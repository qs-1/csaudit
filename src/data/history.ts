import type { CreditLookup } from '@/engine';
import { CURRENT } from './registry';

type Catalog = Record<string, { cr?: number }>;
const YEARS: Record<string, () => Promise<{ default: unknown }>> = {
  '2023-24': () => import('./courses/2023-24.json'),
  '2024-25': () => import('./courses/2024-25.json'),
  '2025-26': () => import('./courses/2025-26.json'),
  '2026-27': () => import('./courses/2026-27.json'),
};

/** Catalog year a term falls in: Fall 2025 belongs to 2025-26, Spring and Summer 2026 too. */
function yearOf(term: string): string {
  const y = parseInt(term, 10);
  const start = term.endsWith('Fall') ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

let loaded: Promise<CreditLookup> | null = null;

/**
 * Credits each course carried when it was taken, from that year's catalog, then today's credits.
 * Only the schedule-style transcript (the portal's "Unofficial Transcript" PDF) needs this, since it lists no credits,
 * so the catalogs load on demand. On a real transcript this matched the stated totals exactly, where today's
 * credits alone didn't (ISLM 101 was 3 credits in 2023, 2 now).
 */
export function historicCredits(): Promise<CreditLookup> {
  loaded ??= Promise.all(Object.entries(YEARS).map(async ([y, load]) => [y, (await load()).default as Catalog] as const))
    .then((list) => {
      const byYear = Object.fromEntries(list);
      return (code: string, term: string) => byYear[yearOf(term)]?.[code]?.cr ?? CURRENT.credits[code];
    })
    .catch((e) => { loaded = null; throw e; });
  return loaded;
}
