import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { program, term } from '../src/data/schema';

const SEASON: Record<string, number> = { SP: 1, SU: 2, FA: 3, WN: 4, WI: 4 };
const rank = (id: string) => parseInt(id, 10) * 10 + (SEASON[id.slice(4)] ?? 0);
const read = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(join(dir, f), 'utf8'))] as const);

describe('data files', () => {
  it('has current credits from the newest term', () => {
    const c = JSON.parse(readFileSync('src/data/credits.json', 'utf8'));
    const newest = read('src/data/terms').map(([f]) => f.replace('.json', '')).sort((a, b) => rank(a) - rank(b)).pop();
    expect(c.term).toBe(newest);
    expect(Object.values(c.credits).every((n) => typeof n === 'number' && n >= 0 && n <= 8)).toBe(true);
  });
  it.each(read('src/data/programs'))('program %s is valid', (_, data) => {
    const r = program.safeParse(data);
    expect(r.success ? [] : r.error.issues).toEqual([]);
  });
  it.each(read('src/data/terms'))('term %s is valid', (_, data) => {
    const r = term.safeParse(data);
    expect(r.success ? [] : r.error.issues.slice(0, 5)).toEqual([]);
  });
});

/* ---------- Every checklist against the course descriptions in its year's catalog ---------- */

interface CatalogCourse { t: string; cr?: number; pre?: string[][]; lab?: boolean }
interface Course { code: string; credits: number; prereq?: string[] }

// Deliberate differences from the catalog text, each with its reason.
const KNOWN: Record<string, string> = {
  'UNIV 100': 'The 2023/24 and 2024/25 catalogs print its heading without a course description.',
  'MATH 102<MATH 101': 'The catalog accepts intermediate mathematics instead; pre-medical students have to take MATH 101.',
};

const courses = Object.fromEntries(read('src/data/courses').map(([f, d]) => [f.replace('.json', ''), d as Record<string, CatalogCourse>]));
const programs = read('src/data/programs').map(([f, d]) => [f, d] as const);

describe.each(programs)('%s against its catalog', (_, p) => {
  const year = String(p.catalogYear).replace('/', '-');
  const cat = courses[year]!;
  const fixed: Course[] = [...p.groups.filter((g: { kind: string }) => g.kind === 'all').flatMap((g: { courses: Course[] }) => g.courses), ...p.deficiency];
  const byCode = new Map(fixed.map((c) => [c.code, c]));

  /** Everything a course needs, directly or through its prerequisites. */
  const closure = (code: string, seen = new Set<string>()) => {
    for (const q of byCode.get(code)?.prereq ?? []) if (!seen.has(q)) { seen.add(q); closure(q, seen); }
    return seen;
  };

  it('has course data for its year', () => expect(cat).toBeDefined());

  // Checklists keep the catalog's credits. Newer credits come from the scraped sections (src/data/credits.json).
  it('lists only courses the catalog describes, at the catalog credits', () => {
    const out: string[] = [];
    for (const c of fixed) {
      const k = cat[c.code];
      if (!k) { if (!KNOWN[c.code]) out.push(`${c.code} is not in the ${year} catalog`); continue; }
      if (k.cr !== undefined && k.cr !== c.credits) out.push(`${c.code}: ${c.credits} credits, catalog says ${k.cr}`);
    }
    expect(out).toEqual([]);
  });

  it('has the prerequisites the catalog gives', () => {
    const out: string[] = [];
    for (const c of fixed) {
      const pre = cat[c.code]?.pre;
      if (!pre) continue;
      const have = closure(c.code);
      for (const any of pre) if (!any.some((q) => have.has(q))) out.push(`${c.code} needs ${any.join(' or ')}`);
      for (const q of c.prereq ?? []) if (!pre.some((any) => any.includes(q)) && !KNOWN[`${c.code}<${q}`]) out.push(`${c.code}: catalog doesn't require ${q}`);
    }
    expect(out).toEqual([]);
  });

  it('adds up to no more than the degree total', () => {
    const req = p.groups.reduce((a: number, g: { kind: string; courses?: Course[]; need?: number; credits?: number }) =>
      a + (g.kind === 'all' ? g.courses!.reduce((s, c) => s + c.credits, 0) : g.need! * g.credits!), 0);
    expect(req).toBeLessThanOrEqual(p.totalCredits);
  });

  // Each pool's `eligible` list is what lets the app notice a later drop in credits, so it has to match the catalog.
  it('lists exactly the catalog courses that met each pool\'s credits', () => {
    const out: string[] = [];
    for (const g of p.groups.filter((x: { kind: string }) => x.kind === 'pool')) {
      if (!g.eligible) continue;
      const want = Object.keys(cat).filter((c) => g.depts.includes(c.split(' ')[0]!) && (cat[c]!.cr ?? 0) >= g.credits).sort();
      const have = Object.keys(g.eligible).sort();
      for (const c of want) if (!have.includes(c)) out.push(`${g.id}: ${c} is missing`);
      for (const c of have) if (!want.includes(c)) out.push(`${g.id}: ${c} is not a ${g.credits}-credit course in the ${year} catalog`);
    }
    expect(out).toEqual([]);
  });

  it('names real courses in its specializations', () => {
    const out = (p.tracks ?? []).flatMap((t: { id: string; courses: string[] }) => t.courses.filter((c) => !cat[c]).map((c) => `${t.id}: ${c}`));
    expect(out).toEqual([]);
  });
});
