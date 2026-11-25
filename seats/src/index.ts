// Seat alerts for the FCCU planner. The site proxies /api/* here (vercel.json), so the app stays same-origin.
//
// No accounts: a device is a random id plus a secret the app keeps in localStorage. Push is optional; a device
// without it still sees its watches update in the app.

import { deptOf, getList, openSession } from './empower';
import { armedFor, FRESH, MIN, type TermCounts } from './logic';
import { run, vapid, type Env } from './poll';
import { send } from './webpush';

const WATCHES_MAX = 15;
const WATCH_DAYS = 45;
const SIGNUPS_PER_DAY = 200; // per network: a campus shares one address, so this only stops scripts
const DEVICES_MAX = 20_000;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
const fail = (status: number, error: string) => json({ error }, status);

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomId = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/* ---------- What can be watched: the planner's own published section lists ---------- */

type Index = { terms: string[]; sections: Record<string, Record<string, string[]>> };
let index: { at: number; data: Index } | null = null;

/** Terms from the site's sync.json and their sections from /sections/<term>.json, cached for 30 minutes. */
async function sectionsIndex(env: Env): Promise<Index> {
  if (index && Date.now() - index.at < 30 * MIN) return index.data;
  const sync = await (await fetch(`${env.SITE}/sync.json`, { cf: { cacheTtl: 300 } })).json<{ terms: string[] }>();
  const sections: Index['sections'] = {};
  for (const t of sync.terms) {
    const r = await fetch(`${env.SITE}/sections/${t}.json`, { cf: { cacheTtl: 300 } });
    if (r.ok) sections[t] = (await r.json<{ s: Record<string, string[]> }>()).s;
  }
  index = { at: Date.now(), data: { terms: Object.keys(sections), sections } };
  return index.data;
}

/* ---------- Devices ---------- */

interface Device { id: string; endpoint: string | null; push_dead: number | null; admin: number }

async function auth(req: Request, env: Env): Promise<Device | null> {
  const m = /^Bearer ([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(req.headers.get('Authorization') ?? '');
  if (!m) return null;
  const d = await env.DB.prepare('SELECT id, endpoint, push_dead, admin FROM devices WHERE id = ? AND secret = ?').bind(m[1], await sha256(m[2]!)).first<Device>();
  if (d) await env.DB.prepare('UPDATE devices SET seen = ? WHERE id = ?').bind(Date.now(), d.id).run();
  return d;
}

interface SubBody { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
/** A push subscription from the browser, or null. Only https endpoints, with keys of the right shape. */
function parseSub(b: SubBody | null | undefined): { endpoint: string; p256dh: string; auth: string } | null {
  if (!b || typeof b.endpoint !== 'string' || typeof b.keys?.p256dh !== 'string' || typeof b.keys?.auth !== 'string') return null;
  if (!/^https:\/\/[^\s]{10,800}$/.test(b.endpoint)) return null;
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(b.keys.p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(b.keys.auth)) return null;
  return { endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth };
}

const clientIp = (req: Request) => req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('cf-connecting-ip') ?? 'unknown';

async function createDevice(req: Request, env: Env) {
  const body = await req.json<{ sub?: SubBody }>().catch(() => null);
  const sub = body?.sub ? parseSub(body.sub) : null;
  if (body?.sub && !sub) return fail(400, 'That push subscription looks wrong');
  const now = Date.now();
  const id = randomId(16);
  const secret = randomId(32);
  if (sub) {
    // The same browser subscribing again (cleared storage, new install): keep its watches, issue a new secret.
    const old = await env.DB.prepare('SELECT id FROM devices WHERE endpoint = ?').bind(sub.endpoint).first<{ id: string }>();
    if (old) {
      await env.DB.prepare('UPDATE devices SET secret = ?, p256dh = ?, auth = ?, push_dead = NULL, seen = ? WHERE id = ?').bind(await sha256(secret), sub.p256dh, sub.auth, now, old.id).run();
      return json({ id: old.id, secret });
    }
  }
  const day = new Date(now).toISOString().slice(0, 10);
  const who = await sha256(`${clientIp(req)}|${day}|${env.VAPID_PUBLIC}`);
  const [count, mine] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM devices'),
    env.DB.prepare('SELECT n FROM signups WHERE who = ? AND day = ?').bind(who, day),
  ]);
  if (((count!.results[0] as { n: number }).n) >= DEVICES_MAX) return fail(503, 'Seat alerts are full right now');
  if (((mine!.results[0] as { n: number } | undefined)?.n ?? 0) >= SIGNUPS_PER_DAY) return fail(429, 'Too many new devices from this network today. Try tomorrow.');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO devices (id, secret, endpoint, p256dh, auth, created, seen) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, await sha256(secret), sub?.endpoint ?? null, sub?.p256dh ?? null, sub?.auth ?? null, now, now),
    env.DB.prepare('INSERT INTO signups (who, day, n) VALUES (?, ?, 1) ON CONFLICT (who, day) DO UPDATE SET n = n + 1').bind(who, day),
  ]);
  return json({ id, secret }, 201);
}

