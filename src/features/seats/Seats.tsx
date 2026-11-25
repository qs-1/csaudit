import * as Menu from '@radix-ui/react-dropdown-menu';
import fuzzysort from 'fuzzysort';
import { ArrowUpRight, Bell, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { ScreenHeader } from '@/app/Shell';
import { TERMS } from '@/data/registry';
import { hasSeats, type Section } from '@/engine';
import { DaySquares, DeptPicker, timeLines } from '@/features/planner/CourseSearch';
import { usePlan, type PlanState } from '@/features/planner/usePlan';
import { useDebounced, useIsMobile } from '@/lib/hooks';
import { isWatching, pushSupport, seats, useLiveSeats, useSeats, useWatchPolling, WATCHES_MAX, type Watch } from '@/lib/seats';
import { cn } from '@/lib/utils';
import { overlayLive, useModel, useTermData, type Model } from '@/state/model';
import { Button } from '@/ui/button';
import { Card, CardHead, Code } from '@/ui/card';
import { Chip, Switch } from '@/ui/controls';
import { Sheet } from '@/ui/sheet';
import { toggleWatch, WatchBell } from './Bell';

const EMPOWER = 'https://mysis-fccollege.empower-xl.com/';
const OPEN = TERMS[TERMS.length - 1]!;
const FRESH = 15 * 60_000;
const PAGE = 30; // courses per page in the list

function ago(t: number | null, now: number) {
  if (!t) return '';
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(id); }, []);
  return now;
}

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
const key = (s: { course: string; sec: string }) => `${s.course}|${s.sec}`;

/** The open term's sections, with the poller's fresher counts where it has them. */
function useOpenSections(): Section[] | null {
  const { term } = useTermData(OPEN);
  const live = useLiveSeats(term ? OPEN.id : null);
  return useMemo(() => overlayLive(term, live)?.sections ?? null, [term, live]);
}

/** The plan for the open term, when the planner is on it. */
function WithPlan({ children }: { children: (p: PlanState | null) => ReactNode }) {
  const m = useModel();
  return m && m.termEntry.id === OPEN.id ? <PlanOf m={m}>{children}</PlanOf> : <>{children(null)}</>;
}
function PlanOf({ m, children }: { m: Model; children: (p: PlanState) => ReactNode }) {
  return <>{children(usePlan(m))}</>;
}

/* ---------- Header menu ---------- */

