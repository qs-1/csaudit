/** Term keys look like "2025 Fall". Labels look like "Fall 2025". */
const ORDER: Record<string, number> = { Spring: 1, Summer: 2, Fall: 3, Winter: 4 };

export const termYear = (key: string) => parseInt(key, 10) || 0;
export const termSeason = (key: string) => key.split(' ')[1] ?? '';
export const termOrder = (key: string) => termYear(key) * 10 + (ORDER[termSeason(key)] ?? 0);
export const sortTerms = (keys: string[]) => [...keys].sort((a, b) => termOrder(a) - termOrder(b));
export const isRegular = (key: string) => /Fall|Spring/.test(key);
export const termLabel = (key: string) => `${termSeason(key)} ${termYear(key)}`.trim();
export const shortTerm = (key: string) => `${termSeason(key).slice(0, 2)} ${String(termYear(key)).slice(2)}`;

/** The regular term after `key`. */
export function nextRegular(key: string): string {
  if (!key) return '';
  const y = termYear(key);
  return termSeason(key) === 'Fall' || termSeason(key) === 'Winter' ? `${y + 1} Spring` : `${y} Fall`;
}
