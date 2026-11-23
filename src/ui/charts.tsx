import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { motion as m, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

const EASE = [0.22, 1, 0.36, 1] as const;

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/* ---------- A line coloured by where it goes: rises in the palette's first ink, drops in its second ---------- */

export const RISE = 'rgb(var(--done-ink))';
export const DROP = 'rgb(var(--doing-ink))';
/** Colour of the step that ends at point i (the first point takes its next step's colour). */
export const stepColor = (vals: number[], i: number) => {
  const j = Math.max(1, i);
  return vals.length < 2 || vals[j]! >= vals[j - 1]! ? RISE : DROP;
};

/** A horizontal gradient with a hard stop at every point, so each step of the line keeps one colour. */
export function useStepStroke(xs: number[], vals: number[]) {
  const id = `step${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const x0 = xs[0] ?? 0, x1 = xs[xs.length - 1] ?? 0;
  if (xs.length < 2 || x1 <= x0) return { defs: null, stroke: RISE };
  const at = (x: number) => (x - x0) / (x1 - x0);
  const stops = xs.slice(1).flatMap((x, k) => {
    const c = stepColor(vals, k + 1);
    return [<stop key={`a${k}`} offset={at(xs[k]!)} style={{ stopColor: c }} />, <stop key={`b${k}`} offset={at(x)} style={{ stopColor: c }} />];
  });
  return {
    defs: <defs><linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x0} x2={x1} y1={0} y2={0}>{stops}</linearGradient></defs>,
    stroke: `url(#${id})`,
  };
}

/* ---------- Trend: one ink line, term bars in the palette, a y axis in the gutter ---------- */

export interface TrendPoint { label: string; value: number; bar?: number; detail?: string }

export function Trend({ points, min, max, guide, height = 180, format = (v: number) => v.toFixed(2), className, onActive }: {
  points: TrendPoint[];
  min: number;
  max: number;
  guide?: number;
  height?: number;
  format?: (v: number) => string;
  className?: string;
  /** The hovered or tapped point (null when none), so the card can show its value in place of a tooltip. */
  onActive?: (i: number | null) => void;
}) {
  const still = useReducedMotion();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const gutter = 32, padR = 8, padTop = 12, padBottom = 24;
  const h = height - padTop - padBottom;
  const plotW = Math.max(0, width - gutter - padR);
  const n = points.length;
  const step = n <= 1 ? 0 : plotW / (n - 1);
  const x = (i: number) => gutter + (n <= 1 ? plotW / 2 : i * step);
  const y = (v: number) => padTop + h - ((Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * h;
  const line = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.value)}`).join(' ');
  const active = hover ?? selected ?? n - 1;
  const every = Math.max(1, Math.ceil(56 / Math.max(1, step))); // a 10px mono label is about 32px wide
  const showLabel = (i: number) => i === active || ((i === 0 || i === n - 1 || i % every === 0) && Math.abs(i - active) * step >= 40);
  const ticks: number[] = [];
  for (let t = Math.ceil(min * 2) / 2; t <= max + 1e-9; t += 0.5) ticks.push(t);
  const ap = points[active];
  const barW = Math.min(14, Math.max(4, step * 0.35));
  const picked = hover ?? selected;
  const vals = points.map((p) => p.value);
  const step$ = useStepStroke(points.map((_, i) => x(i)), vals);
  useEffect(() => { onActive?.(picked); }, [picked, onActive]);

  const pointAt = (clientX: number, el: HTMLElement) => {
    const rel = clientX - el.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - rel) < Math.abs(x(best) - rel)) best = i;
    return best;
  };

  return (
    <div
      ref={ref}
      className={cn('relative touch-pan-y select-none', className)}
      style={{ height }}
      onPointerMove={(e) => setHover(pointAt(e.clientX, e.currentTarget))}
      onPointerDown={(e) => {
        const i = pointAt(e.clientX, e.currentTarget);
        setHover(i);
        setSelected(i);
      }}
      onPointerLeave={() => setHover(null)}
    >
      {width > 0 && n > 0 ? (
        <svg width={width} height={height} className="absolute inset-0 overflow-visible" role="group" aria-label="GPA trend by term">
          {step$.defs}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={gutter} x2={width - padR} y1={y(t)} y2={y(t)} className="stroke-fg/[0.06]" strokeWidth={1} />
              <text x={gutter - 8} y={y(t) + 3.5} textAnchor="end" className="num fill-fg-3 text-[10px]">{t.toFixed(1)}</text>
            </g>
          ))}
          {guide !== undefined ? (
            <line x1={gutter} x2={width - padR} y1={y(guide)} y2={y(guide)} strokeDasharray="2 4" className="stroke-fg-3" strokeWidth={1} />
          ) : null}
          {points.map((p, i) =>
            p.bar !== undefined ? (
              <m.rect
                key={`b${i}`} x={x(i) - barW / 2} width={barW} rx={3}
                initial={still ? false : { y: padTop + h, height: 0 }}
                animate={{ y: y(p.bar), height: Math.max(0, padTop + h - y(p.bar)) }}
                transition={{ duration: 0.6, ease: EASE, delay: still ? 0 : i * 0.03 }}
                className={cn('transition-[fill-opacity] duration-150 fill-done', i === active ? '[fill-opacity:0.85]' : '[fill-opacity:0.3]')}
              />
            ) : null,
          )}
          <m.path d={line} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" stroke={step$.stroke} initial={still ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: EASE }} />
          {ap && picked !== null ? <line x1={x(active)} x2={x(active)} y1={padTop} y2={padTop + h} className="stroke-fg/15" strokeWidth={1} /> : null}
          {ap ? <circle cx={x(active)} cy={y(ap.value)} r={4} stroke={stepColor(vals, active)} style={{ fill: picked !== null ? 'rgb(var(--surface))' : stepColor(vals, active) }} strokeWidth={1.75} /> : null}
          {points.map((p, i) => (
            <g
              key={`hit-${i}`}
              role="button"
              tabIndex={0}
              aria-label={`${p.label}: ${format(p.value)}${p.detail ? `, ${p.detail}` : ''}`}
              style={{ outline: 'none' }}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setSelected(i)}
              onFocus={() => setSelected(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(i); }
              }}
            >
              <rect x={x(i) - Math.max(14, step / 2)} y={padTop} width={Math.max(28, step)} height={h} fill="transparent" />
            </g>
          ))}
          {points.map((p, i) => !showLabel(i) ? null : (
            <text key={`t${i}`} x={x(i)} y={height - 6} textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'} className={cn('num text-[10px]', i === active ? 'fill-fg' : 'fill-fg-3')}>
              {p.label}
            </text>
          ))}
        </svg>
      ) : null}
      {ap && width > 0 && !onActive ? (
        <div
          className="num pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-md bg-surface px-2 py-1 text-xs shadow-float"
          style={{ left: Math.min(width - 60, Math.max(gutter + 40, x(active))), top: Math.max(0, y(ap.value) - 36) }}
        >
          {format(ap.value)}
          {ap.detail ? <span className="ml-2 text-fg-3">{ap.detail}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
