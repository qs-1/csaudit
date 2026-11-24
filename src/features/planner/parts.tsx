import * as CM from '@radix-ui/react-context-menu';
import { AlertTriangle, ArrowLeftRight, Check, ChevronRight, PanelRight, Trash2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { blocksFor, DAY_LONG, DAY_SHORT, hasSeats, hm, sid, type Day, type Policy, type Section, type Zone } from '@/engine';
import { useIsMobile } from '@/lib/hooks';
import { cn, plural } from '@/lib/utils';
import type { Model } from '@/state/model';
import { actions } from '@/state/store';
import { ui, useUI } from '@/state/ui';
import { Button } from '@/ui/button';
import { Card, Code } from '@/ui/card';
import { Sheet } from '@/ui/sheet';
import { hasSeatCounts, REGISTERED, roleTag, SectionRow } from './CourseSearch';
import { colorVar, onVar, preview, removeFromPlan, restoreToPlan, type PlanState } from './usePlan';

/* ---------- This term: load, what it still needs, the week in a line ---------- */

const ZONE: Record<Zone, { label: (p: Policy) => string; text: string; fill: string }> = {
  ok: { label: () => 'Normal load', text: 'text-fg-2', fill: 'bg-done' },
  petition: { label: () => 'Overload petition', text: 'text-warn', fill: 'bg-warn' },
  lab: { label: (p) => `${p.maxLoad} needs a lab course`, text: 'text-warn', fill: 'bg-warn' },
  over: { label: (p) => `Over the ${p.maxLoad} limit`, text: 'text-bad', fill: 'bg-bad' },
};

const EASE = [0.22, 1, 0.36, 1] as const;

export function TermCard({ m, p, onOpen }: { m: Model; p: PlanState; onOpen?: () => void }) {
  const pol = m.catalog.policy;
  const z = ZONE[p.zone];
  const need = p.need;
  const load = p.load.load;
  const reduce = useReducedMotion();
  return (
    <Card className="px-5 pb-6 pt-6 md:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-baseline gap-2">
            <motion.span
              key={load}
              initial={reduce ? false : { y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="display tnum text-[40px] leading-none md:text-[44px]"
            >
              {load}
            </motion.span>
            <span className="text-sm text-fg-3">credits</span>
          </p>
          <p className="mt-2 text-sm text-fg-3">
            {m.bare ? (p.chosen.length ? plural(p.chosen.length, 'course') + ' planned' : 'Nothing planned yet') : need > 0 ? (
              <><span className="tnum text-fg-2">{Math.min(p.load.fresh, need)}</span> of <span className="tnum">{need}</span> needed credits planned</>
            ) : 'Nothing left to register'}
            {p.load.retaken ? <> · {p.load.retaken} cr of retakes</> : null}
          </p>
        </div>
        <span className={cn('mt-1.5 shrink-0 whitespace-nowrap text-sm', z.text)}>{z.label(pol)}</span>
      </div>
      <LoadTrack load={load} pol={pol} fill={z.fill} />
      <Needs m={m} p={p} onOpen={onOpen} />
      <Facts p={p} />
    </Card>
  );
}

/** Normal, petition and over-limit as three stretches of one track, filled up to the load. */
function LoadTrack({ load, pol, fill }: { load: number; pol: Policy; fill: string }) {
  const scale = pol.maxLoad + 3;
  const reduce = useReducedMotion();
  const segs = [
    { from: 0, to: pol.regularLoad, bg: 'bg-fg/[0.08]' },
    { from: pol.regularLoad, to: pol.maxLoad, bg: 'bg-warn/[0.16]' },
    { from: pol.maxLoad, to: scale, bg: 'bg-bad/[0.12]' },
  ];
  return (
    <div className="mt-5" aria-hidden>
      <div className="flex h-2 gap-[3px]">
        {segs.map((sg, i) => {
          const f = Math.max(0, Math.min(1, (load - sg.from) / (sg.to - sg.from)));
          return (
            <span key={i} className={cn('relative overflow-hidden rounded-full', sg.bg)} style={{ flex: sg.to - sg.from }}>
              <motion.span
                className={cn('absolute inset-y-0 left-0 rounded-full transition-colors', fill)}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${f * 100}%` }}
                // Each stretch fills after the one before it, so the bar reads left to right.
                transition={{ duration: reduce ? 0 : 0.45, ease: EASE, delay: reduce ? 0 : i * 0.12 }}
              />
            </span>
          );
        })}
      </div>
      <div className="relative h-5">
        {[pol.regularLoad, pol.maxLoad].map((t) => (
          <span key={t} className="num absolute top-1.5 -translate-x-1/2 text-2xs text-fg-3" style={{ left: `${(t / scale) * 100}%` }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

/** What the term still has to cover, as small pills. Tapping one searches for it. */
function Needs({ m, p, onOpen }: { m: Model; p: PlanState; onOpen?: () => void }) {
  const { cov } = p;
  if (m.bare) return null;
  const items = [
    ...cov.named.map((n) => ({ key: n.line.key, label: n.line.code, sub: n.section ? n.section.sec : '', done: !!n.section, mono: true, intent: { course: n.line.code } })),
    ...cov.slots.map((sl) => ({ key: sl.line.key, label: sl.line.code, sub: sl.section ? sid(sl.section) : '', done: !!sl.section, mono: false, intent: { group: sl.line.group } })),
    ...(m.result.free > 0 || cov.freeLeft > 0 ? [{ key: 'free', label: 'Free electives', sub: cov.freeLeft ? `${cov.freeLeft} cr left` : '', done: cov.freeLeft === 0, mono: false, intent: { group: 'free' } }] : []),
  ];
  if (!items.length) return null;
  return (
    <ul className="no-scrollbar -mx-5 mt-4 flex gap-1.5 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
      {items.map((i) => (
        <li key={i.key} className="shrink-0">
          <button
            type="button"
            onClick={() => { ui.intent(i.intent); onOpen?.(); }}
            className={cn('inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 pl-2.5 pr-3 text-sm transition-colors hover:bg-fg/[0.07]', i.done ? 'text-fg' : 'text-fg-2')}
          >
            {i.done ? <Check className="size-3.5 text-fg-2" strokeWidth={2} /> : <span className="mx-px size-3 rounded-full ring-[1.5px] ring-inset ring-fg/25" />}
            <span className={cn(i.mono && 'num text-[13px]')}>{i.label}</span>
            {i.sub ? <span className="num text-xs text-fg-3">{i.sub}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The planned week as one line of facts. */
function Facts({ p }: { p: PlanState }) {
  const s = weekStats(p.chosen);
  if (!s) return null;
  const facts: [string, string][] = [
    [`${s.days.length} ${s.days.length === 1 ? 'day' : 'days'}`, s.free.length ? ` on campus, ${s.free.map((d) => DAY_SHORT[d]).join(', ')} free` : ' on campus'],
    [hm(s.first.start), ` earliest, ${DAY_SHORT[s.first.d]}`],
    [hm(s.last.end), ` latest, ${DAY_SHORT[s.last.d]}`],
    [dur(s.hours), ' in class'],
    s.gap.gap > 0 ? [dur(s.gap.gap), ` gap on ${DAY_SHORT[s.gap.d]}`] : ['No gaps', ''],
  ];
  return (
    <p className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-4 text-sm text-fg-3 md:flex md:flex-wrap md:gap-x-6 md:gap-y-1">
      {facts.map(([b, rest], i) => (
        <span key={b + rest} className={cn('min-w-0 md:whitespace-nowrap', i === 0 && 'col-span-2')}><span className="tnum font-medium text-fg">{b}</span>{rest}</span>
      ))}
    </p>
  );
}

/* ---------- One placed section ---------- */

export function SectionSheet({ m, p }: { m: Model; p: PlanState }) {
  const section = useUI((x) => x.section);
  // On a phone there's no hover: touching a row while dragging the sheet must not preview it on the timetable behind.
  const touch = useIsMobile();
  const onClose = () => ui.select(null);
  // The panel belongs to the planner page; leaving the page closes it.
  useEffect(() => () => ui.select(null), []);
  const s = section ? p.inPlan(section.course) ?? section : null;
  const others = s ? (m.sections[s.course] ?? []).filter((o) => o.sec !== s.sec) : [];
  const role = s && !m.bare ? (p.registered.has(s.course) ? REGISTERED : roleTag(m.roles.roleOf(s.course))) : null;
  const clashes = s ? p.clashWith(s) : [];
  const showSeats = hasSeatCounts(m.term?.sections ?? []);
  const title = s ? (m.catalog.groups.flatMap((g) => (g.kind === 'all' ? g.courses : [])).find((c) => c.code === s.course)?.title ?? s.title) : '';
  const timed = s ? s.meetings.filter((x) => x.start != null && x.end != null) : [];
  const full = s && showSeats && !hasSeats(s);

  return (
    <Sheet
      open={!!s}
      onOpenChange={(o) => { if (!o) { preview(null); onClose(); } }}
      title={s ? `${s.course} · ${s.sec}` : ''}
      hideTitle
      footer={s && p.inPlan(s.course)?.sec === s.sec ? (
        <Button variant="danger" className="w-full" onClick={() => { onClose(); removeWithUndo(p, s); }}>
          <Trash2 />
          {p.registered.has(s.course) ? 'Drop from plan' : 'Remove from plan'}
        </Button>
      ) : undefined}
    >
      {s ? (
        <div onPointerLeave={() => !touch && preview(null)}>
          <p className="pr-10 text-sm text-fg-3"><Code className="text-fg-2">{s.course}</Code><span className="mx-1.5">·</span>Section {s.sec}</p>
          <h2 className="display mt-1 pr-10 text-[24px] leading-tight">{title}</h2>

          {clashes.length ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-bad/[0.08] px-3 py-2.5 text-sm text-bad">
              <AlertTriangle className="mt-px size-4 shrink-0" strokeWidth={1.75} />
              Clashes with {clashes.map((x) => sid(x)).join(', ')}
            </p>
          ) : null}

          <ul className="mt-5 divide-y divide-line border-y border-line">
            {timed.length ? timed.map((x, i) => (
              <li key={i} className="flex items-baseline gap-4 py-3">
                <span className="w-[88px] shrink-0 text-sm text-fg-2">{[...x.days].map((d) => DAY_SHORT[d]).join(', ')}</span>
                <span className="tnum flex-1 text-[17px] text-fg">{hm(x.start!)} – {hm(x.end!)}</span>
                {x.room ? <span className="num text-sm text-fg-3">{x.room}</span> : null}
              </li>
            )) : <li className="py-3 text-sm text-fg-3">Time not published yet</li>}
          </ul>

          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-fg-3">Instructor</dt><dd className="text-fg">{s.instructor || 'Staff'}</dd>
            <dt className="text-fg-3">Credits</dt><dd className="num text-fg">{s.credits}</dd>
            {showSeats ? <><dt className="text-fg-3">Seats</dt><dd className={cn('num', full ? 'text-bad' : 'text-fg')}>{full ? `Full · 0 of ${s.cap}` : `${s.avail} of ${s.cap} open`}</dd></> : null}
            {role ? <><dt className="text-fg-3">Counts as</dt><dd className={cn(role.tone === 'bad' ? 'text-bad' : role.tone === 'warn' ? 'text-warn' : 'text-fg')}>{role.text}</dd></> : null}
          </dl>

          {others.length ? (
            <>
              <p className="mb-1.5 mt-6 text-sm text-fg-3">Switch to another section</p>
              <ul className="flex flex-col gap-0.5 rounded-[10px] bg-surface-2/60 p-1">
                {others.map((o) => (
                  <SectionRow key={sid(o)} s={o} p={p} showSeats={showSeats} touch={touch} onPick={(x) => { actions.pick(p.termId, x.course, x.sec); preview(null); }} />
                ))}
              </ul>
            </>
          ) : null}

        </div>
      ) : null}
    </Sheet>
  );
}

/* ---------- Things to fix ---------- */

export function PlanAlerts({ m, p }: { m: Model; p: PlanState }) {
  const unscheduled = p.chosen.filter((s) => s.meetings.every((x) => x.start == null));
  // Registered in this term already: it's the term being planned, even though the next new one comes after it.
  const wrongTerm = !m.bare && m.result.nextTerm && m.termEntry.key !== m.result.nextTerm && !m.registered.length && !m.unplaced.length && !p.shared;
  const out: { key: string; tone: 'bad' | 'warn' | 'neutral'; text: React.ReactNode }[] = [];
  if (p.clashes.length) out.push({ key: 'clash', tone: 'bad', text: <>Clashes: {p.clashes.map(([a, b]) => `${sid(a)} and ${sid(b)}`).join('; ')}</> });
  if (p.stale.length) out.push({ key: 'stale', tone: 'warn', text: <>No longer offered: {p.stale.join(', ')}. <button className="text-fg underline decoration-line underline-offset-4" onClick={() => p.stale.forEach((c) => actions.unpick(p.termId, c))}>Remove</button></> });
  if (unscheduled.length) out.push({ key: 'time', tone: 'neutral', text: <>No time published for {unscheduled.map(sid).join(', ')}</> });
  if (m.registered.length && !p.shared) out.push({ key: 'reg', tone: 'neutral', text: <>Your {m.termEntry.label} registration is on the timetable. Add, switch or drop courses here to plan changes.</> });
  if (m.unplaced.length && !p.shared) out.push({ key: 'unplaced', tone: 'warn', text: <>Registered but not in the section list: {m.unplaced.join(', ')}</> });
  if (p.dropped.length) {
    const lost = p.dropped.filter((s) => !m.roles.passed.has(s.course));
    out.push({ key: 'dropped', tone: lost.length ? 'warn' : 'neutral', text: <>Dropped {p.dropped.map((s) => s.course).join(', ')}.{lost.length ? ` That's ${lost.reduce((a, s) => a + s.credits, 0)} credits to make up.` : ' A retake, so no credits lost.'}</> });
  }
  if (wrongTerm) out.push({ key: 'term', tone: 'warn', text: <>These sections are for {m.termEntry.label}, but your next semester looks like it comes after.</> });
  if (!out.length) return null;
  return (
    <ul className="flex flex-col gap-1 px-1">
      {out.map((o) => (
        <motion.li key={o.key} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: EASE }} className={cn('text-sm', o.tone === 'bad' ? 'text-bad' : o.tone === 'warn' ? 'text-warn' : 'text-fg-3')}>
          {o.text}
        </motion.li>
      ))}
    </ul>
  );
}

/* ---------- One day's classes, for phones ---------- */

const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}` : `${min}m`);

export function DayAgenda({ m, p, day, onSelect }: { m: Model; p: PlanState; day: string; onSelect: (s: Section) => void }) {
  const items = p.chosen
    .flatMap((s) => s.meetings.filter((x) => x.start != null && x.days.includes(day)).map((x) => ({ s, start: x.start!, end: x.end! })))
    .sort((a, b) => a.start - b.start);
  if (!items.length) {
    return <p className="py-10 text-center text-sm text-fg-3">No classes on {DAY_LONG[day]}</p>;
  }
  const titles = new Map(m.catalog.groups.flatMap((g) => (g.kind === 'all' ? g.courses.map((c) => [c.code, c.title] as const) : [])));
  return (
    <ul className="flex flex-col">
      {items.map((it, i) => {
        const gap = i > 0 ? it.start - items[i - 1]!.end : 0;
        const clash = p.clashIds.has(sid(it.s)) && gap < 0;
        const ci = p.colors.get(it.s.course);
        const c = colorVar(ci);
        return (
          <motion.li key={`${sid(it.s)}-${it.start}`} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.04 }}>
            {gap > 0 ? <p className="py-1.5 pl-[68px] text-xs text-fg-3">{dur(gap)} free</p> : null}
            {gap < 0 || clash ? <p className="py-1.5 pl-[68px] text-xs font-medium text-bad">Overlaps</p> : null}
            <button type="button" onClick={() => onSelect(it.s)} className="flex w-full items-stretch gap-3 text-left active:opacity-80">
              <div className="num w-14 shrink-0 pt-3 text-right">
                <p className="text-sm font-medium">{hm(it.start)}</p>
                <p className="text-xs text-fg-3">{hm(it.end)}</p>
              </div>
              <div
                className={cn('min-w-0 flex-1 rounded-[12px] px-4 py-3', clash && 'ring-2 ring-bad ring-offset-2 ring-offset-surface')}
                style={{ background: `rgb(var(${c}))`, color: `rgb(var(${onVar(ci)}))` }}
              >
                <p className="text-base font-medium"><Code>{it.s.course}</Code> <span className="font-normal opacity-80">· {it.s.sec}</span></p>
                <p className="truncate text-sm opacity-90">{titles.get(it.s.course) ?? it.s.title}</p>
                <p className="mt-0.5 text-xs opacity-75">{it.s.instructor || 'Staff'} · {dur(it.end - it.start)}{it.s.meetings.find((x) => x.start === it.start)?.room ? ` · ${it.s.meetings.find((x) => x.start === it.start)!.room}` : ''}</p>
              </div>
            </button>
          </motion.li>
        );
      })}
    </ul>
  );
}

/* ---------- The planned week at a glance ---------- */

const WEEKDAYS: Day[] = ['M', 'T', 'W', 'R', 'F', 'S'];

export function weekStats(chosen: Section[]) {
  const blocks = blocksFor(chosen);
  if (!blocks.length) return null;
  const days = WEEKDAYS.filter((d) => blocks.some((b) => b.day === d));
  const perDay = days.map((d) => {
    const bs = blocks.filter((b) => b.day === d).sort((a, b) => a.start - b.start);
    let gap = 0, end = bs[0]!.end;
    for (const b of bs.slice(1)) { gap = Math.max(gap, b.start - end); end = Math.max(end, b.end); }
    return { d, start: bs[0]!.start, end, gap, mins: bs.reduce((n, b) => n + b.end - b.start, 0) };
  });
  const first = perDay.reduce((a, b) => (b.start < a.start ? b : a));
  const last = perDay.reduce((a, b) => (b.end > a.end ? b : a));
  const longest = perDay.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
  const gap = perDay.reduce((a, b) => (b.gap > a.gap ? b : a));
  const free = WEEKDAYS.slice(0, 5).filter((d) => !days.includes(d));
  return {
    days, free, first, last, longest, gap,
    hours: perDay.reduce((n, x) => n + x.mins, 0),
  };
}

/* ---------- Right-click (or long-press) on a timetable block ---------- */

const MENU = 'z-[60] min-w-[220px] overflow-hidden rounded-xl bg-surface p-1 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=closed]:animate-out data-[state=closed]:fade-out-0';
const ITEM = 'flex h-9 select-none items-center gap-2.5 rounded-lg px-2.5 text-sm text-fg outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2 data-[state=open]:bg-surface-2';

export function removeWithUndo(p: PlanState, s: Section) {
  const registered = p.registered.has(s.course);
  removeFromPlan(p, s.course);
  preview(null);
  toast(`${registered ? 'Dropped' : 'Removed'} ${s.course}`, { action: { label: 'Undo', onClick: () => restoreToPlan(p, s) } });
}

/** Menu for one planned section: details, switch to another section (previewed on hover), remove. */
export function BlockMenu({ m, p, s, onDetails }: { m: Model; p: PlanState; s: Section; onDetails: (s: Section) => void }) {
  const others = (m.sections[s.course] ?? []).filter((o) => o.sec !== s.sec);
  const title = m.catalog.groups.flatMap((g) => (g.kind === 'all' ? g.courses : [])).find((c) => c.code === s.course)?.title ?? s.title;
  const remove = () => removeWithUndo(p, s);
  return (
    <CM.Portal>
      <CM.Content className={MENU} collisionPadding={8} onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="num text-sm font-medium">{s.course} <span className="font-normal text-fg-3">· {s.sec}</span></p>
          <p className="max-w-[240px] truncate text-xs text-fg-3">{title}</p>
        </div>
        <CM.Separator className="-mx-1 mb-1 h-px bg-line" />
        <CM.Item className={ITEM} onSelect={() => onDetails(s)}>
          <PanelRight className="size-4 text-fg-3" strokeWidth={1.5} />
          Details
        </CM.Item>
        <CM.Sub>
          <CM.SubTrigger className={ITEM} disabled={!others.length}>
            <ArrowLeftRight className="size-4 text-fg-3" strokeWidth={1.5} />
            {others.length ? 'Switch section' : 'No other sections'}
            {others.length ? <ChevronRight className="ml-auto size-4 text-fg-3" strokeWidth={1.5} /> : null}
          </CM.SubTrigger>
          <CM.Portal>
            <CM.SubContent className={cn(MENU, 'max-h-[min(360px,var(--radix-context-menu-content-available-height))] overflow-y-auto')} sideOffset={4} collisionPadding={8} onPointerLeave={() => preview(null)}>
              {others.map((o) => {
                const clash = p.clashWith(o).length > 0;
                const full = !hasSeats(o) && o.cap > 0;
                const when = o.meetings.filter((x) => x.start != null && x.end != null).map((x) => `${[...x.days].map((d) => DAY_SHORT[d]).join(' ')}  ${hm(x.start!)}–${hm(x.end!)}`);
                return (
                  <CM.Item
                    key={o.sec}
                    className={cn(ITEM, 'h-auto items-start py-2', full && 'opacity-60')}
                    onFocus={() => preview(o)}
                    onPointerEnter={() => preview(o)}
                    onSelect={() => { actions.pick(p.termId, o.course, o.sec); preview(null); toast.success(`Switched to ${o.course} · ${o.sec}`); }}
                  >
                    <span className="num w-4 shrink-0 font-medium">{o.sec}</span>
                    <span className="min-w-0 flex-1">
                      {when.length ? when.map((w) => <span key={w} className="num block whitespace-pre">{w}</span>) : <span className="block">Time not set</span>}
                      <span className={cn('block text-xs', clash ? 'text-bad' : 'text-fg-3')}>
                        {clash ? 'Clashes' : o.instructor || 'Staff'}{full ? ' · Full' : ''}
                      </span>
                    </span>
                  </CM.Item>
                );
              })}
            </CM.SubContent>
          </CM.Portal>
        </CM.Sub>
        <CM.Separator className="-mx-1 my-1 h-px bg-line" />
        <CM.Item className={cn(ITEM, 'text-bad data-[highlighted]:bg-bad/[0.08]')} onSelect={remove}>
          <Trash2 className="size-4" strokeWidth={1.5} />
          {p.registered.has(s.course) ? 'Drop from plan' : 'Remove from plan'}
        </CM.Item>
      </CM.Content>
    </CM.Portal>
  );
}
