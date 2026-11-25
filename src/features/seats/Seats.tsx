import { Bell, BellOff, BellRing, ExternalLink, Share, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ScreenHeader } from '@/app/Shell';
import { go } from '@/lib/route';
import { pushSupport, seats, useSeats, useWatchPolling, type Watch } from '@/lib/seats';
import { cn } from '@/lib/utils';
import { useModel } from '@/state/model';
import { Button } from '@/ui/button';
import { Card, CardHead } from '@/ui/card';

const EMPOWER = 'https://mysis-fccollege.empower-xl.com/';

/** "just now", "3m ago", "2h ago". */
function ago(t: number | null, now: number) {
  if (!t) return 'not yet';
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}

/** Re-renders every 20 s so "checked 1m ago" keeps moving. */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(id); }, []);
  return now;
}

const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

function Notifications() {
  const push = useSeats((s) => s.push);
  const busy = useSeats((s) => s.busy);
  const has = useSeats((s) => s.watches.length > 0);
  const support = pushSupport();
  const on = () => void seats.enablePush().then(() => toast.success('Notifications on'), fail);

  let icon: ReactNode = <Bell />;
  let title: string;
  let text: ReactNode;
  let action: ReactNode = null;
  if (push === 'on' && support === 'ok') {
    icon = <BellRing />;
    title = 'Notifications are on';
    text = 'You’ll get one the moment a watched section opens. Alerts older than 10 minutes are dropped, not delivered late.';
    action = (
      <>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void seats.test().then(() => toast('Test sent', { description: 'It should arrive in a few seconds.' }), fail)}>Send a test</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void seats.disablePush().then(() => toast('Notifications off'), fail)}>Turn off</Button>
      </>
    );
  } else if (push === 'dead' && support === 'ok') {
    icon = <BellOff />;
    title = 'Notifications stopped on this device';
    text = 'The browser ended its notification subscription (notifications turned off, site data cleared, or the app reinstalled). Your watches are still here.';
    action = <Button size="sm" variant="primary" disabled={busy} onClick={on}>Turn back on</Button>;
  } else if (support === 'ios-install') {
    icon = <Share />;
    title = 'On iPhone, add this app to your Home Screen';
    text = (
      <>
        iOS only delivers notifications to installed web apps. In Safari tap <b className="font-medium text-fg">Share</b>, then <b className="font-medium text-fg">Add to Home Screen</b>,
        open the app from there and turn notifications on in its Seats tab. The installed app keeps its own watches, so add them there.
      </>
    );
  } else if (support === 'denied') {
    icon = <BellOff />;
    title = 'Notifications are blocked for this site';
    text = 'Allow them in your browser’s site settings, then come back. Until then this page shows your watches live.';
  } else if (support === 'unsupported') {
    icon = <BellOff />;
    title = 'This browser can’t show notifications';
    text = 'Keep this page open instead: counts update every minute.';
  } else {
    title = 'Turn on notifications';
    text = has ? 'Your watches are saved, but you’ll only see openings here until notifications are on.' : 'Get a notification the moment a watched section opens.';
    action = <Button size="sm" variant="primary" disabled={busy} onClick={on}><Bell />Turn on</Button>;
  }

  return (
    <Card className="p-5 md:p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[12px] bg-surface-2 text-fg-2 [&_svg]:size-[18px]">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-md font-medium">{title}</p>
          <p className="mt-1 text-sm text-fg-3">{text}</p>
          {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </div>
    </Card>
  );
}

function PollerLine({ now }: { now: number }) {
  const poller = useSeats((s) => s.poller);
  const lastOk = useSeats((s) => s.lastOk);
  const has = useSeats((s) => s.watches.length > 0);
  if (!has) return null;
  const [dot, text] =
    poller === 'blocked' ? ['bg-bad', 'Checks paused: FCCU’s server refused them. Trying again within the hour.']
    : poller === 'backoff' ? ['bg-warn', `FCCU’s server is having trouble, so checks are waiting a bit. Last good check ${ago(lastOk, now)}.`]
    : poller === 'starting' || !lastOk ? ['bg-fg-3', 'The first check runs within a minute.']
    : ['bg-good', `Checked every minute while registration is busy. Last check ${ago(lastOk, now)}.`];
  return (
    <p className="flex items-center gap-2 px-1 text-sm text-fg-3">
      <span className={cn('size-2 shrink-0 rounded-full', dot)} aria-hidden />
      {text}
    </p>
  );
}

