// The once-a-minute job: send waiting pushes, then poll the departments someone watches, one request at a time.
// Free plan limits per run: 10 ms CPU, 50 outgoing requests, 50 database queries. Each run stays well inside them.

import { EmpowerError, getList, openSession, type Seat, type Session } from './empower';
import { backoff, freshPoller, gap, MIN, pickDepts, recordTime, step, type PollerState } from './logic';
import { send, type Vapid } from './webpush';

export interface Env {
  DB: D1Database;
  SITE: string; // the planner's origin, for validating watches against its published sections
  VAPID_PUBLIC: string;
  VAPID_JWK: string; // secret: the private key as a JWK
  VAPID_SUBJECT: string;
}

const PUSH_MAX = 25; // pushes per run (~4 ms CPU and 25 requests)
const DEPTS_MAX = 4; // departments per run when nothing is waiting to be sent
const WALL_MS = 40_000; // start no new Empower request after this long, so runs never overlap
const ALERT_TTL = 10 * MIN; // an alert older than this is dropped, not delivered late
const SESSION_MAX_AGE = 6 * 60 * MIN;

export const vapid = (env: Env): Vapid => ({ publicKey: env.VAPID_PUBLIC, jwk: JSON.parse(env.VAPID_JWK), subject: env.VAPID_SUBJECT });

async function kvGet<T>(db: D1Database, keys: string[]): Promise<Record<string, T>> {
  const { results } = await db.prepare(`SELECT k, v FROM kv WHERE k IN (${keys.map(() => '?').join(',')})`).bind(...keys).all<{ k: string; v: string }>();
  return Object.fromEntries(results.map((r) => [r.k, JSON.parse(r.v) as T]));
}
const kvPut = (db: D1Database, k: string, v: unknown) => db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind(k, JSON.stringify(v));
const logEvent = (db: D1Database, now: number, kind: string, detail: unknown) => db.prepare('INSERT INTO events (t, kind, detail) VALUES (?, ?, ?)').bind(now, kind, JSON.stringify(detail));

