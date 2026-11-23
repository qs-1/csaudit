import { describe, expect, it } from 'vitest';
import catalog from '../src/data/programs/cs-2023-24.json';
import catalog26 from '../src/data/programs/cs-2026-27.json';
import { audit, creditChanges, matchSlots } from '../src/engine/audit';
import { applyRetakes, gradeHint, replacedByIp, retakeOptions, solveTarget, stats, termSeries } from '../src/engine/gpa';
import { isScheduleTranscript, linesFromItems, parseTranscript, selfCheck } from '../src/engine/parse';
import { autofill, clash, coverage, explainNone, groupByCourse, isLabSection, labCourses, loadOf, roleContext, unfit, zoneFor } from '../src/engine/plan';
import { notices } from '../src/engine/notices';
import { decodePlan, encodePlan, icsFor, termStartGuess } from '../src/engine/share';
import { nextRegular, sortTerms } from '../src/engine/terms';
import { DEFAULT_ASSUMPTIONS, type Catalog, type Section } from '../src/engine/types';
import { MAIN, paste, setAtt, withRows, without, type Spec } from './fixtures/make';

const cat = catalog as unknown as Catalog;
const run = (specs: Spec[], a = {}, o = {}) => audit(parseTranscript(paste(specs)), cat, { ...DEFAULT_ASSUMPTIONS, ...a }, o);
const codes = (ls: { code: string }[]) => ls.map((l) => l.code);

describe('parser', () => {
  it('reads the same rows from Chrome, Safari and Firefox pastes', () => {
    const [c, s, f] = (['chrome', 'safari', 'firefox'] as const).map((st) => parseTranscript(paste(MAIN, st)));
    expect(c!.rows).toHaveLength(MAIN.length);
    expect(s!.rows).toEqual(c!.rows);
    expect(f!.rows).toEqual(c!.rows);
  });
  it('passes its own self-check and drops personal details', () => {
    const t = parseTranscript(paste(MAIN));
    expect(selfCheck(t)).toEqual([]);
    expect(JSON.stringify(t)).not.toMatch(/Test Student|Lahore|example\.invalid|0300/);
  });
  it('flags a mismatch with the transcript totals', () => {
    const t = parseTranscript(paste(MAIN));
    t.rows.pop(); t.rows.pop();
    t.rows.find((r) => r.code === 'COMP 102')!.pts = 0;
    expect(selfCheck(t).length).toBeGreaterThan(0);
  });
  it('detects the lab marker and in-progress rows', () => {
    const t = parseTranscript(paste(MAIN));
    const e = t.rows.find((r) => r.code === 'CSCS 105')!;
    expect(e.lab).toBe(true);
    expect(e.title).toBe('Basic Electronics');
    expect(t.rows.filter((r) => r.ip).map((r) => r.code)).toEqual(['COMP 311', 'COMP 497A', 'COMP 401']);
  });
  it('splits merged codes like MCOM101', () => {
    const t = parseTranscript(paste(withRows(MAIN, { term: '2026 Spring', code: 'MCOM 101', title: 'Media', grade: 'B', att: 3 }), 'firefox'));
    expect(t.rows.some((r) => r.code === 'MCOM 101')).toBe(true);
  });
  it('reads the schedule-style "Unofficial Transcript" PDF, which lists no credits per course', () => {
    const text = [
      'Unofficial Transcript',
      'Term Dept CrseSecTitle Days Time Building Instr Gr',
      '2026FA COMP 311 A Computer Networks M W 11:00/12:50 SBLOCKS219 X Teacher',
      'Term Totals',
      '2026SUMCOM 101 E Introduction to Communication MTWRF02:00/03:30EBLOCKE040 Y Teacher',
      '2025FA CSCS 105 D *Basic Electronics T R 12:30/01:45SBLOCKS029 Z Teacher B-',
      'W 02:00/03:50SBLOCKS027BZ Teacher',
      '2025FA CSCS 203 C Differential Equations T R 02:00/03:15SBLOCKS413 W Teacher A-',
      '2025SP CSCS 203 C Differential Equations M W F 11:00/11:50 SBLOCKS313 V Teacher D R',
      '2023FA ISLM 101 E Islamic Education T R 12:30/01:45EBLOCKE122 U Teacher A-',
      '2023FA WRCM101 BB Writing and Communication I M W F 12:00/12:50EBLOCKE105 T Teacher B',
      'Undergraduate Totals Cr Enrl Cr Att Cr Ern Qual Pts',
      '22 13 13 42',
    ].join('\n');
    // Credits as they were when taken: ISLM 101 was 3 in 2023, 2 today.
    const credits = (code: string, term: string) => ({ 'CSCS 105': 4, 'CSCS 203': 3, 'ISLM 101': term.startsWith('2023') ? 3 : 2 } as Record<string, number>)[code];
    expect(isScheduleTranscript(text)).toBe(true);
    const t = parseTranscript(text, credits);
    expect(t.rows.map((r) => `${r.term}|${r.code}|${r.title}|${r.grade}|${r.att}${r.ip ? '|ip' : ''}${r.rep ? '|R' : ''}${r.lab ? '|lab' : ''}`)).toEqual([
      '2026 Fall|COMP 311|Computer Networks||0|ip',
      '2026 Summer|MCOM 101|Introduction to Communication||0|ip',
      '2025 Fall|CSCS 105|Basic Electronics|B-|4|lab',
      '2025 Fall|CSCS 203|Differential Equations|A-|3',
      '2025 Spring|CSCS 203|Differential Equations|D|3|R',
      '2023 Fall|ISLM 101|Islamic Education|A-|3',
      '2023 Fall|WRCM 101|Writing and Communication I|B|3', // unknown to the lookup: 3
    ]);
    expect(t.totals).toEqual({ att: 13, ern: 13, pts: 42 });
    expect(selfCheck(t)).toEqual([]);
    expect(isScheduleTranscript(paste(MAIN))).toBe(false);
  });
  it('reads the printable transcript with credits after each grade, even when its columns run together', () => {
    const text = [
      'Unofficial Transcript',
      'Term Dept Crse SecTitle Days Time Building Instr Gr Att Ern Pts GPA',
      '2027SP COMP 497BA Senior Project MTWRF12:00/12:00 TBD TBD X Teacher START: 02/01/2027',
      'Term Totals 0 0 0 0',
      '2026SUMCOM101 E Introduction to Communication Studies MTWRF02:00/03:30EBLOCKE040 Y Teacher C 3 3 6',
      'M',
      '2026SPCOMP 301 B Operating Systems M 11:00/12:50 SBLOCKS319 A 3 3 12',
      'Teacher',
      '2025FA CSCS 105 D *Basic Electronics T R 12:30/01:45 SBLOCKS029 Z Teacher B- 4 4 10.8',
      'W 02:00/03:50SBLOCKS027BZ Teacher',
      '2025SPCSCS 203 C Differential Equations M W F 11:00/11:50 SBLOCKS313 V Teacher D R 0 0 0',
      'Term Totals 13.00 13.0028.80 2.215',
      'Undergraduate Totals Cr Enrl Cr Att Cr Ern Qual Pts GPA',
      '16 10 10 28.8 2.880',
      'Overall Undergraduate Totals Cr Enrl Cr Att Cr Ern GPA',
      '16 10 10 28.8 2.880',
    ].join('\n');
    expect(isScheduleTranscript(text)).toBe(true);
    // The lookup would say 2 credits; the transcript's own numbers win.
    const t = parseTranscript(text, () => 2);
    expect(t.rows.map((r) => `${r.term}|${r.code}|${r.sec}|${r.grade}|${r.att}|${r.ern}|${r.pts}${r.ip ? '|ip' : ''}${r.rep ? '|R' : ''}`)).toEqual([
      '2027 Spring|COMP 497B|A||0|0|0|ip',
      '2026 Summer|MCOM 101|E|C|3|3|6',
      '2026 Spring|COMP 301|B|A|3|3|12',
      '2025 Fall|CSCS 105|D|B-|4|4|10.8',
      '2025 Spring|CSCS 203|C|D|0|0|0|R',
    ]);
    expect(t.totals).toEqual({ att: 10, ern: 10, pts: 28.8 });
    expect(selfCheck(t)).toEqual([]);
  });
  it('groups PDF text items into lines by coordinates', () => {
    const txt = linesFromItems([
      { str: 'COMP', x: 10, y: 700, w: 30 }, { str: '102', x: 41, y: 700, w: 20 }, { str: 'Programming', x: 80, y: 701, w: 60 },
      { str: 'Next', x: 10, y: 680, w: 20 },
    ]);
    expect(txt).toBe('COMP102 Programming\nNext');
  });
});