function WatchRow({ w, title, now }: { w: Watch; title?: string; now: number }) {
  const busy = useSeats((s) => s.busy);
  const known = w.avail !== null && w.cap !== null && w.seen !== null && now - w.seen < 15 * 60_000;
  const open = known && w.avail! > 0;
  return (
    <li className="flex items-center gap-3 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-md">
          <span className="font-medium">{w.course} {w.sec}</span>
          {title ? <span className="text-fg-3"> · {title}</span> : null}
        </p>
        <p className={cn('num mt-0.5 text-sm', open ? 'text-good' : 'text-fg-3')}>
          {!known ? 'Waiting for the first check'
            : open ? `${w.avail} of ${w.cap} open · checked ${ago(w.seen, now)}`
            : `Full · 0 of ${w.cap} · checked ${ago(w.seen, now)}`}
        </p>
        <p className="mt-0.5 text-xs text-fg-3">
          {open && w.last_alert && now - w.last_alert < 60 * 60_000 ? `Opened ${ago(w.last_alert, now)}. Register before it goes.`
            : w.armed ? 'Alerts when a seat opens'
            : 'Open now. Alerts again if it fills and reopens.'}
        </p>
      </div>
      {open ? (
        <Button size="sm" variant="primary" asChild>
          <a href={EMPOWER} target="_blank" rel="noopener noreferrer">Empower<ExternalLink /></a>
        </Button>
      ) : null}
      <Button size="icon-sm" variant="ghost" aria-label={`Stop watching ${w.course} ${w.sec}`} disabled={busy} onClick={() => void seats.unwatch(w).catch(fail)}>
        <Trash2 />
      </Button>
    </li>
  );
}

export function SeatsScreen() {
  const m = useModel();
  const loaded = useSeats((s) => s.loaded);
  const watches = useSeats((s) => s.watches);
  const error = useSeats((s) => s.error);
  const now = useNow();
  useWatchPolling();

  const titleOf = (w: Watch) => (m && m.termEntry.id === w.term ? m.sections[w.course]?.[0]?.title : undefined);

  return (
    <>
      <ScreenHeader eyebrow="Seat alerts" title="Seats" />
      <div className="mx-auto flex max-w-[720px] flex-col gap-5">
        <Notifications />
        <PollerLine now={now} />
        <Card>
          <CardHead title="Watching" sub={watches.length ? `${watches.length} of 15 sections` : undefined} />
          <div className="px-5 pb-3 md:px-6">
            {!loaded ? <p className="py-6 text-sm text-fg-3">Loading…</p>
              : watches.length ? <ul className="divide-y divide-line">{watches.map((w) => <WatchRow key={`${w.term}|${w.course}|${w.sec}`} w={w} title={titleOf(w)} now={now} />)}</ul>
              : (
                <div className="py-6">
                  <p className="text-base">Nothing watched yet.</p>
                  <p className="mt-1 text-sm text-fg-3">In the planner, open a full section and tap <b className="font-medium text-fg-2">Alert me when a seat opens</b>.</p>
                  <Button className="mt-4" size="sm" variant="secondary" onClick={() => go('planner')}>Open the planner</Button>
                </div>
              )}
            {error ? <p className="pb-3 text-sm text-bad">{error}</p> : null}
          </div>
        </Card>
        <p className="px-1 text-xs leading-relaxed text-fg-3">
          Seat counts come from FCCU’s public course catalog. Only departments someone watches are checked, one request at a time,
          and checks slow down when the server is busy. Watches end after 45 days. Nothing here is linked to your name or transcript.
          {seats.hasDevice() ? <> <button type="button" className="underline decoration-line underline-offset-4 hover:text-fg" onClick={() => void seats.forget().then(() => toast('This device was forgotten'), fail)}>Forget this device</button></> : null}
        </p>
      </div>
    </>
  );
}