/** Only one run talks to Empower at a time, even if a slow run spills into the next minute. */
async function lock(db: D1Database, now: number): Promise<boolean> {
  await db.prepare("INSERT OR IGNORE INTO kv (k, v) VALUES ('lock', '0')").run();
  const r = await db.prepare("UPDATE kv SET v = ? WHERE k = 'lock' AND CAST(v AS INTEGER) < ?").bind(String(now + 90_000), now).run();
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

export async function drainOutbox(env: Env, now: number, max = PUSH_MAX): Promise<number> {
  const db = env.DB;
  const { results } = await db.prepare(`SELECT o.id, o.device, o.message, o.topic, o.tries, o.expires, d.endpoint, d.p256dh, d.auth
      FROM outbox o JOIN devices d ON d.id = o.device
      WHERE o.next <= ? AND o.expires > ? AND d.endpoint IS NOT NULL AND d.push_dead IS NULL
      ORDER BY o.id LIMIT ?`).bind(now, now, max)
    .all<{ id: number; device: string; message: string; topic: string | null; tries: number; expires: number; endpoint: string; p256dh: string; auth: string }>();
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

/** Applies one department's fresh counts: changed seat rows, watch transitions, queued alerts. One batch. */
async function apply(db: D1Database, term: string, dept: string, seats: Seat[], now: number): Promise<number> {
  const [old, watches] = await db.batch([
    db.prepare('SELECT course, sec, avail, cap FROM seats WHERE term = ? AND dept = ?').bind(term, dept),
    db.prepare('SELECT device, course, sec, armed, alerts FROM watches WHERE term = ? AND dept = ? AND expires > ?').bind(term, dept, now),
  ]);
  const before = new Map((old!.results as { course: string; sec: string; avail: number; cap: number }[]).map((r) => [`${r.course}|${r.sec}`, r]));
  const writes: D1PreparedStatement[] = [];
  const fresh = new Map<string, Seat>();
  for (const s of seats) {
    const key = `${s.course}|${s.sec}`;
    fresh.set(key, s);
    const b = before.get(key);
    if (!b || b.avail !== s.avail || b.cap !== s.cap) {
      writes.push(db.prepare(`INSERT INTO seats (term, course, sec, dept, cid, avail, cap, seen, changed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (term, course, sec) DO UPDATE SET cid = excluded.cid, avail = excluded.avail, cap = excluded.cap, seen = excluded.seen, changed = excluded.changed`)
        .bind(term, s.course, s.sec, dept, s.cid, s.avail, s.cap, now, now));
    }
  }
  // Unchanged rows still get a fresh "seen", in one statement.
  writes.push(db.prepare('UPDATE seats SET seen = ? WHERE term = ? AND dept = ?').bind(now, term, dept));

  let alerts = 0;
  const queue: D1PreparedStatement[] = [];
  for (const w of watches!.results as { device: string; course: string; sec: string; armed: number; alerts: string }[]) {
    const s = fresh.get(`${w.course}|${w.sec}`);
    if (!s) continue; // section dropped from the catalog; the app shows it as missing
    const r = step({ armed: !!w.armed, alerts: JSON.parse(w.alerts) as number[] }, s.avail, now);
    if (r.next.armed !== !!w.armed || r.alert) {
      writes.push(db.prepare('UPDATE watches SET armed = ?, alerts = ?, last_alert = COALESCE(?, last_alert) WHERE device = ? AND term = ? AND course = ? AND sec = ?')
        .bind(r.next.armed ? 1 : 0, JSON.stringify(r.next.alerts), r.alert ? now : null, w.device, term, w.course, w.sec));
    }
    if (r.alert) {
      alerts++;
      const seatsLeft = s.avail === 1 ? '1 seat' : `${s.avail} seats`;
      queue.push(db.prepare('INSERT INTO outbox (device, message, topic, next, expires) VALUES (?, ?, ?, ?, ?)').bind(
        w.device,
        JSON.stringify({ title: `${w.course} ${w.sec} has ${seatsLeft} open`, body: `${s.avail} of ${s.cap} open at ${clock(now)}. Register on Empower before it goes.`, url: '/#/seats', tag: `${term}-${w.course}-${w.sec}` }),
        `${term}${w.course}${w.sec}`, now, now + ALERT_TTL,
      ));
    }
  }
  // Shuffled so the same people aren't always first when one seat opens for many watchers.
  await db.batch([...writes, ...shuffle(queue)]);
  return alerts;
}

export async function cleanup(db: D1Database, now: number) {
  await db.batch([
    db.prepare('DELETE FROM outbox WHERE expires <= ?').bind(now),
    db.prepare('DELETE FROM events WHERE t < ?').bind(now - 7 * 24 * 60 * MIN),
    db.prepare('DELETE FROM watches WHERE expires <= ?').bind(now),
    // Devices nobody has opened in 30 days and that watch nothing.
    db.prepare('DELETE FROM devices WHERE seen < ? AND id NOT IN (SELECT device FROM watches)').bind(now - 30 * 24 * 60 * MIN),
    db.prepare('DELETE FROM seats WHERE seen < ?').bind(now - 2 * 24 * 60 * MIN),
    db.prepare('DELETE FROM signups WHERE day < ?').bind(new Date(now - 2 * 24 * 60 * MIN).toISOString().slice(0, 10)),
  ]);
}

export interface RunReport { pushed: number; polled: string[]; alerts: number; skipped?: string; error?: string }

export async function run(env: Env, now = Date.now()): Promise<RunReport> {
  const db = env.DB;
  const pushed = await drainOutbox(env, now);
  if (new Date(now).getUTCMinutes() % 30 === 0) await cleanup(db, now);

  const { results: watched } = await db.prepare('SELECT DISTINCT term, dept FROM watches WHERE expires > ?').bind(now).all<{ term: string; dept: string }>();
  if (!watched.length) return { pushed, polled: [], alerts: 0, skipped: 'nothing watched' }; // no requests at all

  const st = await kvGet<unknown>(db, ['poller', 'session', 'polled']);
  const p: PollerState = { ...freshPoller(), ...(st.poller as Partial<PollerState> | undefined) };
  if (now < p.until) return { pushed, polled: [], alerts: 0, skipped: p.blocked ? 'blocked, waiting' : 'backing off' };
  if (!(await lock(db, now))) return { pushed, polled: [], alerts: 0, skipped: 'another run is polling' };

  const polled = (st.polled as Record<string, number> | undefined) ?? {};
  let session = st.session as Session | undefined;
  const report: RunReport = { pushed, polled: [], alerts: 0 };
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
          writes.push(notifyAdmins(db, now, 'Seat checks paused', `Empower refused the poller (${err.message}). Trying again in an hour. Nobody gets alerts until then.`));
        }
        report.error = err.message;
        break;
      }
      if (p.blocked) writes.push(notifyAdmins(db, now, 'Seat checks resumed', 'Empower is answering again.'));
      p.fails = 0;
      p.blocked = false;
      p.lastOk = Date.now();
      polled[key] = now;
      report.polled.push(key);
      if (!got.seats.length) writes.push(logEvent(db, now, 'empty', { dept })); // a bad filter or a page change
      else report.alerts += await apply(db, term, dept, got.seats, now);
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
    writes.push(kvPut(db, 'poller', p), kvPut(db, 'polled', polled), unlock(db));
    if (session) writes.push(kvPut(db, 'session', session));
    else writes.push(db.prepare("DELETE FROM kv WHERE k = 'session'"));
    await db.batch(writes);
  }
}
