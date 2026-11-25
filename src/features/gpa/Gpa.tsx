import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { ScreenHeader } from '@/app/Shell';
import { applyRetakes, GP, gradeHint, replacedByIp, retakeOptions, shortTerm, solveTarget, termLabel } from '@/engine';
import { cn, num, signed } from '@/lib/utils';
import { useModel, type Model } from '@/state/model';
import { actions, useStore } from '@/state/store';
import { Card, CardHead, Code } from '@/ui/card';
import { Trend } from '@/ui/charts';
import { Slider, Stepper } from '@/ui/controls';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Gpa() {
  const m = useModel();
  if (!m) return null;
  return (
    <>
      <ScreenHeader eyebrow={`${m.result.stats.att} graded credits`} title="GPA" />
      <div className="grid grid-cols-1 gap-5 md:gap-6 lg:grid-cols-12 lg:items-start">
        <History m={m} className="lg:col-span-7" />
        <Target m={m} className="lg:col-span-5" />
        <Retakes m={m} className="lg:col-span-12" />
      </div>
    </>
  );
}

/* ---------- CGPA over time: the number, then the line ---------- */

function History({ m, className }: { m: Model; className?: string }) {
  const s = m.result.stats;
  const pts = m.series;
  const [active, setActive] = useState<number | null>(null);
  const best = pts.reduce((a, p) => (p.gpa > (a?.gpa ?? -1) ? p : a), pts[0]);
  const first = pts[0];
  const a = active !== null ? pts[active] : null;
  const lo = Math.min(m.catalog.minCgpa, ...pts.map((p) => Math.min(p.cgpa, p.gpa))) - 0.2;
  const below = s.att > 0 && s.cgpa < m.catalog.minCgpa;

  return (
    <Card className={cn('px-5 pb-5 pt-6 md:px-7 md:pb-7 md:pt-7', className)}>
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-fg-3">{a ? termLabel(a.term) : 'Cumulative GPA'}</p>
          <p className={cn('display tnum mt-2 text-[48px] leading-none md:text-[56px]', below && !a && 'text-bad')}>
            {a ? num(a.cgpa) : s.att ? num(s.cgpa) : '–'}
          </p>
          <p className="mt-2.5 h-5 text-sm text-fg-3">
            {a ? (
              <>Term <span className="tnum text-fg-2">{num(a.gpa)}</span> over {a.credits} cr</>
            ) : first && pts.length > 1 ? (
              <><span className="tnum text-fg-2">{signed(s.cgpa - first.cgpa)}</span> since {termLabel(first.term)}</>
            ) : null}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-6 md:gap-8 md:text-right">
          <Fig label="Major" value={s.matt ? num(s.mgpa) : '–'} bad={s.matt > 0 && s.mgpa < m.catalog.minMajorCgpa} />
          <Fig label="Best term" value={best ? num(best.gpa) : '–'} sub={best ? shortTerm(best.term) : undefined} />
          <Fig label="Minimum" value={num(m.catalog.minCgpa)} />
        </dl>
      </div>

      <div className="mt-8">
        {pts.length ? (
          <Trend
            height={220}
            min={Math.max(0, Math.floor(lo * 2) / 2)}
            max={4}
            guide={m.catalog.minCgpa}
            onActive={setActive}
            points={pts.map((p) => ({ label: shortTerm(p.term), value: p.cgpa, bar: p.gpa }))}
          />
        ) : <p className="py-10 text-center text-sm text-fg-3">No graded terms yet</p>}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-fg-3">
          <span className="inline-flex items-center gap-2"><span className="h-[2px] w-3.5 rounded-full bg-done-ink" />Up</span>
          <span className="inline-flex items-center gap-2"><span className="h-[2px] w-3.5 rounded-full bg-doing-ink" />Down</span>
          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-1.5 rounded-[2px] bg-done/50" />Term</span>
          <span className="inline-flex items-center gap-2"><span className="w-3.5 border-t border-dashed border-fg-3" />Min</span>
        </div>
      </div>
    </Card>
  );
}

