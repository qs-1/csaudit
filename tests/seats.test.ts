// The seat-alert Worker's pure parts: Empower parsing, alert transitions, backoff, scheduling, push encryption.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deptOf, findToken, listBody, parseSeats } from '../seats/src/empower';
import { ALERTS_PER_HOUR, armedFor, backoff, diffDept, FRESH, freshPoller, gap, MIN, newSections, pickDepts, pruneTerm, recordTime, step, type WatchState } from '../seats/src/logic';
import { b64u, encrypt, unb64u, vapidJwt } from '../seats/src/webpush';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('Empower parsing', () => {
  it('reads sections, ids and seats from GetList', () => {
    const s = parseSeats(fixture('getlist-busn.html'));
    expect(s.map((x) => [x.course, x.sec, x.avail, x.cap])).toEqual([['BUSN 121', 'D', 30, 35], ['BUSN 121', 'E', 35, 35], ['BUSN 382', 'B', 0, 35]]);
    expect(s.every((x) => /^[0-9A-F]{32}$/.test(x.cid ?? ''))).toBe(true);
  });

  it('takes the seats from the last meeting row of a section that meets more than once', () => {
    const s = parseSeats(fixture('getlist-biol.html'));
    expect(s.map((x) => `${x.course} ${x.sec}`)).toEqual(['BIOL 100 A', 'BIOL 100 B', 'BIOL 100 E']);
    expect(s.every((x) => x.cap === 35 && x.avail >= 0 && x.avail <= 35)).toBe(true);
  });

  it('agrees with the Python scraper on the same HTML', () => {
    // Values scripts/scrape.py parsed from these fixtures when they were saved.
    expect(parseSeats(fixture('getlist-biol.html')).map((x) => x.avail)).toEqual([18, 28, 31]);
  });

  it('finds the form token near the top of the page', () => {
    expect(findToken('<form id="f1"><input type="hidden" name="token" id="token" value="F46DECD66860C6519613ABE3CD193CC3035ACACC">')).toBe('F46DECD66860C6519613ABE3CD193CC3035ACACC');
    expect(findToken('<html>no form</html>')).toBeNull();
  });

  it('sends the fields the browser sends', () => {
    const b = listBody('TOK', '2027SP', 'CSCS');
    expect(b.get('token')).toBe('TOK');
    expect(b.get('empower_global_dept_id')).toBe('CSCS');
    expect(b.get('status')).toBe('1');
    expect(b.has('cs_emph_id')).toBe(true);
    expect(deptOf('CSCS 100')).toBe('CSCS');
  });
});

describe('alert transitions', () => {
  const t0 = Date.UTC(2026, 10, 25, 4, 0);
  const play = (counts: number[], start: WatchState = { armed: true, alerts: [] }) => {
    let w = start;
    return counts.map((a, i) => { const r = step(w, a, t0 + i * MIN); w = r.next; return r.alert; });
  };

  it('alerts once when a full section opens, not again while it stays open', () => {
    expect(play([0, 0, 1, 2, 1, 3])).toEqual([false, false, true, false, false, false]);
  });

  it('alerts again after the section fills and reopens (MATH 107 E at 9am)', () => {
    // 1 -> 0, reopens 3 minutes later, fills, reopens 6 minutes after that.
    expect(play([1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 1], { armed: armedFor(1), alerts: [] })).toEqual([false, false, false, false, true, false, false, false, false, false, false, false, false, true]);
  });

  it('caps alerts per hour for a seat that keeps flipping', () => {
    const flips = Array.from({ length: 40 }, (_, i) => i % 2); // 0,1,0,1,... one minute apart
    expect(play(flips).filter(Boolean)).toHaveLength(ALERTS_PER_HOUR);
  });

  it('arms a new watch only when the section is full or unknown', () => {
    expect(armedFor(0)).toBe(true);
    expect(armedFor(null)).toBe(true);
    expect(armedFor(3)).toBe(false);
    // A watch made while seats were open waits for a fill, then alerts on the reopening.
    expect(play([3, 2, 0, 1], { armed: armedFor(3), alerts: [] })).toEqual([false, false, false, true]);
  });
});

