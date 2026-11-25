import { AlertTriangle, ArrowLeftRight, Check, ChevronDown, ChevronRight, Circle, Clock3, Ellipsis, Info, Minus } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ScreenHeader } from '@/app/Shell';
import { CURRENT } from '@/data/registry';
import { creditChanges, termLabel, type Line, type Notice } from '@/engine';
import { go } from '@/lib/route';
import { cn, num, plural, signed } from '@/lib/utils';
import { useModel, type Model } from '@/state/model';
import { ui } from '@/state/ui';
import { Button } from '@/ui/button';
import { Card, CardHead, Code, HeadLink } from '@/ui/card';
import { stepColor, useStepStroke, useWidth } from '@/ui/charts';
import { Segmented } from '@/ui/controls';
import { DegreePanel } from './Degree';

export function Overview() {
  const m = useModel();
  // The panel belongs to this page; leaving the page closes it.
  useEffect(() => () => ui.degree(false), []);
  if (!m) return null;
  return (
    <>
      <ScreenHeader
        eyebrow={
          <>
            {m.catalog.program} ·{' '}
            <button type="button" onClick={() => ui.degree(true)} className="underline decoration-fg-3/40 decoration-dotted underline-offset-[3px] transition-colors hover:text-fg">
              Batch {m.catalog.batch}
            </button>
          </>
        }
        title="Overview"
        actions={<DegreeButton />}
        mobileActions={<DegreeButton />}
      />
      <div className="flex flex-col gap-7 md:gap-6">
        <Notices m={m} />
        <Hero m={m} />
        <Asides m={m} />
        <div className="grid grid-cols-1 gap-7 md:gap-6 lg:grid-cols-12 lg:items-start">
          <div className="flex min-w-0 flex-col gap-7 md:gap-6 lg:col-span-7">
            <Cgpa m={m} />
            <Todo m={m} />
          </div>
          <Groups m={m} className="lg:col-span-5" />
        </div>
        <AllCourses m={m} />
      </div>
      <DegreePanel m={m} />
    </>
  );
}

/** Opens the degree panel: checklist year, credits, pre-med, specialization, exemptions. */
function DegreeButton() {
  return (
    <button
      type="button"
      aria-label="Degree options"
      title="Degree options"
      onClick={() => ui.degree(true)}
      className="grid size-10 place-items-center rounded-[12px] bg-surface text-fg-2 shadow-soft transition-colors hover:text-fg press md:size-9 md:rounded-[10px]"
    >
      <Ellipsis className="size-[18px]" strokeWidth={1.75} />
    </button>
  );
}

/* ---------- Things that could make the numbers quietly wrong ---------- */

const few = (a: string[]) => (a.length > 5 ? `${a.slice(0, 5).join(', ')} and ${a.length - 5} more` : a.join(', '));

function notice(n: Notice, m: Model): { text: ReactNode; action?: [string, () => void] } {
  const transcript: [string, () => void] = ['Review', () => go('transcript')];
  switch (n.kind) {
    case 'scope':
      return { text: `Only ${n.major} of ${n.total} courses are ${m.catalog.majorDepts.join(' or ')}. This audit covers ${m.catalog.program} only.` };
    case 'entry':
      return { text: `No checklist for ${n.year} entry yet. Using Batch ${m.catalog.batch} (${m.catalog.catalogYear}).`, action: ['Change', () => ui.degree(true)] };
    case 'grade':
      return {
        text: n.rows.length === 1
          ? <><Code>{n.rows[0]!.code}</Code> has grade <Code>{n.rows[0]!.grade}</Code>, which isn't recognised. Counted as in progress.</>
          : <>Grades not recognised: {few(n.rows.map((r) => `${r.code} (${r.grade})`))}. Counted as in progress.</>,
        action: ['Set grade', () => go('transcript')],
      };
    case 'unread':
      return { text: <>In the transcript but not read as {n.codes.length === 1 ? 'a course' : 'courses'}: <Code>{few(n.codes)}</Code>.</>, action: transcript };
    case 'totals':
      return { text: n.problems.join(' '), action: transcript };
  }
}

