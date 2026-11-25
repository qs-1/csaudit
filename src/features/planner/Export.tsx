import { useState } from 'react';
import { toast } from 'sonner';
import { encodePlan, icsFor, isUnscheduled, termStartGuess } from '@/engine';
import { plural } from '@/lib/utils';
import type { Model } from '@/state/model';
import { Button } from '@/ui/button';
import { DateField, Stepper } from '@/ui/controls';
import { Sheet } from '@/ui/sheet';
import type { PlanState } from './usePlan';

/**
 * A link that opens this timetable for anyone. The plan lives in the link; nothing is uploaded.
 * It carries every section on the timetable, not just the stored plan: that only holds changes to the transcript's
 * registration, so registered courses kept as they are would be missing from it.
 */
export function shareLink(p: PlanState): string {
  const sections = Object.fromEntries(p.chosen.map((s) => [s.course, s.sec]));
  return `${window.location.origin}${window.location.pathname}?plan=${encodePlan(p.termId, sections)}`;
}

export async function share(m: Model, p: PlanState) {
  const url = shareLink(p);
  // Phones get the system share sheet; elsewhere, or if it's dismissed with an error, the link is copied.
  if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: `${m.termEntry.label} timetable`, url }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  navigator.clipboard.writeText(url).then(
    () => toast.success('Link copied', { description: 'It opens this timetable. Nothing is uploaded; the plan is in the link.' }),
    () => toast.error('Copy failed'),
  );
}

const toInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Asks for the first day of classes and how long the term runs, then downloads an .ics of weekly classes. */
export function CalendarSheet({ m, p, open, onOpenChange }: { m: Model; p: PlanState; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [date, setDate] = useState(() => toInput(termStartGuess(p.termId)));
  const [weeks, setWeeks] = useState(15);
  const timed = p.chosen.filter((s) => !isUnscheduled(s));
  const untimed = p.chosen.length - timed.length;

  const download = () => {
    const [y, mo, d] = date.split('-').map(Number);
    if (!y || !mo || !d) { toast.error('Pick the first day of classes'); return; }
    const ics = icsFor(timed, new Date(y, mo - 1, d), weeks, `${m.termEntry.label} classes`);
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `fccu-${m.termEntry.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    onOpenChange(false);
    toast.success('Calendar file downloaded', { description: 'Open it to add your classes to Google Calendar, Outlook or your phone.' });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Add to calendar" side="center">
      <div className="flex flex-col gap-5 pt-1">
        <p className="text-sm text-fg-2">
          Every class as a weekly event with its room, {plural(timed.length, 'course')} in all.
          {untimed ? ` ${plural(untimed, 'course')} with no published time ${untimed === 1 ? 'is' : 'are'} left out.` : ''}
        </p>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg-2">First day of classes</span>
          <DateField label="First day of classes" value={date} onChange={setDate} />
          <span className="text-xs text-fg-3">A guess. Check FCCU's academic calendar.</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-fg-2">Weeks of classes</span>
          <Stepper label="Weeks of classes" value={weeks} min={1} max={20} onChange={setWeeks} />
        </div>
        <Button variant="primary" size="lg" disabled={!timed.length} onClick={download}>Download .ics</Button>
      </div>
    </Sheet>
  );
}
