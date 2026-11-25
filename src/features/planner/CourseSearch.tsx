import fuzzysort from 'fuzzysort';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { DAY_SHORT, hm, hasSeats, sid, type Role, type Section } from '@/engine';
import { useDebounced } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import type { Model } from '@/state/model';
import { useUI, ui } from '@/state/ui';
import { Code, type Tone } from '@/ui/card';
import { TERMS } from '@/data/registry';
import { useCanWatch, WatchBell } from '@/features/seats/Bell';
import { Chip, Switch } from '@/ui/controls';
import { preview, removeFromPlan, restoreToPlan, type PlanState } from './usePlan';

export interface CourseItem {
  code: string;
  title: string;
  credits: number;
  sections: Section[];
  role: Role;
  rank: number;
  key: string;
  instructors: string;
}

const RANK: Record<Role['kind'], number> = { required: 0, slot: 1, free: 2, retake: 3, extra: 4, passed: 5, ip: 6, exempt: 6 };

/** Registered for the planning term on the transcript. */
export const REGISTERED: { tone: Tone; text: string } = { tone: 'neutral', text: 'Registered' };

export function roleTag(role: Role): { tone: Tone; text: string } {
  switch (role.kind) {
    case 'required': {
      const l = role.line;
      const pending = l.prereq.filter((p) => p.state !== 'done').map((p) => p.code).join(', ');
      if (l.readiness === 'blocked') return { tone: 'bad', text: `Required · needs ${pending}` };
      if (l.readiness === 'wait') return { tone: 'neutral', text: `Required · after ${pending}` };
      return { tone: 'info', text: 'Required' };
    }
    case 'slot': return { tone: 'good', text: role.group.slotLabel };
    case 'free': return { tone: 'neutral', text: 'Free elective' };
    case 'retake': return { tone: 'neutral', text: `Retake · ${role.grade}` };
    case 'passed': return { tone: 'neutral', text: `Passed · ${role.grade}` };
    case 'ip': return { tone: 'neutral', text: 'In progress' };
    case 'exempt': return { tone: 'neutral', text: 'Exempt' };
    default: return { tone: 'neutral', text: 'Not needed' };
  }
}

export function useCourses(m: Model): CourseItem[] {
  return useMemo(() => {
    const titles = new Map<string, string>();
    for (const g of m.catalog.groups) if (g.kind === 'all') for (const c of g.courses) titles.set(c.code, c.title);
    return Object.entries(m.sections)
      .map(([code, sections]) => {
        const role = m.roles.roleOf(code);
        return {
          code, sections, role, rank: m.bare ? 0 : RANK[role.kind], // no transcript: plain A to Z
          title: titles.get(code) ?? sections[0]!.title,
          credits: sections[0]!.credits,
          key: `${code} ${code.replace(' ', '')} ${titles.get(code) ?? sections[0]!.title}`,
          instructors: [...new Set(sections.map((s) => s.instructor))].join(' '),
        };
      })
      .sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
  }, [m.sections, m.roles, m.catalog, m.bare]);
}

type Filter = string; // 'needed' | 'all' | 'retake' | `g:<group>`

const normalise = (q: string) => q.trim().replace(/([a-z])(\d)/gi, '$1 $2');
const PAGE = 150; // more load on their own as the list scrolls near the end

