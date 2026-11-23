import { stats } from './gpa';
import { isRegular, nextRegular, sortTerms, termLabel, termYear } from './terms';
import { zoneFor } from './zone';
import type { Assumptions, CatCourse, Catalog, Line, OpenTerm, PoolGroup, Readiness, Result, Row, Verdict } from './types';

export interface AuditOptions {
  /**
   * Current credits per course, from the newest scraped sections. They replace the checklist's credits for
   * every course not passed yet. Passed courses keep the credits the transcript gives them.
   */
  termCredits?: Record<string, number>;
  /** The newest term with published sections ("2027 Spring"): registration for it is still open. */
  openTerm?: string;
  /** Courses that count as a lab in the newest term's sections (they meet in a lab), whatever their credits. */
  labs?: string[];
}

export interface CreditChange { code: string; title: string; from: number; to: number; note?: string }

/**
 * Checklist courses whose current credits differ from what the checklist says. Covers three places:
 * required courses, their alternates, and pool courses that no longer give the credits the slot asks for
 * (a 4-credit science lab that is now 3).
 */
export function creditChanges(cat: Catalog, current: Record<string, number>): CreditChange[] {
  const out: CreditChange[] = [];
  for (const g of cat.groups) {
    if (g.kind === 'all') {
      for (const c of g.courses) {
        const now = current[c.code];
        if (now !== undefined && now !== c.credits) out.push({ code: c.code, title: c.title, from: c.credits, to: now });
        const alt = c.alt ? current[c.alt] : undefined;
        if (c.alt && alt !== undefined && alt !== c.credits) out.push({ code: c.alt, title: `Alternative to ${c.code}`, from: c.credits, to: alt });
      }
    } else {
      for (const [code, title] of Object.entries(g.eligible ?? {})) {
        const now = current[code];
        if (now !== undefined && now < g.credits) out.push({ code, title, from: g.credits, to: now, note: `${g.label} asks for ${g.credits} credits on this checklist` });
      }
    }
  }
  return out;
}

export const dept = (c: string) => c.split(' ')[0]!;
export const level = (c: string) => parseInt(c.split(' ')[1] ?? '0', 10);
const DEFAULT_COURSE_CREDITS = 3;

/** Maximum bipartite matching (Kuhn). Returns, for each slot, the index of its candidate or -1. */
export function matchSlots(slots: string[][], cands: string[]): number[] {
  const owner: number[] = cands.map(() => -1);
  const tryFor = (s: number, seen: boolean[]): boolean => {
    for (let c = 0; c < cands.length; c++) {
      if (seen[c] || !slots[s]!.includes(dept(cands[c]!))) continue;
      seen[c] = true;
      if (owner[c] === -1 || tryFor(owner[c]!, seen)) { owner[c] = s; return true; }
    }
    return false;
  };
  slots.forEach((_, s) => tryFor(s, cands.map(() => false)));
  const out = slots.map(() => -1);
  owner.forEach((s, c) => { if (s >= 0) out[s] = c; });
  return out;
}

/** Every code a fixed requirement claims, including alternates. These never fill a pool slot. */
export function fixedCodes(cat: Catalog, premed = false): Set<string> {
  const out = new Set<string>(cat.poolExclude);
  for (const g of cat.groups) if (g.kind === 'all') for (const c of g.courses) { out.add(c.code); if (c.alt) out.add(c.alt); }
  if (premed) for (const c of cat.deficiency) out.add(c.code);
  return out;
}

