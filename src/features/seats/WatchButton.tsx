import { Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { hasSeats, type Section } from '@/engine';
import { go } from '@/lib/route';
import { pushSupport, seats, useSeats } from '@/lib/seats';
import { Button } from '@/ui/button';

/** "Alert me" for one section, in the section panel. Watching works without notifications; they're offered after. */
export function WatchButton({ term, s }: { term: string; s: Section }) {
  const watching = useSeats((x) => x.watches.some((w) => w.term === term && w.course === s.course && w.sec === s.sec));
  const push = useSeats((x) => x.push);
  const busy = useSeats((x) => x.busy);
  const full = !hasSeats(s);

  if (watching) {
    return (
      <Button variant="quiet" className="w-full" disabled={busy} onClick={() => void seats.unwatch({ term, course: s.course, sec: s.sec }).then(() => toast(`Stopped watching ${s.course} ${s.sec}`), () => {})}>
        <BellOff />
        Stop alerts for this section
      </Button>
    );
  }

  const add = async () => {
    try {
      await seats.watch(term, s.course, s.sec, s.avail);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Couldn’t add the alert');
      return;
    }
    const what = full ? 'when a seat opens' : 'if it fills and a seat opens again';
    const support = pushSupport();
    if (push === 'on') toast.success(`Watching ${s.course} ${s.sec}`, { description: `You’ll get a notification ${what}.` });
    else if (support === 'ok') {
      toast.success(`Watching ${s.course} ${s.sec}`, {
        description: `Turn on notifications to hear ${what}.`,
        action: { label: 'Turn on', onClick: () => void seats.enablePush().then(() => toast.success('Notifications on'), (e: Error) => toast.error(e.message)) },
        duration: 10_000,
      });
    } else {
      toast.success(`Watching ${s.course} ${s.sec}`, {
        description: support === 'ios-install' ? 'On iPhone, alerts need the app on your Home Screen. The Seats tab shows how.' : 'The Seats tab shows it live.',
        action: { label: 'Open Seats', onClick: () => go('seats') },
      });
    }
  };

  return (
    <Button variant={full ? 'primary' : 'secondary'} className="w-full" disabled={busy} onClick={() => void add()}>
      <Bell />
      {full ? 'Alert me when a seat opens' : 'Alert me if it fills, then opens'}
    </Button>
  );
}