export const CourseSearch = forwardRef<HTMLInputElement, { m: Model; p: PlanState; touch?: boolean; className?: string }>(function CourseSearch({ m, p, touch, className }, inputRef) {
  const courses = useCourses(m);
  const intent = useUI((s) => s.intent);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(m.bare ? 'all' : 'needed');
  const [fits, setFits] = useState(false);
  const [dept, setDept] = useState(''); // '' is every department
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const q = useDebounced(query, 80);
  const listRef = useRef<HTMLDivElement>(null);

  // Arrive with a course or requirement already picked out.
  useEffect(() => {
    if (!intent) return;
    if (intent.course) { setQuery(intent.course); setFilter('all'); setOpen(intent.course); }
    else if (intent.group === 'free') { setQuery(''); setFilter('all'); }
    else if (intent.group) { setQuery(''); setFilter(`g:${intent.group}`); }
    ui.intent(null);
  }, [intent]);

  useEffect(() => { setLimit(PAGE); listRef.current?.scrollTo({ top: 0 }); }, [q, filter, fits, dept]);

  const depts = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of courses) { const d = c.code.split(' ')[0]!; n.set(d, (n.get(d) ?? 0) + 1); }
    return [...n].sort(([a], [b]) => a.localeCompare(b));
  }, [courses]);

  const slotGroups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of courses) if (c.role.kind === 'slot' && !seen.has(c.role.group.id)) seen.set(c.role.group.id, c.role.group.label);
    return [...seen];
  }, [courses]);

  const counts = useMemo(() => ({
    needed: courses.filter((c) => c.role.kind === 'required' || c.role.kind === 'slot').length,
    retake: courses.filter((c) => c.role.kind === 'retake').length,
  }), [courses]);

  const fitsPlan = (c: CourseItem) => c.sections.some((s) => p.inPlan(s.course)?.sec === s.sec || p.clashWith(s).length === 0);

  const results = useMemo(() => {
    let pool = courses;
    if (filter === 'needed') pool = pool.filter((c) => c.role.kind === 'required' || c.role.kind === 'slot');
    else if (filter === 'retake') pool = pool.filter((c) => c.role.kind === 'retake');
    else if (filter.startsWith('g:')) pool = pool.filter((c) => c.role.kind === 'slot' && c.role.group.id === filter.slice(2));
    if (dept) pool = pool.filter((c) => c.code.startsWith(`${dept} `));
    if (fits) pool = pool.filter((c) => p.inPlan(c.code) || fitsPlan(c));
    const nq = normalise(q);
    if (!nq) return pool;
    return fuzzysort.go(nq, pool, { keys: ['key', 'instructors'], threshold: 0.3, limit: 200 }).map((r) => r.obj);
  }, [courses, filter, fits, q, p, dept]);

  const shown = results.slice(0, limit);
  const showSeats = hasSeatCounts(m.term?.sections ?? []);
  const watchTerm = watchableTerm(m.termEntry.id, m.term?.sections ?? []);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) setLimit((l) => l + PAGE); }, { root: listRef.current, rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [limit, results.length]);

  const pick = (s: Section) => {
    const cur = p.inPlan(s.course)?.sec;
    if (cur === s.sec) {
      removeFromPlan(p, s.course);
      if (touch) toast(`${p.registered.has(s.course) ? 'Dropped' : 'Removed'} ${s.course}`);
      return;
    }
    restoreToPlan(p, s);
    preview(null);
    const clashes = p.clashWith(s);
    if (clashes.length) toast.warning(`${s.course} ${s.sec} clashes with ${clashes.map((c) => c.course).join(', ')}`);
    else if (touch) toast.success(`${cur ? 'Switched to' : 'Added'} ${s.course} · ${s.sec}`);
  };

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" strokeWidth={1.5} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          aria-label="Search courses"
          enterKeyHint="search"
          className="h-10 w-full rounded-[12px] bg-surface-2 pl-9 pr-10 text-md text-fg outline-none transition-shadow placeholder:text-fg-3 focus:shadow-[inset_0_0_0_1.5px_rgb(var(--fg)/0.4)] focus-visible:outline-none"
        />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-fg">
            <X className="size-4" strokeWidth={1.5} />
          </button>
        ) : !touch ? (
          <kbd className="num pointer-events-none absolute right-2.5 top-1/2 grid h-5 min-w-5 -translate-y-1/2 place-items-center rounded-[5px] bg-surface px-1 text-2xs text-fg-3 shadow-soft">/</kbd>
        ) : null}
      </div>

      {m.bare ? null : <div className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 md:-mx-5 md:px-5">
        <Chip on={filter === 'needed'} onClick={() => setFilter('needed')} count={counts.needed}>Needed</Chip>
        {slotGroups.map(([id, label]) => (
          <Chip key={id} on={filter === `g:${id}`} onClick={() => setFilter(filter === `g:${id}` ? 'needed' : `g:${id}`)}>{label}</Chip>
        ))}
        {counts.retake ? <Chip on={filter === 'retake'} onClick={() => setFilter(filter === 'retake' ? 'needed' : 'retake')} count={counts.retake}>Retakes</Chip> : null}
        <Chip on={filter === 'all'} onClick={() => setFilter('all')} count={courses.length}>All</Chip>
      </div>}

      <div className="mt-3 flex h-8 items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <DeptPicker depts={depts} value={dept} onChange={setDept} />
          <span className="num whitespace-nowrap text-xs text-fg-3" aria-label={`${results.length} courses`}>{results.length}</span>
        </span>
        <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm text-fg-2">
          Fits my week
          <Switch checked={fits} onChange={setFits} size="sm" />
        </label>
      </div>

      <div ref={listRef} className="-mx-2 mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2" onPointerLeave={() => !touch && preview(null)}>
        {shown.length === 0 ? (
          <p className="py-12 text-center text-sm text-fg-3">{m.term ? 'No matching courses' : 'Loading sections…'}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {shown.map((c) => (
              <CourseRow
                key={c.code}
                c={c}
                p={p}
                expanded={open === c.code || (results.length === 1)}
                onToggle={() => setOpen(open === c.code ? null : c.code)}
                onPick={pick}
                touch={touch}
                showSeats={showSeats}
                watchTerm={watchTerm}
                bare={m.bare}
                fits={fits}
              />
            ))}
          </ul>
        )}
        {results.length > limit ? <div ref={moreRef} className="h-px" aria-hidden /> : null}
      </div>
    </div>
  );
});

