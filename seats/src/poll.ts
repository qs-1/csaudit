// The once-a-minute job: send waiting pushes, then poll the departments someone watches, one request at a time.
// Free plan limits per run: 10 ms CPU, 50 outgoing requests, 50 database queries. Each run stays well inside them.

import { EmpowerError, getList, openSession, type Seat, type Session } from './empower';
import { ANY, backoff, diffDept, newSections, freshPoller, gap, MIN, pickDepts, pruneTerm, recordTime, step, type PollerState, type TermCounts } from './logic';
import { send, type Vapid } from './webpush';

export interface Env {
  DB: D1Database;
  SITE: string; // the planner's origin, for validating watches against its published sections
  VAPID_PUBLIC: string;
  VAPID_JWK: string; // secret: the private key as a JWK
  VAPID_SUBJECT: string;
  PROXY_KEY?: string; // secret: sent by the site's proxy (middleware.ts); unset in local development
  PUSHES?: Queue<PushBatch>; // pushes fanned out to their own runs; without it the cron sends them itself
}

/** One queue message: outbox rows for one consumer run to send. */
export interface PushBatch { ids: number[] }

const PUSH_MAX = 25; // pushes per run (~4 ms CPU and 25 requests), in the cron and in each queue run
const FANOUT_MAX = 2500; // pushes handed to the queue at once: 100 messages, one send
const QUEUED_HOLD = 2 * MIN; // a queued push the cron leaves alone; if its queue run never comes, the cron sends it
const DEPTS_MAX = 4; // departments per run when nothing is waiting to be sent
const WALL_MS = 40_000; // start no new Empower request after this long, so runs never overlap
const ALERT_TTL = 10 * MIN; // an alert older than this is dropped, not delivered late
const SESSION_MAX_AGE = 6 * 60 * MIN;

export const vapid = (env: Env): Vapid => ({ publicKey: env.VAPID_PUBLIC, jwk: JSON.parse(env.VAPID_JWK), subject: env.VAPID_SUBJECT });

const kvPut = (db: D1Database, k: string, v: unknown) => db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind(k, JSON.stringify(v));
const logEvent = (db: D1Database, now: number, kind: string, detail: unknown) => db.prepare('INSERT INTO events (t, kind, detail) VALUES (?, ?, ?)').bind(now, kind, JSON.stringify(detail));

/** Only one run talks to Empower at a time, even if a slow run spills into the next minute. */
async function lock(db: D1Database, now: number): Promise<boolean> {
  const r = await db.prepare("INSERT INTO kv (k, v) VALUES ('lock', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v WHERE CAST(kv.v AS INTEGER) < ?")
    .bind(String(now + 90_000), now).run();
  return r.meta.changes === 1;
}
const unlock = (db: D1Database) => db.prepare("UPDATE kv SET v = '0' WHERE k = 'lock'");

const clock = (t: number) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit' });

function shuffle<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [xs[i], xs[j]] = [xs[j]!, xs[i]!]; }
  return xs;
}

/** Queues a push for every admin device, e.g. "seat checks paused". */
const notifyAdmins = (db: D1Database, now: number, title: string, body: string) =>
  db.prepare(`INSERT INTO outbox (device, message, topic, next, expires)
    SELECT id, ?, 'poller', ?, ? FROM devices WHERE admin = 1 AND endpoint IS NOT NULL AND push_dead IS NULL`)
    .bind(JSON.stringify({ title, body, url: '/#/seats', tag: 'poller' }), now, now + 6 * 60 * MIN);

type Due = { id: number; device: string; message: string; topic: string | null; tries: number; expires: number; endpoint: string; p256dh: string; auth: string };
const due = (db: D1Database, now: number, max = PUSH_MAX) => db.prepare(`SELECT o.id, o.device, o.message, o.topic, o.tries, o.expires, d.endpoint, d.p256dh, d.auth
    FROM outbox o JOIN devices d ON d.id = o.device
    WHERE o.next <= ? AND o.expires > ? AND d.endpoint IS NOT NULL AND d.push_dead IS NULL
    ORDER BY o.id LIMIT ?`).bind(now, now, max);

const rowsById = (db: D1Database, now: number, ids: number[]) => db.prepare(`SELECT o.id, o.device, o.message, o.topic, o.tries, o.expires, d.endpoint, d.p256dh, d.auth
    FROM outbox o JOIN devices d ON d.id = o.device
    WHERE o.id IN (SELECT value FROM json_each(?)) AND o.expires > ? AND d.endpoint IS NOT NULL AND d.push_dead IS NULL`).bind(JSON.stringify(ids), now);