async function setPush(req: Request, env: Env, d: Device) {
  const body = await req.json<{ sub?: SubBody | null }>().catch(() => null);
  if (body?.sub === null) {
    await env.DB.prepare('UPDATE devices SET endpoint = NULL, p256dh = NULL, auth = NULL, push_dead = NULL WHERE id = ?').bind(d.id).run();
    return json({ push: 'off' });
  }
  const sub = parseSub(body?.sub);
  if (!sub) return fail(400, 'That push subscription looks wrong');
  // Another device row holding this endpoint is this same browser from before: it gives the address up.
  await env.DB.batch([
    env.DB.prepare('UPDATE devices SET endpoint = NULL, p256dh = NULL, auth = NULL WHERE endpoint = ? AND id != ?').bind(sub.endpoint, d.id),
    env.DB.prepare('UPDATE devices SET endpoint = ?, p256dh = ?, auth = ?, push_dead = NULL WHERE id = ?').bind(sub.endpoint, sub.p256dh, sub.auth, d.id),
  ]);
  return json({ push: 'on' });
}

async function testPush(env: Env, d: Device) {
  if (!d.endpoint || d.push_dead) return fail(409, 'Notifications are off on this device');
  const key = `test:${d.id}`;
  const last = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first<{ v: string }>();
  if (last && Date.now() - Number(last.v) < 30_000) return fail(429, 'Wait a few seconds before another test');
  await env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind(key, String(Date.now())).run();
  const sub = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM devices WHERE id = ?').bind(d.id).first<{ endpoint: string; p256dh: string; auth: string }>();
  const status = await send(vapid(env), sub!, { title: 'Test alert', body: '', url: '/#/seats', tag: 'test' }, { ttl: 300, urgency: 'high', topic: 'test' }).catch(() => 0);
  if (status === 404 || status === 410) {
    await env.DB.prepare('UPDATE devices SET push_dead = ? WHERE id = ?').bind(Date.now(), d.id).run();
    return fail(410, 'Notifications stopped on this device');
  }
  return status >= 200 && status < 300 ? json({ sent: true }) : fail(502, `The push service answered ${status || 'nothing'}`);
}

/**
 * A real alert through the whole path: re-arms one of this device's open watched sections and marks it new, so the
 * next poll reads it, sees seats and queues a push like any reopening. Only this device's watch changes.
 */