function MoreMenu({ mobile }: { mobile?: boolean }) {
  const push = useSeats((s) => s.push);
  const device = useSeats((s) => s.loaded) && seats.hasDevice();
  if (!device) return null;
  const item = 'flex h-10 items-center rounded-lg px-3 text-base outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2';
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          type="button"
          aria-label="More"
          className={cn('grid place-items-center text-fg-2', mobile ? 'size-10 rounded-[12px] bg-surface shadow-soft active:scale-[0.97]' : 'size-9 rounded-[10px] hover:bg-surface-2 hover:text-fg')}
        >
          <MoreHorizontal className="size-[18px]" strokeWidth={1.75} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className="z-50 min-w-[220px] rounded-xl bg-surface p-1 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
          {push === 'on' ? <>
            <Menu.Item className={item} onSelect={() => void seats.test().then(() => toast('Test sent'), fail)}>Send test</Menu.Item>
            <Menu.Item className={item} onSelect={() => void seats.liveTest().then((r) => r && toast(`${r.course} ${r.sec}: test alert within 2 minutes`), fail)}>Test a real alert</Menu.Item>
            <Menu.Item className={item} onSelect={() => void seats.disablePush().catch(fail)}>Turn off notifications</Menu.Item>
            <Menu.Separator className="mx-2 my-1 h-px bg-line" />
          </> : null}
          <Menu.Item className={cn(item, 'text-bad')} onSelect={() => void seats.forget().catch(fail)}>Forget this device</Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/* ---------- Notifications: a note inside Watching unless they're on ---------- */

function useNotifications(): { on: boolean; note: ReactNode; action: ReactNode } {
  const push = useSeats((s) => s.push);
  const busy = useSeats((s) => s.busy);
  const support = pushSupport();
  const turnOn = <Button size="sm" variant="primary" disabled={busy} onClick={() => void seats.enablePush().catch(fail)}>Turn on</Button>;
  if (support === 'ios-install') {
    return { on: false, action: null, note: <>Notifications need the app on your Home Screen: <span className="text-fg-2">Share</span>, <span className="text-fg-2">Add to Home Screen</span>, open it, then Turn on.</> };
  }
  if (support === 'unsupported') return { on: false, action: null, note: 'This browser can’t show notifications. Counts still update here.' };
  if (support === 'denied') return { on: false, action: null, note: 'Notifications are blocked in this browser’s site settings.' };
  if (push === 'on') return { on: true, action: null, note: null };
  if (push === 'dead') return { on: false, action: turnOn, note: 'Notifications stopped. Turn them on again to get alerts.' };
  return { on: false, action: turnOn, note: 'Notifications are off. Turn them on to get alerts.' };
}

/* ---------- Watching ---------- */

function WatchRow({ w, s, now }: { w: Watch; s?: Section; now: number }) {
  const fresh = w.avail !== null && w.seen !== null && now - w.seen < FRESH;
  const avail = fresh ? w.avail! : s?.avail ?? null;
  const cap = fresh ? w.cap! : s?.cap ?? null;
  const open = avail !== null && avail > 0;
  return (
    <li className="py-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Code className="text-md font-medium">{w.course} {w.sec}</Code>
          <p className="truncate text-sm text-fg-3">{s ? s.title : 'No longer in the section list'}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('num text-[24px] font-medium leading-7 tracking-[-0.02em]', open ? 'text-good' : 'text-fg')}>
            {avail === null ? '–' : avail}<span className="text-base font-normal text-fg-3">/{cap ?? '–'}</span>
          </p>
          <p className="whitespace-nowrap text-xs text-fg-3">{fresh ? `${open ? 'open' : 'full'} · ${ago(w.seen, now)}` : 'first check soon'}</p>
        </div>
        <WatchBell term={w.term} s={{ course: w.course, sec: w.sec, avail: avail ?? 0, cap: cap ?? 0 }} className="-mr-2" />
      </div>
      {s ? (
        <div className="mt-2.5 flex items-start gap-2.5">
          <DaySquares s={s} />
          <span className="min-w-0">
            {timeLines(s).map((line) => <span key={line} className="num block whitespace-pre text-xs text-fg-2">{line}</span>)}
            <span className="block text-xs text-fg-3">{s.instructor || 'Staff'}</span>
          </span>
        </div>
      ) : null}
      {open && fresh ? (
        <a href={EMPOWER} target="_blank" rel="noopener noreferrer" className="mt-2.5 inline-flex items-center gap-0.5 text-sm font-medium text-good underline decoration-good/30 underline-offset-4 hover:decoration-good">
          Register on Empower<ArrowUpRight className="size-3.5" strokeWidth={2} />
        </a>
      ) : null}
    </li>
  );
}