describe('terms', () => {
  it('orders terms and finds the next regular one', () => {
    expect(sortTerms(['2025 Fall', '2025 Spring', '2024 Fall', '2025 Summer'])).toEqual(['2024 Fall', '2025 Spring', '2025 Summer', '2025 Fall']);
    expect(nextRegular('2026 Fall')).toBe('2027 Spring');
    expect(nextRegular('2026 Spring')).toBe('2026 Fall');
  });
});

describe('audit: main student', () => {
  const r = run(MAIN);
  it('counts earned, in-progress and need', () => {
    expect(r.earned).toBe(108);
    expect(r.ipCredits).toBe(7);
    expect(r.need).toBe(17);
    expect(r.semesters).toBe(7);
    expect(r.nextTerm).toBe('2027 Spring');
  });
  it('lists what is still to take, with readiness', () => {
    expect(codes(r.missing)).toEqual(['COMP 421', 'COMP 497B', 'Science lab']);
    expect(r.missing.find((l) => l.code === 'COMP 421')!.readiness).toBe('wait');
  });
  it('can finish next semester', () => {
    expect(r.verdict.status).toBe('final');
    expect(r.verdict.headline).toContain('17 credits');
    expect(r.verdict.detail).toContain('Spring 2027');
    expect(r.verdict.notes.join(' ')).not.toContain('COMP 311');
  });
  it('tags every line with its basis', () => {
    expect(r.lines.every((l) => l.basis)).toBe(true);
    expect(r.lines.find((l) => l.code === 'COMP 102')!.basis).toBe('transcript');
    expect(r.lines.find((l) => l.code === 'COMP 421')!.basis).toBe('catalog');
  });
  it('uses term credits for courses not taken yet', () => {
    const x = run(MAIN, {}, { termCredits: { 'COMP 421': 2 } });
    const l = x.lines.find((l) => l.code === 'COMP 421')!;
    expect(l.credits).toBe(2);
    expect(l.basis).toBe('term');
  });
  it('notes when current credits differ from the checklist', () => {
    const x = run(MAIN, {}, { termCredits: { 'COMP 421': 2 } });
    expect(x.lines.find((l) => l.code === 'COMP 421')!.evidence).toBe('3 cr in the 2023/24 checklist');
    expect(run(MAIN, {}, { termCredits: { 'COMP 421': 3 } }).lines.find((l) => l.code === 'COMP 421')!.evidence).toBe('');
  });
  it('keeps transcript credits for passed courses whatever the current credits', () => {
    const x = run(setAtt(MAIN, 'PKST 101', 3), {}, { termCredits: { 'PKST 101': 2 } });
    const l = x.lines.find((l) => l.code === 'PKST 101')!;
    expect(l.credits).toBe(3);
    expect(l.evidence).toBe('Counted at 3 cr, 2 cr now');
    expect(x.earned).toBe(run(setAtt(MAIN, 'PKST 101', 3)).earned);
  });
  it('lists checklist courses whose credits changed', () => {
    expect(creditChanges(cat, { 'PKST 101': 2, 'COMP 102': 4, 'ISLM 101': 2 })).toEqual([
      { code: 'ISLM 101', title: 'Islamic Education', from: 3, to: 2 },
      { code: 'PKST 101', title: 'Pakistan Studies', from: 3, to: 2 },
    ]);
  });
  it('lists intro science labs that dropped below the 4 credits the checklist asks for', () => {
    const out = creditChanges(cat, { 'BIOL 100': 3, 'CHEM 100': 3, 'BIOL 105': 4, 'ENVR 151': 3, 'PHYS 101': 3 });
    expect(out.map((c) => `${c.code} ${c.from}->${c.to}`)).toEqual(['BIOL 100 4->3', 'CHEM 100 4->3']);
    expect(out[0]!.note).toBe('Science lab asks for 4 credits on this checklist');
  });
  it('lists a change to the alternate of a required course', () => {
    expect(creditChanges(cat, { 'CRST 152': 2 })).toEqual([{ code: 'CRST 152', title: 'Alternative to ISLM 101', from: 3, to: 2 }]);
  });
  it('does not flag a 3-credit lab on a checklist that accepts 3 or 4', () => {
    const c26 = catalog26 as unknown as Catalog;
    expect(creditChanges(c26, { 'BIOL 102': 3, 'BIOL 105': 4 })).toEqual([]);
  });
  it('says when a lab taken at 4 credits now counts for 3', () => {
    const rows = withRows(MAIN, { term: '2024 Fall', code: 'BIOL 100', title: '*Introductory Biology', grade: 'B', att: 4 });
    const l = run(rows, {}, { termCredits: { 'BIOL 100': 3 } }).lines.find((x) => x.group === 'lab')!;
    expect(l.credits).toBe(4);
    expect(l.evidence).toBe('Counted at 4 cr, 3 cr now');
  });
  it('a 3-credit lab still fills the lab slot and leaves exactly one extra free credit', () => {
    const lab = (code: string, att: number) => run(withRows(MAIN, { term: '2026 Fall', code, title: '*Lab', grade: null, att }), {}, { termCredits: { 'BIOL 100': 3, 'BIOL 105': 4 } });
    const three = lab('BIOL 100', 3);
    const four = lab('BIOL 105', 4);
    expect(three.lines.find((l) => l.group === 'lab')!.slot).toBe(false);
    expect(three.lines.find((l) => l.group === 'lab')!.credits).toBe(3);
    expect(three.free).toBe(four.free + 1);
  });
  it('never treats Basic Electronics as the science lab', () => {
    expect(r.lines.find((l) => l.group === 'lab')!.slot).toBe(true);
  });
});

