// Decisions with no I/O, so the tests can cover them: when a watch alerts, when to back off, what to poll next.

export const MIN = 60_000;

/** At most this many alerts per watch in an hour. A seat that keeps flipping between 0 and 1 shouldn't spam. */
export const ALERTS_PER_HOUR = 6;

export interface WatchState { armed: boolean; alerts: number[] } // alerts: recent alert times (ms)

/**
 * A watch alerts when its section goes from full to open, then stays quiet while seats remain. It re-arms when
 * the section is full again, so every reopening is a new alert (a seat taken back within minutes is common).
 * No cooldown: in the 9am test a section reopened 3 minutes after filling and stayed open for 3.4 minutes.
 */
export function step(w: WatchState, avail: number, now: number): { next: WatchState; alert: boolean } {
  const recent = w.alerts.filter((t) => now - t < 60 * MIN);
  if (avail <= 0) return { next: { armed: true, alerts: recent }, alert: false };
  if (!w.armed) return { next: { armed: false, alerts: recent }, alert: false };
  if (recent.length >= ALERTS_PER_HOUR) return { next: { armed: false, alerts: recent }, alert: false };
  return { next: { armed: false, alerts: [...recent, now] }, alert: true };
}

/** A new watch is armed only if the section is full now. An open section alerts after it fills and reopens. */
export const armedFor = (avail: number | null) => avail === null || avail <= 0;

export interface PollerState {
  fails: number; // consecutive failures
  until: number; // no Empower requests before this time
  slow: number; // 0 normal; each step doubles the gap between polls of a department, up to 8x
  blocked: boolean; // Cloudflare or the server refused us
  lastOk: number;
  base: Record<string, number[]>; // recent response times per department (ms)
}

export const freshPoller = (): PollerState => ({ fails: 0, until: 0, slow: 0, blocked: false, lastOk: 0, base: {} });

/** Waiting time after the nth failure in a row: 1, 2, 4, 8, 16, then 30 minutes. A block waits an hour. */
export function backoff(fails: number, blocked: boolean): number {
  if (blocked) return 60 * MIN;
  return Math.min(2 ** Math.max(0, fails - 1), 30) * MIN;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;

/** Records a response time. Slower than 3x the department's usual time counts as a slowdown. */
export function recordTime(p: PollerState, dept: string, ms: number): { slow: boolean } {
  const xs = p.base[dept] ?? [];
  const slow = xs.length >= 5 && ms > 3 * median(xs) && ms > 1500;
  p.base[dept] = [...xs, ms].slice(-10);
  return { slow };
}

/** Gap between polls of one department, stretched while the server is slow. */
export const gap = (p: PollerState) => MIN * 2 ** Math.min(p.slow, 3);

/**
 * Departments to poll this run: those with an active watch, least recently polled first, skipping any polled
 * within the current gap. Capped per run to stay inside the free plan's 10 ms of CPU and 50 requests.
 */
export function pickDepts(watched: string[], lastPolled: Record<string, number>, now: number, gapMs: number, max: number): string[] {
  // A little early is fine: cron runs drift by a second or two, and waiting a whole extra minute is not.
  return [...new Set(watched)]
    .filter((d) => now - (lastPolled[d] ?? 0) >= gapMs - 5000)
    .sort((a, b) => (lastPolled[a] ?? 0) - (lastPolled[b] ?? 0))
    .slice(0, max);
}
