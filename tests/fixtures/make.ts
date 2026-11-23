// Synthetic, anonymised transcripts. No real student data. Shapes follow what the parser expects.
import { GP } from '../../src/engine/gpa';

export interface Spec { term: string; code: string; title: string; grade: string | null; att: number; rep?: boolean }
export type Style = 'chrome' | 'safari' | 'firefox';

const T = (term: string, rows: [string, string, string | null, number][]): Spec[] =>
  rows.map(([code, title, grade, att]) => ({ term, code, title, grade, att }));

export const MAIN: Spec[] = [
  ...T('2023 Fall', [['COMP 102', 'Programming I', 'A', 4], ['COMP 113', 'Discrete Mathematics', 'B+', 3], ['MATH 111', 'Calculus & Analytical Geometry', 'B', 3], ['UNIV 100', 'Foundation of University Education', 'A', 3], ['WRCM 101', 'Writing and Communication I', 'A-', 3]]),
  ...T('2024 Spring', [['COMP 111', 'Programming II', 'B', 4], ['COMP 206', 'Digital Logic Design', 'B+', 3], ['STAT 115', 'Probability & Statistics', 'A-', 3], ['WRCM 102', 'Writing and Communication II', 'B', 3], ['PKST 101', 'Pakistan Studies', 'A', 2]]),
  ...T('2024 Fall', [['COMP 200', 'Data Structures & Algorithms', 'B', 4], ['CSCS 201', 'Multivariate Calculus', 'C+', 3], ['CSCS 202', 'Computational Linear Algebra', 'B', 3], ['URDU 101', 'Communicative Urdu', 'A', 3], ['ISLM 101', 'Islamic Education', 'A', 3]]),
  ...T('2025 Spring', [['COMP 213', 'Database Systems', 'B', 3], ['COMP 220', 'Software Engineering', 'A-', 3], ['COMP 300', 'Computer Organization', 'B-', 3], ['CSCS 203', 'Differential Equations', 'C', 3], ['PHIL 101', 'Intro to Philosophy', 'B', 3]]),
  ...T('2025 Fall', [['COMP 301', 'Operating Systems', 'B', 3], ['COMP 302', 'Theory of Automata', 'B', 3], ['COMP 303', 'Design & Analysis of Algorithms', 'B+', 3], ['CSCS 105', '*Basic Electronics', 'B', 4], ['PSYC 101', 'Intro to Psychology', 'A', 3]]),
  ...T('2026 Spring', [['COMP 360', 'Intro to Artificial Intelligence', 'B', 3], ['COMP 410', 'Parallel & Distributed Computing', 'B', 3], ['CSCS 320', 'Numerical Computing', 'B+', 3], ['SOCL 101', 'Intro to Sociology', 'A', 3], ['ENGL 101', 'English Literature', 'B', 3], ['COMP 451', 'Compiler Construction', 'B', 3]]),
  ...T('2026 Summer', [['COMP 331', 'Elective One', 'B', 3], ['COMP 332', 'Elective Two', 'B+', 3], ['CSCS 330', 'Elective Three', 'A-', 3], ['COMP 333', 'Elective Four', 'B', 3]]),
  ...T('2026 Fall', [['COMP 311', 'Computer Networks', null, 3], ['COMP 497A', 'Senior Project A', null, 3], ['COMP 401', 'Ethics', null, 1]]),
];

export const without = (s: Spec[], ...codes: string[]) => s.filter((r) => !codes.includes(r.code));
export const withRows = (s: Spec[], ...extra: Spec[]) => [...s, ...extra];
export const setAtt = (s: Spec[], code: string, att: number) => s.map((r) => (r.code === code ? { ...r, att } : r));

const SECTION = ['A', 'B', 'C'];
const fmt = (n: number) => n.toFixed(3);

function cells(r: Spec, i: number): string[] {
  const base = [r.code.split(' ')[0]!, r.code.split(' ')[1]!, SECTION[i % 3]!, ...r.title.split(' '), 'MWF', '9:00/9:50', 'Smith'];
  if (r.grade === null) return base;
  const ern = r.grade === 'F' ? 0 : r.att;
  return [...base, r.grade, ...(r.rep ? ['R'] : []), fmt(r.att), fmt(ern), fmt((GP[r.grade] ?? 0) * r.att)];
}

export function paste(specs: Spec[], style: Style = 'chrome'): string {
  const sep = style === 'safari' ? '\n' : style === 'firefox' ? '\u00a0' : ' ';
  const terms = [...new Set(specs.map((s) => s.term))];
  const live = specs.filter((s) => !s.rep && s.grade !== null);
  const att = live.reduce((a, r) => a + r.att, 0);
  const ern = live.reduce((a, r) => a + (r.grade === 'F' ? 0 : r.att), 0);
  const pts = live.reduce((a, r) => a + (GP[r.grade!] ?? 0) * r.att, 0);
  const out: string[] = ['Student Record', 'Name: Test Student', 'Address: 1 Example Road, Lahore', 'Phone: 0300-0000000', 'Email: student@example.invalid', ''];
  for (const t of terms) {
    out.push(`Show/Hide ${t}`);
    specs.filter((s) => s.term === t).forEach((r, i) => {
      let c = cells(r, i);
      if (style === 'firefox') c = [`${c[0]}${c[1]}`, ...c.slice(2)]; // "COMP102": code and number run together
      out.push(c.join(sep));
    });
    out.push('Term Totals 16.000 16.000 60.000 3.750');
  }
  out.push(`Undergraduate Institutional Totals 0 ${att} ${ern} ${fmt(pts)} ${fmt(att ? pts / att : 0)}`);
  return out.join('\n');
}