function Watching({ byKey, now, mobile }: { byKey: Map<string, Section>; now: number; mobile: boolean }) {
  const loaded = useSeats((s) => s.loaded);
  const watches = useSeats((s) => s.watches);
  const error = useSeats((s) => s.error);
  const poller = useSeats((s) => s.poller);
  const lastOk = useSeats((s) => s.lastOk);
  const n = useNotifications();
  const sub = !watches.length ? 'Full sections you want a seat in'
    : `${watches.length} of ${WATCHES_MAX} · ${lastOk ? `checked ${ago(lastOk, now)}` : 'checked every minute'}`;
  return (
    <Card>
      <CardHead title="Watching" sub={sub} action={n.action} />
      <div className="px-5 pb-5 md:px-6 md:pb-6">
        {n.note ? <p className="mt-2 text-sm text-warn">{n.note}</p> : null}
        {!loaded ? <p className="py-6 text-sm text-fg-3">Loading</p>
          : watches.length ? (
            <ul className="mt-1 divide-y divide-line">
              {watches.map((w) => <WatchRow key={`${w.term}|${key(w)}`} w={w} s={w.term === OPEN.id ? byKey.get(key(w)) : undefined} now={now} />)}
            </ul>
          ) : (
            <div className="pb-2 pt-6">
              <p className="display text-[17px] leading-6">Nothing watched yet</p>
              <ol className="mt-4 grid gap-4 sm:grid-cols-3 sm:gap-6">
                {[
                  ['Find a full section', mobile ? 'Tap Add. The list starts with sections that have no seats.' : 'The list starts with sections that have no seats.'],
                  ['Tap its bell', 'Up to 15 sections. Each one is watched for 45 days.'],
                  ['Get a notification', 'When a seat opens, usually within two minutes. Then register on Empower.'],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-3 sm:block">
                    <span className="num text-[22px] font-medium leading-7 text-fg-3">{i + 1}</span>
                    <span className="block sm:mt-1">
                      <span className="block text-base font-medium">{t}</span>
                      <span className="mt-0.5 block text-sm text-fg-3">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        {watches.length && poller === 'blocked' ? <p className="mt-2 text-sm text-warn">Checks paused. Retrying within the hour.</p>
          : watches.length && poller === 'backoff' ? <p className="mt-2 text-sm text-warn">Checks slowed down. Last good check {ago(lastOk, now)}.</p> : null}
        {error ? <p className="mt-2 text-sm text-bad">{error}</p> : null}
        {watches.length ? <p className="mt-3 text-xs text-fg-3">One alert each time a section opens.</p> : null}
      </div>
    </Card>
  );
}

/* ---------- Your plan: the sections picked in the planner, with their counts ---------- */

function YourPlan({ p }: { p: PlanState }) {
  const chosen = useMemo(() => [...p.chosen].sort((a, b) => a.course.localeCompare(b.course)), [p.chosen]);
  if (!chosen.length) return null;
  const full = chosen.filter((s) => !hasSeats(s)).length;
  return (
    <Card>
      <CardHead title="Your plan" sub={`${chosen.length} sections · ${full ? `${full} full` : 'none full'}`} />
      <ul className="flex flex-col gap-1.5 px-3 pb-3 pt-3 md:px-4 md:pb-4">
        {chosen.map((s) => <SectionItem key={key(s)} s={s} code />)}
      </ul>
    </Card>
  );
}

/* ---------- Find: browse and search the open term's sections ---------- */

const normalise = (q: string) => q.trim().replace(/([a-z])(\d)/gi, '$1 $2');
type Show = 'full' | 'plan' | 'all';

function Find({ sections, p, className }: { sections: Section[] | null; p: PlanState | null; className?: string }) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 80);
  const planned = !!p?.chosen.length;
  const [show, setShow] = useState<Show>(planned ? 'plan' : 'full');
  const [dept, setDept] = useState('');
  const [fits, setFits] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  const courses = useMemo(() => {
    const by = new Map<string, Section[]>();
    for (const s of sections ?? []) by.set(s.course, [...(by.get(s.course) ?? []), s]);
    return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([code, secs]) => ({
      code, title: secs[0]!.title, secs,
      key: `${code} ${code.replace(' ', '')} ${secs[0]!.title}`,
      who: [...new Set(secs.map((s) => s.instructor).filter(Boolean))].join(' '),
    }));
  }, [sections]);

  const depts = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of courses) { const d = c.code.split(' ')[0]!; n.set(d, (n.get(d) ?? 0) + 1); }
    return [...n].sort(([a], [b]) => a.localeCompare(b));
  }, [courses]);

  const inPlan = useMemo(() => new Set(p?.chosen.map((s) => s.course) ?? []), [p]);
  const keep = (s: Section) =>
    (show !== 'full' || !hasSeats(s))
    && (!fits || !p || p.inPlan(s.course)?.sec === s.sec || p.clashWith(s).length === 0);

  const counts = useMemo(() => ({
    full: (sections ?? []).filter((s) => !hasSeats(s)).length,
    plan: (sections ?? []).filter((s) => inPlan.has(s.course)).length,
    all: sections?.length ?? 0,
  }), [sections, inPlan]);

  const results = useMemo(() => {
    let pool = courses;
    if (show === 'plan') pool = pool.filter((c) => inPlan.has(c.code));
    if (dept) pool = pool.filter((c) => c.code.startsWith(`${dept} `));
    const nq = normalise(q);
    if (nq) pool = fuzzysort.go(nq, pool, { keys: ['key', 'who'], threshold: 0.3, limit: 200 }).map((r) => r.obj);
    return pool.map((c) => ({ ...c, secs: c.secs.filter(keep) })).filter((c) => c.secs.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses, show, inPlan, dept, q, fits, p]);
  const nSecs = results.reduce((a, c) => a + c.secs.length, 0);

  useEffect(() => { setLimit(PAGE); listRef.current?.scrollTo({ top: 0 }); }, [q, show, dept, fits]);
  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) setLimit((l) => l + PAGE); }, { root: listRef.current, rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, results.length]);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" strokeWidth={1.5} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Course, title or teacher"
          aria-label="Search sections"
          enterKeyHint="search"
          className="h-10 w-full rounded-[12px] bg-surface-2 pl-9 pr-10 text-md text-fg outline-none transition-shadow placeholder:text-fg-3 focus:shadow-[inset_0_0_0_1.5px_rgb(var(--fg)/0.4)]"
        />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-fg-3 hover:text-fg">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        ) : null}
      </div>

      <div className="no-scrollbar -mx-5 mt-3 flex gap-1.5 overflow-x-auto px-5 md:-mx-6 md:px-6">
        <Chip on={show === 'full'} onClick={() => setShow('full')} count={counts.full}>Full</Chip>
        {planned ? <Chip on={show === 'plan'} onClick={() => setShow('plan')} count={counts.plan}>My plan</Chip> : null}
        <Chip on={show === 'all'} onClick={() => setShow('all')} count={counts.all}>All</Chip>
      </div>

      <div className="mt-3 flex h-8 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <DeptPicker depts={depts} value={dept} onChange={setDept} />
          <span className="num whitespace-nowrap text-xs text-fg-3" aria-label={`${nSecs} sections`}>{nSecs}</span>
        </span>
        {p?.chosen.length ? (
          <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm text-fg-2">
            Fits my week
            <Switch checked={fits} onChange={setFits} size="sm" />
          </label>
        ) : null}
      </div>

      <div ref={listRef} className="-mx-2 mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
        {!results.length ? (
          <p className="py-12 text-center text-sm text-fg-3">{sections ? 'No matching sections' : 'Loading sections'}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {results.slice(0, limit).map((c) => (
              <li key={c.code}>
                <p className="flex items-baseline gap-2 px-1 pb-1.5">
                  <Code className="text-sm font-medium">{c.code}</Code>
                  <span className="truncate text-sm text-fg-3">{c.title}</span>
                </p>
                <ul className="flex flex-col gap-1.5">
                  {c.secs.map((s) => <SectionItem key={key(s)} s={s} />)}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {results.length > limit ? <div ref={moreRef} className="h-px" aria-hidden /> : null}
      </div>
    </div>
  );
}

/** One section: tap a full one to watch it. One with seats shows its count instead of a bell. */
function SectionItem({ s, code }: { s: Section; code?: boolean }) {
  const on = useSeats((x) => isWatching(x.watches, OPEN.id, s.course, s.sec));
  const full = !hasSeats(s);
  const body = (
    <>
      <span className="num w-5 shrink-0 self-start pt-px text-sm font-medium text-fg-2">{s.sec}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><DaySquares s={s} />{code ? <Code className="text-xs font-medium text-fg-2">{s.course}</Code> : null}</span>
        <span className="mt-1.5 block">
          {timeLines(s).map((line) => <span key={line} className="num block whitespace-pre text-xs text-fg-2">{line}</span>)}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-3">
          <span>{s.instructor || 'Staff'}</span>
          <span aria-hidden>·</span>
          <span className={cn('num', !full && 'text-good')}>{full ? `Full · 0/${s.cap}` : `${s.avail} of ${s.cap} open`}</span>
        </span>
      </span>
    </>
  );
  if (!full && !on) {
    return <li className="flex items-center gap-3 rounded-[12px] py-2.5 pl-3 pr-1.5">{body}<span className="size-8 shrink-0" aria-hidden /></li>;
  }
  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        aria-label={`${on ? 'Stop watching' : 'Watch'} ${s.course} ${s.sec}`}
        onClick={() => toggleWatch(OPEN.id, s)}
        className="flex w-full items-center gap-3 rounded-[12px] bg-surface-2/60 py-2.5 pl-3 pr-1.5 text-left transition-colors hover:bg-surface-2"
      >
        {body}
        <span className={cn('grid size-8 shrink-0 place-items-center', on ? 'text-fg' : 'text-fg-3')}>
          <Bell className="size-4" strokeWidth={1.75} fill={on ? 'currentColor' : 'none'} />
        </span>
      </button>
    </li>
  );
}

/* ---------- Page ---------- */

export function SeatsScreen() {
  return <WithPlan>{(p) => <Page p={p} />}</WithPlan>;
}

function Page({ p }: { p: PlanState | null }) {
  const mobile = useIsMobile();
  const now = useNow();
  const sections = useOpenSections();
  const byKey = useMemo(() => new Map((sections ?? []).map((s) => [key(s), s])), [sections]);
  const [adding, setAdding] = useState(false);
  useWatchPolling();

  if (mobile) {
    return (
      <>
        <ScreenHeader eyebrow={OPEN.label} title="Seats" mobileActions={<MoreMenu mobile />} />
        <div className="flex flex-col gap-5">
          <Watching byKey={byKey} now={now} mobile />
          {p ? <YourPlan p={p} /> : null}
          <div className="h-12" aria-hidden />
        </div>
        {createPortal(
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="fixed right-4 z-30 flex h-11 items-center gap-2 rounded-full bg-fg pl-3.5 pr-4 text-base font-medium text-bg shadow-[0_8px_24px_-6px_rgb(0_0_0/0.35)] transition-transform active:scale-[0.96]"
            style={{ bottom: 'calc(78px + var(--safe-b))' }}
          >
            <Plus className="size-[18px]" strokeWidth={2} />
            Add
          </button>,
          document.body,
        )}
        <Sheet open={adding} onOpenChange={setAdding} title="Find a section" tall className="flex flex-col">
          <Find sections={sections} p={p} className="flex-1" />
        </Sheet>
      </>
    );
  }

  return (
    <>
      <ScreenHeader eyebrow={OPEN.label} title="Seats" actions={<MoreMenu />} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Watching byKey={byKey} now={now} mobile={false} />
          {p ? <YourPlan p={p} /> : null}
        </div>
        <Card className="flex h-[calc(100dvh-152px)] min-h-[420px] flex-col p-5 lg:sticky lg:top-6 md:p-6">
          <h2 className="display mb-4 text-[21px] leading-7">Find a section</h2>
          <Find sections={sections} p={p} className="min-h-0 flex-1" />
        </Card>
      </div>
    </>
  );
}