/**
 * Hands every due push to the queue, 25 to a message. Each message is its own run with its own CPU and request
 * limits, and they run side by side, so 300 people watching one section all hear within seconds instead of over
 * 12 minutes. 25 to a message keeps queue use at 3 operations per 25 pushes (the free plan has 10,000 a day).
 * If the queue refuses (no queue, or the day's operations used up), nothing changes and the cron sends them 25 a minute.
 */
export async function fanOut(env: Env, now: number): Promise<number> {
  if (!env.PUSHES) return 0;
  const db = env.DB;
  const ids = (await due(db, now, FANOUT_MAX).all<Due>()).results.map((r) => r.id);
  if (!ids.length) return 0;
  const batches: PushBatch[] = [];
  for (let i = 0; i < ids.length; i += PUSH_MAX) batches.push({ ids: ids.slice(i, i + PUSH_MAX) });
  try {
    await env.PUSHES.sendBatch(batches.map((body) => ({ body })));
  } catch (e) {
    console.error('queue send failed', e);
    return 0;
  }
  await db.prepare('UPDATE outbox SET next = ? WHERE id IN (SELECT value FROM json_each(?))').bind(now + QUEUED_HOLD, JSON.stringify(ids)).run();
  return ids.length;
}

/** A queue run: sends one batch. A failed push is retried by the cron, like any other. */
export async function sendBatch(env: Env, b: PushBatch, now = Date.now()): Promise<number> {
  const rows = (await rowsById(env.DB, now, b.ids.slice(0, PUSH_MAX)).all<Due>()).results;
  return rows.length ? drainOutbox(env, now, rows) : 0;
}

/** Sends pushes that are due. `rows` when the caller already read them. */
export async function drainOutbox(env: Env, now: number, rows?: Due[]): Promise<number> {
  const db = env.DB;
  const results = rows ?? (await due(db, now).all<Due>()).results;
  if (!results.length) return 0;
  const v = vapid(env);
  const writes: D1PreparedStatement[] = [];
  const counts: Record<string, number> = {};
  for (const r of results) {
    let status = 0;
    try {
      status = await send(v, r, JSON.parse(r.message), { ttl: Math.max(60, Math.round((r.expires - now) / 1000)), urgency: 'high', topic: r.topic ?? undefined });
    } catch { status = 0; } // network trouble or timeout: retry
    counts[status] = (counts[status] ?? 0) + 1;
    if (status >= 200 && status < 300) writes.push(db.prepare('DELETE FROM outbox WHERE id = ?').bind(r.id));
    else if (status === 404 || status === 410) {
      // The subscription is gone (app removed, site data cleared, notifications turned off). Watches stay; the
      // app shows "notifications stopped on this device" and re-subscribing brings them back.
      writes.push(db.prepare('UPDATE devices SET push_dead = ? WHERE id = ?').bind(now, r.device));
      writes.push(db.prepare('DELETE FROM outbox WHERE device = ?').bind(r.device));
    } else if (status === 0 || status === 429 || status >= 500) {
      writes.push(db.prepare('UPDATE outbox SET tries = tries + 1, next = ? WHERE id = ?').bind(now + 30_000 * 2 ** r.tries, r.id));
    } else writes.push(db.prepare('DELETE FROM outbox WHERE id = ?').bind(r.id)); // 400/403/413: retrying won't help
  }
  writes.push(logEvent(db, now, 'push', counts));
  await db.batch(writes);
  return results.length;
}

/**
 * Applies one department's fresh counts to its watches and queues alerts. Reads only the watches that could move:
 * sections that crossed between full and open, course watches on courses with a new section, and watches made since
 * the last check. One query, one batch.
 */
