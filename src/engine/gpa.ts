import { sortTerms } from './terms';
import type { Catalog, Row, Stats } from './types';

export const GP: Record<string, number> = {
  A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, F: 0,
};
export const GRADES = Object.keys(GP);
/** FCCU only allows retaking a course graded C- or lower. */
export const canRetake = (grade: string) => grade in GP && GP[grade]! <= GP['C-']!;
/** Grades that carry no earned credit. */
export const NO_CREDIT = new Set(['F', 'W', 'NP', 'I']);
const dept = (code: string) => code.split(' ')[0]!;

export function isMajor(code: string, cat: Catalog): boolean {
  if (cat.majorExclude.includes(code)) return false;
  return cat.majorDepts.includes(dept(code)) || !!cat.majorInclude?.includes(code);
}

export function stats(rows: Row[], cat: Catalog): Stats {
  const live = rows.filter((r) => !r.rep && !r.ip);
  const att = live.reduce((a, r) => a + r.att, 0);
  const qp = live.reduce((a, r) => a + r.pts, 0);
  const mj = live.filter((r) => isMajor(r.code, cat));
  const matt = mj.reduce((a, r) => a + r.att, 0);
  const mqp = mj.reduce((a, r) => a + r.pts, 0);
  return { att, qp, cgpa: att ? qp / att : 0, matt, mqp, mgpa: matt ? mqp / matt : 0 };
}

export interface TermPoint { term: string; gpa: number; cgpa: number; credits: number; att: number }

/**
 * Term GPA and the CGPA as it stood after each term. A replaced attempt counts until the
 * attempt that replaces it is graded, the way the transcript itself would have read at the time.
 */
export function termSeries(rows: Row[]): TermPoint[] {
  const graded = rows.filter((r) => !r.ip && r.code && r.grade in GP);
  const out: TermPoint[] = [];
  const live: Row[] = [];
  for (const term of sortTerms([...new Set(graded.map((r) => r.term))])) {
    const these = graded.filter((r) => r.term === term);
    for (const r of these) {
      const old = live.findIndex((o) => o.code === r.code && o.rep);
      if (old >= 0) live.splice(old, 1);
      live.push(r);
    }
    const tAtt = these.reduce((a, r) => a + r.att, 0);
    const tPts = these.reduce((a, r) => a + r.pts, 0);
    const cAtt = live.reduce((a, r) => a + r.att, 0);
    const cPts = live.reduce((a, r) => a + r.pts, 0);
    if (!tAtt) continue;
    out.push({ term, gpa: tPts / tAtt, cgpa: cAtt ? cPts / cAtt : 0, credits: these.reduce((a, r) => a + r.ern, 0), att: tAtt });
  }
  return out;
}

/**
 * Grades an in-progress retake will replace. Until the new grade is in they still count, so a target has to
 * take them out and grade the course again.
 */
export function replacedByIp(rows: Row[]): { att: number; pts: number; codes: string[] } {
  const ip = new Set(rows.filter((r) => r.ip && !r.rep && r.code).map((r) => r.code));
  const old = rows.filter((r) => !r.ip && !r.rep && ip.has(r.code) && r.grade in GP && r.att > 0);
  return { att: old.reduce((a, r) => a + r.att, 0), pts: old.reduce((a, r) => a + r.pts, 0), codes: old.map((r) => r.code) };
}

/** `ipTerm` is set when a retake of this attempt is already registered (the term it is in): picking a grade then says how it will go, and adds no load. */
export interface RetakeOption { code: string; title: string; grade: string; att: number; pts: number; major: boolean; term: string; ipTerm?: string }

/** Attempts graded C- or lower, which FCCU allows retaking as often as needed. A course already being retaken stays, marked with `ipTerm`. */
export function retakeOptions(rows: Row[], cat: Catalog): RetakeOption[] {
  const retaking = new Map(rows.filter((r) => r.ip).map((r) => [r.code, r.term] as const));
  return rows
    .filter((r) => !r.rep && !r.ip && canRetake(r.grade) && r.att > 0)
    .map((r) => ({ code: r.code, title: r.title, grade: r.grade, att: r.att, pts: r.pts, major: isMajor(r.code, cat), term: r.term, ...(retaking.has(r.code) ? { ipTerm: retaking.get(r.code)! } : {}) }))
    .sort((a, b) => GP[a.grade]! - GP[b.grade]! || b.att - a.att);
}

export interface RetakeEffect { cgpa: number; mgpa: number; loadCredits: number; qp: number; mqp: number }

/** Applies chosen retake grades. Load rises by the retaken credits (not for a retake already registered); the old attempt is replaced. */
export function applyRetakes(s: Stats, opts: RetakeOption[], picks: Record<string, string | undefined>): RetakeEffect {
  let qp = s.qp, mqp = s.mqp, load = 0;
  for (const o of opts) {
    const g = picks[o.code];
    if (!g || !(g in GP)) continue;
    const d = GP[g]! * o.att - o.pts;
    qp += d;
    if (o.major) mqp += d;
    if (!o.ipTerm) load += o.att; // a registered retake is already in the load
  }
  return { qp, mqp, cgpa: s.att ? qp / s.att : 0, mgpa: s.matt ? mqp / s.matt : 0, loadCredits: load };
}

export function letterFor(avg: number): string {
  for (const g of ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D'] as const) if (avg >= GP[g]! - 1e-9) return g;
  return 'F';
}

/** The lowest straight grade that on its own averages at least `avg`, so "B+ or better" really does get you there. */
/** "B+ or better", or for an average between A- and A, which no single grade gives. */
export function gradeHint(avg: number): string {
  if (avg >= 4 - 1e-9) return "Straight A's";
  if (avg > GP['A-']! + 1e-9) return 'Between A- and A';
  return `${letterToReach(avg)} or better`;
}

export function letterToReach(avg: number): string {
  for (const g of ['F', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A'] as const) if (GP[g]! >= avg - 1e-9) return g;
  return 'A';
}

export interface Solve {
  target: number; credits: number; required: number; reachable: boolean; maxPossible: number; minPossible: number; letter: string; already: boolean;
}

/**
 * The average grade point needed on `credits` still to be graded to finish on `target`.
 * `qp` and `att` are the current quality points and attempted credits.
 */
export function solveTarget(qp: number, att: number, credits: number, target: number): Solve {
  const total = att + credits;
  const maxPossible = total ? (qp + 4 * credits) / total : 0;
  const minPossible = total ? qp / total : 0;
  if (credits <= 0) {
    const cur = att ? qp / att : 0;
    return { target, credits, required: cur, reachable: cur >= target, maxPossible: cur, minPossible: cur, letter: letterFor(cur), already: cur >= target - 1e-9 };
  }
  const required = (target * total - qp) / credits;
  return {
    target, credits, required: Math.max(0, required), reachable: required <= 4 + 1e-9, maxPossible, minPossible,
    letter: letterToReach(Math.max(0, required)), already: required <= 0,
  };
}
