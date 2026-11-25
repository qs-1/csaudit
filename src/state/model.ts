import { useEffect, useMemo, useState } from 'react';
import {
  audit, groupByCourse, isRegular, labCourses, nextRegular, notices, sortTerms, roleContext, selfCheck, termSeries,
  type Catalog, type Notice, type Result, type Row, type RoleContext, type Section, type Term, type TermPoint, type Transcript,
} from '@/engine';
import { CURRENT, defaultTerm, detectProgram, programById, TERMS, type TermEntry } from '@/data/registry';
import { useLiveSeats, type LiveSeats } from '@/lib/seats';
import { memoLast } from '@/lib/utils';
import { useStore } from './store';

/* ---------- Section lists load on demand and stay cached ---------- */

const EMPTY: Row[] = [];
const NO_TRANSCRIPT: Transcript = { rows: EMPTY, totals: null };
const cache = new Map<string, Term>();
const pending = new Map<string, Promise<Term>>();

function loadTerm(entry: TermEntry): Promise<Term> {
  const hit = cache.get(entry.id);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(entry.id);
  if (!p) {
    p = entry.load().then((t) => { cache.set(entry.id, t); return t; });
    p.catch(() => pending.delete(entry.id));
    pending.set(entry.id, p);
  }
  return p;
}

export function useTermData(entry: TermEntry): { term: Term | null; failed: boolean } {
  const [state, setState] = useState<{ id: string; term: Term | null; failed: boolean }>(() => ({ id: entry.id, term: cache.get(entry.id) ?? null, failed: false }));
  useEffect(() => {
    let live = true;
    if (cache.has(entry.id)) setState({ id: entry.id, term: cache.get(entry.id)!, failed: false });
    else loadTerm(entry).then(
      (term) => live && setState({ id: entry.id, term, failed: false }),
      () => live && setState({ id: entry.id, term: null, failed: true }),
    );
    return () => { live = false; };
  }, [entry]);
  return state.id === entry.id ? state : { term: cache.get(entry.id) ?? null, failed: false };
}

/**
 * The hourly snapshot with fresher counts on top, where the seat alerts poller has them (departments someone
 * watches, seen in the last 10 minutes). Only counts it saw after the snapshot replace it.
 */
export function overlayLive(t: Term | null, live: LiveSeats): Term | null {
  if (!t || !live.size) return t;
  const asOf = Date.parse(t.asOf);
  let changed = false;
  const sections = t.sections.map((s) => {
    const l = live.get(`${s.course}|${s.sec}`);
    if (!l || !(l[2] > asOf)) return s;
    changed = true;
    return { ...s, avail: l[0], cap: l[1], live: l[2] };
  });
  return changed ? { ...t, sections } : t;
}
const withLive = memoLast(overlayLive);

/* ---------- The audit model every screen reads from ---------- */

// Newest scraped credits first, then the planning term's own sections on top once they load.
// Sections are published for the newest term only while its registration is open.
const OPEN_TERM = TERMS[TERMS.length - 1]?.key;
const NO_TERM = { termCredits: CURRENT.credits, openTerm: OPEN_TERM };
const auditOptions = memoLast((t: Term | null, cat: Catalog) => {
  if (!t) return NO_TERM;
  const out: Record<string, number> = { ...CURRENT.credits };
  const seen = new Set<string>();
  for (const s of t.sections) if (!seen.has(s.course)) { seen.add(s.course); out[s.course] = s.credits; }
  return { termCredits: out, openTerm: OPEN_TERM, labs: labCourses(t.sections, cat) };
});
const runAudit = memoLast(audit);
const upcoming = memoLast((rows: Row[]) => nextRegular(sortTerms(rows.map((r) => r.term).filter(isRegular)).pop() ?? ''));
const roles = memoLast(roleContext);
const series = memoLast(termSeries);
const check = memoLast(selfCheck);
const notify = memoLast((rows: Row[], cat: Catalog, raw: string, detected: boolean, problems: string[]) => notices(rows, cat, { raw, detected, problems }));
const NONE: Notice[] = [];
const byCourse = memoLast((t: Term | null) => groupByCourse(t?.sections ?? []));
const NO_REG = { sections: [] as Section[], unplaced: [] as string[] };
/** Courses the transcript shows registered in the planning term, found in its section list by section letter. */
const registration = memoLast((rows: Row[], key: string, by: Record<string, Section[]>) => {
  const mine = rows.filter((r) => r.ip && !r.rep && r.code && r.term === key);
  if (!mine.length) return NO_REG;
  const sections: Section[] = [];
  const unplaced: string[] = [];
  for (const r of mine) {
    const offered = by[r.code] ?? [];
    const s = offered.find((x) => x.sec === r.sec) ?? (offered.length === 1 ? offered[0] : undefined);
    if (s) sections.push(s);
    else unplaced.push(r.code);
  }
  return { sections, unplaced };
});

export interface Model {
  /** No transcript: the planner alone, without degree requirements. */
  bare: boolean;
  transcript: Transcript;
  catalog: Catalog;
  result: Result;
  roles: RoleContext;
  series: TermPoint[];
  problems: string[];
  /** Things that could make the numbers quietly wrong. Shown above the overview. */
  notices: Notice[];
  termEntry: TermEntry;
  term: Term | null;
  termFailed: boolean;
  sections: Record<string, Section[]>;
  /** Already registered in the planning term (from the transcript): the plan starts from these. */
  registered: Section[];
  /** Registered in the planning term but not found in its section list. */
  unplaced: string[];
}

export function useModel(): Model | null {
  const stored = useStore((s) => s.transcript);
  const planOnly = useStore((s) => s.planOnly);
  const transcript = stored ?? (planOnly ? NO_TRANSCRIPT : null);
  const programId = useStore((s) => s.programId);
  const assumptions = useStore((s) => s.assumptions);
  const termId = useStore((s) => s.termId);
  const raw = useStore((s) => s.transcriptText);

  const catalog = useMemo(
    () => programById(programId) ?? detectProgram(transcript?.rows ?? []),
    [programId, transcript],
  );

  const termEntry = TERMS.find((t) => t.id === termId) ?? defaultTerm(upcoming(transcript?.rows ?? EMPTY));
  const { term: snapshot, failed } = useTermData(termEntry);
  const term = withLive(snapshot, useLiveSeats(snapshot ? termEntry.id : null));

  if (!transcript) return null;
  const bare = !stored;
  const result = runAudit(transcript, catalog, assumptions, auditOptions(term, catalog));
  const problems = check(transcript);
  const sections = byCourse(term);
  const reg = term ? registration(transcript.rows, termEntry.key, sections) : NO_REG;
  return {
    bare, transcript, catalog, result,
    roles: roles(transcript.rows, result, catalog, assumptions.premed),
    series: series(transcript.rows),
    problems,
    notices: bare ? NONE : notify(transcript.rows, catalog, raw, !programById(programId), problems),
    termEntry, term, termFailed: failed,
    sections,
    registered: reg.sections,
    unplaced: reg.unplaced,
  };
}