export function audit(tr: { rows: Row[] }, cat: Catalog, as: Assumptions, opts: AuditOptions = {}): Result {
  const rows = tr.rows.filter((r) => !r.rep && r.code);
  const done: Record<string, Row> = {};
  const ip: Record<string, Row> = {};
  for (const r of rows) {
    if (r.ip) ip[r.code] = r;
    else if (r.ern > 0) done[r.code] = r;
  }
  const tc = opts.termCredits ?? {};
  // A retake in progress of a passed course adds nothing new: the new grade replaces the old one.
  const retakes = Object.keys(ip).filter((c) => done[c]).map((c) => ({
    code: c, title: ip[c]!.title, term: ip[c]!.term, replaces: done[c]!.grade, credits: tc[c] ?? done[c]!.ern,
  }));
  for (const r of retakes) delete ip[r.code];
  const retaking = new Map(retakes.map((r) => [r.code, r]));
  const labSet = new Set([...cat.labCodes, ...rows.filter((r) => r.lab).map((r) => r.code), ...(opts.labs ?? [])]);
  const exempt = new Set(as.exempt.filter((c) => cat.exemptible.includes(c)));
  const fixed = fixedCodes(cat, as.premed);

  const retakeNote = (c: string) => {
    const r = retaking.get(c);
    return r ? `Retaking in ${termLabel(r.term)}, +0 cr` : '';
  };

  const lines: Line[] = [];
  const prereqState = (c: string) => (done[c] ? 'done' : ip[c] ? 'ip' : 'missing') as 'done' | 'ip' | 'missing';

  const fixedLine = (c: CatCourse, group: string): Line => {
    const base = {
      key: `${group}:${c.code}`, group, code: c.code, title: c.title, slot: false,
      prereq: (c.prereq ?? []).map((p) => ({ code: p, state: prereqState(p) })), lab: labSet.has(c.code),
    };
    const viaAlt = !done[c.code] && c.alt && done[c.alt] ? c.alt : undefined;
    const t = tc[c.code];
    const changed = t !== undefined && t !== c.credits ? `${c.credits} cr in the ${cat.catalogYear} checklist` : '';
    const d = done[c.code] ?? (c.alt ? done[c.alt] : undefined);
    const p = d ? undefined : ip[c.code] ?? (c.alt ? ip[c.alt] : undefined);
    if (d) {
      const now = tc[d.code];
      const taken = now !== undefined && now !== d.ern ? `Counted at ${d.ern} cr, ${now} cr now` : '';
      return { ...base, credits: d.ern, state: 'done', grade: d.grade, term: d.term, basis: 'transcript', readiness: 'ready',
        evidence: [viaAlt ? `Taken as ${viaAlt}` : '', taken, retakeNote(d.code)].filter(Boolean).join(' · ') };
    }
    if (p) {
      // In-progress rows carry no credits on the transcript yet.
      return { ...base, credits: tc[p.code] ?? c.credits, state: 'ip', grade: '', term: p.term, basis: 'transcript', readiness: 'ready',
        evidence: [p.code !== c.code ? `Taking as ${p.code}` : '', changed].filter(Boolean).join(' · ') };
    }
    if (exempt.has(c.code)) {
      return { ...base, credits: 0, state: 'exempt', grade: '', term: '', basis: 'assumption', readiness: 'ready', evidence: 'Exempt' };
    }
    return { ...base, credits: t ?? c.credits, state: 'missing', grade: '', term: '', basis: t !== undefined ? 'term' : 'catalog',
      readiness: 'ready', evidence: changed };
  };

  let exemptExtra = 0;
  for (const g of cat.groups) {
    if (g.kind !== 'all') continue;
    for (const c of g.courses) {
      const l = fixedLine(c, g.id);
      if (l.state === 'exempt') exemptExtra++;
      lines.push(l);
    }
  }
  if (as.premed) for (const c of cat.deficiency) lines.push(fixedLine(c, 'deficiency'));

  // Pools: every pool slot competes for the same taken courses, matched so one course fills one slot.
  const pools = cat.groups.filter((g): g is PoolGroup => g.kind === 'pool');
  const slots: { g: PoolGroup; n: number }[] = [];
  for (const g of pools) {
    const n = g.need + (g.id === cat.policy.exemptionReplacement ? exemptExtra : 0);
    for (let i = 0; i < n; i++) slots.push({ g, n: i });
  }
  const taken = [...Object.keys(done), ...Object.keys(ip)].filter((c) => !fixed.has(c));
  taken.sort((a, b) => (done[a] ? 0 : 1) - (done[b] ? 0 : 1) || a.localeCompare(b));
  const m = matchSlots(slots.map((s) => s.g.depts), taken);
  const used = new Set<string>();
  slots.forEach((s, i) => {
    const code = m[i]! >= 0 ? taken[m[i]!]! : undefined;
    const base = { key: `${s.g.id}:${s.n}`, group: s.g.id, prereq: [], readiness: 'ready' as Readiness, depts: s.g.depts };
    if (code) {
      used.add(code);
      const d = done[code];
      const r = (d ?? ip[code])!;
      lines.push({ ...base, code, title: r.title, slot: false, lab: !!s.g.lab || r.lab,
        credits: d ? d.ern : tc[code] ?? s.g.credits, state: d ? 'done' : 'ip', grade: d ? d.grade : '', term: r.term,
        basis: 'transcript', evidence: [d && tc[code] !== undefined && tc[code] !== d.ern ? `Counted at ${d.ern} cr, ${tc[code]} cr now` : '', d ? retakeNote(code) : ''].filter(Boolean).join(' · ') });
    } else {
      lines.push({ ...base, code: s.g.slotLabel, title: '', slot: true, lab: !!s.g.lab, credits: s.g.credits, state: 'missing',
        grade: '', term: '', basis: 'catalog', evidence: s.g.depts.join(' · ') });
    }
  });

  const extra = taken.filter((c) => !used.has(c)).map((c) => {
    const d = done[c];
    const r = (d ?? ip[c])!;
    return { code: c, title: r.title, state: (d ? 'done' : 'ip') as 'done' | 'ip', grade: d?.grade ?? '', term: r.term,
      credits: d ? d.ern : tc[c] ?? DEFAULT_COURSE_CREDITS };
  });

  for (const l of lines) {
    if (l.state !== 'missing') continue;
    l.readiness = l.prereq.some((p) => p.state === 'missing') ? 'blocked' : l.prereq.some((p) => p.state === 'ip') ? 'wait' : 'ready';
  }

  // Matches the transcript's own earned total, so repeatable courses taken twice both count.
  const earned = rows.filter((r) => !r.ip).reduce((a, r) => a + r.ern, 0);
  const ipCredits = lines.filter((l) => l.state === 'ip').reduce((a, l) => a + l.credits, 0)
    + extra.filter((e) => e.state === 'ip').reduce((a, e) => a + e.credits, 0);
  const missing = lines.filter((l) => l.state === 'missing');
  const reqCredits = missing.reduce((a, l) => a + l.credits, 0);
  const target = (as.totalCredits ?? cat.totalCredits) + (as.premed ? cat.premedExtra : 0);
  const free = Math.max(0, target - earned - ipCredits - reqCredits);
  const need = reqCredits + free;

  const codesWithIp = [...Object.keys(done), ...Object.keys(ip)];
  const upper = {
    done: Object.keys(done).filter((c) => level(c) >= cat.upper.level).length,
    withIp: codesWithIp.filter((c) => level(c) >= cat.upper.level).length,
    min: cat.upper.min,
  };
  const tr0 = cat.tracks?.find((t) => t.id === as.track);
  const track = tr0 ? {
    label: tr0.label, need: tr0.need,
    done: tr0.courses.filter((c) => done[c]).length,
    withIp: tr0.courses.filter((c) => done[c] || ip[c]).length,
  } : null;

  const allTerms = sortTerms([...new Set(rows.map((r) => r.term).filter(Boolean))]);
  const reg = allTerms.filter(isRegular);
  const lastReg = reg[reg.length - 1] ?? '';
  const firstYear = allTerms.length ? termYear(allTerms[0]!) : 0;

  // Registered in a term that is still open for registration: what is left might be added to it.
  let open: OpenTerm | null = null;
  const openRows = opts.openTerm && opts.openTerm === allTerms[allTerms.length - 1]
    ? tr.rows.filter((r) => r.ip && !r.rep && r.code && r.term === opts.openTerm) : [];
  if (openRows.length) {
    const p = cat.policy;
    const load = openRows.reduce((a, r) => a + (tc[r.code] ?? (done[r.code]?.ern || DEFAULT_COURSE_CREDITS)), 0);
    // A course filling the science lab slot is a lab course, at 4 credits or at 3.
    const labLines = new Set(lines.filter((l) => l.lab && !l.slot).map((l) => l.code));
    const lab = openRows.some((r) => labSet.has(r.code) || labLines.has(r.code)) || missing.some((l) => l.lab);
    const total = load + need;
    const zone = zoneFor(total, p, lab);
    const inOpen = new Set(openRows.map((r) => r.code));
    // A course can't be taken alongside its own prerequisite.
    const waits = missing.find((l) => !l.slot && l.prereq.some((x) => x.state === 'missing' || inOpen.has(x.code)));
    const why = need === 0 ? ''
      : zone === 'over' ? `${load} registered + ${need} left is ${total} credits, over the ${p.maxLoad} limit`
      : zone === 'lab' ? `${total} credits is only allowed with a lab course`
      : waits ? `${waits.code} needs ${waits.prereq.filter((x) => x.state === 'missing' || inOpen.has(x.code)).map((x) => x.code).join(' and ')} first`
      : reg.length < p.minRegularSemesters ? `that would be ${reg.length} regular semesters, the minimum is ${p.minRegularSemesters}`
      : '';
    open = { term: opts.openTerm!, load, lab, total, fits: need > 0 && !why, why };
    // Over the load only because of retakes, which add no credits: dropping them would make room.
    const dropping = retakes.filter((x) => x.term === opts.openTerm);
    if (need > 0 && (zone === 'over' || zone === 'lab') && !waits && reg.length >= p.minRegularSemesters && dropping.length) {
      const alt = total - dropping.reduce((a, x) => a + x.credits, 0);
      if (zoneFor(alt, p, lab) !== 'over' && zoneFor(alt, p, lab) !== 'lab') open.swap = { codes: dropping.map((x) => x.code), total: alt };
    }
  }

  const partial: Omit<Result, 'verdict'> = {
    lines, extra, earned, ipCredits, target, reqCredits, free, need, retakes, open,
    stats: stats(tr.rows, cat), upper, track, semesters: reg.length,
    currentTerm: allTerms[allTerms.length - 1] ?? '',
    nextTerm: nextRegular(lastReg), firstYear, missing,
    inProgress: Object.values(ip).map((r) => ({ code: r.code, title: r.title })),
  };
  return { ...partial, verdict: decide(partial, cat) };
}

