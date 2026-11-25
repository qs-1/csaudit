import { dept, fixedCodes, matchSlots } from './audit';
import { canRetake } from './gpa';
import type { Catalog, Line, PoolGroup, Result, Row, Section } from './types';

export const DAYS = ['M', 'T', 'W', 'R', 'F', 'S'] as const;
export type Day = (typeof DAYS)[number];
export const DAY_SHORT: Record<string, string> = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat' };
export const DAY_LONG: Record<string, string> = { M: 'Monday', T: 'Tuesday', W: 'Wednesday', R: 'Thursday', F: 'Friday', S: 'Saturday' };

export const sid = (s: Section) => `${s.course} ${s.sec}`;
export const hm = (x: number) => `${String((x / 60) | 0).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
export const isUnscheduled = (s: Section) => s.meetings.every((m) => m.start == null);
export const hasSeats = (s: Pick<Section, 'avail' | 'cap'>) => s.avail > 0 || s.cap === 0;

export function clash(a: Section, b: Section): boolean {
  if (a.course === b.course) return false;
  return a.meetings.some((x) =>
    b.meetings.some((y) =>
      x.start != null && y.start != null && x.end != null && y.end != null &&
      [...x.days].some((d) => y.days.includes(d)) && x.start < y.end && y.start < x.end));
}
export function clashPairs(secs: Section[]): [Section, Section][] {
  const out: [Section, Section][] = [];
  secs.forEach((a, i) => secs.slice(i + 1).forEach((b) => { if (clash(a, b)) out.push([a, b]); }));
  return out;
}

/** Days with at least one meeting, in week order. Saturday only shows up when something meets then. */
export function daysUsed(secs: Section[]): Day[] {
  const used = new Set(secs.flatMap((s) => s.meetings.flatMap((m) => (m.start == null ? [] : [...m.days]))));
  return DAYS.filter((d) => used.has(d));
}

export interface Block { section: Section; day: Day; start: number; end: number; room?: string }
export function blocksFor(secs: Section[]): Block[] {
  const out: Block[] = [];
  for (const s of secs) for (const m of s.meetings) {
    if (m.start == null || m.end == null) continue;
    for (const d of m.days) out.push({ section: s, day: d as Day, start: m.start, end: m.end, room: m.room });
  }
  return out.sort((a, b) => a.start - b.start || a.section.course.localeCompare(b.section.course));
}

export { zoneFor, type Zone } from './zone';

/** A separate weekly block of 100 minutes or more on one day, beside the lectures: the lab. */
export const hasLabMeeting = (s: Section) =>
  s.meetings.length > 1 && s.meetings.some((m) => m.start != null && m.end != null && m.days.length === 1 && m.end - m.start >= 100);

/**
 * Counts as a lab course for the load rules. Science labs were 4 credits for earlier batches and are 3 now,
 * so the credits alone can't tell: the lab meeting on the timetable can.
 */
export function isLabSection(s: Section, cat: Catalog): boolean {
  if (cat.labCodes.includes(s.course)) return true;
  const labDepts = cat.groups.filter((g): g is PoolGroup => g.kind === 'pool' && !!g.lab).flatMap((g) => g.depts);
  return labDepts.includes(dept(s.course)) && (s.credits >= 4 || hasLabMeeting(s));
}

/** Courses with a lab section in a term's list, for the audit's load check. */
export function labCourses(sections: Section[], cat: Catalog): string[] {
  return [...new Set(sections.filter((s) => isLabSection(s, cat)).map((s) => s.course))];
}

export interface Load { load: number; fresh: number; retaken: number }
/**
 * `fresh` = credits for courses not passed before and not already counted as in progress (`counted`: courses
 * registered on the transcript). Retakes add load but no new earned credits.
 */
export function loadOf(secs: Section[], passed: Set<string>, counted: Set<string> = new Set()): Load {
  const load = secs.reduce((a, s) => a + s.credits, 0);
  const retaken = secs.filter((s) => passed.has(s.course)).reduce((a, s) => a + s.credits, 0);
  const already = secs.filter((s) => !passed.has(s.course) && counted.has(s.course)).reduce((a, s) => a + s.credits, 0);
  return { load, fresh: load - retaken - already, retaken };
}

/* ---------- What a course would do for this student ---------- */

export type Role =
  | { kind: 'required'; line: Line }
  | { kind: 'slot'; group: PoolGroup }
  | { kind: 'free' }
  | { kind: 'retake'; grade: string }
  | { kind: 'passed'; grade: string }
  | { kind: 'ip' }
  | { kind: 'exempt' }
  | { kind: 'extra' };

export interface RoleContext {
  roleOf: (code: string) => Role;
  passed: Set<string>;
}

export function roleContext(rows: Row[], res: Result, cat: Catalog, premed: boolean): RoleContext {
  const passed = new Map<string, string>();
  const ip = new Set<string>();
  for (const r of rows) {
    if (r.rep || !r.code) continue;
    if (r.ip) ip.add(r.code);
    else if (r.ern > 0) passed.set(r.code, r.grade);
  }
  const named = new Map(res.missing.filter((l) => !l.slot).map((l) => [l.code, l]));
  const exempt = new Set(res.lines.filter((l) => l.state === 'exempt').map((l) => l.code));
  const openSlots = new Map<string, PoolGroup>();
  for (const l of res.missing) {
    if (!l.slot) continue;
    const g = cat.groups.find((x): x is PoolGroup => x.id === l.group && x.kind === 'pool');
    if (g) for (const d of g.depts) if (!openSlots.has(d)) openSlots.set(d, g);
  }
  const fixed = fixedCodes(cat, premed);
  const roleOf = (code: string): Role => {
    const line = named.get(code);
    if (line) return { kind: 'required', line };
    if (passed.has(code)) {
      const g = passed.get(code)!;
      return canRetake(g) ? { kind: 'retake', grade: g } : { kind: 'passed', grade: g };
    }
    if (ip.has(code)) return { kind: 'ip' };
    if (exempt.has(code)) return { kind: 'exempt' };
    if (!fixed.has(code)) {
      const g = openSlots.get(dept(code));
      if (g) return { kind: 'slot', group: g };
    }
    return res.free > 0 ? { kind: 'free' } : { kind: 'extra' };
  };
  return { roleOf, passed: new Set(passed.keys()) };
}

/* ---------- How far a set of sections goes towards what is left ---------- */

export interface Coverage {
  named: { line: Line; section?: Section }[];
  slots: { line: Line; section?: Section }[];
  freeLeft: number;
  freeSections: Section[];
  complete: boolean;
}

export function coverage(res: Result, chosen: Section[], passed: Set<string>): Coverage {
  const byCourse = new Map(chosen.map((s) => [s.course, s]));
  const namedLines = res.missing.filter((l) => !l.slot);
  const namedCodes = new Set(namedLines.map((l) => l.code));
  const slotLines = res.missing.filter((l) => l.slot);
  const cands = chosen.filter((s) => !namedCodes.has(s.course) && !passed.has(s.course));
  const m = matchSlots(slotLines.map((l) => l.depts ?? []), cands.map((s) => s.course));
  const slots = slotLines.map((line, i) => ({ line, section: m[i]! >= 0 ? cands[m[i]!] : undefined }));
  const usedBySlots = new Set(slots.flatMap((s) => (s.section ? [s.section.course] : [])));
  const freeSections = cands.filter((s) => !usedBySlots.has(s.course));
  const named = namedLines.map((line) => ({ line, section: byCourse.get(line.code) }));
  // A section worth fewer credits than its requirement assumed (a 3-credit course in the 4-credit lab slot) still fills
  // it, but the total degree credits don't change, so the difference moves to free electives, as the audit does.
  const short = [...named, ...slots].reduce((a, x) => a + (x.section ? x.line.credits - x.section.credits : 0), 0);
  const freeLeft = Math.max(0, res.free + short - freeSections.reduce((a, s) => a + s.credits, 0));
  return {
    named, slots, freeLeft, freeSections,
    complete: named.every((n) => n.section) && slots.every((s) => s.section) && freeLeft === 0,
  };
}

/* ---------- Timetable suggestions ---------- */

export interface Prefs { earliest: number; latest: number; daysOff: string[]; skipFull: boolean }
export const DEFAULT_PREFS: Prefs = { earliest: 0, latest: 24 * 60, daysOff: [], skipFull: true };

export interface Option { sections: Section[]; score: number; days: number; first: number; last: number; gaps: number; credits: number }

function measure(secs: Section[], p: Prefs) {
  let penalty = 0;
  const byDay: Record<string, [number, number][]> = {};
  for (const sec of secs) for (const m of sec.meetings) {
    if (m.start == null || m.end == null) continue;
    if (m.start < p.earliest) penalty += 40 + (p.earliest - m.start) / 5;
    if (m.end > p.latest) penalty += 40 + (m.end - p.latest) / 5;
    for (const d of m.days) {
      if (p.daysOff.includes(d)) penalty += 200;
      (byDay[d] ??= []).push([m.start, m.end]);
    }
  }
  let gaps = 0, first = 24 * 60, last = 0;
  for (const spans of Object.values(byDay)) {
    spans.sort((a, b) => a[0] - b[0]);
    first = Math.min(first, spans[0]![0]);
    last = Math.max(last, spans[spans.length - 1]![1]);
    for (let i = 1; i < spans.length; i++) gaps += Math.max(0, spans[i]![0] - spans[i - 1]![1]);
  }
  const days = Object.keys(byDay).length;
  return { score: penalty + days * 25 + gaps / 10, days, gaps, first: days ? first : 0, last };
}

/** Whether a section keeps to the limits: nothing on a day off, nothing before the start or after the finish. */
export function fitsPrefs(s: Section, p: Prefs): boolean {
  return s.meetings.every((m) => ![...m.days].some((d) => p.daysOff.includes(d))
    && (m.start == null || m.start >= p.earliest) && (m.end == null || m.end <= p.latest));
}

/** Courses offered this term with no section inside the limits. Suggestions leave these out and say so. */
export const unfit = (courses: string[], by: Record<string, Section[]>, prefs: Prefs) =>
  courses.filter((c) => (by[c]?.length ?? 0) > 0 && !by[c]!.some((s) => fitsPrefs(s, prefs)));

export interface Extra {
  /** Courses worth taking if they fit, as long as the total lands inside `credits`. */
  maybe?: string[];
  /** Total credits (pinned sections included) a suggestion has to land in. Only used with `maybe`. */
  credits?: [min: number, max: number];
}

/** Sections of a course a suggestion may use: inside the limits, and open ones first when asked. */
function poolOf(c: string, by: Record<string, Section[]>, prefs: Prefs): Section[] {
  const all = (by[c] ?? []).filter((s) => fitsPrefs(s, prefs));
  const open = prefs.skipFull ? all.filter(hasSeats) : all;
  return open.length ? open : all;
}

const creditsOf = (secs: Section[]) => secs.reduce((a, s) => a + s.credits, 0);

/**
 * Proposes up to `k` clash-free timetables: every course in `courses`, any of `extra.maybe` that fit, and the `fixed`
 * (pinned) sections as they are. Depth-first search, most constrained course first, scored on preferences, days on
 * campus and gaps. With optional courses the best timetable for each different set of courses comes first, so the
 * options aren't four versions of the same week. Deterministic: ties break on section ids.
 */
export function autofill(courses: string[], by: Record<string, Section[]>, fixed: Section[], prefs: Prefs, k = 4, extra: Extra = {}): Option[] {
  // Days off and times are limits, not wishes: a section outside them is never suggested.
  const pool = (c: string) => poolOf(c, by, prefs);
  const order = (cs: string[]) => cs.filter((c) => pool(c).length).sort((a, b) => pool(a).length - pool(b).length || a.localeCompare(b));
  const need = order(courses);
  const maybe = order((extra.maybe ?? []).filter((c) => !courses.includes(c)));
  const [lo, hi] = maybe.length && extra.credits ? extra.credits : [0, Infinity];
  const todo = [...need, ...maybe];
  if (!todo.length) return [];
  // Most credits the optional courses still to come could add, to stop early when the minimum is out of reach.
  const most = maybe.map((c) => Math.max(...pool(c).map((s) => s.credits)));
  const reach = todo.map((_, i) => most.slice(Math.max(0, i - need.length)).reduce((a, b) => a + b, 0));
  const found: (Option & { key: string; set: string })[] = [];
  let leaves = 0;
  const walk = (i: number, chosen: Section[], cr: number) => {
    if (leaves > 50000 || cr > hi) return;
    if (i === todo.length) {
      leaves++;
      if (cr < lo) return;
      const all = [...fixed, ...chosen];
      found.push({ sections: chosen, ...measure(all, prefs), credits: cr, key: chosen.map(sid).sort().join('|'), set: chosen.map((s) => s.course).sort().join('|') });
      return;
    }
    if (i >= need.length && cr + reach[i]! < lo) return;
    for (const s of pool(todo[i]!)) {
      if (fixed.some((o) => clash(o, s)) || chosen.some((o) => clash(o, s))) continue;
      walk(i + 1, [...chosen, s], cr + s.credits);
    }
    if (i >= need.length) walk(i + 1, chosen, cr); // an optional course can be left out
  };
  walk(0, [], creditsOf(fixed));
  found.sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));
  let picked = found;
  if (maybe.length) {
    const firsts = new Set<string>();
    const best = found.filter((o) => (firsts.has(o.set) ? false : (firsts.add(o.set), true)));
    picked = [...best, ...found.filter((o) => !best.includes(o))];
  }
  return picked.filter((o) => o.sections.length).slice(0, k).map(({ key: _key, set: _set, ...o }) => o);
}

/**
 * Why `autofill` found nothing, in plain lines, most useful first: a course that clashes with a pinned section in every
 * section, two courses that always clash, a credit range out of reach, or which single course is in the way.
 */
export function explainNone(courses: string[], by: Record<string, Section[]>, fixed: Section[], prefs: Prefs, extra: Extra = {}): string[] {
  const out: string[] = [];
  const pool = (c: string) => poolOf(c, by, prefs);
  const need = courses.filter((c) => pool(c).length);
  const blocked = new Set<string>();
  for (const c of need) {
    const hit = fixed.filter((f) => pool(c).some((s) => clash(f, s)));
    if (hit.length && pool(c).every((s) => fixed.some((f) => clash(f, s)))) {
      blocked.add(c);
      out.push(`${c} clashes with your pinned ${hit.map(sid).join(', ')} in every section`);
    }
  }
  for (let i = 0; i < need.length; i++) for (let j = i + 1; j < need.length; j++) {
    const a = need[i]!, b = need[j]!;
    if (blocked.has(a) || blocked.has(b)) continue;
    if (pool(a).every((x) => pool(b).every((y) => clash(x, y)))) out.push(`${a} and ${b} clash in every section`);
  }
  if (out.length) return out;
  const maybe = (extra.maybe ?? []).filter((c) => !courses.includes(c) && pool(c).length);
  if (maybe.length && extra.credits) {
    const [lo, hi] = extra.credits;
    const base = creditsOf(fixed) + need.reduce((a, c) => a + Math.min(...pool(c).map((s) => s.credits)), 0);
    const top = base + maybe.reduce((a, c) => a + Math.max(...pool(c).map((s) => s.credits)), 0);
    if (base > hi) return [`What you need already comes to ${base} credits, over your ${hi}`];
    if (top < lo) return [`Everything together comes to ${top} credits at most, under your ${lo}`];
    // When the required courses fit on their own, the range is what's in the way.
    if (autofill(need, by, fixed, prefs, 1).length) return [`Nothing fits between ${lo} and ${hi} credits. Try a wider range or more optional courses`];
  }
  const without = need.length > 1 ? need.filter((c) => autofill(need.filter((x) => x !== c), by, fixed, prefs, 1).length > 0) : [];
  if (without.length && without.length < need.length) {
    out.push(`Leaving out ${without.length === 1 ? without[0] : `${without.slice(0, -1).join(', ')} or ${without.at(-1)}`} makes the rest fit`);
  } else {
    out.push(`No clash-free mix of all ${need.length} courses within these limits`);
  }
  return out;
}

export function groupByCourse(secs: Section[]): Record<string, Section[]> {
  const out: Record<string, Section[]> = {};
  for (const s of secs) (out[s.course] ??= []).push(s);
  return out;
}

/** Seats are only worth showing when at least one section differs from its offered count. */
export const seatsMeaningful = (secs: Section[]) => secs.some((s) => s.avail !== s.cap);