describe('department diff', () => {
  const t0 = Date.UTC(2026, 10, 25, 4, 0);
  const sec = (s: string, avail: number, cap = 35) => ({ course: 'MATH 107', sec: s, avail, cap });

  it('lists only sections that crossed between full and open', () => {
    const a = diffDept(undefined, [sec('A', 0), sec('B', 3), sec('C', 0)], t0);
    const b = diffDept(a.next, [sec('A', 1), sec('B', 2), sec('C', 0)], t0 + MIN);
    expect(b.crossed).toEqual(['MATH 107|A']);
    expect(b.since).toBe(t0);
    expect(b.changed).toBe(2);
    const c = diffDept(b.next, [sec('A', 1), sec('B', 0), sec('C', 0)], t0 + 2 * MIN);
    expect(c.crossed).toEqual(['MATH 107|B']);
  });

  it('keeps when each section last changed', () => {
    const a = diffDept(undefined, [sec('A', 0), sec('B', 3)], t0);
    const b = diffDept(a.next, [sec('A', 0), sec('B', 2)], t0 + MIN);
    expect(b.next.s).toEqual({ 'MATH 107|A': [0, 35, t0], 'MATH 107|B': [2, 35, t0 + MIN] });
    expect(b.next.at).toBe(t0 + MIN);
  });

  it('reads every watch when there is no recent previous check', () => {
    expect(diffDept(undefined, [sec('A', 0)], t0)).toMatchObject({ since: 0, crossed: [] });
    const old = diffDept(undefined, [sec('A', 0)], t0).next;
    expect(diffDept(old, [sec('A', 0)], t0 + FRESH)).toMatchObject({ since: 0, crossed: [] });
  });

  it('counts a section new to a recent check as crossed', () => {
    const a = diffDept(undefined, [sec('A', 0)], t0);
    expect(diffDept(a.next, [sec('A', 0), sec('D', 0)], t0 + MIN).crossed).toEqual(['MATH 107|D']);
  });

  it('finds sections never seen before, even after a gap', () => {
    const a = diffDept(undefined, [sec('A', 0)], t0);
    expect(a.added).toEqual([]); // a first check knows nothing yet
    expect(diffDept(a.next, [sec('A', 0), sec('F', 30)], t0 + FRESH * 3).added).toEqual(['MATH 107|F']);
  });

  it('does not take a section that dropped out of one response for a new one', () => {
    const a = diffDept(undefined, [sec('A', 0), sec('B', 0)], t0);
    const b = diffDept(a.next, [sec('A', 0)], t0 + MIN);
    expect(b.added).toEqual([]);
    expect(diffDept(b.next, [sec('A', 0), sec('B', 2)], t0 + 2 * MIN).added).toEqual([]);
  });

  it('alerts a course watch for new sections with seats, within the hourly cap', () => {
    const s = { 'MATH 107|F': [30, 35, t0] as [number, number, number], 'MATH 107|G': [0, 35, t0] as [number, number, number] };
    expect(newSections(['MATH 107|F', 'MATH 107|G', 'COMP 421|C'], s, 'MATH 107', [], t0)).toEqual({ open: ['MATH 107|F'], alerts: [t0] });
    expect(newSections(['MATH 107|G'], s, 'MATH 107', [], t0).open).toEqual([]);
    const full = Array.from({ length: ALERTS_PER_HOUR }, (_, i) => t0 - i * MIN);
    expect(newSections(['MATH 107|F'], s, 'MATH 107', full, t0).open).toEqual([]);
  });

  it('drops departments not checked in two days', () => {
    const now = t0 + 3 * 24 * 60 * MIN;
    expect(Object.keys(pruneTerm({ MATH: { at: t0, s: {} }, BUSN: { at: now - MIN, s: {} } }, now))).toEqual(['BUSN']);
  });
});

describe('poller pacing', () => {
  it('backs off 1, 2, 4, 8, 16, then 30 minutes; a block waits an hour', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((n) => backoff(n, false) / MIN)).toEqual([1, 2, 4, 8, 16, 30, 30]);
    expect(backoff(1, true)).toBe(60 * MIN);
  });

  it('treats a reply 3x slower than usual as a slowdown, and stretches the gap', () => {
    const p = freshPoller();
    for (const ms of [740, 760, 750, 770, 745]) expect(recordTime(p, 'MATH', ms).slow).toBe(false);
    expect(recordTime(p, 'MATH', 900).slow).toBe(false);
    expect(recordTime(p, 'MATH', 3000).slow).toBe(true);
    expect([0, 1, 2, 3, 3].map((s) => gap({ ...p, slow: s }) / MIN)).toEqual([1, 2, 4, 8, 8]);
  });

  it('polls only watched departments, oldest first, skipping fresh ones', () => {
    const now = 10 * MIN;
    const last = { 'T|A': now - 30_000, 'T|B': now - 5 * MIN, 'T|C': now - 2 * MIN };
    expect(pickDepts(['T|A', 'T|B', 'T|C', 'T|D', 'T|B'], last, now, MIN, 2)).toEqual(['T|D', 'T|B']);
    expect(pickDepts([], last, now, MIN, 4)).toEqual([]);
  });
});

/* ---------- Web Push: decrypt what encrypt produced, the way a browser would (RFC 8291) ---------- */

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
type Bytes = Uint8Array<ArrayBuffer>;
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
const te = new TextEncoder();
const join = (...p: Uint8Array[]): Bytes => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

async function browserDecrypt(body: Bytes, ua: CryptoKeyPair, auth: Bytes) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const as = await crypto.subtle.importKey('raw', asPublic, ECDH, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: as }, ua.privateKey, 256));
  const ikm = await hkdf(auth, shared, join(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen)));
  return { rs, idlen, delimiter: plain[plain.length - 1], text: new TextDecoder().decode(plain.slice(0, -1)) };
}

describe('web push', () => {
  it('encrypts a message a browser can decrypt', async () => {
    const ua = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']) as CryptoKeyPair;
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const sub = { p256dh: b64u(await crypto.subtle.exportKey('raw', ua.publicKey) as ArrayBuffer), auth: b64u(auth) };
    const msg = JSON.stringify({ title: 'CSCS 100 B has 1 seat open', body: '1 of 35 open at 9:03 AM.' });
    const out = await browserDecrypt(await encrypt(sub, te.encode(msg)), ua, auth);
    expect(out).toEqual({ rs: 4096, idlen: 65, delimiter: 2, text: msg });
  });

  it('round-trips base64url', () => {
    const b = crypto.getRandomValues(new Uint8Array(65));
    expect([...unb64u(b64u(b))]).toEqual([...b]);
  });

  it('signs a VAPID token for the push service origin that verifies with the public key', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const now = Date.UTC(2026, 10, 25);
    const jwt = await vapidJwt({ publicKey: '', jwk, subject: 'https://csaudit.vercel.app' }, 'https://fcm.googleapis.com/fcm/send/abc', now);
    const [h, c, s] = jwt.split('.') as [string, string, string];
    const claims = JSON.parse(new TextDecoder().decode(unb64u(c)));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: Math.floor(now / 1000) + 12 * 3600, sub: 'https://csaudit.vercel.app' });
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, unb64u(s), te.encode(`${h}.${c}`))).toBe(true);
  });
});