function CourseRow({ c, p, expanded, onToggle, onPick, touch, showSeats, watchTerm, bare, fits }: {
  c: CourseItem; p: PlanState; expanded: boolean; onToggle: () => void; onPick: (s: Section) => void; touch?: boolean; showSeats: boolean; watchTerm?: string; bare: boolean; fits: boolean;
}) {
  const chosen = p.inPlan(c.code);
  // With "Fits my week" on, drop sections that clash with the plan (the picked one always stays).
  const sections = fits ? c.sections.filter((s) => chosen?.sec === s.sec || p.clashWith(s).length === 0) : c.sections;
  const tag = p.registered.has(c.code) ? REGISTERED : roleTag(c.role);
  const open = c.sections.reduce((n, s) => n + Math.max(0, s.avail), 0);
  const full = showSeats && !chosen && c.sections.every((s) => !hasSeats(s));
  return (
    <li className={cn('rounded-[10px] transition-colors', expanded ? 'bg-fg/[0.035]' : 'hover:bg-fg/[0.025]', full && !expanded && 'opacity-55')}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        {chosen ? <Check className="size-4 shrink-0 text-fg" strokeWidth={2} aria-label="In plan" /> : <span className="mx-px size-3.5 shrink-0 rounded-full ring-[1.5px] ring-inset ring-fg/20" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base"><Code className="mr-2">{c.code}</Code><span className="text-fg-2">{c.title}</span></span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-3">
            {bare ? null : <>
              <span className={cn(tag.tone === 'bad' && 'text-bad', tag.tone === 'warn' && 'text-warn')}>{tag.text}</span>
              <span aria-hidden>·</span>
            </>}
            <span className="shrink-0">{chosen ? `Section ${chosen.sec}` : `${sections.length} section${sections.length === 1 ? '' : 's'}`}</span>
            {showSeats ? <><span aria-hidden>·</span><span className={cn('num shrink-0', full && 'text-bad')}>{full ? 'Full' : `${open} seats`}</span></> : null}
          </span>
        </span>
        <span className="num shrink-0 text-sm text-fg-3">{c.credits} cr</span>
        <ChevronDown className={cn('size-4 shrink-0 text-fg-3 transition-transform duration-200', expanded && 'rotate-180')} strokeWidth={1.5} />
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <ul className="flex flex-col gap-1.5 px-2 pb-2">
              {sections.map((s) => (
                <SectionRow key={sid(s)} s={s} p={p} onPick={onPick} touch={touch} showSeats={showSeats} watchTerm={watchTerm} />
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

export function meetingLines(s: Section) {
  const timed = s.meetings.filter((m) => m.start != null && m.end != null);
  if (!timed.length) return ['Time not set'];
  return timed.map((m) => `${[...m.days].map((d) => DAY_SHORT[d]).join(' ')}  ${hm(m.start!)}–${hm(m.end!)}${m.room ? `  ${m.room}` : ''}`);
}

const WEEK_DAYS = ['M', 'T', 'W', 'R', 'F'] as const;

/** Which weekdays a section meets, as a row of small squares. */
export function DaySquares({ s }: { s: Section }) {
  const met = new Set(s.meetings.filter((m) => m.start != null).flatMap((m) => [...m.days]));
  const days = met.has('S') ? [...WEEK_DAYS, 'S'] : WEEK_DAYS;
  return (
    <span className="flex gap-[3px]" aria-label={`Meets ${[...met].map((d) => DAY_SHORT[d]).join(', ') || 'at no set time'}`}>
      {days.map((d) => (
        <span
          key={d}
          aria-hidden
          className={cn(
            'grid size-[18px] place-items-center rounded-[5px] text-[9.5px] font-medium leading-none',
            met.has(d) ? 'bg-fg text-surface' : 'bg-fg/[0.07] text-fg-3',
          )}
        >
          {DAY_SHORT[d]!.slice(0, 1)}
        </span>
      ))}
    </span>
  );
}

/** Times without the day letters (the squares show those), unless meetings differ by day. */
export function timeLines(s: Section) {
  const timed = s.meetings.filter((m) => m.start != null && m.end != null);
  if (!timed.length) return ['Time not set'];
  const many = timed.length > 1;
  return timed.map((m) => `${many ? `${[...m.days].map((d) => DAY_SHORT[d]).join(' ')}  ` : ''}${hm(m.start!)}–${hm(m.end!)}${m.room ? `  ${m.room}` : ''}`);
}

export function SectionRow({ s, p, onPick, touch, showSeats, watchTerm }: {
  s: Section; p: PlanState; onPick: (s: Section) => void; touch?: boolean; showSeats: boolean;
  /** The term whose seats can be watched; shows the bell. */
  watchTerm?: string;
}) {
  const selected = p.inPlan(s.course)?.sec === s.sec;
  const clashes = selected ? [] : p.clashWith(s);
  const full = showSeats && !hasSeats(s);
  const bell = useCanWatch(watchTerm, s);
  return (
    // A full section can still be planned (seats open up), it just reads as dimmed.
    <li className={cn('relative flex items-center gap-3 rounded-[12px] py-2.5 pl-3 pr-1.5', full && !selected && 'opacity-50 transition-opacity hover:opacity-80 has-[:focus-visible]:opacity-80')}>
      {/* The whole row picks the section; the bell sits above it as its own button. */}
      <button
        type="button"
        onClick={() => onPick(s)}
        onPointerEnter={() => !touch && preview(s)}
        onFocus={() => !touch && preview(s)}
        onBlur={() => !touch && preview(null)}
        aria-pressed={selected}
        aria-label={`${selected ? 'Picked' : 'Pick'} ${s.course} ${s.sec}`}
        className={cn(
          'absolute inset-0 rounded-[12px] bg-surface transition-[box-shadow]',
          selected ? 'shadow-[inset_0_0_0_1.5px_rgb(var(--fg)/0.85)]' : 'hover:shadow-[inset_0_0_0_1px_rgb(var(--fg)/0.3)]',
        )}
      />
      <span className={cn('num pointer-events-none relative w-5 shrink-0 self-start pt-px text-sm font-medium', selected ? 'text-fg' : 'text-fg-2')}>{s.sec}</span>
      <span className="pointer-events-none relative min-w-0 flex-1">
        <DaySquares s={s} />
        <span className="mt-1.5 block">
          {timeLines(s).map((line) => <span key={line} className="num block whitespace-pre text-xs text-fg-2">{line}</span>)}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-3">
          <span>{s.instructor || 'Staff'}</span>
          {showSeats ? <><span aria-hidden>·</span><span className={cn('num', full && 'text-bad')}>{full ? `Full · 0/${s.cap}` : `${s.avail}/${s.cap} seats`}</span></> : null}
          {s.credits !== undefined && !bell ?<><span aria-hidden>·</span><span className="num">{s.credits} cr</span></> : null}
        </span>
        {clashes.length ? <span className="mt-1 block text-xs text-bad">Clashes with {clashes.map((x) => `${x.course} ${x.sec}`).join(', ')}</span> : null}
      </span>
      {bell ? <WatchBell term={watchTerm!} s={s} className="relative -mr-2" /> : null}
      <span className="pointer-events-none relative grid size-7 shrink-0 place-items-center">
        {selected ? <Check className="size-4 text-fg" strokeWidth={2} /> : <Plus className="size-4 text-fg-3" strokeWidth={1.75} />}
      </span>
    </li>
  );
}

/** The term whose seats can be watched: the newest, while its sections carry seat counts. */
export const watchableTerm = (termId: string, secs: Section[]) => (termId === TERMS[TERMS.length - 1]?.id && hasSeatCounts(secs) ? termId : undefined);

/** Whether the section list carries seat counts at all (older scrapes have none). */
export const hasSeatCounts = (secs: Section[]) => secs.some((s) => s.cap > 0);

export function DeptPicker({ depts, value, onChange }: { depts: [string, number][]; value: string; onChange: (d: string) => void }) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label="Department"
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors data-[state=open]:bg-surface-3',
          value ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-fg-2 hover:bg-surface-3 hover:text-fg',
        )}
      >
        <span className={cn(value && 'num')}>{value || 'All depts'}</span>
        {value ? (
          <span
            role="button"
            aria-label="All departments"
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange(''); }}
            className="-mr-1 grid size-5 place-items-center rounded opacity-70 hover:opacity-100"
          >
            <X className="size-3.5" strokeWidth={2} />
          </span>
        ) : <ChevronDown className="size-3.5 text-fg-3" strokeWidth={1.75} />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-[60] w-[min(312px,calc(100vw-32px))] rounded-xl bg-surface p-1.5 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
        >
          <Menu.Item onSelect={() => onChange('')} className={cn('mb-1 flex h-8 items-center justify-between rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-surface-2', !value ? 'text-fg' : 'text-fg-2')}>
            All departments
            {!value ? <Check className="size-3.5" strokeWidth={2} /> : null}
          </Menu.Item>
          <div className="grid max-h-[min(300px,50dvh)] grid-cols-4 gap-0.5 overflow-y-auto overscroll-contain">
            {depts.map(([d, n]) => (
              <Menu.Item
                key={d}
                onSelect={() => onChange(d)}
                title={`${n} ${n === 1 ? 'course' : 'courses'}`}
                className={cn(
                  'flex h-9 flex-col items-center justify-center rounded-lg outline-none data-[highlighted]:bg-surface-2',
                  d === value && 'bg-accent text-accent-fg data-[highlighted]:bg-accent',
                )}
              >
                <span className="num text-xs font-medium leading-none">{d}</span>
                <span className={cn('num mt-0.5 text-[10px] leading-none', d === value ? 'opacity-70' : 'text-fg-3')}>{n}</span>
              </Menu.Item>
            ))}
          </div>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
