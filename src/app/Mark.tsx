import { cn } from '@/lib/utils';

/** App mark: a ruler of credits, three blocks earned and one still to go. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('shrink-0', className)} aria-hidden>
      <rect x="1" y="6" width="5.5" height="12" rx="1.25" className="fill-fg" />
      <rect x="8" y="6" width="5.5" height="12" rx="1.25" className="fill-fg" />
      <rect x="15" y="6" width="3" height="12" rx="1.25" className="fill-fg" />
      <rect x="20" y="6.75" width="3" height="10.5" rx="1" className="fill-none stroke-fg" strokeWidth="1.5" />
    </svg>
  );
}
