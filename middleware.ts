// Vercel Routing Middleware: sends /api/* to the seats Worker. It adds a key only this proxy knows, and the visitor's
// address as Vercel saw it, so the Worker refuses anyone who calls it directly and its per-address limits hold.
// SEATS_PROXY_KEY is a Vercel environment variable; the Worker has the same value as its PROXY_KEY secret.

declare const process: { env: Record<string, string | undefined> };

export const config = { matcher: '/api/:path*' };

const WORKER = 'https://fccu-seats.qasimsuhail1.workers.dev';

export default async function middleware(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('accept-encoding'); // a plain body back, passed through as it is
  headers.set('x-proxy-key', process.env.SEATS_PROXY_KEY ?? '');
  headers.set('x-client-ip', req.headers.get('x-real-ip') ?? ''); // set by Vercel, not by the visitor
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  const res = await fetch(`${WORKER}${url.pathname}${url.search}`, { method: req.method, headers, body, redirect: 'manual' });
  // fetch() has already decoded the body, so the Worker's encoding and length no longer describe it. Passing them
  // on makes browsers fail with ERR_CONTENT_DECODING_FAILED.
  const out = new Headers(res.headers);
  out.delete('content-encoding');
  out.delete('content-length');
  out.delete('transfer-encoding');
  return new Response(res.body, { status: res.status, headers: out });
}
