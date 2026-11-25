import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import type { Section } from '@/engine';
import { go } from '@/lib/route';
import { isWatching, seats, useSeats } from '@/lib/seats';
import { cn } from '@/lib/utils';

/** Adds or removes a section. Without notifications on, adding also opens Seats, where they're set up. */
export function toggleWatch(term: string, s: Pick<Section, 'course' | 'sec' | 'avail'>) {
  const { watches, push } = useSeats.getState();
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
  if (isWatching(watches, term, s.course, s.sec)) { seats.unwatch({ term, course: s.course, sec: s.sec }).catch(fail); return; }
  seats.watch(term, s.course, s.sec, s.avail).catch(fail);
  if (push !== 'on') go('seats');
}

export function WatchBell({ term, s, className }: { term: string; s: Pick<Section, 'course' | 'sec' | 'avail'>; className?: string }) {
  const on = useSeats((x) => isWatching(x.watches, term, s.course, s.sec));
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${on ? 'Stop watching' : 'Watch'} ${s.course} ${s.sec}`}
      onClick={(e) => { e.stopPropagation(); toggleWatch(term, s); }}
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-[9px] transition-colors hover:bg-fg/[0.06] active:scale-[0.94]',
        on ? 'text-fg' : 'text-fg-3 hover:text-fg',
        className,
      )}
    >
      <Bell className="size-4" strokeWidth={1.75} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}