/** One icon for the group, one line each, a link to where it's fixed. Nothing shows when all is well. */
function Notices({ m }: { m: Model }) {
  if (!m.notices.length) return null;
  return (
    <div className="flex gap-3 px-1 md:-mt-1">
      <AlertTriangle className="mt-[3px] size-4 shrink-0 text-warn" strokeWidth={1.75} aria-label="Check" />
      <ul className="flex min-w-0 flex-1 flex-col gap-1">
        {m.notices.map((n) => {
          const { text, action } = notice(n, m);
          return (
            // Phones: the link follows the sentence. Wider: it sits at the right edge, like a card's head link.
            <li key={n.kind} className="py-1 text-sm text-fg-2 md:flex md:items-center md:justify-between md:gap-4">
              <span className="min-w-0">{text}</span>
              {action ? (
                <button type="button" onClick={action[1]} className="ml-1.5 inline-flex items-center gap-0.5 whitespace-nowrap align-bottom text-fg-3 transition-colors hover:text-fg md:ml-0 md:shrink-0">
                  {action[0]}<ChevronRight className="size-4" strokeWidth={1.5} />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- Verdict, the credits gauge and the four graduation figures ---------- */

const EASE = [0.22, 1, 0.36, 1] as const;

function Hero({ m }: { m: Model }) {
  const r = m.result;
  const v = r.verdict;
  return (
    <Card className="px-5 pb-5 pt-6 md:px-8 md:pb-8 md:pt-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="display text-[24px] leading-tight md:text-[28px]">{v.headline}</h2>
          <p className="mt-1.5 text-md text-fg-2 md:mt-1">{v.detail}</p>
        </div>
        {r.need > 0 ? (
          <Button variant="primary" size="lg" className="hidden md:inline-flex" onClick={() => go('planner')}>Plan {m.termEntry.label}</Button>
        ) : null}
      </div>
      <Gauge m={m} />
      <Figures m={m} />
      {/* Phones: at the bottom of the card, within thumb reach. */}
      {r.need > 0 ? (
        <button
          type="button"
          onClick={() => go('planner')}
          className="mt-7 flex h-11 w-full items-center justify-between rounded-inner bg-surface-2 pl-4 pr-3 text-base font-medium transition-colors active:bg-surface-3 md:hidden"
        >
          Plan {m.termEntry.label}
          <ChevronRight className="size-4 text-fg-3" strokeWidth={1.75} />
        </button>
      ) : null}
    </Card>
  );
}

// A 240° arc, open at the bottom, in a 300 × 210 box.
const ARC = (() => {
  const cx = 150, cy = 140, r = 118;
  const at = (deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)] as const;
  const [x1, y1] = at(210);
  const [x2, y2] = at(-30);
  return `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`;
})();

/** Earned credits fill the arc in ink, in-progress ones continue it in the accent. Left and target sit either side. */
function Gauge({ m }: { m: Model }) {
  const r = m.result;
  const still = useReducedMotion();
  const total = Math.max(r.target, r.earned + r.ipCredits) || 1;
  const e = Math.min(1, r.earned / total);
  const i = Math.min(1 - e, r.ipCredits / total);
  return (
    <div className="mx-auto mt-8 grid max-w-[720px] grid-cols-[1fr_auto_1fr] items-center md:mt-1">
      <Side value={r.need} label="Left" />
      <div className="relative w-[196px] md:w-[300px]" style={{ aspectRatio: '300 / 210' }}>
        <svg viewBox="0 0 300 210" className="absolute inset-0 size-full overflow-visible" role="img" aria-label={`${r.earned} of ${r.target} credits earned, ${r.ipCredits} in progress`}>
          <path d={ARC} fill="none" strokeWidth={12} strokeLinecap="round" className="stroke-fg/[0.08]" />
          {e > 0 ? (
            <motion.path
              d={ARC} fill="none" strokeWidth={12} strokeLinecap="round" className="stroke-done"
              initial={still ? false : { pathLength: 0 }}
              animate={{ pathLength: e }}
              transition={{ duration: 1, ease: EASE }}
            />
          ) : null}
          {i > 0 ? (
            <motion.path
              d={ARC} fill="none" strokeWidth={12} className="stroke-doing"
              initial={still ? false : { pathLength: 0, pathOffset: e }}
              animate={{ pathLength: i, pathOffset: e }}
              transition={{ duration: 0.45, ease: EASE, delay: still ? 0 : 0.8 }}
            />
          ) : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-[9%]">
          <span className="tnum text-[30px] font-medium leading-none tracking-[-0.03em] md:text-[50px]">{r.earned}</span>
          <span className="mt-1 text-xs text-fg-3 md:mt-2 md:text-sm">Earned</span>
          {r.ipCredits ? (
            <span className="tnum mt-1.5 whitespace-nowrap rounded-full bg-doing/25 px-2 py-px text-[11px] text-fg md:mt-2.5 md:py-0.5 md:text-xs">+{r.ipCredits} in progress</span>
          ) : null}
        </div>
      </div>
      <Side value={r.target} label="Target" />
    </div>
  );
}

function Side({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <p className="tnum text-[22px] font-medium leading-none tracking-[-0.02em] md:text-[30px]">{value}</p>
      <p className="mt-1.5 text-sm text-fg-3 md:mt-2">{label}</p>
    </div>
  );
}

/** Each figure as a thin bar with its minimum marked, so "how close" reads without doing the sum. */
function Figures({ m }: { m: Model }) {
  const r = m.result;
  const s = r.stats;
  const still = useReducedMotion();
  const minSem = m.catalog.policy.minRegularSemesters;
  const upperMax = Math.max(r.upper.min * 1.5, r.upper.withIp) || 1;
  const semMax = Math.max(minSem * 1.25, r.semesters) || 1;
  const items = [
    { label: 'CGPA', short: s.att > 0 && s.cgpa < m.catalog.minCgpa ? 'bad' : null, value: s.att ? num(s.cgpa) : '–', min: num(m.catalog.minCgpa), fill: s.att ? s.cgpa / 4 : 0, tick: m.catalog.minCgpa / 4, onClick: () => go('gpa') },
    { label: 'Major GPA', short: s.matt > 0 && s.mgpa < m.catalog.minMajorCgpa ? 'bad' : null, value: s.matt ? num(s.mgpa) : '–', min: num(m.catalog.minMajorCgpa), fill: s.matt ? s.mgpa / 4 : 0, tick: m.catalog.minMajorCgpa / 4, onClick: () => go('gpa') },
    { label: `${m.catalog.upper.level}+ level courses`, brief: `${m.catalog.upper.level}+ level`, value: String(r.upper.withIp), min: String(r.upper.min), fill: r.upper.withIp / upperMax, tick: r.upper.min / upperMax, short: r.upper.withIp < r.upper.min ? 'prog' : null },
    { label: 'Regular semesters', value: String(r.semesters), min: String(minSem), fill: r.semesters / semMax, tick: minSem / semMax, short: r.semesters < minSem ? 'prog' : null },
  ];
  return (
    <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-7 border-t border-line pt-7 md:mt-6 md:grid-cols-4 md:gap-x-8 md:pt-6">
      {items.map((it, idx) => {
        const body = (
          <>
            <p className="truncate text-sm text-fg-2">
              {'brief' in it && it.brief ? <><span className="min-[360px]:hidden">{it.brief}</span><span className="hidden min-[360px]:inline">{it.label}</span></> : it.label}
            </p>
            <div className="relative mt-3 h-1.5 rounded-full bg-fg/[0.08]">
              <motion.div
                className={cn('absolute inset-y-0 left-0 rounded-full', it.short === 'bad' && 'bg-bad')}
                // Each figure takes its own palette colour; only a GPA under its minimum turns red.
                style={it.short === 'bad' ? undefined : { backgroundColor: `rgb(var(--c${idx}))` }}
                initial={still ? false : { width: 0 }}
                animate={{ width: `${Math.min(1, it.fill) * 100}%` }}
                transition={{ duration: 0.8, ease: EASE, delay: still ? 0 : 0.2 + idx * 0.06 }}
              />
              <span className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-fg/50" style={{ left: `${Math.min(1, it.tick) * 100}%` }} />
            </div>
            <p className="mt-3 whitespace-nowrap">
              <span className={cn('tnum text-[17px] font-medium', it.short === 'bad' && 'text-bad')}>{it.value}</span>
              <span className="num ml-1.5 text-xs text-fg-3">min {it.min}</span>
            </p>
          </>
        );
        return it.onClick ? (
          <button key={it.label} type="button" onClick={it.onClick} className="-m-2 rounded-inner p-2 text-center transition-colors hover:bg-surface-2/70">{body}</button>
        ) : (
          <div key={it.label} className="text-center">{body}</div>
        );
      })}
    </div>
  );
}

/* ---------- CGPA after each term, as one quiet line ---------- */

function Cgpa({ m, className }: { m: Model; className?: string }) {
  if (m.series.length < 2) return null;
  return <CgpaLine m={m} className={className} />;
}

function CgpaLine({ m, className }: { m: Model; className?: string }) {
  const pts = m.series;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const still = useReducedMotion();
  const H = 116, padX = 4, padTop = 24, padBottom = 26;
  const vals = pts.map((p) => p.cgpa);
  const hiV = Math.max(...vals), loV = Math.min(...vals);
  // Never stretch less than 0.3 of a grade point over the full height, so small wobbles stay small.
  const span = Math.max(hiV - loV, 0.3);
  const lo = (hiV + loV) / 2 - span / 2;
  const n = pts.length;
  const x = (i: number) => padX + (i * Math.max(0, width - 2 * padX)) / (n - 1);
  const y = (v: number) => padTop + (1 - (v - lo) / span) * (H - padTop - padBottom);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.cgpa)}`).join(' ');
  const iHi = vals.indexOf(hiV);
  const iLo = vals.indexOf(loV);
  const first = pts[0]!;
  const last = pts[n - 1]!;
  const shown = active ?? n - 1;
  const anchor = (i: number) => (x(i) < 28 ? 'start' : x(i) > width - 28 ? 'end' : 'middle');

  const pick = (clientX: number, el: HTMLElement) => {
    const rel = clientX - el.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - rel) < Math.abs(x(best) - rel)) best = i;
    return best;
  };

  const a = active !== null ? pts[active]! : null;
  const step = useStepStroke(pts.map((_, i) => x(i)), vals);
  return (
    <Card className={cn('pb-4', className)}>
      <CardHead
        title="CGPA"
        sub={a
          ? <span className="num">{termLabel(a.term)} · {num(a.cgpa)} <span className="text-fg-3/80">(term {num(a.gpa)})</span></span>
          : <><span className="num text-fg-2">{signed(last.cgpa - first.cgpa)}</span> since {termLabel(first.term)}</>}
        action={<HeadLink onClick={() => go('gpa')}>GPA</HeadLink>}
      />
      <div
        ref={ref}
        className="relative mx-5 mt-2 touch-pan-y select-none md:mx-6"
        style={{ height: H }}
        onPointerMove={(e) => { if (e.pointerType === 'mouse') setActive(pick(e.clientX, e.currentTarget)); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive(null); }}
        onClick={(e) => { const i = pick(e.clientX, e.currentTarget); setActive(active === i ? null : i); }}
      >
        {width > 0 ? (
          <svg width={width} height={H} className="absolute inset-0 overflow-visible" role="img" aria-label={`CGPA by term, from ${num(first.cgpa)} in ${termLabel(first.term)} to ${num(last.cgpa)} in ${termLabel(last.term)}`}>
            {step.defs}
            {a ? <line x1={x(shown)} x2={x(shown)} y1={padTop - 6} y2={H - padBottom + 4} className="stroke-fg/15" strokeWidth={1} /> : null}
            <motion.path
              d={d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" stroke={step.stroke}
              initial={still ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1, ease: EASE }}
            />
            {iHi !== iLo ? (
              <>
                <text x={x(iHi)} y={y(hiV) - 10} textAnchor={anchor(iHi)} className="num fill-fg-3 text-[11px]">{num(hiV)}</text>
                <text x={x(iLo)} y={y(loV) + 19} textAnchor={anchor(iLo)} className="num fill-fg-3 text-[11px]">{num(loV)}</text>
              </>
            ) : null}
            <motion.circle
              cx={x(shown)} cy={y(pts[shown]!.cgpa)} r={3.5} strokeWidth={1.75}
              stroke={stepColor(vals, shown)} style={{ fill: a ? 'rgb(var(--surface))' : stepColor(vals, shown) }}
              initial={still ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: still ? 0 : 0.9 }}
            />
          </svg>
        ) : null}
      </div>
    </Card>
  );
}

/* ---------- Under the verdict: what stands in the way, how the numbers came out, credit changes ---------- */

function Asides({ m }: { m: Model }) {
  const v = m.result.verdict;
  const items = [
    ...v.notes.map((text) => ({ text, warn: true })),
    ...v.facts.map((text) => ({ text, warn: false })),
  ];
  const changes = useMemo(() => creditChanges(m.catalog, CURRENT.credits), [m.catalog]);
  if (!items.length && !changes.length) return null;
  return (
    <div className="-mt-1 flex flex-col md:-mt-2">
      {items.length ? (
        <ul className="flex flex-col">
          {items.map((it) => {
            const Icon = it.warn ? AlertTriangle : Info;
            return (
              <li key={it.text} className="flex items-start gap-3 px-1 py-1.5 text-sm text-fg-2">
                <Icon className={cn('mt-[3px] size-4 shrink-0', it.warn ? 'text-warn' : 'text-fg-3')} strokeWidth={1.75} />
                <span className="min-w-0">{it.text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <CreditChanges m={m} changes={changes} />
    </div>
  );
}

/* ---------- Courses whose credits changed since the student's checklist ---------- */

function CreditChanges({ m, changes }: { m: Model; changes: ReturnType<typeof creditChanges> }) {
  const [open, setOpen] = useState(false);
  const still = useReducedMotion();
  if (!changes.length) return null;
  const line = new Map(m.result.lines.map((l) => [l.code, l]));
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center gap-3 px-1 py-1.5 text-left text-sm text-fg-2 transition-colors hover:text-fg"
      >
        <ArrowLeftRight className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />
        <span className="min-w-0 flex-1">{plural(changes.length, 'course')} changed credits in {CURRENT.label} vs your {m.catalog.catalogYear} checklist</span>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-fg-3 transition-colors group-hover:text-fg">
          {open ? 'Hide' : 'Show'}
          <ChevronDown className={cn('size-4 transition-transform duration-200', open && 'rotate-180')} strokeWidth={1.5} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="changes"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: still ? 0 : 0.28, ease: EASE }}
          >
            <ul className="flex flex-wrap gap-1.5 pb-1 pl-8 pr-1 pt-2">
              {changes.map((c) => {
                const completed = line.get(c.code)?.state === 'done';
                return (
                  <li key={c.code} className="inline-flex max-w-full items-center gap-2 rounded-inner bg-surface px-2.5 py-1.5 text-sm shadow-soft">
                    <Code>{c.code}</Code>
                    <span className="min-w-0 truncate text-fg-2">{c.title}</span>
                    <span className="num shrink-0">
                      <span className="text-fg-3 line-through decoration-fg-3/60">{c.from}</span>
                      <span className="mx-1 text-fg-3">→</span>
                      <span className="text-fg">{c.to}</span>
                    </span>
                    {completed ? <Check aria-label="Completed" className="size-3.5 shrink-0 text-fg-3" strokeWidth={2} /> : null}
                  </li>
                );
              })}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Requirement groups ---------- */

interface GroupSummary { id: string; label: string; lines: Line[]; done: number; ip: number; total: number }

function summarize(m: Model): GroupSummary[] {
  const groups = [...m.catalog.groups.map((g) => ({ id: g.id, label: g.label })), { id: 'deficiency', label: 'Pre-medical deficiency' }];
  return groups
    .map((g) => {
      const lines = m.result.lines.filter((l) => l.group === g.id);
      return {
        ...g, lines,
        done: lines.filter((l) => l.state === 'done' || l.state === 'exempt').length,
        ip: lines.filter((l) => l.state === 'ip').length,
        total: lines.length,
      };
    })
    .filter((g) => g.total > 0);
}

/** Done in ink, in progress in the accent. A finished group is just a check. */
function Ring({ done, ip, total }: { done: number; ip: number; total: number }) {
  const still = useReducedMotion();
  if (done >= total) {
    return (
      <span className="grid size-[26px] shrink-0 place-items-center rounded-full bg-done">
        <Check className="size-3.5 text-done-on" strokeWidth={2.25} aria-hidden />
      </span>
    );
  }
  const d = done / total;
  const p = ip / total;
  return (
    <svg viewBox="0 0 26 26" className="size-[26px] shrink-0 -rotate-90" aria-hidden>
      <circle cx={13} cy={13} r={11} fill="none" strokeWidth={3} className="stroke-fg/[0.08]" />
      {d > 0 ? (
        <motion.circle
          cx={13} cy={13} r={11} fill="none" strokeWidth={3} strokeLinecap="round" className="stroke-done"
          initial={still ? false : { pathLength: 0 }}
          animate={{ pathLength: d }}
          transition={{ duration: 0.8, ease: EASE, delay: still ? 0 : 0.15 }}
        />
      ) : null}
      {p > 0 ? (
        <motion.circle
          cx={13} cy={13} r={11} fill="none" strokeWidth={3} className="stroke-doing"
          initial={still ? false : { pathLength: 0, pathOffset: d }}
          animate={{ pathLength: p, pathOffset: d }}
          transition={{ duration: 0.4, ease: EASE, delay: still ? 0 : 0.8 }}
        />
      ) : null}
    </svg>
  );
}

function Groups({ m, className }: { m: Model; className?: string }) {
  const groups = summarize(m);
  const total = groups.reduce((a, g) => a + g.total, 0);
  const done = groups.reduce((a, g) => a + g.done, 0);
  const ip = groups.reduce((a, g) => a + g.ip, 0);
  const left = total - done - ip;
  // The dot in each label is the colour of its part of the bar below.
  const counts: [string, number, string | null][] = [['Courses', total, null], ['Done', done, 'bg-done'], ['In progress', ip, 'bg-doing'], ['Left', left, 'bg-fg/20']];
  return (
    <Card className={cn('pb-2', className)}>
      <CardHead title="Requirements" />
      <div className="px-5 pb-4 pt-5 md:px-6">
        <div className="flex justify-between gap-3">
          {counts.map(([label, value, dot], i) => (
            // Phones skip the total, which is the other three added up.
            <div key={label} className={cn(i === counts.length - 1 && 'text-right', i === 0 && 'hidden md:block')}>
              <p className={cn('tnum text-[26px] leading-none tracking-[-0.02em]', dot ? 'text-fg-3' : 'text-fg')}>{value}</p>
              <p className={cn('mt-2 flex items-center gap-1.5 whitespace-nowrap text-xs text-fg-3', i === counts.length - 1 && 'justify-end')}>
                {dot ? <span className={cn('size-1.5 rounded-full', dot)} /> : null}{label}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex h-2 gap-1 animate-reveal md:mt-5" aria-hidden>
          {done ? <span className="rounded-full bg-done" style={{ flex: done }} /> : null}
          {ip ? <span className="rounded-full bg-doing" style={{ flex: ip }} /> : null}
          {left ? <span className="rounded-full bg-fg/[0.12]" style={{ flex: left }} /> : null}
        </div>
      </div>
      <ul className="pt-1">
        {groups.map((g) => {
          const complete = g.done >= g.total;
          return (
            <li key={g.id}>
              <a
                href={`#g-${g.id}`}
                onClick={(e) => { e.preventDefault(); document.getElementById(`g-${g.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/60 md:px-6 md:py-2.5"
              >
                <Ring done={g.done} ip={g.ip} total={g.total} />
                <span className={cn('min-w-0 flex-1 truncate text-base', complete && 'text-fg-3')}>
                  {g.label}
                  {g.ip ? <span className="ml-2 text-xs text-doing-ink">{g.ip} in progress</span> : null}
                </span>
                <span className={cn('num shrink-0 text-sm', complete ? 'text-fg-3' : 'text-fg-2')}>{g.done} / {g.total}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ---------- Still to take, as a short ledger ---------- */

function Todo({ m, className }: { m: Model; className?: string }) {
  const r = m.result;
  const named = r.missing.filter((l) => !l.slot);
  const slots = r.missing.filter((l) => l.slot);
  const offered = (code: string) => (m.sections[code]?.length ?? 0) > 0;
  const open = (intent: Parameters<typeof ui.intent>[0]) => { ui.intent(intent); go('planner'); };
  const empty = !named.length && !slots.length && !r.free;

  const rows: { key: string; code: string; title: string; status: ReactNode; credits: number; onClick: () => void }[] = [
    ...named.map((l) => {
      const pending = l.prereq.filter((p) => p.state !== 'done').map((p) => p.code).join(', ');
      const status = l.readiness === 'blocked'
        ? <span className="text-bad">Needs {pending}</span>
        : l.readiness === 'wait' ? <>After {pending}</> : null;
      const notOffered = m.term && !offered(l.code) ? <span className="text-warn">Not offered in {m.termEntry.label}</span> : null;
      const first = notOffered ?? status;
      const full = first && l.evidence ? <>{first} · {l.evidence}</> : first ?? (l.evidence || null);
      return { key: l.key, code: l.code, title: l.title, status: full, credits: l.credits, onClick: () => open({ course: l.code }) };
    }),
    ...slots.map((l) => ({ key: l.key, code: '', title: l.code, status: <span className="num">{(l.depts ?? []).join(' · ')}</span>, credits: l.credits, onClick: () => open({ group: l.group }) })),
    ...(r.free > 0 ? [{ key: 'free', code: '', title: 'Free electives', status: 'Any course', credits: r.free, onClick: () => open({ group: 'free' }) }] : []),
  ];

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHead title="Still to take" action={empty ? undefined : <HeadLink onClick={() => go('planner')}>Planner</HeadLink>} />
      {empty ? (
        <p className="px-6 py-12 text-center text-md text-fg-2">Nothing left</p>
      ) : (
        <>
          <ul className="mt-3">
            {rows.map((row) => (
              <li key={row.key} className="border-t border-line">
                <button type="button" onClick={row.onClick} className="flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors hover:bg-surface-2/60 md:px-6 md:py-3">
                  {row.code
                    ? <span className="num w-[78px] shrink-0 rounded-md bg-surface-2 py-1 text-center text-xs text-fg-2 md:w-[84px]">{row.code}</span>
                    : <span aria-hidden className="h-6 w-[78px] shrink-0 rounded-md border border-dashed border-fg/20 md:w-[84px]" />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-base">{row.title}</span>
                    {row.status ? <span className="mt-0.5 block text-sm text-fg-3">{row.status}</span> : null}
                  </span>
                  <span className="num shrink-0 text-sm text-fg-2">{row.credits}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex min-h-12 items-center justify-between border-t border-line px-5 text-sm md:px-6">
            <span className="text-fg-3">Total</span>
            <span className="num font-medium">{plural(r.need, 'credit')}</span>
          </div>
        </>
      )}
    </Card>
  );
}

/* ---------- Every requirement, grouped ---------- */

type Filter = 'all' | 'left' | 'done';

function StateIcon({ state }: { state: Line['state'] | 'done' | 'ip' }) {
  const c = 'size-4 shrink-0';
  if (state === 'done') return <Check className={cn(c, 'text-fg-2')} strokeWidth={1.75} aria-label="Done" />;
  if (state === 'ip') return <Clock3 className={cn(c, 'text-doing-ink')} strokeWidth={1.5} aria-label="In progress" />;
  if (state === 'exempt') return <Minus className={cn(c, 'text-fg-3')} strokeWidth={1.5} aria-label="Exempt" />;
  return <Circle className={cn(c, 'text-fg/25')} strokeWidth={1.5} aria-label="Left" />;
}

function AllCourses({ m }: { m: Model }) {
  const [filter, setFilter] = useState<Filter>('all');
  const groups = useMemo(() => summarize(m), [m]);
  const keep = (state: string) => filter === 'all' || (filter === 'left' ? state === 'missing' || state === 'ip' : state === 'done' || state === 'exempt');
  const extra = m.result.extra.filter((e) => keep(e.state));

  return (
    <Card className="pb-4">
      <CardHead
        title="All courses"
        action={
          <Segmented<Filter>
            label="Show"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[{ value: 'all', label: 'All' }, { value: 'left', label: 'Left' }, { value: 'done', label: 'Done' }]}
          />
        }
      />
      <div className="mt-2 grid min-w-0 grid-cols-1 gap-x-12 md:grid-cols-2 md:px-6">
        {groups.map((g) => {
          const lines = g.lines.filter((l) => keep(l.state));
          if (!lines.length) return null;
          return (
            <section key={g.id} id={`g-${g.id}`} className="min-w-0 scroll-mt-6 pt-4">
              <h3 className="flex items-baseline justify-between border-b border-line px-5 pb-2 text-sm text-fg-3 md:px-0">
                {g.label}
                <span className="num text-xs">{g.done} of {g.total}</span>
              </h3>
              <ul className="pt-1">{lines.map((l) => <CourseLine key={l.key} l={l} />)}</ul>
            </section>
          );
        })}
        {extra.length ? (
          <section id="g-extra" className="min-w-0 scroll-mt-6 pt-4">
            <h3 className="border-b border-line px-5 pb-2 text-sm text-fg-3 md:px-0">Free electives</h3>
            <ul className="pt-1">
              {extra.map((e) => (
                <CourseLine key={e.code} l={{ code: e.code, title: e.title, state: e.state, grade: e.grade, term: e.term, credits: e.credits, slot: false, evidence: '' }} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Card>
  );
}

function CourseLine({ l }: { l: Pick<Line, 'code' | 'title' | 'state' | 'grade' | 'term' | 'credits' | 'slot' | 'evidence'> }) {
  const sub = l.state === 'done' ? termLabel(l.term) : l.state === 'ip' ? `In progress · ${termLabel(l.term)}` : l.state === 'exempt' ? 'Exempt' : l.slot ? l.evidence : '';
  const note = l.evidence && !l.slot && l.state !== 'exempt' ? l.evidence : '';
  return (
    <li className="flex max-w-full items-center gap-3 overflow-hidden px-5 py-3 md:px-0 md:py-2">
      <StateIcon state={l.state} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-base', l.slot && 'text-fg-2')}>
          {l.slot ? l.code : <><Code className="mr-2 hidden text-fg-2 md:inline">{l.code}</Code>{l.title}</>}
        </p>
        {/* Phones: code on the second line so the title has room. */}
        {sub || note || !l.slot ? (
          <p className="mt-0.5 truncate text-xs text-fg-3 md:mt-0">
            {!l.slot ? <span className="num md:hidden">{l.code}{sub || note ? ' · ' : ''}</span> : null}
            {[sub, note].filter(Boolean).join(' · ')}
          </p>
        ) : null}
      </div>
      <span className={cn('num w-8 shrink-0 text-right text-sm', l.state === 'done' ? 'text-fg' : 'text-fg-3')}>{l.state === 'done' ? l.grade : l.credits}</span>
    </li>
  );
}