/* A student registered for next term while its registration is still open, with a retake among the courses. */
describe('audit: registered in a term that is still open', () => {
  const OPEN = { openTerm: '2027 Spring' };
  const ip = (code: string, title: string, att: number): Spec => ({ term: '2027 Spring', code, title, grade: null, att });
  const passedD = MAIN.map((r) => (r.code === 'CSCS 201' ? { ...r, grade: 'D' } : r));
  const registered = withRows(passedD, ip('COMP 421', 'Information Security', 3), ip('COMP 497B', 'Senior Project B', 3), ip('CSCS 201', 'Multivariate Calculus', 3));

  it('keeps the section letter of every row', () => {
    const rows = parseTranscript(paste(registered)).rows;
    expect(rows.find((r) => r.code === 'COMP 421')!.sec).toMatch(/^[A-C]$/);
  });

  it('counts a retake of a passed course as no new credits, and says so', () => {
    const r = run(registered, {}, OPEN);
    expect(r.retakes).toEqual([expect.objectContaining({ code: 'CSCS 201', replaces: 'D', term: '2027 Spring' })]);
    expect(r.ipCredits).toBe(7 + 6); // Fall's 7, Spring's 421 and 497B; not the retake
    expect(r.lines.find((l) => l.code === 'CSCS 201')!.evidence).toContain('+0 cr');
    expect(r.verdict.facts.join(' ')).toContain('CSCS 201 in Spring 2027 is a retake');
    expect(r.verdict.notes.join(' ')).not.toContain('retake');
  });

  it('offers the open term when what is left fits into it', () => {
    const r = run(registered, {}, OPEN);
    expect(r.open).toMatchObject({ term: '2027 Spring', load: 9, fits: true });
    expect(r.verdict.status).toBe('final');
    expect(r.verdict.detail).toMatch(/^Add Science lab and \d+ free elective credits to Spring 2027 and it can be your last semester/);
  });

  it('without an open term, finishing comes after the registered term', () => {
    const r = run(registered);
    expect(r.open).toBeNull();
    expect(r.verdict.detail).toContain('Fall 2027');
  });

  it('suggests swapping the retake when only the load is in the way', () => {
    // 18 registered (3 of them the retake) + a 4-credit lab = 22, over 21. Without the retake: 19.
    const heavy = withRows(registered, ip('HIST 104', 'Introduction to History', 3), ip('PSYC 200', 'Social Psychology', 3), ip('ECON 100', 'Principles of Economics', 3));
    const r = run(heavy, {}, OPEN);
    expect(r.need).toBe(4);
    expect(r.open).toMatchObject({ load: 18, total: 22, fits: false, swap: { codes: ['CSCS 201'], total: 19 } });
    expect(r.verdict.detail).toBe('Fall 2027 can be your last semester. Or Spring 2027, if you swap the CSCS 201 retake for Science lab.');
  });

  it('a 3-credit science lab counts as the lab course for 21 credits, as a 4-credit one did', () => {
    // Registered 18 including a 3-credit ENVR course with no "*" marker; what is left takes it to 21 or so.
    const withLab = withRows(registered, ip('ENVR 101', 'Introduction to Environmental Science', 3), ip('HIST 104', 'Introduction to History', 3), ip('PSYC 200', 'Social Psychology', 3), ip('ECON 100', 'Principles of Economics', 3));
    const r = run(withLab, {}, OPEN);
    expect(r.lines.find((l) => l.code === 'ENVR 101')).toMatchObject({ group: 'lab', lab: true });
    expect(r.open!.lab).toBe(true);
    expect(r.open!.why).not.toContain('lab course');
    // The same load without a lab course: 21 is refused.
    const noLab = withRows(registered, ip('PHIL 220', 'Ethics', 3), ip('HIST 104', 'Introduction to History', 3), ip('PSYC 200', 'Social Psychology', 3), ip('ECON 100', 'Principles of Economics', 3));
    const n = run(noLab, {}, OPEN);
    expect(n.open!.lab).toBe(n.missing.some((l) => l.lab));
  });

  it('lab sections: the lab meeting decides, not the credits, for every batch', () => {
    const sec = (course: string, credits: number, meetings: Section['meetings']) => ({ course, sec: 'A', title: '', credits, meetings, instructor: '', avail: 1, cap: 1 }) as Section;
    const envr = sec('ENVR 101', 3, [{ days: 'TR', start: 840, end: 890 }, { days: 'F', start: 840, end: 950 }]);
    const lecture = sec('BIOL 403', 3, [{ days: 'MWF', start: 600, end: 650 }]);
    const oldLab = sec('BIOL 105', 4, [{ days: 'TR', start: 660, end: 735 }]);
    const cs = sec('COMP 451', 3, [{ days: 'T', start: 660, end: 770 }, { days: 'R', start: 660, end: 770 }]);
    for (const c of [cat, catalog26 as unknown as Catalog]) {
      expect(isLabSection(envr, c)).toBe(true);
      expect(isLabSection(lecture, c)).toBe(false);
      expect(isLabSection(oldLab, c)).toBe(true);
      expect(isLabSection(cs, c)).toBe(false);
    }
    expect(labCourses([envr, lecture, oldLab, cs], cat)).toEqual(['ENVR 101', 'BIOL 105']);
    // The audit takes the term's lab courses: a lab registered in the open term lifts the 21-credit limit.
    const r = run(withRows(registered, ip('BIOL 100', 'Intro Biology', 3)), {}, { ...OPEN, labs: ['BIOL 100'] });
    expect(r.open!.lab).toBe(true);
  });

  it('planner load: registered courses add load but not credits towards what is left', () => {
    const s = (course: string, credits: number) => ({ course, credits }) as Section;
    const l = loadOf([s('COMP 421', 3), s('CSCS 201', 3), s('PKST 101', 2)], new Set(['CSCS 201']), new Set(['COMP 421', 'CSCS 201']));
    expect(l).toEqual({ load: 8, fresh: 2, retaken: 3 });
  });
});

