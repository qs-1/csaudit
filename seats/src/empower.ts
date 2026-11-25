// Talking to FCCU's Empower course catalog. Requests go one at a time; the caller decides when.
//
// GetList needs a form token, and the token only works with the cookies of the page load that issued it
// (JSESSIONID, SERVER, __cf_bm). The catalog page is ~1.8 MB because its course dropdown lists every course on
// record, so the token is read from the first few KB of the stream and the rest is never downloaded.

export const BASE = 'https://mysis-fccollege.empower-xl.com/';
export const PAGE = `${BASE}fusebox.cfm?fuseaction=CourseCatalog&rpt=1`;
export const LIST = `${BASE}cfcs/courseCatalog.cfc?method=GetList`;
export const UA = 'fccu-audit seat alerts (student project; github.com/qs-1/csaudit)';

export interface Session { token: string; cookies: Record<string, string>; at: number }
export interface Seat { course: string; sec: string; cid: string | null; cap: number; avail: number }

/** Why a request didn't give us sections. `blocked`: Cloudflare or the server refused us (not a hiccup). */
export class EmpowerError extends Error {
  constructor(message: string, readonly kind: 'blocked' | 'token' | 'error', readonly ms: number) { super(message); }
}

// Seats sit on the last meeting row of a section, after its course label, so they belong to the latest label.
const ROW = /Course<\/b><br\/>\s*([A-Z][A-Z0-9/&.-]*)(?:&nbsp;|\s)+(\d{3,4}[A-Z]?)(?:&nbsp;|\s)+([A-Z0-9]+)|data-cid="([0-9A-F]{32})"|Seats Offer<\/b><br\/>\s*(\d+)|Seats Available<\/b><br\/>\s*(-?\d+)/g;

/** Sections and seat counts from GetList's HTML. One regex pass: about 1 ms for BUSN (135 sections). */
export function parseSeats(html: string): Seat[] {
  const out: Seat[] = [];
  let cur: Seat | null = null;
  for (const m of html.matchAll(ROW)) {
    if (m[1]) {
      cur = { course: `${m[1]} ${m[2]}`, sec: m[3]!, cid: null, cap: -1, avail: -1 };
      out.push(cur);
    } else if (!cur) continue;
    else if (m[4]) cur.cid ??= m[4];
    else if (m[5]) cur.cap = +m[5];
    else if (m[6]) cur.avail = Math.max(0, +m[6]);
  }
  return out.filter((s) => s.cap >= 0 && s.avail >= 0);
}

export function findToken(html: string): string | null {
  const i = html.indexOf('name="token"');
  if (i < 0) return null;
  return /value="([0-9A-F]{20,64})"/.exec(html.slice(i, i + 200))?.[1] ?? null;
}

function takeCookies(res: Response, jar: Record<string, string>) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const eq = pair!.indexOf('=');
    if (eq > 0) jar[pair!.slice(0, eq).trim()] = pair!.slice(eq + 1).trim();
  }
}

const cookieHeader = (jar: Record<string, string>) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

/** A challenge page, an error page or anything else that isn't the catalog. */
function refused(res: Response, ms: number): EmpowerError | null {
  if (res.headers.get('cf-mitigated')) return new EmpowerError(`Cloudflare challenge (${res.status})`, 'blocked', ms);
  if (res.status === 403 || res.status === 429) return new EmpowerError(`HTTP ${res.status}`, 'blocked', ms);
  if (!res.ok) return new EmpowerError(`HTTP ${res.status}`, 'error', ms);
  return null;
}

export async function openSession(timeoutMs = 20_000): Promise<Session> {
  const t = Date.now();
  const res = await fetch(PAGE, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  const bad = refused(res, Date.now() - t);
  if (bad) { await res.body?.cancel(); throw bad; }
  const jar: Record<string, string> = {};
  takeCookies(res, jar);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let head = '';
  let token: string | null = null;
  try {
    while (!token && head.length < 64_000) {
      const { value, done } = await reader.read();
      if (done) break;
      head += dec.decode(value, { stream: true });
      // Only the new part could hold it; looking from a little before keeps a token split across chunks.
      token = findToken(head.slice(Math.max(0, head.length - value.length - 200)));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!token) {
    const kind = /challenge|cf-chl|Just a moment/i.test(head) ? 'blocked' : 'error';
    throw new EmpowerError(kind === 'blocked' ? 'Cloudflare challenge page' : 'No form token on the catalog page', kind, Date.now() - t);
  }
  return { token, cookies: jar, at: Date.now() };
}

const EMPTY = ['screen_width', 'cs_descr', 'CS_time_start', 'CS_time_end', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  'empower_global_course_id', 'cs_sess_id', 'cs_loca_id', 'cs_inst_id', 'cs_classroom', 'cs_emph_id'];

export function listBody(token: string, term: string, dept: string): URLSearchParams {
  const b = new URLSearchParams({ fuseaction: 'CourseCatalog', token, status: '1', empower_global_term_id: term, empower_global_dept_id: dept });
  for (const k of EMPTY) b.set(k, '');
  return b;
}

/** One department's sections. Throws EmpowerError; kind 'token' means open a new session and try again. */
export async function getList(s: Session, term: string, dept: string, timeoutMs = 20_000): Promise<{ seats: Seat[]; ms: number }> {
  const t = Date.now();
  const res = await fetch(LIST, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(s.cookies) },
    body: listBody(s.token, term, dept),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ms = Date.now() - t;
  const bad = refused(res, ms);
  if (bad) { await res.body?.cancel(); throw bad; }
  takeCookies(res, s.cookies); // __cf_bm is reissued every 30 minutes
  const text = await res.text();
  let j: { SUCCESS?: boolean; MSG?: string; html?: string };
  try { j = JSON.parse(text); } catch {
    throw new EmpowerError(/challenge|cf-chl|Just a moment/i.test(text) ? 'Cloudflare challenge page' : 'GetList did not answer JSON', /challenge|cf-chl|Just a moment/i.test(text) ? 'blocked' : 'error', ms);
  }
  if (j.SUCCESS !== true || typeof j.html !== 'string') {
    throw new EmpowerError(`GetList: ${j.MSG ?? 'no data'}`, /invalid request/i.test(j.MSG ?? '') ? 'token' : 'error', ms);
  }
  return { seats: parseSeats(j.html), ms };
}

/** "CSCS 100" -> "CSCS". Every course prefix is also the department's filter value (checked against the form). */
export const deptOf = (course: string) => course.split(' ')[0]!;