const f2 = (n: number) => n.toFixed(2);

/** Longest run of still-missing courses that each need the one before. */
function chainDepth(missing: Line[]): number {
  const byCode = new Map(missing.filter((l) => !l.slot).map((l) => [l.code, l]));
  const memo = new Map<string, number>();
  const depth = (code: string, seen: Set<string>): number => {
    if (memo.has(code)) return memo.get(code)!;
    const l = byCode.get(code);
    if (!l || seen.has(code)) return 0;
    seen.add(code);
    const d = 1 + Math.max(0, ...l.prereq.filter((p) => p.state === 'missing').map((p) => depth(p.code, seen)));
    seen.delete(code);
    memo.set(code, d);
    return d;
  };
  return Math.max(missing.length ? 1 : 0, ...[...byCode.keys()].map((c) => depth(c, new Set())));
}

/** "PKST 101", "PKST 101 and 2 free elective credits", or a credit count when the list would be long. */
function leftList(r: Omit<Result, 'verdict'>): string {
  const items = r.missing.map((l) => l.code);
  if (r.free > 0) items.push(`${r.free} free elective credit${r.free === 1 ? '' : 's'}`);
  if (items.length > 3) return `${r.need} more credits`;
  return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] ?? '';
}

function decide(r: Omit<Result, 'verdict'>, cat: Catalog): Verdict {
  const p = cat.policy;
  const notes: string[] = [];
  const next = termLabel(r.nextTerm);
  const lowCgpa = r.stats.att > 0 && r.stats.cgpa < cat.minCgpa;
  const lowMajor = r.stats.matt > 0 && r.stats.mgpa < cat.minMajorCgpa;

  if (lowCgpa) notes.push(`CGPA ${f2(r.stats.cgpa)} is below the required ${f2(cat.minCgpa)}`);
  if (lowMajor) notes.push(`Major CGPA ${f2(r.stats.mgpa)} is below the required ${f2(cat.minMajorCgpa)}`);
  // Upper-level courses come late by design; the count only matters once two semesters or less are left.
  if (r.upper.withIp < r.upper.min && r.need <= 2 * p.regularLoad) notes.push(`${r.upper.withIp} of ${r.upper.min} required ${cat.upper.level}+ level courses`);
  if (r.track && r.track.withIp < r.track.need) notes.push(`${r.track.withIp} of ${r.track.need} ${r.track.label} electives`);
  if (r.firstYear && r.nextTerm && termYear(r.nextTerm) - r.firstYear >= p.tenureYears) notes.push(`Near the ${p.tenureYears}-year degree limit`);
  // Not problems, just how the numbers came out. The easy one to miss: a retake fills a timetable slot but not the credit count.
  const facts: string[] = [];
  for (const x of r.retakes) facts.push(`${x.code} in ${termLabel(x.term)} is a retake: it replaces the ${x.replaces} and adds no credits`);

  if (r.need === 0) {
    return r.ipCredits > 0
      ? { status: 'clear', headline: 'Nothing left to register', detail: 'Every requirement is done or in progress.', notes, facts }
      : { status: 'clear', headline: 'Requirements complete', detail: 'Every requirement on the checklist is done.', notes, facts };
  }

  // Registered in a term that's still open: what's left may still go into it.
  if (r.open && !lowCgpa && !lowMajor) {
    const o = r.open;
    const label = termLabel(o.term);
    if (o.fits) {
      const petition = o.total > p.regularLoad ? `, with an overload petition for ${o.total} credits` : '';
      return { status: 'final', headline: `${r.need} credits to graduate`, detail: `Add ${leftList(r)} to ${label} and it can be your last semester${petition}.`, notes, facts };
    }
    if (o.swap) {
      const what = `${o.swap.codes.join(' and ')} retake${o.swap.codes.length > 1 ? 's' : ''}`;
      return {
        status: 'final', headline: `${r.need} credits to graduate`,
        detail: `${termLabel(r.nextTerm)} can be your last semester. Or ${label}, if you swap the ${what} for ${leftList(r)}.`,
        notes, facts: [...facts, `${label} with everything: ${o.why}`],
      };
    }
    facts.push(`Can't all go into ${label}: ${o.why}`);
  }

  // Prerequisite chains set a floor: each link needs its own semester.
  if (r.need > p.maxLoad) {
    const terms = Math.max(Math.ceil(r.need / p.regularLoad), chainDepth(r.missing));
    return {
      status: 'progress',
      headline: `${r.need} credits left`,
      detail: `At least ${terms} more semester${terms === 1 ? '' : 's'} at ${p.regularLoad} credits each.`,
      notes, facts,
    };
  }

  const stuck = r.missing.find((l) => !l.slot && l.readiness === 'blocked');
  if (stuck) {
    const pre = stuck.prereq.filter((x) => x.state === 'missing').map((x) => x.code).join(' and ');
    return { status: 'blocked', headline: `${stuck.code} needs ${pre} first`, detail: `A course and its prerequisite can't be taken in the same semester, so ${next} can't be the last.`, notes, facts };
  }
  const termsAfter = r.semesters + 1;
  if (termsAfter < p.minRegularSemesters) {
    return { status: 'blocked', headline: `${r.need} credits left`, detail: `Finishing in ${next} would be ${termsAfter} regular semesters. The minimum is ${p.minRegularSemesters}.`, notes, facts };
  }
  if (lowCgpa || lowMajor) {
    return { status: 'blocked', headline: `${r.need} credits to graduate`, detail: `${lowCgpa ? 'CGPA' : 'Major CGPA'} has to reach ${f2(lowCgpa ? cat.minCgpa : cat.minMajorCgpa)} to graduate.`, notes, facts };
  }
  const needsLab = r.missing.some((l) => l.lab);
  if (r.need > p.regularLoad && r.need === p.maxLoad && p.maxLoadNeedsLab && !needsLab) {
    notes.push(`${p.maxLoad} credits is only allowed with a lab course`);
  }
  return {
    status: 'final',
    headline: `${r.need} credits to graduate`,
    detail: r.need > p.regularLoad ? `${next} can be your last semester with an overload petition.` : `${next} can be your last semester.`,
    notes, facts,
  };
}