async function apply(db: D1Database, term: string, dept: string, seats: Seat[], counts: TermCounts, newest: number, now: number, writes: D1PreparedStatement[]): Promise<number> {
  const d = diffDept(counts[dept], seats, now);
  counts[dept] = d.next;
  if (d.since && !d.crossed.length && !d.added.length && newest <= d.since) return 0; // nothing that could move a watch
  const addedCourses = [...new Set(d.added.map((k) => k.split('|')[0]))];
  const { results: watches } = await db.prepare(`SELECT device, course, sec, armed, alerts, test FROM watches
      WHERE term = ? AND dept = ? AND expires > ? AND (? = 0 OR created > ? OR test = 1 OR course || '|' || sec IN (SELECT value FROM json_each(?))
        OR (sec = '*' AND course IN (SELECT value FROM json_each(?))))`)
    .bind(term, dept, now, d.since, d.since, JSON.stringify(d.crossed), JSON.stringify(addedCourses))
    .all<{ device: string; course: string; sec: string; armed: number; alerts: string; test: number | null }>();

  let alerts = 0;
  const queue: D1PreparedStatement[] = [];
  const push = (device: string, tag: string, title: string, body: string) => queue.push(db.prepare('INSERT INTO outbox (device, message, topic, next, expires) VALUES (?, ?, ?, ?, ?)')
    .bind(device, JSON.stringify({ title, body, url: '/#/seats', tag: `${term}-${tag}` }), `${term}${tag}`.replace(/[^A-Za-z0-9]/g, ''), now, now + ALERT_TTL));
  for (const w of watches) {
    if (w.test) writes.push(db.prepare('UPDATE watches SET test = NULL WHERE device = ? AND term = ? AND course = ? AND sec = ?').bind(w.device, term, w.course, w.sec));
    if (w.sec === ANY) {
      const r = newSections(d.added, d.next.s, w.course, JSON.parse(w.alerts) as number[], now);
      if (r.open.length) {
        alerts++;
        writes.push(db.prepare('UPDATE watches SET alerts = ?, last_alert = ? WHERE device = ? AND term = ? AND course = ? AND sec = ?')
          .bind(JSON.stringify(r.alerts), now, w.device, term, w.course, w.sec));
        const secs = r.open.map((k) => k.split('|')[1]!);
        const [avail, cap] = d.next.s[r.open[0]!]!;
        push(w.device, `${w.course}-new`, secs.length === 1 ? `${w.course} ${secs[0]}: new section, ${avail} of ${cap} open` : `${w.course}: ${secs.length} new sections, ${secs.join(', ')}`, `At ${clock(now)}`);
      } else if (w.test) push(w.device, `${w.course}-new`, `${w.course}: no new sections yet`, `Test alert at ${clock(now)}`);
      continue;
    }
    const s = d.next.s[`${w.course}|${w.sec}`];
    if (!s) continue; // section dropped from the catalog; the app shows it as missing
    const [avail, cap] = s;
    const r = step({ armed: !!w.armed, alerts: JSON.parse(w.alerts) as number[] }, avail, now);
    if (r.next.armed !== !!w.armed || r.alert) {
      writes.push(db.prepare('UPDATE watches SET armed = ?, alerts = ?, last_alert = COALESCE(?, last_alert) WHERE device = ? AND term = ? AND course = ? AND sec = ?')
        .bind(r.next.armed ? 1 : 0, JSON.stringify(r.next.alerts), r.alert ? now : null, w.device, term, w.course, w.sec));
    }
    if (r.alert) alerts++;
    if (r.alert || w.test) push(w.device, `${w.course}-${w.sec}`, `${w.course} ${w.sec}: ${avail} of ${cap} open`, `${r.alert ? 'At' : 'Test alert at'} ${clock(now)}`);
  }
  // Shuffled so the same people aren't always first when one seat opens for many watchers.
  writes.push(...shuffle(queue));
  return alerts;
}

export async function cleanup(db: D1Database, now: number) {
  await db.batch([
    db.prepare('DELETE FROM outbox WHERE expires <= ?').bind(now),
    db.prepare('DELETE FROM events WHERE t < ?').bind(now - 7 * 24 * 60 * MIN),
    db.prepare('DELETE FROM watches WHERE expires <= ?').bind(now),
    // A device with nothing watched and no visit in 3 days goes. The app starts a new one if it comes back.
    db.prepare('DELETE FROM devices WHERE seen < ? AND id NOT IN (SELECT device FROM watches)').bind(now - 3 * 24 * 60 * MIN),
    db.prepare('DELETE FROM signups WHERE day < ?').bind(new Date(now - 2 * 24 * 60 * MIN).toISOString().slice(0, 10)),
  ]);
}

export interface RunReport { pushed: number; queued?: number; polled: string[]; alerts: number; skipped?: string; error?: string }

/** The once-a-minute job, then any alerts it found go straight to the queue instead of waiting for next minute. */
export async function run(env: Env, now = Date.now()): Promise<RunReport> {
  const r = await check(env, now);
  if (r.alerts) r.queued = (r.queued ?? 0) + await fanOut(env, Date.now());
  return r;
}

