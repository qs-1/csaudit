import * as CM from '@radix-ui/react-context-menu';
import { AnimatePresence, motion } from 'motion/react';
import { Fragment, useMemo, type ReactNode } from 'react';
import { blocksFor, DAY_SHORT, daysUsed, hm, sid, type Block, type Day, type Section } from '@/engine';
import { cn } from '@/lib/utils';
import { colorVar, onVar } from './usePlan';

const WEEK: Day[] = ['M', 'T', 'W', 'R', 'F'];

interface Placed extends Block { lane: number; lanes: number; key: string }

/** Lays out one day's blocks in side-by-side lanes wherever they overlap. */
function placeDay(blocks: Block[]): Placed[] {
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((b) => b.lane + 1));
    for (const b of cluster) b.lanes = lanes;
    cluster = [];
  };
  for (const b of [...blocks].sort((a, z) => a.start - z.start || a.end - z.end)) {
    if (b.start >= clusterEnd) { flush(); clusterEnd = -1; }
    const laneEnds: number[] = [];
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? 0, c.end);
    let lane = laneEnds.findIndex((e) => e <= b.start);
    if (lane < 0) lane = laneEnds.length;
    const p: Placed = { ...b, lane, lanes: 1, key: '' };
    cluster.push(p);
    out.push(p);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  flush();
  return out;
}

const TODAY = () => (['', 'M', 'T', 'W', 'R', 'F', 'S'] as const)[new Date().getDay()];

