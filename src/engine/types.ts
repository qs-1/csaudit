export type Basis = 'transcript' | 'catalog' | 'term' | 'assumption';

export interface Row {
  term: string; // "2025 Fall"
  code: string; // "COMP 102"
  sec?: string; // "B"; lets a registered course be found in the term's section list
  title: string;
  lab: boolean; // title carried the "*" prefix
  ip: boolean; // in progress (no grade yet)
  grade: string;
  rep: boolean; // "R" flag: this attempt was replaced by a later one
  odd?: string; // a grade the reader doesn't know (e.g. "T"); the row counts as in progress until one is set
  att: number;
  ern: number;
  pts: number;
}
export interface Totals { att: number; ern: number; pts: number }
export interface Transcript { rows: Row[]; totals: Totals | null }

export interface CatCourse { code: string; title: string; credits: number; prereq?: string[]; alt?: string }
export interface AllGroup { id: string; label: string; kind: 'all'; courses: CatCourse[] }
export interface PoolGroup {
  id: string; label: string; kind: 'pool'; need: number; credits: number;
  slotLabel: string; depts: string[]; lab?: boolean;
  /** Courses that met this slot's credits in the checklist's catalog year, with titles. Lets a later drop in credits be noticed. */
  eligible?: Record<string, string>;
}
export type Group = AllGroup | PoolGroup;

/** An optional specialization: at least `need` of a pool group's courses taken from `courses`. */
export interface Track { id: string; label: string; group: string; need: number; courses: string[] }

/** Registration and graduation rules that differ between programs or catalog years. */
export interface Policy {
  regularLoad: number; // most credits without a petition
  maxLoad: number; // hard ceiling, with a petition
  maxLoadNeedsLab: boolean; // the ceiling is only allowed when a lab course is part of the load
  minRegularSemesters: number;
  tenureYears: number;
  exemptionReplacement: string; // pool group that gains a slot for every exempted course
}

export interface Catalog {
  id: string;
  institution: string;
  program: string;
  short: string;
  batch: number;
  admits: number[]; // entry years this catalog applies to
  catalogYear: string;
  label: string;
  verified: string;
  source: string;
  /** Official documents for this batch. `kind` places them on the Documents screen; a kind with no entry shows as not added. */
  links?: { kind?: 'checklist' | 'roadmap' | 'catalogue'; label: string; note?: string; href: string }[];
  totalCredits: number; premedExtra: number; minCgpa: number; minMajorCgpa: number;
  upper: { level: number; min: number };
  policy: Policy;
  majorDepts: string[]; majorInclude?: string[]; majorExclude: string[]; poolExclude: string[];
  labCodes: string[]; exemptible: string[];
  groups: Group[]; tracks?: Track[]; deficiency: CatCourse[];
}

export interface Assumptions {
  totalCredits: number | null; // null = catalog default
  exempt: string[]; // exempted course codes
  premed: boolean; // MATH 101/102 deficiency
  track: string | null; // chosen specialization, null for none
}
export const DEFAULT_ASSUMPTIONS: Assumptions = { totalCredits: null, exempt: [], premed: false, track: null };

export interface Meeting { days: string; start: number | null; end: number | null; room?: string }
export interface Section {
  course: string; sec: string; title: string; credits: number;
  meetings: Meeting[]; instructor: string; avail: number; cap: number;
}
export interface Term {
  id: string;
  label: string; // "Spring 2027"
  asOf: string;
  sections: Section[];
}

export type LineState = 'done' | 'ip' | 'missing' | 'exempt';
export type Readiness = 'ready' | 'wait' | 'blocked';
export interface Line {
  key: string;
  group: string;
  code: string; // course code, or slot label for an unfilled pool slot
  title: string;
  credits: number;
  state: LineState;
  grade: string;
  term: string; // term it was taken or is being taken in
  slot: boolean; // unfilled pool slot (no specific course yet)
  basis: Basis;
  evidence: string;
  prereq: { code: string; state: 'done' | 'ip' | 'missing' }[];
  readiness: Readiness;
  lab: boolean;
  depts?: string[];
}

export interface Stats { att: number; qp: number; cgpa: number; matt: number; mqp: number; mgpa: number }

export type Status = 'clear' | 'final' | 'progress' | 'blocked';
export interface Verdict {
  status: Status;
  headline: string;
  detail: string;
  /** Things in the way: shown as warnings. */
  notes: string[];
  /** How the numbers came out (a retake adds no credits, why the open term can't take everything). */
  facts: string[];
}

export interface Result {
  lines: Line[];
  extra: { code: string; title: string; state: 'done' | 'ip'; credits: number; grade: string; term: string }[];
  earned: number; ipCredits: number; target: number;
  reqCredits: number; free: number; need: number;
  stats: Stats;
  upper: { done: number; withIp: number; min: number };
  track: { label: string; done: number; withIp: number; need: number } | null;
  semesters: number; // regular semesters on the transcript, including the current one
  currentTerm: string;
  nextTerm: string;
  firstYear: number;
  missing: Line[]; // lines still to register, in catalog order
  inProgress: { code: string; title: string }[];
  /** In-progress retakes of courses already passed: they replace the grade and add no credits. */
  retakes: { code: string; title: string; term: string; replaces: string; credits: number }[];
  /**
   * The term the student is registered in whose registration is still open (its sections are published), when it is
   * the newest term on the transcript. What is left may still fit into it.
   */
  open: OpenTerm | null;
  verdict: Verdict;
}

export interface OpenTerm {
  term: string;
  /** Credits registered, retakes included. */
  load: number;
  lab: boolean;
  /** Registered plus what is left. */
  total: number;
  /** What is left can be added to this term: load limits, prerequisites and the semester minimum allow it. */
  fits: boolean;
  /** Why it doesn't fit, when it doesn't. */
  why: string;
  /** When only the load is in the way: dropping these retakes (they add no credits) would make room. */
  swap?: { codes: string[]; total: number };
}