async function check(env: Env, now: number): Promise<RunReport> {
  const db = env.DB;
  // Everything a quiet run needs, in one round trip.
  const [out, w, kv] = await db.batch([
    due(db, now, PUSH_MAX + 1),
    // A watch marked for a test counts as new, so its department's next check reads it.
    db.prepare('SELECT term, dept, MAX(CASE WHEN test = 1 THEN ? ELSE created END) AS newest FROM watches WHERE expires > ? GROUP BY term, dept').bind(now, now),
    db.prepare("SELECT k, v FROM kv WHERE k IN ('poller', 'session', 'polled') OR k LIKE 'live:%'"),
  ]);
  // A few waiting (retries, a quiet minute): sent here. More than one run can send: all to the queue.
  const waiting = out!.results as Due[];
  const queued = waiting.length > PUSH_MAX ? await fanOut(env, now) : 0;
  const pushed = queued ? 0 : await drainOutbox(env, now, waiting.slice(0, PUSH_MAX));
  if (new Date(now).getUTCMinutes() % 30 === 0) await cleanup(db, now);

  const watched = w!.results as { term: string; dept: string; newest: number }[];
  if (!watched.length) return { pushed, queued, polled: [], alerts: 0, skipped: 'nothing watched' }; // no requests at all
  const newest = new Map(watched.map((x) => [`${x.term}|${x.dept}`, x.newest]));

  const st: Record<string, unknown> = Object.fromEntries((kv!.results as { k: string; v: string }[]).map((r) => [r.k, JSON.parse(r.v)]));
  const p: PollerState = { ...freshPoller(), ...(st.poller as Partial<PollerState> | undefined) };
  if (now < p.until) return { pushed, polled: [], alerts: 0, skipped: p.blocked ? 'blocked, waiting' : 'backing off' };
  if (!(await lock(db, now))) return { pushed, polled: [], alerts: 0, skipped: 'another run is polling' };

  const polled = (st.polled as Record<string, number> | undefined) ?? {};
  const counts: Record<string, TermCounts> = {}; // term -> counts
  for (const [k, v] of Object.entries(st)) if (k.startsWith('live:')) counts[k.slice(5)] = v as TermCounts;
  let session = st.session as Session | undefined;
  const report: RunReport = { pushed, queued, polled: [], alerts: 0 };
  const writes: D1PreparedStatement[] = [];
  try {
    const keys = watched.map((w) => `${w.term}|${w.dept}`);
    const pick = pickDepts(keys, polled, now, gap(p), pushed > 10 ? 1 : DEPTS_MAX);
    if (!pick.length) { report.skipped = 'all departments fresh'; return report; }
    let wasSlow = false;
    for (const key of pick) {
      if (Date.now() - now > WALL_MS) break;
      const [term, dept] = key.split('|') as [string, string];
      let got: { seats: Seat[]; ms: number };
      try {
        if (!session || now - session.at > SESSION_MAX_AGE) session = await openSession();
        try {
          got = await getList(session, term, dept);
        } catch (e) {
          if (!(e instanceof EmpowerError && e.kind === 'token')) throw e;
          session = await openSession(); // expired session: one fresh page load, then retry once
          got = await getList(session, term, dept);
        }
      } catch (e) {
        const err = e instanceof EmpowerError ? e : new EmpowerError(String(e), 'error', 0);
        const wasBlocked = p.blocked;
        p.fails += 1;
        p.blocked = err.kind === 'blocked';
        p.until = Date.now() + backoff(p.fails, p.blocked);
        if (p.blocked) session = undefined;
        writes.push(logEvent(db, now, p.blocked ? 'blocked' : 'error', { dept, message: err.message, ms: err.ms, fails: p.fails }));
        if (p.blocked && !wasBlocked) {
          writes.push(notifyAdmins(db, now, 'Seat checks paused', `${err.message}. Retrying in an hour.`));
        }
        report.error = err.message;
        break;
      }
      if (p.blocked) writes.push(notifyAdmins(db, now, 'Seat checks resumed', ''));
      p.fails = 0;
      p.blocked = false;
      p.lastOk = Date.now();
      polled[key] = now;
      report.polled.push(key);
      if (!got.seats.length) writes.push(logEvent(db, now, 'empty', { dept })); // a bad filter or a page change
      else report.alerts += await apply(db, term, dept, got.seats, (counts[term] ??= {}), newest.get(key) ?? 0, now, writes);
      if (recordTime(p, dept, got.ms).slow) {
        // Their server is struggling: poll less often and stop for this run.
        p.slow = Math.min(p.slow + 1, 3);
        wasSlow = true;
        writes.push(logEvent(db, now, 'slow', { dept, ms: got.ms, gap: gap(p) / MIN }));
        break;
      }
    }
    if (!wasSlow && !report.error && report.polled.length) p.slow = Math.max(0, p.slow - 1);
    if (report.alerts) writes.push(logEvent(db, now, 'alerts', { n: report.alerts, polled: report.polled }));
    return report;
  } finally {
    for (const term of new Set(report.polled.map((k) => k.split('|')[0]!))) writes.push(kvPut(db, `live:${term}`, pruneTerm(counts[term]!, now)));
    writes.push(kvPut(db, 'poller', p), kvPut(db, 'polled', polled), unlock(db));
    if (session) writes.push(kvPut(db, 'session', session));
    else writes.push(db.prepare("DELETE FROM kv WHERE k = 'session'"));
    await db.batch(writes);
  }
}