describe('audit: other students', () => {
  it('exempted student: exempt lines, extra humanities slots, no credit invented', () => {
    const s = without(MAIN, 'UNIV 100', 'WRCM 101');
    const x = run(s, { exempt: ['UNIV 100', 'WRCM 101'] });
    expect(x.lines.filter((l) => l.state === 'exempt').map((l) => l.code)).toEqual(['UNIV 100', 'WRCM 101']);
    expect(x.lines.filter((l) => l.group === 'hum')).toHaveLength(4);
    expect(x.verdict.status).not.toBe('clear');
    expect(x.need).toBe(x.target - x.earned - x.ipCredits);
  });
  it('does not exempt a course the student actually took', () => {
    const x = run(MAIN, { exempt: ['UNIV 100'] });
    expect(x.lines.find((l) => l.code === 'UNIV 100')!.state).toBe('done');
  });
  it('pre-med student: 138 target and MATH 101/102 required', () => {
    const x = run(MAIN, { premed: true });
    expect(x.target).toBe(138);
    expect(codes(x.missing)).toEqual(expect.arrayContaining(['MATH 101', 'MATH 102']));
    expect(x.lines.find((l) => l.code === 'MATH 102')!.readiness).toBe('blocked');
    const taken = run(withRows(MAIN, { term: '2023 Fall', code: 'MATH 101', title: 'Deficiency', grade: 'B', att: 3 }, { term: '2024 Spring', code: 'MATH 102', title: 'Deficiency', grade: 'B', att: 3 }), { premed: true });
    expect(taken.lines.find((l) => l.code === 'MATH 101')!.state).toBe('done');
    expect(taken.need).toBe(17);
  });
  it('custom credit target overrides the checklist', () => {
    expect(run(MAIN, { totalCredits: 130 }).need).toBe(15);
  });
  it('PKST taken at 3 credits keeps the transcript credits', () => {
    const x = run(setAtt(MAIN, 'PKST 101', 3));
    expect(x.lines.find((l) => l.code === 'PKST 101')!.credits).toBe(3);
    expect(x.earned).toBe(109);
    expect(x.need).toBe(16);
  });
  it('CRST 152 can stand in for ISLM 101', () => {
    const s = MAIN.map((r) => (r.code === 'ISLM 101' ? { ...r, code: 'CRST 152' } : r));
    const x = run(s);
    const l = x.lines.find((l) => l.code === 'ISLM 101')!;
    expect(l.state).toBe('done');
    expect(l.evidence).toContain('CRST 152');
    expect(x.extra.map((e) => e.code)).not.toContain('CRST 152');
  });
  it('blocks the final semester when a prerequisite was never taken', () => {
    const x = run(without(MAIN, 'COMP 311'));
    expect(x.need).toBeLessThanOrEqual(21);
    expect(x.verdict.status).toBe('blocked');
    expect(x.verdict.headline).toContain('COMP 421 needs COMP 311');
  });
  it('counts prerequisite chains when estimating semesters left', () => {
    const x = run(without(MAIN, 'COMP 301', 'COMP 311'));
    expect(x.verdict.status).toBe('progress');
    expect(x.verdict.detail).toContain('3 more semesters');
  });
  it('is clear when everything is done or in progress', () => {
    const s = withRows(MAIN,
      { term: '2026 Summer', code: 'BIOL 101', title: 'Biology Lab', grade: 'B', att: 4 },
      { term: '2026 Fall', code: 'COMP 421', title: 'Information Security', grade: null, att: 3 },
      { term: '2026 Fall', code: 'COMP 497B', title: 'Senior Project B', grade: null, att: 3 });
    const x = run(s, { totalCredits: 125 });
    expect(x.need).toBe(0);
    expect(x.verdict.status).toBe('clear');
    expect(x.verdict.detail).toContain('in progress');
  });
  it('more than 21 credits left is ordinary progress', () => {
    const x = run(without(MAIN, 'COMP 331', 'COMP 332', 'CSCS 330', 'COMP 333'));
    expect(x.need).toBe(29);
    expect(x.verdict.status).toBe('progress');
    expect(x.verdict.detail).toContain('2 more semesters');
  });
  it('a missing prerequisite does not block a student with semesters to go', () => {
    const x = run(without(MAIN, 'COMP 301', 'COMP 311', 'COMP 410', 'COMP 331', 'COMP 332', 'CSCS 330', 'COMP 333'));
    expect(x.verdict.status).toBe('progress');
  });
  it('counts both attempts of a repeatable course in earned credits', () => {
    const x = run(withRows(MAIN, { term: '2026 Summer', code: 'COMP 331', title: 'Topics again', grade: 'A', att: 3 }));
    expect(x.earned).toBe(111);
  });
});

