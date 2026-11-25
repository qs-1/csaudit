// Web Push without a library: payload encryption (RFC 8291, aes128gcm) and VAPID signing (RFC 8292), on WebCrypto.
// About 0.17 ms of CPU per message, measured on Workers.

export interface PushSub { endpoint: string; p256dh: string; auth: string }
export interface Vapid { publicKey: string; jwk: JsonWebKey; subject: string } // publicKey: base64url, uncompressed P-256

const enc = new TextEncoder();
export type Bytes = Uint8Array<ArrayBuffer>;
const utf8 = (s: string) => enc.encode(s) as Bytes;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

export function b64u(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(s: string): Bytes {
  const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
}

const cat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Encrypts one message for a subscription. `eph` and `salt` are only passed by tests. */
export async function encrypt(sub: Pick<PushSub, 'p256dh' | 'auth'>, payload: Uint8Array, eph?: CryptoKeyPair, salt: Bytes = crypto.getRandomValues(new Uint8Array(16))): Promise<Bytes> {
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  const pair = eph ?? (await crypto.subtle.generateKey(ECDH, true, ['deriveBits']) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  const ua = await crypto.subtle.importKey('raw', uaPublic, ECDH, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ua } as never, pair.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, cat(utf8('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record, so it ends with the last-record delimiter 0x02.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(payload, new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPublic.length;
  return cat(head, asPublic, sealed);
}

// A VAPID token is valid for up to 24 hours; one per push service, reused while this isolate lives.
const jwts = new Map<string, { jwt: string; exp: number }>();
let signer: { jwk: JsonWebKey; key: Promise<CryptoKey> } | null = null;

export async function vapidJwt(v: Vapid, endpoint: string, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const hit = jwts.get(aud);
  if (hit && hit.exp - now > 60 * 60_000) return hit.jwt;
  if (signer?.jwk !== v.jwk) signer = { jwk: v.jwk, key: crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
  const exp = now + 12 * 60 * 60_000;
  const head = b64u(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(utf8(JSON.stringify({ aud, exp: Math.floor(exp / 1000), sub: v.subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signer.key, utf8(`${head}.${body}`));
  const jwt = `${head}.${body}.${b64u(sig)}`;
  jwts.set(aud, { jwt, exp });
  return jwt;
}

export interface PushOptions { ttl: number; urgency: 'very-low' | 'low' | 'normal' | 'high'; topic?: string }

/**
 * Sends one message. TTL: how long the push service keeps trying if the phone is off or offline; after that the
 * message is dropped, because "1 seat open" an hour late is wrong. Urgency high asks the phone to deliver it now
 * instead of batching it for battery. A newer message with the same topic replaces one still waiting.
 */
export async function send(v: Vapid, sub: PushSub, message: unknown, o: PushOptions): Promise<number> {
  const body = await encrypt(sub, utf8(JSON.stringify(message)));
  const headers: Record<string, string> = {
    Authorization: `vapid t=${await vapidJwt(v, sub.endpoint)}, k=${v.publicKey}`,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(o.ttl),
    Urgency: o.urgency,
  };
  if (o.topic) headers.Topic = o.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  await res.body?.cancel();
  return res.status;
}
