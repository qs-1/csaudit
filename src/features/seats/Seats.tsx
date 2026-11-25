import * as Menu from '@radix-ui/react-dropdown-menu';
import fuzzysort from 'fuzzysort';
import { Bell, ExternalLink, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { ScreenHeader } from '@/app/Shell';
import { TERMS } from '@/data/registry';
import { hasSeats, type Section } from '@/engine';
import { DaySquares, timeLines } from '@/features/planner/CourseSearch';
import { useDebounced, useIsMobile } from '@/lib/hooks';
import { isWatching, pushSupport, seats, useLiveSeats, useSeats, useWatchPolling, type Watch } from '@/lib/seats';
import { cn } from '@/lib/utils';
import { overlayLive, useTermData } from '@/state/model';
import { Button } from '@/ui/button';
import { Card, CardHead, Code } from '@/ui/card';
import { Sheet } from '@/ui/sheet';
import { toggleWatch, WatchBell } from './Bell';

const EMPOWER = 'https://mysis-fccollege.empower-xl.com/';
const OPEN = TERMS[TERMS.length - 1]!;
const FRESH = 15 * 60_000;

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

/** The open term's sections, with the poller's fresher counts where it has them. */
function useOpenSections(): Section[] | null {
  const { term } = useTermData(OPEN);
  const live = useLiveSeats(term ? OPEN.id : null);
  return useMemo(() => overlayLive(term, live)?.sections ?? null, [term, live]);
}

/* ---------- Notifications: one line ---------- */

function Notifications() {
  const push = useSeats((s) => s.push);
  const busy = useSeats((s) => s.busy);
  const support = pushSupport();
  const on = () => void seats.enablePush().catch(fail);
  const turnOn = <Button size="sm" variant="primary" disabled={busy} onClick={on}>Turn on</Button>;

  let text: ReactNode;
  let action: ReactNode = null;
  let steps: ReactNode = null;
  if (support === 'ios-install') {
    text = 'Add to Home Screen for notifications';
    steps = <><span className="text-fg-2">Share</span> → <span className="text-fg-2">Add to Home Screen</span> → <span className="text-fg-2">open it, then Turn on</span></>;
  } else if (support === 'unsupported') text = 'This browser can’t show notifications';
  else if (support === 'denied') text = 'Blocked in browser settings';
  else if (push === 'on') text = 'Notifications on';
  else if (push === 'dead') { text = 'Notifications stopped'; action = turnOn; }
  else { text = 'Notifications off'; action = turnOn; }

  return (
    <div className="px-1">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <p className="text-base font-medium">{text}</p>
        {action}
      </div>
      {steps ? <p className="mt-0.5 text-sm text-fg-3">{steps}</p> : null}
    </div>
  );
}

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
            <Menu.Item className={item} onSelect={() => void seats.liveTest().then((r) => r && toast(`${r.course} ${r.sec}: alert within 2 minutes`), fail)}>Test a real alert</Menu.Item>
            <Menu.Item className={item} onSelect={() => void seats.disablePush().catch(fail)}>Turn off notifications</Menu.Item>
            <Menu.Separator className="mx-2 my-1 h-px bg-line" />
          </> : null}
          <Menu.Item className={cn(item, 'text-bad')} onSelect={() => void seats.forget().catch(fail)}>Forget this device</Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/* ---------- Watching ---------- */

function WatchRow({ w, s, now }: { w: Watch; s?: Section; now: number }) {
  const fresh = w.avail !== null && w.seen !== null && now - w.seen < FRESH;
  const avail = fresh ? w.avail! : s?.avail ?? null;
  const cap = fresh ? w.cap! : s?.cap ?? null;
  const open = fresh && avail! > 0;
  return (
    <li className="flex items-center gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <Code className="text-sm font-medium">{w.course} {w.sec}</Code>
        <p className="truncate text-sm text-fg-3">{s?.title ?? ' '}</p>
      </div>
      {open ? (
        <a href={EMPOWER} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium underline decoration-line underline-offset-4 hover:decoration-fg">
          Empower<ExternalLink className="size-3.5" strokeWidth={1.75} />
        </a>
      ) : null}
      <div className="shrink-0 text-right">
        <p className={cn('num text-base', open && 'text-good')}>{avail === null ? '–' : `${avail}/${cap}`}</p>
        <p className="text-xs text-fg-3">{fresh ? ago(w.seen, now) : 'not checked'}</p>
      </div>
      <WatchBell term={w.term} s={{ course: w.course, sec: w.sec, avail: avail ?? 0 }} />
    </li>
  );
}