describe('credit load', () => {
  const p = cat.policy;
  it('keeps 19 normal, petitions above it, 21 only with a lab', () => {
    expect(zoneFor(19, p, false)).toBe('ok');
    expect(zoneFor(20, p, false)).toBe('petition');
    expect(zoneFor(21, p, false)).toBe('lab');
    expect(zoneFor(21, p, true)).toBe('petition');
    expect(zoneFor(22, p, true)).toBe('over');
  });
});

describe('slot matching', () => {
  it('never lets one course fill two requirements', () => {
    expect(matchSlots([['PHIL', 'SOCL'], ['SOCL']], ['SOCL 101', 'PHIL 101'])).toEqual([1, 0]);
    const one = matchSlots([['PHIL', 'SOCL'], ['SOCL']], ['SOCL 101']);
    expect(one.filter((x) => x >= 0)).toHaveLength(1);
  });
});

const sec = (course: string, s: string, days: string, start: number, end: number, credits = 3): Section =>
  ({ course, sec: s, title: course, credits, meetings: [{ days, start, end }], instructor: 'X', avail: 10, cap: 10 });
const prefs = { earliest: 0, latest: 1440, daysOff: [] as string[], skipFull: true };

describe('planning', () => {
  const t = parseTranscript(paste(MAIN));
  const r = audit(t, cat, DEFAULT_ASSUMPTIONS);
  const roles = roleContext(t.rows, r, cat, false);

  it('says what each course would count as', () => {
    expect(roles.roleOf('COMP 421').kind).toBe('required');
    expect(roles.roleOf('BIOL 101').kind).toBe('slot');
    expect(roles.roleOf('HIST 101').kind).toBe('free');
    expect(roles.roleOf('CSCS 203').kind).toBe('passed'); // a C can't be retaken, only C- or lower
    const low = t.rows.map((r) => (r.code === 'CSCS 203' ? { ...r, grade: 'D', pts: r.att } : r));
    expect(roleContext(low, audit({ ...t, rows: low }, cat, DEFAULT_ASSUMPTIONS), cat, false).roleOf('CSCS 203').kind).toBe('retake');
    expect(roles.roleOf('COMP 102').kind).toBe('passed');
    expect(roles.roleOf('COMP 311').kind).toBe('ip');
  });
  it('tracks what a plan covers, without counting a course twice', () => {
    const c = coverage(r, [sec('COMP 421', 'A', 'MW', 600, 650), sec('BIOL 101', 'A', 'TR', 600, 700, 4), sec('HIST 101', 'A', 'F', 600, 650)], roles.passed);
    expect(c.named.find((n) => n.line.code === 'COMP 421')!.section).toBeDefined();
    expect(c.slots[0]!.section?.course).toBe('BIOL 101');
    expect(c.freeLeft).toBe(r.free - 3);
    expect(c.complete).toBe(false);
  });
  it('moves the missing credit to free electives when a 3-credit course fills the 4-credit lab slot', () => {
    const four = coverage(r, [sec('BIOL 101', 'A', 'TR', 600, 700, 4)], roles.passed);
    const three = coverage(r, [sec('BIOL 101', 'A', 'TR', 600, 700, 3)], roles.passed);
    expect(three.slots[0]!.section?.course).toBe('BIOL 101');
    expect(three.freeLeft).toBe(four.freeLeft + 1);
  });
  it('detects clashes only on shared days and overlapping times', () => {
    expect(clash(sec('A 1', 'A', 'MW', 600, 650), sec('B 1', 'A', 'W', 640, 700))).toBe(true);
    expect(clash(sec('A 1', 'A', 'MW', 600, 650), sec('B 1', 'A', 'W', 650, 700))).toBe(false);
    expect(clash(sec('A 1', 'A', 'MW', 600, 650), sec('B 1', 'A', 'TR', 600, 650))).toBe(false);
  });
  it('suggests clash-free timetables that respect days off', () => {
    const by = groupByCourse([
      sec('X 1', 'A', 'MW', 600, 650), sec('X 1', 'B', 'TR', 600, 650),
      sec('Y 1', 'A', 'MW', 600, 650), sec('Y 1', 'B', 'F', 600, 700),
    ]);
    const opts = autofill(['X 1', 'Y 1'], by, [], { ...prefs, daysOff: ['M'] });
    expect(opts.length).toBeGreaterThan(0);
    expect(opts[0]!.sections.map((s) => s.course + s.sec).sort()).toEqual(['X 1B', 'Y 1B']);
    for (const o of opts) expect(o.sections.some((a, i) => o.sections.slice(i + 1).some((b) => clash(a, b)))).toBe(false);
  });
  it('never suggests a section on a day off, and names courses that cannot avoid one', () => {
    const by = groupByCourse([
      sec('X 1', 'A', 'MWF', 600, 650), sec('X 1', 'B', 'TR', 600, 675),
      sec('Y 1', 'A', 'MWF', 700, 750), sec('Y 1', 'B', 'MWF', 800, 850),
    ]);
    const off = { ...prefs, daysOff: ['M', 'W', 'F'] };
    const opts = autofill(['X 1', 'Y 1'], by, [], off);
    expect(opts.length).toBe(1);
    for (const o of opts) for (const s of o.sections) for (const m of s.meetings) expect([...m.days].some((d) => off.daysOff.includes(d))).toBe(false);
    expect(unfit(['X 1', 'Y 1'], by, off)).toEqual(['Y 1']);
  });
  it('keeps to the start and finish limits', () => {
    const by = groupByCourse([sec('X 1', 'A', 'M', 480, 530), sec('X 1', 'B', 'T', 600, 650)]);
    expect(autofill(['X 1'], by, [], { ...prefs, earliest: 540 }).map((o) => o.sections[0]!.sec)).toEqual(['B']);
  });
  it('skips full sections when another is open', () => {
    const by = groupByCourse([{ ...sec('X 1', 'A', 'M', 600, 650), avail: 0 }, sec('X 1', 'B', 'T', 600, 650)]);
    expect(autofill(['X 1'], by, [], prefs)[0]!.sections[0]!.sec).toBe('B');
  });
  it('returns nothing to suggest for an empty course list', () => {
    expect(autofill([], {}, [], prefs)).toEqual([]);
  });
  it('builds around pinned sections', () => {
    const pin = sec('P 1', 'A', 'TR', 600, 650);
    const by = groupByCourse([sec('X 1', 'A', 'T', 620, 680), sec('X 1', 'B', 'W', 600, 650)]);
    const opts = autofill(['X 1'], by, [pin], prefs);
    expect(opts.map((o) => o.sections.map((s) => s.sec))).toEqual([['B']]);
    expect(opts[0]!.credits).toBe(6);
  });
  it('adds optional courses only while the total stays in the credit range, best set first', () => {
    const by = groupByCourse([
      sec('X 1', 'A', 'M', 600, 650), sec('Y 1', 'A', 'T', 600, 650), sec('Z 1', 'A', 'W', 600, 650), sec('Z 1', 'B', 'R', 600, 650),
    ]);
    const opts = autofill(['X 1'], by, [], prefs, 6, { maybe: ['Y 1', 'Z 1'], credits: [6, 6] });
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) expect(o.credits).toBe(6);
    // Two different course sets come before a second version of either.
    expect(new Set(opts.slice(0, 2).map((o) => o.sections.map((s) => s.course).sort().join()))).toHaveProperty('size', 2);
    expect(autofill(['X 1'], by, [], prefs, 4, { maybe: ['Y 1'], credits: [12, 15] })).toEqual([]);
  });
  it('explains why nothing fits', () => {
    const pin = sec('P 1', 'A', 'MW', 600, 650);
    const by = groupByCourse([sec('X 1', 'A', 'M', 600, 650), sec('Y 1', 'A', 'T', 600, 650), sec('W 1', 'A', 'T', 600, 650)]);
    expect(explainNone(['X 1'], by, [pin], prefs)[0]).toMatch(/X 1 clashes with your pinned P 1 A/);
    expect(explainNone(['Y 1', 'W 1'], by, [], prefs)[0]).toMatch(/W 1 and Y 1 clash|Y 1 and W 1 clash/);
    expect(explainNone(['Y 1'], by, [], prefs, { maybe: ['X 1'], credits: [12, 15] })[0]).toMatch(/6 credits at most/);
  });
});