export function WeekGrid({ secs, ghost = [], colors, clashIds, onSelect, compact, className, menu, onRemove }: {
  secs: Section[];
  ghost?: Section[];
  colors: Map<string, number>;
  clashIds: Set<string>;
  onSelect?: (s: Section) => void;
  compact?: boolean;
  className?: string;
  /** Right-click (long-press on touch) menu for a block. */
  menu?: (s: Section) => ReactNode;
  /** Delete or Backspace on a focused block. */
  onRemove?: (s: Section) => void;
}) {
  const ghosts = useMemo(() => ghost.filter((g) => !secs.some((s) => sid(s) === sid(g))), [ghost, secs]);
  const days = useMemo(() => {
    const used = daysUsed([...secs, ...ghosts]);
    return used.includes('S') ? [...WEEK, 'S' as Day] : WEEK;
  }, [secs, ghosts]);

  const blocks = useMemo(() => {
    const all = blocksFor(secs);
    const count = new Map<string, number>();
    const byDay = new Map<Day, Placed[]>();
    for (const d of days) {
      const placed = placeDay(all.filter((b) => b.day === d));
      for (const p of placed) {
        // Keyed per course and occurrence, so changing a section animates the block to its new slot.
        const n = (count.get(p.section.course) ?? 0) + 1;
        count.set(p.section.course, n);
        p.key = `${p.section.course}#${n}`;
      }
      byDay.set(d, placed);
    }
    return byDay;
  }, [secs, days]);
  const ghostBlocks = useMemo(() => blocksFor(ghosts), [ghosts]);
  // Previewing another section of a planned course: the planned one would be replaced, so it fades back.
  const replaced = useMemo(() => new Set(ghosts.map((g) => g.course)), [ghosts]);

  const span = useMemo(() => {
    const all = [...blocksFor(secs), ...ghostBlocks];
    const lo = Math.min(8 * 60, ...all.map((b) => b.start));
    const hi = Math.max(16 * 60, ...all.map((b) => b.end));
    return { from: Math.floor(lo / 60) * 60, to: Math.ceil(hi / 60) * 60 };
  }, [secs, ghostBlocks]);

  const hourH = compact ? 60 : 64;
  const ppm = hourH / 60;
  const hours = Array.from({ length: (span.to - span.from) / 60 }, (_, i) => span.from / 60 + i);
  const height = hours.length * hourH;
  const gutter = compact ? 34 : 44;
  const today = TODAY();

  const clashesAt = (g: Block) => secs.find((s) => s.course !== g.section.course && blocksFor([s]).some((a) => a.day === g.day && a.start < g.end && g.start < a.end));

  return (
    <div className={cn('select-none', className)}>
      <div className="flex" style={{ paddingLeft: gutter }}>
        {days.map((d) => (
          <div key={d} className={cn('flex-1 pb-2 text-center', d === today ? 'font-medium text-fg' : 'text-fg-3', compact ? 'text-2xs' : 'text-xs')}>
            {compact ? DAY_SHORT[d]!.slice(0, 1) : DAY_SHORT[d]}
          </div>
        ))}
      </div>
      <div className="relative flex" style={{ height }}>
        <div className="relative shrink-0" style={{ width: gutter }} aria-hidden>
          {hours.map((hr, i) => (
            <span key={hr} className={cn('num absolute text-2xs leading-none text-fg-3', compact ? 'right-1' : 'right-2.5', i === 0 ? 'translate-y-0' : '-translate-y-1/2')} style={{ top: i * hourH }}>
              {hr}:00
            </span>
          ))}
        </div>
        {/* Hour lines and day columns only: the blocks carry the colour. */}
        <div className="relative flex flex-1">
          {hours.map((hr, i) => (
            <div key={hr} className="pointer-events-none absolute inset-x-0 border-t border-line" style={{ top: i * hourH }} />
          ))}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-line" />
          {days.map((d) => (
            <div key={d} className="relative flex-1 border-l border-line">
              <AnimatePresence initial={false}>
                {(blocks.get(d) ?? []).map((b, _, all) => {
                  const ci = colors.get(b.section.course);
                  const c = colorVar(ci);
                  // Only the meetings that actually overlap are marked, not every meeting of the section.
                  const clash = clashIds.has(sid(b.section)) && all.some((o) => o !== b && o.section.course !== b.section.course && o.start < b.end && b.start < o.end);
                  const top = (b.start - span.from) * ppm;
                  const h = (b.end - b.start) * ppm;
                  const block = (
                    <motion.button
                      key={b.key}
                      layoutId={`blk-${b.key}`}
                      type="button"
                      onClick={() => onSelect?.(b.section)}
                      onKeyDown={(e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && onRemove) { e.preventDefault(); onRemove(b.section); } }}
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: replaced.has(b.section.course) ? 0.25 : 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                      aria-label={`${b.section.course} section ${b.section.sec}, ${DAY_SHORT[d]} ${hm(b.start)} to ${hm(b.end)}${clash ? ', clashes' : ''}`}
                      className={cn(
                        'absolute overflow-hidden text-left transition-[filter] hover:brightness-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg focus-visible:ring-offset-2 focus-visible:ring-offset-surface data-[state=open]:brightness-[0.9] dark:hover:brightness-110 dark:data-[state=open]:brightness-125',
                        compact ? 'rounded-[6px] px-1 py-1' : 'rounded-[9px] px-2 py-1.5',
                        clash && 'ring-2 ring-bad ring-offset-1 ring-offset-surface',
                      )}
                      style={{
                        top: top + 2,
                        height: Math.max(h - 4, 16),
                        left: `calc(${(b.lane / b.lanes) * 100}% + ${compact ? 2 : 3}px)`,
                        width: `calc(${100 / b.lanes}% - ${compact ? 4 : 6}px)`,
                        background: `rgb(var(${c}))`,
                        color: `rgb(var(${onVar(ci)}))`,
                      }}
                    >
                      {clash ? <span className="hatch absolute inset-0" aria-hidden /> : null}
                      {compact ? (
                        // Narrow columns: "BIOL" over "412", so the number is never the part that's cut off.
                        <span className="num relative block text-[9px] font-medium leading-[11px] tracking-tight">
                          {b.section.course.split(' ').map((part) => <span key={part} className="block truncate">{part}</span>)}
                        </span>
                      ) : (
                        <span className="num relative block truncate text-xs font-medium">{b.section.course}</span>
                      )}
                      {h > (compact ? 34 : 30) ? (
                        <span className={cn('num relative block truncate opacity-80', compact ? 'text-[9px] leading-[11px] tracking-tight' : 'text-2xs')}>
                          {b.section.sec}{compact ? '' : ` · ${hm(b.start)}`}{b.room ? `${compact ? ' ' : ' · '}${b.room}` : ''}
                        </span>
                      ) : null}
                    </motion.button>
                  );
                  return menu ? (
                    <CM.Root key={b.key} modal={false}>
                      <CM.Trigger asChild>{block}</CM.Trigger>
                      {menu(b.section)}
                    </CM.Root>
                  ) : <Fragment key={b.key}>{block}</Fragment>;
                })}
              </AnimatePresence>
              {ghostBlocks.filter((b) => b.day === d).map((b) => {
                const hit = clashesAt(b);
                const bad = !!hit;
                const h = (b.end - b.start) * ppm;
                return (
                  <motion.div
                    key={`g-${sid(b.section)}-${b.start}`}
                    initial={{ opacity: 0, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.12 }}
                    className={cn(
                      'pointer-events-none absolute z-10 overflow-hidden border-[1.5px] border-dashed bg-surface shadow-float',
                      compact ? 'inset-x-[2px] rounded-[6px] px-1 py-1' : 'inset-x-[3px] rounded-[9px] px-2 py-1.5',
                      bad ? 'border-bad' : 'border-fg-3',
                    )}
                    // Opaque surface, so the block underneath never shows through the text.
                    style={{ top: (b.start - span.from) * ppm + 2, height: Math.max(h - 4, 16) }}
                  >
                    <span className={cn('num block truncate font-medium', bad ? 'text-bad' : 'text-fg', compact ? 'text-[9px] leading-[11px] tracking-tight' : 'text-xs')}>
                      {b.section.course}{compact ? '' : ` ${b.section.sec}`}
                    </span>
                    {h > (compact ? 22 : 30) ? (
                      <span className={cn('num block truncate', bad ? 'text-bad/80' : 'text-fg-2', compact ? 'text-[9px] leading-[11px] tracking-tight' : 'text-2xs')}>
                        {hit ? `Clashes with ${hit.course}` : compact ? b.section.sec : hm(b.start)}{b.room && !bad ? ` · ${b.room}` : ''}
                      </span>
                    ) : null}
                  </motion.div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
