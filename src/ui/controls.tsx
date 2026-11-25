import * as Menu from '@radix-ui/react-dropdown-menu';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Check, ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ---------- Segmented control with a sliding thumb ---------- */

export interface SegOption<T extends string> { value: T; label: ReactNode; aria?: string; marked?: boolean }

export function Segmented<T extends string>({ options, value, onChange, size = 'md', className, label, full }: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label: string;
  full?: boolean;
}) {
  const id = useId();
  return (
    // layoutRoot: measure the thumb against this control, not the page, so it slides sideways even when the
    // control sits in a fixed panel or the page scrolled since the last change.
    <motion.div layoutRoot role="radiogroup" aria-label={label} className={cn('inline-flex rounded-[10px] bg-surface-2 p-0.5', full && 'flex w-full', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.aria}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative isolate inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors duration-150',
              size === 'sm' ? 'h-7 px-2.5 text-sm' : size === 'lg' ? 'h-10 px-4 text-md' : 'h-8 px-3.5 text-base',
              full && 'flex-1 px-1',
              on ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
            )}
          >
            {on ? (
              <motion.span layoutId={id} className="absolute inset-0 -z-10 rounded-lg bg-surface shadow-card dark:bg-surface-3 dark:shadow-none" transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} />
            ) : null}
            {o.label}
            {o.marked ? <span className="absolute inset-x-3 bottom-1 h-px bg-fg-3/60" aria-hidden /> : null}
          </button>
        );
      })}
    </motion.div>
  );
}

/* ---------- Switch ---------- */

export function Switch({ checked, onChange, label, id, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; label?: string; id?: string; size?: 'sm' | 'md' }) {
  const sm = size === 'sm';
  return (
    <SwitchPrimitive.Root
      id={id}
      aria-label={label}
      checked={checked}
      onCheckedChange={onChange}
      className={cn('relative inline-flex shrink-0 items-center rounded-full bg-surface-3 p-0.5 transition-colors duration-200 data-[state=checked]:bg-fg', sm ? 'h-5 w-8' : 'h-[26px] w-[44px] p-[3px]')}
    >
      <SwitchPrimitive.Thumb className={cn('block rounded-full bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-transform duration-200 ease-out dark:bg-bg', sm ? 'size-4 data-[state=checked]:translate-x-3' : 'size-5 data-[state=checked]:translate-x-[18px]')} />
    </SwitchPrimitive.Root>
  );
}

export function SwitchRow({ title, sub, checked, onChange }: { title: ReactNode; sub?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-2">
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block text-base">{title}</span>
        {sub ? <span className="block text-sm text-fg-3">{sub}</span> : null}
      </label>
      <Switch id={id} checked={checked} onChange={onChange} />
    </div>
  );
}

/* ---------- Slider ---------- */

export function Slider({ value, onChange, min, max, step, label, className }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step: number; label: string; className?: string;
}) {
  return (
    <SliderPrimitive.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onChange(v[0]!)}
      className={cn('relative flex h-8 w-full touch-none select-none items-center', className)}
    >
      <SliderPrimitive.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-3">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-fg" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb aria-label={label} className="block size-5 rounded-full border border-line bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.15)] transition-transform active:scale-95" />
    </SliderPrimitive.Root>
  );
}

/* ---------- Chip (toggle) ---------- */

export function Chip({ on, onClick, children, className, count }: { on: boolean; onClick: () => void; children: ReactNode; className?: string; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm transition-colors duration-150 press',
        on ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-fg-2 hover:bg-surface-3 hover:text-fg',
        className,
      )}
    >
      {children}
      {count !== undefined ? <span className={cn('num text-xs', on ? 'opacity-70' : 'text-fg-3')}>{count}</span> : null}
    </button>
  );
}

/* ---------- Text input ---------- */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-10 w-full rounded-lg border border-line bg-surface px-3 text-base text-fg outline-none transition-shadow placeholder:text-fg-3 focus:border-fg-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-info/15',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

/* ---------- Stepper ---------- */

