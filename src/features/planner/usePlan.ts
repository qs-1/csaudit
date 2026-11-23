import { useMemo } from 'react';
import { create } from 'zustand';
import {
  clashPairs, coverage, isLabSection, loadOf, sid, zoneFor,
  type Coverage, type Load, type Section, type Zone,
} from '@/engine';
import type { Model } from '@/state/model';
import { actions, DROPPED, useStore, type Plan } from '@/state/store';

/** Sections shown as a ghost on the timetable while hovering a choice. */
export const usePreview = create<{ secs: Section[] }>()(() => ({ secs: [] }));
export const preview = (secs: Section[] | Section | null) =>
  usePreview.setState({ secs: secs ? (Array.isArray(secs) ? secs : [secs]) : [] });

const EMPTY: Plan = {};
const PALETTE = 8;

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable colours: each course prefers a colour from its code and takes the next free one on a collision. */
function assignColors(courses: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  for (const c of courses) {
    let i = hash(c) % PALETTE;
    for (let k = 0; k < PALETTE && used.has(i); k++) i = (i + 1) % PALETTE;
    used.add(i);
    out.set(c, i);
  }
  return out;
}

export const colorVar = (i: number | undefined) => (i === undefined ? '--fg-3' : `--c${i}`);
/** Text colour that reads on a solid course colour (set with the palette). */
export const onVar = (i: number | undefined) => (i === undefined ? '--surface' : `--c${i}-on`);

export interface PlanState {
  termId: string;
  plan: Plan;
  chosen: Section[];
  stale: string[];
  clashes: [Section, Section][];
  clashIds: Set<string>;
  colors: Map<string, number>;
  load: Load;
  zone: Zone;
  hasLab: boolean;
  cov: Coverage;
  /** Credits still needed, counting registered courses dropped in this plan. */
  need: number;
  /** Registered on the transcript for this term, by course. */
  registered: Map<string, Section>;
  /** Registered courses this plan drops. */
  dropped: Section[];
  inPlan: (course: string) => Section | undefined;
  clashWith: (s: Section) => Section[];
}

/** Takes a course off the plan: a picked one is unpicked, a registered one is marked as dropped. */
export function removeFromPlan(p: PlanState, course: string) {
  if (p.registered.has(course)) actions.pick(p.termId, course, DROPPED);
  else actions.unpick(p.termId, course);
}
/** Puts back what `removeFromPlan` took off. */
export function restoreToPlan(p: PlanState, s: Section) {
  if (p.registered.get(s.course)?.sec === s.sec) actions.unpick(p.termId, s.course);
  else actions.pick(p.termId, s.course, s.sec);
}

export function usePlan(m: Model): PlanState {
  const termId = m.termEntry.id;
  const plan = useStore((s) => s.plans[termId]) ?? EMPTY;
  return useMemo(() => {
    const by = m.sections;
    // The registration on the transcript is the starting point. A pick for a registered course switches its section,
    // DROPPED drops it.
    const registered = new Map(m.registered.map((s) => [s.course, s]));
    const entries = Object.entries(plan).filter(([, sec]) => sec !== DROPPED);
    const picked = entries.flatMap(([c, sec]) => by[c]?.find((s) => s.sec === sec) ?? []);
    const kept = m.registered.filter((s) => !(s.course in plan));
    const chosen = [...kept, ...picked];
    const dropped = m.registered.filter((s) => plan[s.course] === DROPPED);
    const stale = m.term ? entries.filter(([c, sec]) => !by[c]?.some((s) => s.sec === sec)).map(([c]) => c) : [];
    const clashes = clashPairs(chosen);
    const hasLab = chosen.some((s) => isLabSection(s, m.catalog));
    const counted = new Set(registered.keys());
    const load = loadOf(chosen, m.roles.passed, counted);
    // A dropped course that wasn't a retake takes its credits back off what's in progress.
    const lost = dropped.filter((s) => !m.roles.passed.has(s.course)).reduce((a, s) => a + s.credits, 0);
    const res = lost ? { ...m.result, free: m.result.free + lost, need: m.result.need + lost } : m.result;
    const byCourse = new Map(chosen.map((s) => [s.course, s]));
    return {
      termId, plan, chosen, stale, clashes,
      clashIds: new Set(clashes.flatMap(([a, b]) => [sid(a), sid(b)])),
      colors: assignColors(chosen.map((s) => s.course)),
      load, hasLab,
      zone: zoneFor(load.load, m.catalog.policy, hasLab),
      // Registered courses are already in the audit's in-progress credits, so only the rest count towards what's left.
      cov: coverage(res, chosen.filter((s) => !counted.has(s.course)), m.roles.passed),
      need: res.need,
      registered, dropped,
      inPlan: (c) => byCourse.get(c),
      clashWith: (s) => chosen.filter((o) => o.course !== s.course && clashPairs([o, s]).length > 0),
    };
  }, [plan, m.sections, m.term, m.catalog, m.result, m.roles, m.registered, termId]);
}