describe('gpa', () => {
  const t = parseTranscript(paste(MAIN));
  it('matches the transcript totals', () => {
    const s = stats(t.rows, cat);
    expect(s.att).toBe(t.totals!.att);
    expect(s.qp).toBeCloseTo(t.totals!.pts, 3);
    expect(s.mgpa).toBeGreaterThan(0);
  });
  it('excludes CSCS 100 and replaced attempts', () => {
    const rows = [...t.rows, { term: '2024 Fall', code: 'CSCS 100', title: 'Seminar', lab: false, ip: false, grade: 'A', rep: false, att: 1, ern: 1, pts: 4 }];
    const s = stats(rows, cat);
    expect(s.matt).toBe(stats(t.rows, cat).matt);
    const withRep = [...t.rows, { ...t.rows[0]!, rep: true, grade: 'F', pts: 0 }];
    expect(stats(withRep, cat).att).toBe(stats(t.rows, cat).att);
  });
  it('builds a term-by-term history that ends on the current CGPA', () => {
    const series = termSeries(t.rows);
    expect(series[0]!.term).toBe('2023 Fall');
    expect(series[series.length - 1]!.cgpa).toBeCloseTo(stats(t.rows, cat).cgpa, 6);
  });
  it('only offers retakes for C- or lower', () => {
    expect(retakeOptions(t.rows, cat).map((o) => o.grade)).toEqual([]); // the sample's lowest grade is a C
  });
  it('retake raises CGPA and adds load only', () => {
    const rows = t.rows.map((r) => (r.code === 'CSCS 203' ? { ...r, grade: 'D', pts: r.att } : r));
    const s = stats(rows, cat);
    const opts = retakeOptions(rows, cat);
    const worst = opts[0]!;
    const e = applyRetakes(s, opts, { [worst.code]: 'A' });
    expect(e.cgpa).toBeGreaterThan(s.cgpa);
    expect(e.loadCredits).toBe(worst.att);
  });
  it('leaves out courses already being retaken', () => {
    const rows = [...t.rows, { term: '2026 Fall', code: 'CSCS 203', title: 'DE', lab: false, ip: true, grade: '', rep: false, att: 0, ern: 0, pts: 0 }];
    expect(retakeOptions(rows, cat).map((o) => o.code)).not.toContain('CSCS 203');
  });
  it('solves the target', () => {
    const s = solveTarget(330, 100, 20, 3.3);
    expect(s.required).toBeCloseTo((3.3 * 120 - 330) / 20, 6);
    expect(s.reachable).toBe(true);
    expect(solveTarget(300, 100, 3, 3.9).reachable).toBe(false);
    expect(solveTarget(380, 100, 10, 3.0).already).toBe(true);
  });
  it('a retake in progress takes its old grade out of the target sum', () => {
    const rows = [...t.rows, { term: '2026 Fall', code: 'CSCS 203', title: 'DE', lab: false, ip: true, grade: '', rep: false, att: 0, ern: 0, pts: 0 }];
    const old = t.rows.find((r) => r.code === 'CSCS 203' && !r.rep)!;
    expect(replacedByIp(rows)).toEqual({ att: old.att, pts: old.pts, codes: ['CSCS 203'] });
    expect(replacedByIp(t.rows).att).toBe(0);
  });
  it('names the grade an average needs', () => {
    expect(gradeHint(3.2)).toBe('B+ or better');
    expect(gradeHint(3.7)).toBe('A- or better');
    expect(gradeHint(3.85)).toBe('Between A- and A');
    expect(gradeHint(4)).toBe("Straight A's");
  });
});

