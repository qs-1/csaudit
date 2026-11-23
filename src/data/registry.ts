import type { Catalog, Row, Term } from '@/engine';
import { sortTerms, termYear } from '@/engine';
import cs202324 from './programs/cs-2023-24.json';
import cs202425 from './programs/cs-2024-25.json';
import cs202526 from './programs/cs-2025-26.json';
import cs202627 from './programs/cs-2026-27.json';
import credits from './credits.json';

/**
 * Everything batch- or term-specific is listed here.
 * Adding a batch: drop its checklist into ./programs and add it to PROGRAMS. Course titles, credits and
 * prerequisites come from that year's catalog, extracted into ./courses (scripts/extract-courses.mjs);
 * the tests check every program against it.
 * Terms: scripts/scrape.py (run on a schedule by .github/workflows/catalog.yml) writes ./terms/<id>.json, which
 * is picked up below. The newest term also refreshes ./credits.json, so credit changes reach the audit without
 * touching any checklist.
 */
export const PROGRAMS: Catalog[] = [cs202324, cs202425, cs202526, cs202627] as unknown as Catalog[];

/**
 * Current credits per course, written by scripts/convert-sections.mjs from the newest term.
 * They override the checklist for every course not on the transcript yet.
 */
export const CURRENT: { term: string; label: string; asOf: string; credits: Record<string, number> } = credits;

export interface TermEntry {
  id: string;
  key: string; // same form as transcript terms: "2027 Spring"
  label: string;
  links?: { label: string; href: string }[];
  load: () => Promise<Term>;
}

const SEASON: Record<string, [name: string, order: number]> = { SP: ['Spring', 1], SU: ['Summer', 2], FA: ['Fall', 3], WN: ['Winter', 4], WI: ['Winter', 4] };
const termFiles = import.meta.glob<{ default: unknown }>('./terms/*.json');

/** Every term in ./terms, oldest first. A file named 2027FA.json shows up as "Fall 2027". */
export const TERMS: TermEntry[] = Object.entries(termFiles)
  .map(([path, load]) => {
    const id = path.slice(path.lastIndexOf('/') + 1, -5);
    const [season, order] = SEASON[id.slice(4)] ?? [id.slice(4), 0];
    const year = id.slice(0, 4);
    return {
      id,
      key: `${year} ${season}`,
      label: `${season} ${year}`,
      order: +year * 10 + order,
      links: [{ label: 'Overload petition', href: 'docs/credit-overload-petition.html' }],
      load: () => load().then((m) => m.default as Term),
    };
  })
  .sort((a, b) => a.order - b.order)
  .map(({ order: _, ...t }) => t);

export const programById = (id: string | null | undefined) => PROGRAMS.find((p) => p.id === id);

/** Picks the catalog whose entry year matches the first term on the transcript. */
export function detectProgram(rows: Row[]): Catalog {
  const terms = sortTerms([...new Set(rows.map((r) => r.term).filter(Boolean))]);
  const first = terms[0];
  if (first) {
    const y = termYear(first);
    const match = PROGRAMS.find((p) => p.admits.includes(y));
    if (match) return match;
    // No checklist for that year: the closest earlier one, else the earliest.
    const earlier = PROGRAMS.filter((p) => Math.min(...p.admits) < y);
    if (earlier.length) return earlier[earlier.length - 1]!;
  }
  return PROGRAMS[0]!;
}

/** The term to plan by default: the one right after the transcript, else the latest available. */
export function defaultTerm(nextTerm: string): TermEntry {
  return TERMS.find((t) => t.key === nextTerm) ?? TERMS[TERMS.length - 1]!;
}

export const asset = (href: string) => `${import.meta.env.BASE_URL}${href}`;
