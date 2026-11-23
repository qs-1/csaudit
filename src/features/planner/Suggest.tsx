import { AnimatePresence, motion } from 'motion/react';
import { Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { toast } from 'sonner';
import { autofill, blocksFor, explainNone, fitsPrefs, unfit, DAY_SHORT, hm, seatsMeaningful, sid, type Option, type Section } from '@/engine';
import { useIsMobile } from '@/lib/hooks';
import { cn, plural } from '@/lib/utils';
import type { Model } from '@/state/model';
import { actions, DROPPED, useStore } from '@/state/store';
import { Button } from '@/ui/button';
import { Chip, Input, Segmented, Stepper, SwitchRow } from '@/ui/controls';
import { Sheet } from '@/ui/sheet';
import { colorVar, preview, type PlanState } from './usePlan';

const START = [{ value: '0', label: 'Any' }, { value: '540', label: '9:00' }, { value: '600', label: '10:00' }, { value: '660', label: '11:00' }];
const END = [{ value: '1440', label: 'Any' }, { value: '900', label: '15:00' }, { value: '960', label: '16:00' }, { value: '1020', label: '17:00' }];

/** What a suggestion does with a course: keep its planned section, find it a section, add it if it fits, or leave it out. */
type Role = 'keep' | 'need' | 'maybe' | 'skip';

/** Kept for the tab's lifetime, so closing and reopening the sheet doesn't lose the choices. */
const useAsk = create<{ roles: Record<string, Role>; added: string[]; credits: [number, number] | null }>()(() => ({ roles: {}, added: [], credits: null }));
const setRole = (c: string, r: Role) => useAsk.setState((s) => ({ roles: { ...s.roles, [c]: r } }));
const addMaybe = (c: string) => useAsk.setState((s) => ({ added: s.added.includes(c) ? s.added : [...s.added, c], roles: { ...s.roles, [c]: 'maybe' } }));
const dropAdded = (c: string) => useAsk.setState((s) => {
  const { [c]: _, ...roles } = s.roles;
  return { added: s.added.filter((x) => x !== c), roles };
});

export function Suggest({ m, p, open, onOpenChange }: { m: Model; p: PlanState; open: boolean; onOpenChange: (o: boolean) => void }) {
  const prefs = useStore((s) => s.prefs);
  const ask = useAsk();
  const mobile = useIsMobile();
  const [options, setOptions] = useState<Option[] | null>(null);
  const [why, setWhy] = useState<string[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const stale = () => { setOptions(null); setWhy([]); };

  const offered = (c: string) => (m.sections[c]?.length ?? 0) > 0;
  const required = m.bare ? [] : m.result.missing.filter((l) => !l.slot && l.readiness !== 'blocked').map((l) => l.code);
  const missingFromTerm = required.filter((c) => !offered(c));
  // Planned courses first (the registration on the transcript included), then what's still required, then optional
  // courses added here.
  const courses = useMemo(
    () => [...new Set([...p.chosen.map((s) => s.course), ...Object.keys(p.plan), ...required, ...ask.added])].filter(offered),
    [p.chosen, required.join(), p.plan, ask.added, m.sections],
  );
  const roleOf = (c: string): Role => {
    // Registered sections are kept as they are, other planned courses are needed; everything else fills the week up
    // to the credit range.
    const r = ask.roles[c] ?? (p.registered.has(c) && p.inPlan(c) ? 'keep' : p.inPlan(c) ? 'need' : 'maybe');
    return r === 'keep' && !p.inPlan(c) ? 'need' : r;
  };
  const fixed = courses.filter((c) => roleOf(c) === 'keep').flatMap((c) => p.inPlan(c) ?? []);
  const outside = unfit(courses.filter((c) => roleOf(c) === 'need' || roleOf(c) === 'maybe'), m.sections, prefs);
  const need = courses.filter((c) => roleOf(c) === 'need' && !outside.includes(c));
  const maybe = courses.filter((c) => roleOf(c) === 'maybe' && !outside.includes(c));
  const reg = m.catalog.policy.regularLoad;
  // Default range: a regular load, but never asking for more than the planned and required courses add up to
  // (courses added here are extras, so they don't raise the floor).
  const listed = [...need, ...maybe].filter((c) => !ask.added.includes(c)).reduce((a, c) => a + (m.sections[c]?.[0]?.credits ?? 0), 0) + fixed.reduce((a, s) => a + s.credits, 0);
  const credits = ask.credits ?? [Math.max(0, Math.min(reg - 4, listed)), reg];
  const seats = seatsMeaningful(m.term?.sections ?? []);
  const ready = need.length + maybe.length > 0;

  const run = () => {
    const extra = { maybe, credits };
    const found = autofill(need, m.sections, fixed, prefs, 4, extra);
    setOptions(found);
    setWhy(found.length ? [] : explainNone(need, m.sections, fixed, prefs, extra));
  };

  const apply = (o: Option) => {
    const prev = { ...p.plan };
    const next: Record<string, string> = Object.fromEntries([...fixed, ...o.sections].map((s) => [s.course, s.sec]));
    // A registered course the timetable leaves out is dropped, not quietly brought back.
    for (const c of p.registered.keys()) if (!(c in next)) next[c] = DROPPED;
    actions.replacePlan(p.termId, next);
    preview(null);
    onOpenChange(false);
    stale();
    toast.success(`Planned ${plural(o.sections.length + fixed.length, 'course')}`, { action: { label: 'Undo', onClick: () => actions.replacePlan(p.termId, prev) } });
  };

  const title = (c: string) => m.sections[c]?.[0]?.title ?? '';
  const cr = (c: string) => m.sections[c]?.[0]?.credits ?? 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) { preview(null); stale(); } }}
      title="Suggest timetables"
      side="left"
    >
      <div className="flex flex-col gap-6 pt-1" onPointerLeave={() => { preview(null); setHover(null); }}>
        <div className="flex flex-col gap-4">
          <Pref label="Start no earlier than">
            <Segmented label="Earliest start" full size="sm" value={String(prefs.earliest)} onChange={(v) => { actions.prefs({ earliest: +v }); stale(); }} options={START} />
          </Pref>
          <Pref label="Finish by">
            <Segmented label="Latest finish" full size="sm" value={String(prefs.latest)} onChange={(v) => { actions.prefs({ latest: +v }); stale(); }} options={END} />
          </Pref>
          <Pref label="Days off">
            <div className="flex gap-1.5">
              {['M', 'T', 'W', 'R', 'F'].map((d) => {
                const on = prefs.daysOff.includes(d);
                return (
                  <Chip key={d} on={on} className="flex-1 justify-center px-0" onClick={() => { actions.prefs({ daysOff: on ? prefs.daysOff.filter((x) => x !== d) : [...prefs.daysOff, d] }); stale(); }}>
                    {DAY_SHORT[d]}
                  </Chip>
                );
              })}
            </div>
          </Pref>
          {seats ? (
            <div className="-my-1">
              <SwitchRow title="Skip full sections" checked={prefs.skipFull} onChange={(v) => { actions.prefs({ skipFull: v }); stale(); }} />
            </div>
          ) : null}
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <p className="text-[17px] font-medium tracking-[-0.01em]">Courses</p>
            {p.chosen.length ? <p className="text-xs text-fg-3">Keep holds the section you picked</p> : null}
          </div>
          {courses.length ? (
            <ul className="flex flex-col">
              {courses.map((c) => {
                const r = roleOf(c);
                const planned = p.inPlan(c);
                const added = ask.added.includes(c);
                const out = outside.includes(c) && r !== 'keep' && r !== 'skip';
                const opts = [
                  ...(planned ? [{ value: 'keep' as Role, label: `Keep ${planned.sec}` }] : []),
                  { value: 'need' as Role, label: 'Need' },
                  { value: 'maybe' as Role, label: 'Maybe' },
                  ...(added ? [] : [{ value: 'skip' as Role, label: 'Skip' }]),
                ];
                return (
                  <li key={c} className="py-3">
                    <div className="mb-2 flex items-baseline gap-3">
                      <span className="num w-[76px] shrink-0 text-[13px] text-fg-2">{c}</span>
                      <span className={cn('min-w-0 flex-1 truncate text-sm', r === 'skip' ? 'text-fg-3' : 'text-fg')}>{title(c)}</span>
                      <span className="num shrink-0 text-xs text-fg-3">{cr(c)} cr</span>
                      {added ? (
                        <button type="button" aria-label={`Remove ${c}`} onClick={() => { dropAdded(c); stale(); }} className="-my-1 grid size-6 shrink-0 place-items-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-fg">
                          <X className="size-3.5" strokeWidth={2} />
                        </button>
                      ) : null}
                    </div>
                    <Segmented<Role> label={`${c} in suggestions`} full size="sm" value={r} onChange={(v) => { setRole(c, v); stale(); }} options={opts} />
                    {out ? <p className="mt-1.5 text-xs text-warn">No section within your limits, so it's left out</p> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-3 text-sm text-fg-3">{m.bare ? 'Add courses below, or pick sections on the planner first.' : 'Nothing left to schedule this term.'}</p>
          )}
          {missingFromTerm.length ? <p className="mt-1 text-xs text-fg-3">Not offered in {m.termEntry.label}: <span className="num">{missingFromTerm.join(', ')}</span></p> : null}
          <AddCourse m={m} taken={courses} onAdd={(c) => { addMaybe(c); stale(); }} />
        </div>

        {maybe.length ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-fg-2">Total credits</p>
              <p className="text-xs text-fg-3">Maybe courses fill to this</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Stepper label="Fewest credits" value={credits[0]} min={0} max={credits[1]} onChange={(v) => { useAsk.setState({ credits: [v, credits[1]] }); stale(); }} />
              <span className="text-fg-3">–</span>
              <Stepper label="Most credits" value={credits[1]} min={credits[0]} max={m.catalog.policy.maxLoad} onChange={(v) => { useAsk.setState({ credits: [credits[0], v] }); stale(); }} />
            </div>
          </div>
        ) : null}

        <Button variant="primary" size="lg" disabled={!ready} onClick={run}>
          {options ? 'Try again' : 'Find timetables'}
        </Button>

        <AnimatePresence mode="popLayout">
          {options && options.length === 0 ? (
            <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-1 text-sm">
              <p className="font-medium">Nothing fits</p>
              {why.map((w) => <p key={w} className="text-fg-2">{w}</p>)}
            </motion.div>
          ) : null}
          {options?.map((o, i) => (
            <motion.button
              key={o.sections.map(sid).join()}
              type="button"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              onPointerEnter={(e) => { if (!mobile && e.pointerType === 'mouse') { preview([...fixed, ...o.sections]); setHover(i); } }}
              onClick={() => apply(o)}
              className={cn('flex items-center gap-4 rounded-[12px] p-3 text-left shadow-card transition-colors', hover === i ? 'bg-surface-2' : 'bg-surface')}
            >
              <MiniWeek secs={[...fixed, ...o.sections]} highlight={new Set(o.sections.map(sid))} colors={p.colors} />
              <div className="min-w-0 flex-1">
                <p className="text-base font-medium">Option {i + 1}</p>
                <p className="text-sm text-fg-2">{plural(o.days, 'day')} · {hm(o.first)}–{hm(o.last)} · {o.credits} cr</p>
                <p className="text-xs text-fg-3">{o.gaps ? `${Math.round(o.gaps / 60 * 10) / 10}h of gaps a week` : 'No gaps'}</p>
                <p className="num mt-1 truncate text-xs text-fg-2">{o.sections.map((s) => `${s.course.split(' ')[1]}${s.sec}`).join(' · ')}</p>
              </div>
              <span className="shrink-0 rounded-md px-2.5 py-1 text-sm text-fg-2 shadow-card">Use</span>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </Sheet>
  );
}

/** Adds an optional course: courses that would count toward an open requirement first, then search. */
function AddCourse({ m, taken, onAdd }: { m: Model; taken: string[]; onAdd: (c: string) => void }) {
  const [q, setQ] = useState('');
  const prefs = useStore((s) => s.prefs);
  const all = useMemo(() => Object.keys(m.sections).sort(), [m.sections]);
  const free = all.filter((c) => !taken.includes(c));
  const query = q.trim().toLowerCase();
  const matches = query
    ? free.filter((c) => c.toLowerCase().replace(' ', '').includes(query.replace(' ', '')) || (m.sections[c]?.[0]?.title ?? '').toLowerCase().includes(query))
    : m.bare ? [] : free.filter((c) => {
        const r = m.roles.roleOf(c);
        return r.kind === 'slot' && m.sections[c]!.some((s) => fitsPrefs(s, prefs));
      });
  const shown = matches.slice(0, 8);
  return (
    <div className="mt-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a course you'd take if it fits" aria-label="Add an optional course" className="h-9 text-sm" />
      {shown.length ? (
        <>
          {!query ? <p className="mb-1.5 mt-3 text-xs text-fg-3">Would count toward an open requirement</p> : null}
          <div className={cn('flex flex-wrap gap-1.5', query && 'mt-2')}>
            {shown.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onAdd(c); setQ(''); }}
                title={m.sections[c]?.[0]?.title}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-surface-2 pl-2.5 pr-3 text-sm text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg"
              >
                <Plus className="size-3.5 text-fg-3" strokeWidth={2} />
                <span className="num text-[13px]">{c}</span>
              </button>
            ))}
          </div>
        </>
      ) : query ? <p className="mt-2 text-xs text-fg-3">No course matches</p> : null}
    </div>
  );
}

function Pref({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm text-fg-2">{label}</p>
      {children}
    </div>
  );
}

/** Thumbnail of a week, used to compare suggestions at a glance. */
function MiniWeek({ secs, highlight, colors }: { secs: Section[]; highlight: Set<string>; colors: Map<string, number> }) {
  const W = 76, H = 64, from = 8 * 60, to = 18 * 60;
  const days = ['M', 'T', 'W', 'R', 'F'];
  const cw = W / days.length;
  return (
    <svg width={W} height={H} className="shrink-0 rounded-md bg-surface-2" aria-hidden>
      {blocksFor(secs).map((b, i) => {
        const d = days.indexOf(b.day);
        if (d < 0) return null;
        const y = ((Math.max(from, b.start) - from) / (to - from)) * H;
        const h = Math.max(2, ((Math.min(to, b.end) - Math.max(from, b.start)) / (to - from)) * H);
        const c = highlight.has(sid(b.section)) ? colorVar(colors.get(b.section.course) ?? (b.section.course.charCodeAt(5) % 8)) : '--fg-3';
        return <rect key={i} x={d * cw + 1.5} y={y} width={cw - 3} height={h} rx={2} style={{ fill: `rgb(var(${c}) / ${highlight.has(sid(b.section)) ? 0.85 : 0.35})` }} />;
      })}
    </svg>
  );
}