async function liveTest(env: Env, d: Device) {
  if (!d.endpoint || d.push_dead) return fail(409, 'Turn on notifications first');
  const now = Date.now();
  const key = `livetest:${d.id}`;
  const last = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first<{ v: string }>();
  if (last && now - Number(last.v) < 5 * MIN) return fail(429, 'One test every 5 minutes');
  const { results } = await env.DB.prepare('SELECT term, course, sec, dept FROM watches WHERE device = ? AND expires > ?').bind(d.id, now)
    .all<{ term: string; course: string; sec: string; dept: string }>();
  const counts: Record<string, TermCounts> = {};
  for (const t of new Set(results.map((w) => w.term))) counts[t] = await termCounts(env, t);
  // A watch with seats by the last check, else one not checked yet (its first check decides).
  const seatsOf = (w: (typeof results)[number]) => {
    const dc = counts[w.term]?.[w.dept];
    return dc && now - dc.at < FRESH ? dc.s[`${w.course}|${w.sec}`]?.[0] ?? null : null;
  };
  const open = results.find((w) => (seatsOf(w) ?? 0) > 0) ?? results.find((w) => seatsOf(w) === null);
  if (!open) return fail(409, 'Watch a section that has seats first');
  await env.DB.batch([
    env.DB.prepare('UPDATE watches SET armed = 1, alerts = ?, created = ? WHERE device = ? AND term = ? AND course = ? AND sec = ?').bind('[]', now, d.id, open.term, open.course, open.sec),
    env.DB.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind(key, String(now)),
  ]);
  return json({ course: open.course, sec: open.sec });
}

/* ---------- Watches ---------- */

const pushState = (d: Device) => (!d.endpoint ? 'none' : d.push_dead ? 'dead' : 'on');

async function listWatches(env: Env, d: Device) {
  const now = Date.now();
  const [rows, st, live] = await env.DB.batch([
    env.DB.prepare('SELECT term, course, sec, dept, armed, last_alert, created, expires FROM watches WHERE device = ? AND expires > ? ORDER BY created').bind(d.id, now),
    env.DB.prepare("SELECT v FROM kv WHERE k = 'poller'"),
    env.DB.prepare("SELECT k, v FROM kv WHERE k IN (SELECT DISTINCT 'live:' || term FROM watches WHERE device = ?)").bind(d.id),
  ]);
  const counts = Object.fromEntries((live!.results as { k: string; v: string }[]).map((r) => [r.k.slice(5), JSON.parse(r.v) as TermCounts]));
  const watches = (rows!.results as { term: string; course: string; sec: string; dept: string }[]).map(({ dept, ...w }) => {
    const dc = counts[w.term]?.[dept];
    const c = dc?.s[`${w.course}|${w.sec}`];
    return { ...w, avail: c?.[0] ?? null, cap: c?.[1] ?? null, seen: c ? dc!.at : null, changed: c?.[2] ?? null };
  });
  const p = st!.results[0] ? JSON.parse((st!.results[0] as { v: string }).v) as { until: number; blocked: boolean; lastOk: number } : null;
  const poller = !p ? 'starting' : p.blocked ? 'blocked' : now < p.until ? 'backoff' : 'ok';
  return json({ push: pushState(d), poller, lastOk: p?.lastOk ?? null, now, watches });
}

const termCounts = async (env: Env, term: string) => {
  const r = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(`live:${term}`).first<{ v: string }>();
  return r ? JSON.parse(r.v) as TermCounts : {};
};

async function addWatch(req: Request, env: Env, d: Device) {
  const b = await req.json<{ term?: unknown; course?: unknown; sec?: unknown; avail?: unknown }>().catch(() => null);
  if (typeof b?.term !== 'string' || typeof b.course !== 'string' || typeof b.sec !== 'string') return fail(400, 'Send term, course and sec');
  const idx = await sectionsIndex(env);
  if (!idx.terms.includes(b.term)) return fail(400, `${b.term} isn't open for alerts`);
  if (!idx.sections[b.term]?.[b.course]?.includes(b.sec)) return fail(400, `${b.course} ${b.sec} isn't in the ${b.term} list`);
  const now = Date.now();
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM watches WHERE device = ? AND expires > ?').bind(d.id, now).first<{ n: number }>();
  if (count!.n >= WATCHES_MAX) return fail(409, `You can watch up to ${WATCHES_MAX} sections`);
  // Armed if the section is full: by the poller's count when it's fresh, else by what the app showed.
  const dc = (await termCounts(env, b.term))[deptOf(b.course)];
  const c = dc && now - dc.at < FRESH ? dc.s[`${b.course}|${b.sec}`] : undefined;
  const avail = c ? c[0] : Number.isInteger(b.avail) ? (b.avail as number) : null;
  await env.DB.prepare(`INSERT INTO watches (device, term, course, sec, dept, armed, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (device, term, course, sec) DO UPDATE SET expires = excluded.expires`)
    .bind(d.id, b.term, b.course, b.sec, deptOf(b.course), armedFor(avail) ? 1 : 0, now, now + WATCH_DAYS * 24 * 60 * MIN).run();
  return listWatches(env, d);
}

