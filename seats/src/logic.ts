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

/** Counts older than this aren't shown as live, and a department checked longer ago than this is re-read in full. */
export const FRESH = 10 * MIN;

/**
 * A department's last check: when, each section's [avail, cap, last change], and every section key seen in it so far
 * (`k`), so a section that drops out of one response and comes back isn't taken for a new one. Keyed "COURSE 100|A".
 */
export interface DeptCounts { at: number; s: Record<string, [avail: number, cap: number, changed: number]>; k?: string[] }
/** A term's counts by department, stored as one row. */
export type TermCounts = Record<string, DeptCounts>;

/** The `sec` of a watch on a whole course: it alerts when the course gets a new section with seats. */
export const ANY = '*';

/**
 * Compares a check with the department's previous one. Only sections that crossed between full and open can move a
 * watch, so `crossed` lists those. `since` is the previous check's time: watches made after it haven't been looked
 * at yet. With no recent previous check, `since` is 0 and every watch in the department is read. `added` lists
 * sections never seen in the department before; with no previous check at all nothing counts as added.
 */
export function diffDept(prev: DeptCounts | undefined, seats: { course: string; sec: string; avail: number; cap: number }[], now: number) {
  const recent = prev && now - prev.at < FRESH ? prev : undefined;
  const known = new Set(prev ? prev.k ?? Object.keys(prev.s) : []);
  const next: DeptCounts = { at: now, s: {} };
  const crossed: string[] = [];
  const added: string[] = [];
  let changed = 0;
  for (const x of seats) {
    const key = `${x.course}|${x.sec}`;
    const b = prev?.s[key];
    const same = b && b[0] === x.avail && b[1] === x.cap;
    if (!same) changed++;
    next.s[key] = [x.avail, x.cap, same ? b[2] : now];
    if (recent && (!b || (b[0] <= 0) !== (x.avail <= 0))) crossed.push(key);
    if (prev && !known.has(key)) added.push(key);
    known.add(key);
  }
  next.k = [...known];
  return { next, crossed, added, since: recent ? recent.at : 0, changed };
}

/** Whether a course watch alerts for sections new in this check: those with seats, within the hourly cap. */
export function newSections(added: string[], s: DeptCounts['s'], course: string, alerts: number[], now: number) {
  const recent = alerts.filter((t) => now - t < 60 * MIN);
  const open = added.filter((k) => k.startsWith(`${course}|`) && (s[k]?.[0] ?? 0) > 0);
  if (!open.length || recent.length >= ALERTS_PER_HOUR) return { open: [] as string[], alerts: recent };
  return { open, alerts: [...recent, now] };
}

/** Drops departments nobody has checked in two days. */
export function pruneTerm(t: TermCounts, now: number): TermCounts {
  return Object.fromEntries(Object.entries(t).filter(([, d]) => now - d.at < 2 * 24 * 60 * MIN));
}
