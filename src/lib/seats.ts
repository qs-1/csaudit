// Seat alerts: talks to the seats Worker (seats/) through the site's own /api, which vercel.json proxies.
//
// A device is a random id and secret kept in localStorage (the transcript stays in session storage; this holds no
// personal data). Push is optional: without it the Seats screen still shows each watch's live count.

import { useEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';

const KEY = 'fccu-audit:seat-device';

interface Device { id: string; secret: string; endpoint?: string }

export interface Watch {
  term: string; course: string; sec: string;
  armed: number; last_alert: number | null; created: number; expires: number;
  avail: number | null; cap: number | null; seen: number | null; changed: number | null;
}
export type PushState = 'on' | 'none' | 'dead';
export type PollerState = 'ok' | 'backoff' | 'blocked' | 'starting';

/** What this browser can do about notifications. iOS only delivers push to an app added to the Home Screen. */
export type PushSupport = 'ok' | 'denied' | 'ios-install' | 'unsupported';

function readDevice(): Device | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Device | null;
    return d && /^[0-9a-f]{32}$/.test(d.id) && /^[0-9a-f]{64}$/.test(d.secret) ? d : null;
  } catch { return null; }
}
function saveDevice(d: Device | null) {
  try { if (d) localStorage.setItem(KEY, JSON.stringify(d)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

export class SeatError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function api<T>(path: string, init: RequestInit = {}, device = readDevice()): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (device) headers.Authorization = `Bearer ${device.id}.${device.secret}`;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  } catch {
    throw new SeatError('Can’t reach seat alerts. Check your connection.', 0);
  }
  const body = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new SeatError(body.error ?? `Seat alerts answered ${res.status}`, res.status);
  return body as T;
}

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  if (isIOS() && !standalone()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

const toKey = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function subscribe(): Promise<PushSubscriptionJSON> {
  const { vapid } = await api<{ vapid: string }>('/config', {}, null);
  const reg = await navigator.serviceWorker.ready;
  const old = await reg.pushManager.getSubscription();
  // A subscription made with another key (the Worker's keys changed) can't receive our messages.
  if (old && old.options.applicationServerKey) {
    const a = new Uint8Array(old.options.applicationServerKey);
    const b = toKey(vapid);
    if (a.length === b.length && a.every((x, i) => x === b[i])) return old.toJSON();
    await old.unsubscribe();
  }
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(vapid) });
  return sub.toJSON();
}

async function ensureDevice(sub?: PushSubscriptionJSON): Promise<Device> {
  const have = readDevice();
  if (have) return have;
  const d = await api<{ id: string; secret: string }>('/devices', { method: 'POST', body: JSON.stringify(sub ? { sub } : {}) }, null);
  const device = { ...d, endpoint: sub?.endpoint };
  saveDevice(device);
  return device;
}

/* ---------- Shared state for the Seats screen and the watch buttons ---------- */

interface SeatsState {
  loaded: boolean;
  watches: Watch[];
  push: PushState;
  poller: PollerState;
  lastOk: number | null;
  serverNow: number;
  error: string | null;
  busy: boolean;
}

export const useSeats = create<SeatsState>()(() => ({
  loaded: false, watches: [], push: 'none', poller: 'starting', lastOk: null, serverNow: Date.now(), error: null, busy: false,
}));

type ListReply = { push: PushState; poller: PollerState; lastOk: number | null; now: number; watches: Watch[] };
const take = (r: ListReply) => useSeats.setState({ loaded: true, watches: r.watches, push: r.push, poller: r.poller, lastOk: r.lastOk, serverNow: r.now, error: null });

async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
  useSeats.setState({ busy: true });
  try { return await fn(); }
  catch (e) { useSeats.setState({ error: e instanceof Error ? e.message : String(e) }); throw e; }
  finally { useSeats.setState({ busy: false }); }
}

