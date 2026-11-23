import { dept } from './audit';
import { unreadCodes } from './parse';
import { sortTerms, termYear } from './terms';
import type { Catalog, Row } from './types';

/** Something the audit can't settle on its own, worth a line above the results. The UI words it. */
export type Notice =
  | { kind: 'scope'; major: number; total: number }
  | { kind: 'entry'; year: number }
  | { kind: 'grade'; rows: { code: string; grade: string }[] }
  | { kind: 'unread'; codes: string[] }
  | { kind: 'totals'; problems: string[] };

/** Departments in FCCU's Bachelor's catalogs, so a course code is told apart from other capitals and digits. */
const FCCU_DEPTS = [
  'ARTS', 'BIOL', 'BIOT', 'BUSN', 'CHEM', 'CHIN', 'COMP', 'CPPG', 'CRIM', 'CRST', 'CSCS', 'DATA', 'ECON', 'EDUC', 'ENGL',
  'ENVR', 'FREN', 'GEOG', 'GEOL', 'GRMN', 'HIST', 'HPED', 'ISLM', 'KORN', 'LING', 'MATH', 'MBIO', 'MCOM', 'MICR', 'MUSC',
  'PHIL', 'PHRM', 'PHYS', 'PKST', 'PLSC', 'PSYC', 'SOCL', 'SPAN', 'STAT', 'UNIV', 'URDU', 'WRCM',
];

function knownDepts(rows: Row[], cat: Catalog): Set<string> {
  const out = new Set([...FCCU_DEPTS, ...cat.majorDepts]);
  for (const g of cat.groups) {
    if (g.kind === 'pool') g.depts.forEach((d) => out.add(d));
    else g.courses.forEach((c) => out.add(dept(c.code)));
  }
  for (const r of rows) if (r.code) out.add(dept(r.code));
  return out;
}

/**
 * Cases where the numbers could be quietly wrong: a transcript from another program, an entry year with no
 * checklist (the closest one is used), grades the reader doesn't know, courses in the text that never became rows,
 * and totals that don't add up. `detected` is false when the student picked the checklist themselves.
 */
export function notices(rows: Row[], cat: Catalog, o: { raw: string; detected: boolean; problems: string[] }): Notice[] {
  const out: Notice[] = [];
  const codes = [...new Set(rows.filter((r) => !r.rep && r.code).map((r) => r.code))];
  const major = codes.filter((c) => cat.majorDepts.includes(dept(c))).length;
  if (codes.length >= 6 && major * 6 < codes.length) out.push({ kind: 'scope', major, total: codes.length });

  const first = sortTerms([...new Set(rows.map((r) => r.term).filter(Boolean))])[0];
  if (o.detected && first && !cat.admits.includes(termYear(first))) out.push({ kind: 'entry', year: termYear(first) });

  const odd = rows.filter((r) => r.odd && !r.rep).map((r) => ({ code: r.code, grade: r.odd! }));
  if (odd.length) out.push({ kind: 'grade', rows: odd });

  const unread = o.raw ? unreadCodes(o.raw, rows, knownDepts(rows, cat)) : [];
  if (unread.length) out.push({ kind: 'unread', codes: unread });

  if (o.problems.length) out.push({ kind: 'totals', problems: o.problems });
  return out;
}