describe('catalog years', () => {
  const NEW: Spec[] = [
    { term: '2026 Fall', code: 'COMP 102', title: 'Programming Fundamentals', grade: 'A', att: 4 },
    { term: '2026 Fall', code: 'MATH 111', title: 'Calculus', grade: 'C', att: 3 },
    { term: '2026 Fall', code: 'CSCS 101', title: 'Advanced ICT', grade: 'D', att: 3 },
    { term: '2026 Fall', code: 'CSCS 460', title: 'Machine Learning', grade: 'B', att: 3 },
    { term: '2026 Fall', code: 'CSCS 457', title: 'Computer Vision', grade: 'B', att: 3 },
    { term: '2026 Fall', code: 'CSCS 342', title: 'Web Application Development', grade: 'B', att: 3 },
  ];
  const at = (year: number) => parseTranscript(paste(MAIN.map((r) => ({ ...r, term: r.term.replace(/^\d{4}/, (y) => String(Number(y) - 2023 + year)) })))).rows;

  it('picks the checklist from the entry year', async () => {
    const { detectProgram } = await import('../src/data/registry');
    expect(detectProgram(at(2023)).id).toBe('cs-2023-24');
    expect(detectProgram(at(2024)).id).toBe('cs-2024-25');
    expect(detectProgram(at(2025)).id).toBe('cs-2025-26');
    expect(detectProgram(at(2026)).id).toBe('cs-2026-27');
    expect(detectProgram(at(2028)).id).toBe('cs-2026-27'); // no newer checklist yet
  });

  it('counts the allied courses but not CSCS 101 in the 2026/27 major CGPA', async () => {
    const c27 = (await import('../src/data/programs/cs-2026-27.json')).default as unknown as Catalog;
    const s = stats(parseTranscript(paste(NEW)).rows, c27);
    // COMP 102 A(4), MATH 111 C(3), three CSCS electives at B(9): (16 + 6 + 27) / 16
    expect(s.matt).toBe(16);
    expect(s.mgpa).toBeCloseTo(49 / 16);
  });

  it('reports progress on a chosen specialization', async () => {
    const c27 = (await import('../src/data/programs/cs-2026-27.json')).default as unknown as Catalog;
    const r = audit(parseTranscript(paste(NEW)), c27, { ...DEFAULT_ASSUMPTIONS, track: 'ai' });
    expect(r.track).toEqual({ label: 'Artificial Intelligence', need: 7, done: 2, withIp: 2 });
    expect(r.verdict.notes).toContain('2 of 7 Artificial Intelligence electives');
    expect(audit(parseTranscript(paste(NEW)), c27, DEFAULT_ASSUMPTIONS).track).toBeNull();
  });
});

