import type { Policy } from './types';

/** Where a semester's credit load falls against the registration rules. */
export type Zone = 'ok' | 'petition' | 'lab' | 'over';
export function zoneFor(load: number, p: Policy, hasLab: boolean): Zone {
  if (load <= p.regularLoad) return 'ok';
  if (load > p.maxLoad) return 'over';
  if (load === p.maxLoad && p.maxLoadNeedsLab && !hasLab) return 'lab';
  return 'petition';
}
