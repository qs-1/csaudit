import { ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card bg-surface shadow-soft', className)} {...props} />;
}

export function CardHead({ title, sub, action, className }: { title: ReactNode; sub?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-6 md:px-6 md:pt-6', className)}>
      <div className="min-w-0">
        <h2 className="display truncate text-[19px] leading-7 md:text-[21px]">{title}</h2>
        {sub ? <p className="mt-0.5 min-w-0 text-sm text-fg-3">{sub}</p> : null}
      </div>
      {action ? <div className="-mt-0.5 flex shrink-0 items-center gap-1 pt-0.5">{action}</div> : null}
    </div>
  );
}

/** Quiet "see more" link like a section header action. */
export function HeadLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="-mr-1 inline-flex h-8 items-center gap-0.5 rounded-md px-1 text-sm text-fg-3 transition-colors hover:text-fg">
      {children}
      <ChevronRight className="size-4" strokeWidth={1.5} />
    </button>
  );
}

/** Small section label: sentence case, muted. */
export function Label({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-fg-3', className)} {...props} />;
}

export function Code({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('num whitespace-nowrap text-[0.92em]', className)}>{children}</span>;
}

/** Status as coloured text. No background, so it never competes with the content. */
export function Pill({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm', TEXT[tone], className)}>{children}</span>;
}

export type Tone = 'neutral' | 'good' | 'info' | 'warn' | 'bad' | 'solid';
export const TEXT: Record<Tone, string> = {
  neutral: 'text-fg-3', good: 'text-good', info: 'text-info', warn: 'text-warn', bad: 'text-bad', solid: 'text-fg',
};
export function Empty({ title, children, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <p className="display text-[17px] leading-6">{title}</p>
      {children ? <div className="max-w-xs text-sm text-fg-3">{children}</div> : null}
    </div>
  );
}