function Fig({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-fg-3">{label}</dt>
      <dd className={cn('tnum mt-1.5 text-[22px] font-medium leading-none md:text-[24px]', bad && 'text-bad')}>{value}</dd>
      <dd className="num mt-1.5 h-4 text-xs text-fg-3">{sub}</dd>
    </div>
  );
}

/* ---------- What it takes to finish at a given CGPA ---------- */

function Target({ m, className }: { m: Model; className?: string }) {
  const picks = useStore((s) => s.retakes);
  const stats = m.result.stats;
  const target = useStore((s) => s.target) ?? Math.min(4, Math.max(2, Math.ceil((stats.cgpa + 0.05) * 10) / 10));
  const all = retakeOptions(m.transcript.rows, m.catalog);
  // New retakes change the base. A retake already registered is a grade for credits still to be graded, so it is fixed below.
  const opts = all.filter((o) => !o.ipTerm);
  const fixed = all.filter((o) => o.ipTerm && picks[o.code]);
  const fAtt = fixed.reduce((a, o) => a + o.att, 0);
  const fQp = fixed.reduce((a, o) => a + GP[picks[o.code]!]! * o.att, 0);
  const adj = applyRetakes(stats, opts, picks);
  // A retake already registered replaces its old grade: that grade leaves the CGPA and the course is graded again.
  const replaced = replacedByIp(m.transcript.rows);
  const retaking = m.result.retakes.reduce((a, x) => a + x.credits, 0);
  const remaining = m.result.ipCredits + m.result.need + retaking;
  const [credits, setCredits] = useState<number | null>(null);
  const cr = credits ?? remaining;
  const sol = solveTarget(adj.qp - replaced.pts + fQp, stats.att - replaced.att + fAtt, Math.max(0, cr - (credits === null ? fAtt : 0)), target);
  const pos = (v: number) => `${(Math.min(4, Math.max(0, v)) / 4) * 100}%`;
  const hasRetakes = all.some((o) => picks[o.code]);
  const still = useReducedMotion();

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHead title="Target" sub={hasRetakes ? 'Includes your retakes' : 'What it takes to finish where you want'} />
      <div className="px-5 pb-6 pt-5 md:px-6">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-fg-2">Finish with</span>
          <span className="display tnum text-[32px] leading-none">{num(target)}</span>
        </div>
        <Slider className="mt-3" label="Target CGPA" min={2} max={4} step={0.05} value={target} onChange={actions.target} />

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base">Credits still to be graded</p>
            <p className="text-xs text-fg-3">{credits === null ? (replaced.codes.length ? `In progress and left to take, with the ${replaced.codes.join(' and ')} retake` : 'In progress and left to take') : <button className="underline decoration-line underline-offset-4 hover:text-fg" onClick={() => setCredits(null)}>Reset to {remaining}</button>}</p>
          </div>
          <Stepper label="Credits to be graded" value={cr} min={0} max={90} onChange={setCredits} />
        </div>

        <div className="mt-6 rounded-[16px] bg-surface-2 px-5 pb-5 pt-4">
          <div className="min-h-[76px]">
            {cr === 0 ? (
              <p className="pt-2 text-md">With nothing left to grade, CGPA stays at <span className="tnum font-medium">{num(sol.required)}</span>.</p>
            ) : sol.already ? (
              <p className="pt-2 text-md">You finish at <span className="tnum font-medium">{num(target)}</span> or above whatever you score.</p>
            ) : sol.reachable ? (
              <>
                <p className="text-sm text-fg-3">Average needed over {cr} credits</p>
                <div className="mt-2 flex items-baseline gap-3">
                  <motion.span
                    key={sol.required.toFixed(2)}
                    initial={still ? false : { opacity: 0.4, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="display tnum text-[44px] leading-none"
                  >
                    {num(sol.required)}
                  </motion.span>
                  <span className="text-sm text-fg-2">{gradeHint(sol.required)}</span>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-bad">Out of reach</p>
                <p className="mt-2 text-md">Straight A's over {cr} credits reach <span className="tnum font-medium">{num(sol.maxPossible)}</span>.</p>
              </>
            )}
          </div>
          {cr > 0 ? (
            <div className="mt-5">
              {/* The CGPA you end on: anywhere from all F to all A over those credits. The tick is the target. */}
              <div className="mb-2.5 flex justify-between text-2xs text-fg-3">
                <span>Final CGPA</span>
                <span className="num">Target {num(target)}</span>
              </div>
              <div className="relative h-2 rounded-full bg-fg/[0.08]">
                <motion.div
                  className="absolute inset-y-0 rounded-full bg-done/40"
                  initial={false}
                  animate={{ left: pos(sol.minPossible), right: `calc(100% - ${pos(sol.maxPossible)})` }}
                  transition={{ duration: 0.3, ease: EASE }}
                />
                <motion.span
                  className="absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg"
                  initial={false}
                  animate={{ left: pos(target) }}
                  transition={{ duration: 0.3, ease: EASE }}
                />
              </div>
              <div className="num mt-2.5 flex justify-between text-2xs text-fg-3">
                <span>{num(sol.minPossible)} all F</span>
                <span>{num(sol.maxPossible)} all A</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/* ---------- Retakes: pick a grade, see the CGPA move ---------- */

const RETAKE_GRADES = ['C', 'C+', 'B-', 'B', 'B+', 'A-', 'A'];

function Retakes({ m, className }: { m: Model; className?: string }) {
  const picks = useStore((s) => s.retakes);
  const stats = m.result.stats;
  const opts = retakeOptions(m.transcript.rows, m.catalog);
  const adj = applyRetakes(stats, opts, picks);
  const any = opts.some((o) => picks[o.code]);
  return (
    <Card className={cn('pb-3', className)}>
      <CardHead
        title="Retakes"
        sub={opts.length ? 'A C- or lower can be retaken. The new grade replaces the old one.' : undefined}
        action={any ? (
          <div className="text-right">
            <p className="tnum text-[22px] font-medium leading-7">{num(adj.cgpa)}</p>
            <p className="text-xs text-fg-3"><span className={cn('tnum', adj.cgpa >= stats.cgpa ? 'text-fg-2' : 'text-bad')}>{signed(adj.cgpa - stats.cgpa)}</span> · +{adj.loadCredits} cr of load</p>
          </div>
        ) : undefined}
      />
      {opts.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-fg-3">Nothing to retake. FCCU only allows retaking a C- or lower.</p>
      ) : (
        <ul className="mt-4">
          {opts.map((o) => {
            const pick = picks[o.code];
            const gain = pick ? (GP[pick]! * o.att - o.pts) / (stats.att || 1) : 0;
            const choices = RETAKE_GRADES.filter((g) => GP[g]! > GP[o.grade]!);
            return (
              <li key={o.code} className="flex flex-col gap-3 border-t border-line px-5 py-4 first:border-t-0 md:flex-row md:items-center md:gap-6 md:px-6">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base"><Code className="mr-2">{o.code}</Code>{o.title}</p>
                  <p className="mt-0.5 text-xs text-fg-3">
                    Got <span className="num text-fg-2">{o.grade}</span> · {o.att} cr · {termLabel(o.term)}{o.major ? ' · major' : ''}{o.ipTerm ? ` · retaking in ${termLabel(o.ipTerm)}` : ''}
                    {pick ? <span className="num text-fg-2 md:hidden"> · {signed(gain, 3)} CGPA</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="no-scrollbar -mx-5 flex flex-1 gap-1 overflow-x-auto px-5 md:mx-0 md:flex-none md:px-0" role="radiogroup" aria-label={`Retake grade for ${o.code}`}>
                    {choices.map((g) => (
                      <button
                        key={g}
                        type="button"
                        role="radio"
                        aria-checked={pick === g}
                        onClick={() => actions.retake(o.code, pick === g ? undefined : g)}
                        className={cn(
                          'num h-8 min-w-[38px] shrink-0 rounded-[9px] px-2 text-sm transition-colors',
                          pick === g ? 'bg-fg text-bg' : 'bg-surface-2 text-fg-2 hover:bg-fg/[0.08] hover:text-fg',
                        )}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                  <span aria-hidden={!pick} className={cn('num hidden w-[58px] shrink-0 text-right text-sm text-fg-2 md:block', !pick && 'invisible')}>{pick ? signed(gain, 3) : '+0.000'}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