export const seats = {
  hasDevice: () => !!readDevice(),

  async refresh() {
    if (!readDevice()) { useSeats.setState({ loaded: true, watches: [] }); return; }
    try { take(await api<ListReply>('/watches')); }
    catch (e) {
      if (e instanceof SeatError && e.status === 401) { saveDevice(null); useSeats.setState({ loaded: true, watches: [], push: 'none' }); return; }
      useSeats.setState({ loaded: true, error: e instanceof Error ? e.message : String(e) });
    }
  },

  /** Watches a section. `avail` is what the planner showed, so the Worker knows whether it looked full. */
  watch: (term: string, course: string, sec: string, avail: number) => guarded(async () => {
    await ensureDevice();
    take(await api<ListReply>('/watches', { method: 'POST', body: JSON.stringify({ term, course, sec, avail }) }));
  }),

  unwatch: (w: Pick<Watch, 'term' | 'course' | 'sec'>) => guarded(async () => {
    take(await api<ListReply>('/watches', { method: 'DELETE', body: JSON.stringify({ term: w.term, course: w.course, sec: w.sec }) }));
  }),

  /** Asks for permission and subscribes. Must run from a tap (iOS and Safari require it). */
  enablePush: () => guarded(async () => {
    if (pushSupport() !== 'ok') throw new SeatError('This browser can’t show notifications here', 0);
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new SeatError('Notifications weren’t allowed', 0);
    const sub = await subscribe();
    const have = readDevice();
    const d = await ensureDevice(sub);
    if (have) await api('/devices/me/push', { method: 'PUT', body: JSON.stringify({ sub }) });
    saveDevice({ ...d, endpoint: sub.endpoint });
    take(await api<ListReply>('/watches'));
  }),

  disablePush: () => guarded(async () => {
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    await api('/devices/me/push', { method: 'PUT', body: JSON.stringify({ sub: null }) });
    const d = readDevice();
    if (d) saveDevice({ id: d.id, secret: d.secret });
    take(await api<ListReply>('/watches'));
  }),

  test: () => guarded(async () => { await api('/devices/me/test', { method: 'POST' }); }),

  forget: () => guarded(async () => {
    await api('/devices/me', { method: 'DELETE' }).catch(() => {});
    const reg = await navigator.serviceWorker?.ready;
    await (await reg?.pushManager.getSubscription())?.unsubscribe().catch(() => {});
    saveDevice(null);
    useSeats.setState({ watches: [], push: 'none', loaded: true });
  }),

  /**
   * On app start: if notifications are allowed but the browser's subscription changed (iOS rotates them, the
   * service worker was reinstalled), send the new one. Quietly does nothing when there's no device.
   */
  async resync() {
    const d = readDevice();
    if (!d || pushSupport() !== 'ok' || Notification.permission !== 'granted') return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const cur = await reg.pushManager.getSubscription();
      if (cur && cur.endpoint === d.endpoint) return;
      const sub = await subscribe();
      await api('/devices/me/push', { method: 'PUT', body: JSON.stringify({ sub }) });
      saveDevice({ ...d, endpoint: sub.endpoint });
    } catch { /* tried; the Seats screen shows the state */ }
  },
};

/** Refreshes the watch list now and every minute while the page is visible. */
export function useWatchPolling(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    void seats.refresh();
    const tick = () => { if (document.visibilityState === 'visible') void seats.refresh(); };
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [enabled]);
}

/* ---------- Live counts for the planner ---------- */

/** course|sec -> [avail, cap, seen]. Only sections the poller saw in the last 10 minutes. */
export type LiveSeats = Map<string, [avail: number, cap: number, seen: number]>;
const EMPTY: LiveSeats = new Map();

// One fetch a minute for the whole page, however many components read the model.
let live: { term: string | null; map: LiveSeats; at: number; busy: boolean } = { term: null, map: EMPTY, at: 0, busy: false };
const listeners = new Set<() => void>();
const publish = () => listeners.forEach((f) => f());

function loadLive(term: string) {
  if (document.visibilityState !== 'visible' || live.busy || (live.term === term && Date.now() - live.at < 55_000)) return;
  live = { ...live, busy: true };
  fetch(`/api/seats?term=${encodeURIComponent(term)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { seats?: [string, string, number, number, number][] } | null) => {
      const map: LiveSeats = j?.seats?.length ? new Map(j.seats.map(([c, sec, a, cap, seen]) => [`${c}|${sec}`, [a, cap, seen]])) : EMPTY;
      live = { term, map, at: Date.now(), busy: false };
      publish();
    })
    .catch(() => { live = { ...live, term, at: Date.now(), busy: false }; });
}

/** Fresher seat counts than the hourly snapshot, for departments someone watches. Refreshed every minute while visible. */
export function useLiveSeats(term: string | null): LiveSeats {
  const snap = useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => live, () => live);
  useEffect(() => {
    if (!term || import.meta.env.MODE === 'test') return;
    const tick = () => loadLive(term);
    tick();
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [term]);
  return snap.term === term ? snap.map : EMPTY;
}