describe('notices', () => {
  const check = (specs: Spec[], extra = '', detected = true) => {
    const raw = paste(specs) + extra;
    const t = parseTranscript(raw);
    return notices(t.rows, cat, { raw, detected, problems: selfCheck(t) });
  };
  it('stays quiet on a clean transcript', () => {
    expect(check(MAIN)).toEqual([]);
  });
  it('flags a grade it does not know instead of quietly treating the course as in progress', () => {
    const specs = withRows(MAIN, { term: '2025 Fall', code: 'GEOL 101', title: 'Physical Geology', grade: 'T', att: 4 });
    const row = parseTranscript(paste(specs)).rows.find((r) => r.code === 'GEOL 101')!;
    expect(row).toMatchObject({ ip: true, odd: 'T' });
    expect(check(specs).find((n) => n.kind === 'grade')).toEqual({ kind: 'grade', rows: [{ code: 'GEOL 101', grade: 'T' }] });
  });
  it('flags an unknown grade on the schedule-style PDF too, without mistaking instructors for grades', () => {
    const rows = parseTranscript([
      '2025FA GEOL 101 A Physical Geology T R 09:30/10:45 SBLOCKS101 A Teacher T',
      '2026FA COMP 311 A Computer Networks M W 11:00/12:50 SBLOCKS219 B Teacher',
    ].join('\n')).rows;
    expect(rows.map((r) => r.odd)).toEqual(['T', undefined]);
  });
  it('lists course codes in the text that never became rows', () => {
    expect(check(MAIN, '\nTransfer credit accepted: MATH 230 Linear Algebra').find((n) => n.kind === 'unread')).toEqual({ kind: 'unread', codes: ['MATH 230'] });
  });
  it('says when no checklist matches the entry year, unless the student chose one', () => {
    const early = MAIN.map((r) => ({ ...r, term: r.term.replace(/^\d{4}/, (y) => String(Number(y) - 1)) }));
    expect(check(early).find((n) => n.kind === 'entry')).toEqual({ kind: 'entry', year: 2022 });
    expect(check(early, '', false).some((n) => n.kind === 'entry')).toBe(false);
  });
  it('says when the transcript is mostly another program', () => {
    const other = ['ECON 100', 'ECON 101', 'ECON 200', 'ECON 201', 'ECON 300', 'ECON 301', 'MATH 111'].map((code) => ({ term: '2023 Fall', code, title: 'Economics', grade: 'B', att: 3 }));
    expect(check(other).find((n) => n.kind === 'scope')).toEqual({ kind: 'scope', major: 0, total: 7 });
  });
});

describe('share and calendar', () => {
  const s = (course: string, sec: string, days: string, start: number, end: number): Section =>
    ({ course, sec, title: 'Data Structures\, Part 1', credits: 3, meetings: [{ days, start, end, room: 'S320' }], instructor: 'A Khan', avail: 30, cap: 30 });
  it('round-trips a plan through a link', () => {
    const plan = { 'CSCS 201': 'A', 'COMP 301': 'BB', 'BIOL 100L': 'C' };
    const code = encodePlan('2027SP', plan);
    expect(code).toBe('2027SP-BIOL.100L.C-COMP.301.BB-CSCS.201.A');
    expect(decodePlan(code)).toEqual({ termId: '2027SP', plan });
    expect(decodePlan('nonsense')).toBeNull();
    expect(decodePlan('2027SP-<script>')).toBeNull();
  });
  it('guesses a Monday start', () => {
    expect(termStartGuess('2027SP').getDay()).toBe(1);
    expect(termStartGuess('2027FA').getMonth()).toBe(7);
  });
  it('writes weekly events from the first meeting day', () => {
    const ics = icsFor([s('COMP 301', 'A', 'TR', 570, 645), { ...s('X 1', 'A', 'M', 0, 0), meetings: [{ days: 'M', start: null, end: null }] }], new Date(2027, 0, 11), 15, 'Spring 2027 classes');
    expect(ics).toContain('DTSTART;TZID=Asia/Karachi:20270112T093000'); // Tuesday after Monday the 11th
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20270425T235959Z');
    expect(ics).toContain('SUMMARY:COMP 301 Data Structures\\, Part 1');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
});
