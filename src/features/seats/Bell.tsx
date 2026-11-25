import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { hasSeats, type Section } from '@/engine';
import { go } from '@/lib/route';
import { isWatching, seats, useSeats } from '@/lib/seats';
import { cn } from '@/lib/utils';

type Sec = Pick<Section, 'course' | 'sec' | 'avail' | 'cap'>;

/** Only a full section can be watched: one with seats is registered for, not waited on. A watch stays removable. */
export function useCanWatch(term: string | undefined, s: Sec) {
  const on = useSeats((x) => !!term && isWatching(x.watches, term, s.course, s.sec));
  return !!term && (on || !hasSeats(s));
}

/** Adds or removes a section. Without notifications on, adding also opens Seats, where they're set up. */
export function toggleWatch(term: string, s: Sec) {
  const { watches, push } = useSeats.getState();
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));
  if (isWatching(watches, term, s.course, s.sec)) { seats.unwatch({ term, course: s.course, sec: s.sec }).catch(fail); return; }
  if (hasSeats(s)) { toast(`${s.course} ${s.sec} has seats. Register on Empower.`); return; }
  seats.watch(term, s.course, s.sec, s.avail).catch(fail);
  if (push !== 'on') go('seats');
}

/** The bell for a full section, or for one already watched. Nothing for a section with seats. */
export function WatchBell({ term, s, className }: { term: string; s: Sec; className?: string }) {
  const on = useSeats((x) => isWatching(x.watches, term, s.course, s.sec));
  if (!on && hasSeats(s)) return null;
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