function Watching({ sections, now }: { sections: Section[] | null; now: number }) {
  const loaded = useSeats((s) => s.loaded);
  const watches = useSeats((s) => s.watches);
  const error = useSeats((s) => s.error);
  const poller = useSeats((s) => s.poller);
  const lastOk = useSeats((s) => s.lastOk);
  const byKey = useMemo(() => new Map((sections ?? []).map((s) => [`${s.course}|${s.sec}`, s])), [sections]);
  return (
    <Card>
      <CardHead title="Watching" sub={watches.length ? `${watches.length} of 15` : undefined} />
      <div className="px-5 pb-4 md:px-6">
        {!loaded ? <p className="py-5 text-sm text-fg-3">Loading</p>
          : watches.length ? (
            <ul className="divide-y divide-line">
              {watches.map((w) => <WatchRow key={`${w.term}|${w.course}|${w.sec}`} w={w} s={w.term === OPEN.id ? byKey.get(`${w.course}|${w.sec}`) : undefined} now={now} />)}
            </ul>
          ) : <p className="py-5 text-sm text-fg-3">Nothing yet. Tap the bell on a section.</p>}
        {watches.length && poller === 'blocked' ? <p className="pb-1 text-sm text-warn">Checks paused. Retrying within the hour.</p>
          : watches.length && poller === 'backoff' ? <p className="pb-1 text-sm text-warn">Checks slowed down. Last good check {ago(lastOk, now)}.</p> : null}
        {error ? <p className="pb-1 text-sm text-bad">{error}</p> : null}
      </div>
    </Card>
  );
}

/* ---------- Add: search the open term's sections ---------- */

const normalise = (q: string) => q.trim().replace(/([a-z])(\d)/gi, '$1 $2');

function AddSections({ sections, autoFocus, className }: { sections: Section[] | null; autoFocus?: boolean; className?: string }) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 80);
  const courses = useMemo(() => {
    const by = new Map<string, Section[]>();
    for (const s of sections ?? []) by.set(s.course, [...(by.get(s.course) ?? []), s]);
    return [...by].map(([code, secs]) => ({ secs, key: `${code} ${code.replace(' ', '')} ${secs[0]!.title}` }));
  }, [sections]);
  const results = useMemo(() => {
    const nq = normalise(q);
    if (!nq) return [];
    return fuzzysort.go(nq, courses, { key: 'key', threshold: 0.3, limit: 8 }).flatMap((r) => r.obj.secs).slice(0, 40);
  }, [q, courses]);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" strokeWidth={1.5} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus={autoFocus}
          placeholder="Search sections"
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
      {q && !results.length ? <p className="py-8 text-center text-sm text-fg-3">{sections ? 'No matching sections' : 'Loading sections'}</p> : null}
      {results.length ? (
        <ul className="-mx-1 mt-3 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain px-1 pb-1">
          {results.map((s) => <ResultRow key={`${s.course}|${s.sec}`} s={s} />)}
        </ul>
      ) : null}
    </div>
  );
}

function ResultRow({ s }: { s: Section }) {
  const on = useSeats((x) => isWatching(x.watches, OPEN.id, s.course, s.sec));
  const full = !hasSeats(s);
  return (
    <li>
      <button
        type="button"
        aria-pressed={on}
        onClick={() => toggleWatch(OPEN.id, s)}
        className="flex w-full items-center gap-3 rounded-[12px] bg-surface-2/60 py-2.5 pl-3 pr-1.5 text-left transition-colors hover:bg-surface-2"
      >
        <span className="num w-5 shrink-0 self-start pt-px text-sm font-medium text-fg-2">{s.sec}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2"><DaySquares s={s} /><Code className="text-xs font-medium text-fg-2">{s.course}</Code></span>
          <span className="mt-1.5 block">
            {timeLines(s).map((line) => <span key={line} className="num block whitespace-pre text-xs text-fg-2">{line}</span>)}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-3">
            <span>{s.instructor || 'Staff'}</span>
            <span aria-hidden>·</span>
            <span className={cn('num', full && 'text-bad')}>{full ? `Full · 0/${s.cap}` : `${s.avail}/${s.cap} seats`}</span>
          </span>
        </span>
        <span className={cn('grid size-8 shrink-0 place-items-center', on ? 'text-fg' : 'text-fg-3')}>
          <Bell className="size-4" strokeWidth={1.75} fill={on ? 'currentColor' : 'none'} />
        </span>
      </button>
    </li>
  );
}

/* ---------- Page ---------- */

export function SeatsScreen() {
  const mobile = useIsMobile();
  const now = useNow();
  const sections = useOpenSections();
  const lastOk = useSeats((s) => s.lastOk);
  const has = useSeats((s) => s.watches.length > 0);
  const [adding, setAdding] = useState(false);
  useWatchPolling();

  const eyebrow = has && lastOk ? `${OPEN.label} · checked ${ago(lastOk, now)}` : OPEN.label;

  if (mobile) {
    return (
      <>
        <ScreenHeader eyebrow={eyebrow} title="Seats" mobileActions={<MoreMenu mobile />} />
        <div className="flex flex-col gap-5">
          <Notifications />
          <Watching sections={sections} now={now} />
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
        <Sheet open={adding} onOpenChange={setAdding} title="Add" tall autoFocus className="flex flex-col">
          <AddSections sections={sections} className="flex-1" />
        </Sheet>
      </>
    );
  }

  return (
    <>
      <ScreenHeader eyebrow={eyebrow} title="Seats" actions={<MoreMenu />} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Notifications />
          <Watching sections={sections} now={now} />
        </div>
        <Card className="flex max-h-[calc(100dvh-152px)] flex-col p-5 lg:sticky lg:top-6 md:p-6">
          <h2 className="display mb-4 text-[21px] leading-7">Add</h2>
          <AddSections sections={sections} className="min-h-0 flex-1" />
        </Card>
      </div>
    </>
  );
}