export function Stepper({ value, onChange, min, max, step = 1, label, suffix }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label: string; suffix?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="inline-flex h-9 items-center rounded-[10px] bg-surface-2" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - step))} className="grid size-9 place-items-center rounded-lg text-lg text-fg-2 hover:text-fg disabled:opacity-30">−</button>
      <span className="num min-w-[3.5ch] text-center text-base font-medium" aria-live="polite">{value}{suffix}</span>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + step))} className="grid size-9 place-items-center rounded-lg text-lg text-fg-2 hover:text-fg disabled:opacity-30">+</button>
    </div>
  );
}

/* ---------- Select: a menu styled like the rest, instead of the browser's own ---------- */

export function Select<T extends string>({ value, options, onChange, label, className }: {
  value: T;
  options: { value: T; label: ReactNode; detail?: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label={label}
        className={cn(
          'inline-flex h-10 min-w-0 items-center justify-between gap-2 rounded-[12px] bg-surface-2 pl-3 pr-2.5 text-left text-base text-fg outline-none transition-colors hover:bg-surface-3 focus-visible:shadow-[inset_0_0_0_1.5px_rgb(var(--fg)/0.4)] data-[state=open]:bg-surface-3',
          className,
        )}
      >
        <span className="min-w-0 truncate">{current?.label ?? label}</span>
        <ChevronDown className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-[60] max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-xl bg-surface p-1 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
        >
          {options.map((o) => (
            <Menu.Item
              key={o.value}
              onSelect={() => onChange(o.value)}
              className="flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-base outline-none data-[highlighted]:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block">{o.label}</span>
                {o.detail ? <span className="block text-sm text-fg-3">{o.detail}</span> : null}
              </span>
              {o.value === value ? <Check className="size-4 shrink-0" strokeWidth={2} /> : <span className="size-4 shrink-0" />}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/* ---------- Date: shown as MM/DD/YYYY, picked on a month calendar that opens under it ---------- */

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** `value` and `onChange` use "YYYY-MM-DD". */
export function DateField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [y0, m0, d0] = value.split('-').map(Number) as [number, number, number];
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: y0, m: m0 - 1 });
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const move = (k: number) => setView(({ y, m }) => ({ y: y + Math.floor((m + k) / 12), m: (((m + k) % 12) + 12) % 12 }));
  const nav = 'grid size-8 place-items-center rounded-lg text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg';
  return (
    <div>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => { setOpen(!open); setView({ y: y0, m: m0 - 1 }); }}
        className="press flex h-10 w-full items-center justify-between rounded-[12px] bg-surface-2 px-3 text-base text-fg outline-none transition-colors hover:bg-surface-3 focus-visible:shadow-[inset_0_0_0_1.5px_rgb(var(--fg)/0.4)]"
      >
        <span className="num">{value ? `${pad2(m0)}/${pad2(d0)}/${y0}` : 'MM/DD/YYYY'}</span>
        <ChevronDown className={cn('size-4 text-fg-3 transition-transform duration-200', open && 'rotate-180')} strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="mt-2 rounded-[14px] bg-surface-2/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => move(-1)} className={nav}><ChevronDown className="size-4 rotate-90" strokeWidth={1.75} /></button>
            <span className="text-base font-medium">{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
            <button type="button" aria-label="Next month" onClick={() => move(1)} className={nav}><ChevronDown className="size-4 -rotate-90" strokeWidth={1.75} /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((d, i) => <span key={i} className="py-1 text-xs text-fg-3">{d}</span>)}
            {Array.from({ length: lead }, (_, i) => <span key={`e${i}`} />)}
            {Array.from({ length: days }, (_, i) => {
              const iso = isoOf(view.y, view.m, i + 1);
              const on = iso === value;
              return (
                <button
                  key={iso}
                  type="button"
                  aria-pressed={on}
                  aria-label={new Date(view.y, view.m, i + 1).toDateString()}
                  onClick={() => { onChange(iso); setOpen(false); }}
                  className={cn('num grid h-9 place-items-center rounded-lg text-sm transition-colors', on ? 'bg-fg text-bg' : 'text-fg hover:bg-surface-3')}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