async function removeWatch(req: Request, env: Env, d: Device) {
  const b = await req.json<{ term?: unknown; course?: unknown; sec?: unknown }>().catch(() => null);
  if (typeof b?.term !== 'string' || typeof b.course !== 'string' || typeof b.sec !== 'string') return fail(400, 'Send term, course and sec');
  await env.DB.prepare('DELETE FROM watches WHERE device = ? AND term = ? AND course = ? AND sec = ?').bind(d.id, b.term, b.course, b.sec).run();
  return listWatches(env, d);
}

/** Fresh counts for every section the poller has checked lately, for the planner to show instead of hourly ones. */
async function liveSeats(env: Env, term: string | null) {
  if (!term || !/^\d{4}[A-Z]{2}$/.test(term)) return fail(400, 'Which term?');
  const since = Date.now() - FRESH;
  const out: [string, string, number, number, number][] = [];
  for (const d of Object.values(await termCounts(env, term))) {
    if (d.at <= since) continue;
    for (const [key, [avail, cap]] of Object.entries(d.s)) {
      const [course, sec] = key.split('|') as [string, string];
      out.push([course, sec, avail, cap, d.at]);
    }
  }
  return json({ term, seats: out }, 200, { 'Cache-Control': 'public, max-age=20, s-maxage=30' });
}

/** Admin only: one whole-term GetList, to see in the logs whether it fits the CPU limit. */
async function probeTerm(d: Device, term: string | null) {
  if (!d.admin) return fail(403, 'Admins only');
  if (!term || !/^\d{4}[A-Z]{2}$/.test(term)) return fail(400, 'Which term?');
  const t = Date.now();
  const got = await getList(await openSession(), term, '', 60_000);
  return json({ term, sections: got.seats.length, ms: got.ms, wallMs: Date.now() - t });
}

/* ---------- Router ---------- */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname.replace(/\/+$/, '')}`;
    try {
      if (route === 'GET /api/config') return json({ vapid: env.VAPID_PUBLIC }, 200, { 'Cache-Control': 'public, max-age=3600' });
      if (route === 'GET /api/seats') return await liveSeats(env, url.searchParams.get('term'));
      if (route === 'POST /api/devices') return await createDevice(req, env);
      const d = await auth(req, env);
      if (!d) return fail(401, 'Unknown device');
      switch (route) {
        case 'GET /api/watches': return await listWatches(env, d);
        case 'POST /api/watches': return await addWatch(req, env, d);
        case 'DELETE /api/watches': return await removeWatch(req, env, d);
        case 'PUT /api/devices/me/push': return await setPush(req, env, d);
        case 'POST /api/devices/me/test': return await testPush(env, d);
        case 'POST /api/devices/me/livetest': return await liveTest(env, d);
        case 'POST /api/admin/probe': return await probeTerm(d, url.searchParams.get('term'));
        case 'DELETE /api/devices/me':
          await env.DB.batch([env.DB.prepare('DELETE FROM watches WHERE device = ?').bind(d.id), env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(d.id)]);
          return json({ deleted: true });
      }
      return fail(404, 'No such endpoint');
    } catch (e) {
      console.error(route, e);
      return fail(500, 'Something went wrong');
    }
  },

  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(run(env).then((r) => console.log(JSON.stringify(r)), (e) => console.error('run failed', e)));
  },
} satisfies ExportedHandler<Env>;
