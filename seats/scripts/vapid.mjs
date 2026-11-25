// Makes a VAPID key pair for web push. Run once:
//   npm run vapid
// Put the public key in wrangler.jsonc (VAPID_PUBLIC) and the private JWK in the Worker's secrets:
//   npx wrangler secret put VAPID_JWK      (paste the JSON line)
// Changing the pair later invalidates every existing push subscription.
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
const jwk = await crypto.subtle.exportKey('jwk', privateKey);
console.log('VAPID_PUBLIC =', Buffer.from(raw).toString('base64url'));
console.log('VAPID_JWK    =', JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
