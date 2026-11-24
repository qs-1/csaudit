import { CalendarPlus, Check, ChevronDown, Copy, Download, Link2, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { ScreenHeader } from '@/app/Shell';
import { blocksFor, DAY_SHORT, daysUsed, hm, type Block, type Day, type Section } from '@/engine';
import { TERMS } from '@/data/registry';
import { useHotkey, useIsMobile } from '@/lib/hooks';
import { currentHex } from '@/lib/palette';
import { cn, plural, updated } from '@/lib/utils';
import { useModel, type Model } from '@/state/model';
import { actions } from '@/state/store';
import { ui, useUI } from '@/state/ui';
import { Button } from '@/ui/button';
import { Card, Empty } from '@/ui/card';
import { Segmented } from '@/ui/controls';
import { Sheet } from '@/ui/sheet';
import { CourseSearch } from './CourseSearch';
import { CalendarSheet, share } from './Export';
import { BlockMenu, DayAgenda, PlanAlerts, removeWithUndo, SectionSheet, TermCard } from './parts';
import { Suggest } from './Suggest';
import { usePlan, usePreview, type PlanState } from './usePlan';
import { WeekGrid } from './WeekGrid';

export function Planner() {
  const m = useModel();
  const mobile = useIsMobile();
  if (!m) return null;
  if (m.termFailed) {
    return (
      <>
        <ScreenHeader title="Planner" />
        <Card><Empty title="Section list didn't load">Reload the page to try again.</Empty></Card>
      </>
    );
  }
  return mobile ? <MobilePlanner m={m} /> : <DesktopPlanner m={m} />;
}

function usePlanActions(p: PlanState) {
  const copy = () => {
    const text = p.chosen.map((s) => `${s.course} ${s.sec}`).join('\n');
    navigator.clipboard.writeText(text).then(() => toast.success('Copied course list'), () => toast.error('Copy failed'));
  };
  const clear = () => {
    const prev = { ...p.plan };
    actions.replacePlan(p.termId, {});
    toast('Plan cleared', { action: { label: 'Undo', onClick: () => actions.replacePlan(p.termId, prev) } });
  };
  return { copy, clear };
}

interface ExportBlock extends Block { lane: number; lanes: number }

function placeForExport(blocks: Block[]): ExportBlock[] {
  const out: ExportBlock[] = [];
  let cluster: ExportBlock[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((b) => b.lane + 1));
    cluster.forEach((b) => { b.lanes = lanes; });
    cluster = [];
  };
  for (const block of [...blocks].sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (block.start >= clusterEnd) { flush(); clusterEnd = -1; }
    const ends: number[] = [];
    cluster.forEach((b) => { ends[b.lane] = Math.max(ends[b.lane] ?? 0, b.end); });
    let lane = ends.findIndex((end) => end <= block.start);
    if (lane < 0) lane = ends.length;
    const placed: ExportBlock = { ...block, lane, lanes: 1 };
    cluster.push(placed);
    out.push(placed);
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  flush();
  return out;
}

function downloadTimetable(m: Model, p: PlanState) {
  const source = blocksFor(p.chosen);
  if (!source.length) return;
  const days = (daysUsed(p.chosen).includes('S') ? ['M', 'T', 'W', 'R', 'F', 'S'] : ['M', 'T', 'W', 'R', 'F']) as Day[];
  const from = Math.floor(Math.min(8 * 60, ...source.map((b) => b.start)) / 60) * 60;
  const to = Math.ceil(Math.max(16 * 60, ...source.map((b) => b.end)) / 60) * 60;
  const dark = document.documentElement.classList.contains('dark');
  const width = 2160, gutter = 160, right = 56, header = 70, hourH = 132, footer = 54;
  const height = header + ((to - from) / 60) * hourH + footer;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dayW = (width - gutter - right) / days.length;
  const gridTop = header;
  // Same palette as the app, solid blocks with text that reads on each colour.
  const { fill: colours, ink } = currentHex(dark);
  const bg = dark ? '#1a1a1c' : '#ffffff';
  const muted = dark ? '#85858b' : '#707070';
  const line = dark ? '#2a2a2d' : '#e4e4e1';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.fillStyle = muted;
  ctx.font = '600 24px Geist, system-ui, sans-serif';
  days.forEach((day, i) => ctx.fillText(DAY_SHORT[day]!, gutter + dayW * (i + 0.5), 34));
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  for (let t = from; t <= to; t += 30) {
    const y = gridTop + ((t - from) / 60) * hourH;
    ctx.setLineDash(t % 60 ? [5, 7] : []);
    ctx.beginPath(); ctx.moveTo(gutter, y); ctx.lineTo(width - right, y); ctx.stroke();
    if (t < to) {
      // Every half hour, as in the app; the half hours a little quieter.
      const half = t % 60 !== 0;
      ctx.fillStyle = muted; ctx.globalAlpha = half ? 0.6 : 1; ctx.font = `400 ${half ? 20 : 23}px JetBrains Mono, monospace`;
      ctx.textAlign = 'right'; ctx.fillText(`${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, gutter - 18, y + (t === from ? 24 : 8));
      ctx.globalAlpha = 1;
    }
  }
  ctx.setLineDash([]);
  days.forEach((_, i) => {
    const x = gutter + i * dayW;
    ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(x, gridTop); ctx.lineTo(x, height - footer); ctx.stroke();
  });
  ctx.beginPath(); ctx.moveTo(width - right, gridTop); ctx.lineTo(width - right, height - footer); ctx.stroke();
  days.forEach((day, di) => {
    placeForExport(source.filter((b) => b.day === day)).forEach((b) => {
      const ci = p.colors.get(b.section.course) ?? 0;
      const color = colours[ci]!;
      const x = gutter + di * dayW + (b.lane / b.lanes) * dayW + 8;
      const w = dayW / b.lanes - 16;
      const y = gridTop + ((b.start - from) / 60) * hourH + 5;
      const h = Math.max(32, ((b.end - b.start) / 60) * hourH - 10);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 16); ctx.fill();
      ctx.textAlign = 'left'; ctx.fillStyle = ink[ci]!;
      ctx.font = '600 24px JetBrains Mono, monospace'; ctx.fillText(b.section.course, x + 14, y + 33);
      if (h >= 68) { ctx.font = '400 22px Geist, system-ui, sans-serif'; ctx.fillText(`${b.section.sec} · ${hm(b.start)}${b.room ? ` · ${b.room}` : ''}`, x + 14, y + 61); }
    });
  });
  ctx.fillStyle = muted; ctx.font = '400 22px Geist, system-ui, sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(m.termEntry.label, width - right, height - 20);
  canvas.toBlob((blob) => {
    if (!blob) { toast.error('Could not create timetable image'); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fccu-${m.termEntry.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-timetable.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast.success('Timetable downloaded');
  }, 'image/png');
}

/** When the catalog sync last ran, from public/sync.json (rewritten by every sync, so it isn't bundled). */
function useChecked() {
  const [checked, setChecked] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch('/sync.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { checked?: string } | null) => { if (live && typeof j?.checked === 'string') setChecked(j.checked); })
      .catch(() => {});
    const id = setInterval(() => tick((n) => n + 1), 60_000); // keep "12m ago" moving
    return () => { live = false; clearInterval(id); };
  }, []);
  return checked;
}

/** Exact local date and time, e.g. "Nov 23, 2:07 PM". */
const stamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};

/** The planning term. A menu once there's more than one term to plan. */
function TermPicker({ m }: { m: Model }) {
  if (TERMS.length < 2) return <>{m.termEntry.label}</>;
  return (
    <Menu.Root>
      <Menu.Trigger className="-mx-1 inline-flex items-center gap-0.5 rounded-md px-1 text-fg-2 transition-colors hover:text-fg data-[state=open]:text-fg">
        {m.termEntry.label}
        <ChevronDown className="size-3.5" strokeWidth={1.75} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={6} className="z-50 min-w-[180px] rounded-xl bg-surface p-1 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
          <Menu.RadioGroup value={m.termEntry.id} onValueChange={actions.setTerm}>
            {[...TERMS].reverse().map((t) => (
              <Menu.RadioItem key={t.id} value={t.id} className="flex h-9 items-center justify-between gap-3 rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-surface-2">
                {t.label}
                <Menu.ItemIndicator><Check className="size-4 text-fg-2" strokeWidth={1.75} /></Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** "12m ago", "5h ago", else "Nov 23": short enough to stay on one line on a phone. */
const ago = (iso: string) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 2) return 'just now';
  if (min < 60) return `${min}m ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function Eyebrow({ m }: { m: Model }) {
  const checked = useChecked();
  const mobile = useIsMobile();
  if (!m.term) return <TermPicker m={m} />;
  // "checked" is when the GitHub Action last pulled FCCU's catalog; asOf is when the sections last changed.
  const pulled = checked && Date.parse(checked) >= Date.parse(m.term.asOf) ? checked : m.term.asOf;
  return (
    <span className="whitespace-nowrap">
      <TermPicker m={m} />
      <span className="text-fg-3" title={`Pulled from FCCU's course catalog ${updated(pulled, Date.now(), '').trim()}. Sections last changed ${stamp(m.term.asOf)}.`}>
        {' '}· {mobile ? `pulled ${ago(pulled)}` : `last pulled ${stamp(pulled)}`}
      </span>
    </span>
  );
}

/* ---------- Desktop: search on the left, week on the right ---------- */

function DesktopPlanner({ m }: { m: Model }) {
  const p = usePlan(m);
  const ghost = usePreview((s) => s.secs);
  const [suggest, setSuggest] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { copy, clear } = usePlanActions(p);
  const download = () => downloadTimetable(m, p);
  useHotkey('/', useCallback((e: KeyboardEvent) => { e.preventDefault(); searchRef.current?.focus(); }, []));
  useHotkey('mod+k', useCallback((e: KeyboardEvent) => { e.preventDefault(); searchRef.current?.focus(); }, []));

  return (
    <>
      <ScreenHeader
        eyebrow={<Eyebrow m={m} />}
        title="Planner"
        actions={
          <>
            <PlanMenu m={m} p={p} download={download} copy={copy} clear={clear} calendar={() => setCalendar(true)} />
            <Button variant="primary" onClick={() => setSuggest(true)}>Suggest timetables</Button>
          </>
        }
      />
      {/* Two columns once there's room; on tablets search sits above the plan. */}
      <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)]">
        {/* Fits below the page header without scrolling; stays put once the page scrolls. */}
        <Card className="flex h-[480px] flex-col p-5 lg:sticky lg:top-6 lg:h-[calc(100dvh-152px)] lg:min-h-[440px]">
          <CourseSearch ref={searchRef} m={m} p={p} className="flex-1" />
        </Card>
        <div className="flex min-w-0 flex-col gap-5">
          <SharedBar m={m} p={p} />
          <TermCard m={m} p={p} onOpen={() => searchRef.current?.focus()} />
          <PlanAlerts m={m} p={p} />
          <Card className="relative px-5 pb-5 pt-4 md:px-6">
            <div className="mb-3 flex items-center justify-end gap-1 text-sm text-fg-3">
              <span className="mr-1">{plural(p.chosen.length, 'course')}</span>
              <GridTools m={m} p={p} download={download} />
            </div>
            <PlanGrid m={m} p={p} ghost={ghost} />
            {!p.chosen.length && !ghost.length ? (
              <div className="pointer-events-none absolute inset-0 grid place-items-center p-8">
                <div className="max-w-[300px] rounded-[16px] bg-surface/90 px-5 py-4 text-center shadow-float backdrop-blur-sm">
                  <p className="display text-[17px]">Your week shows up here</p>
                  <p className="mt-1 text-sm text-fg-3">{m.bare ? 'Search for a course on the left and pick a section. Hover a section to preview it first.' : 'Pick sections on the left, or let Suggest timetables build a week from what you still need.'}</p>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      </div>
      <SectionSheet m={m} p={p} />
      <Suggest m={m} p={p} open={suggest} onOpenChange={setSuggest} />
      <CalendarSheet m={m} p={p} open={calendar} onOpenChange={setCalendar} />
    </>
  );
}

function PlanGrid({ m, p, ghost, compact }: { m: Model; p: PlanState; ghost: Section[]; compact?: boolean }) {
  return (
    <WeekGrid
      secs={p.chosen}
      ghost={ghost}
      colors={p.colors}
      clashIds={p.clashIds}
      onSelect={ui.select}
      compact={compact}
      menu={(s) => <BlockMenu m={m} p={p} s={s} onDetails={ui.select} />}
      onRemove={(s) => removeWithUndo(p, s)}
    />
  );
}

/* ---------- Phone: agenda by day, search in a drawer ---------- */

type View = 'day' | 'week';
const todayKey = () => ['S', 'M', 'T', 'W', 'R', 'F', 'S'][new Date().getDay()]!;

function MobilePlanner({ m }: { m: Model }) {
  const p = usePlan(m);
  const intent = useUI((s) => s.intent);
  const [search, setSearch] = useState(false);
  const [typing, setTyping] = useState(false); // opened from the search bar: bring up the keyboard
  const [suggest, setSuggest] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [view, setView] = useState<View>('week');
  const used = daysUsed(p.chosen);
  const days = used.includes('S') ? ['M', 'T', 'W', 'R', 'F', 'S'] : ['M', 'T', 'W', 'R', 'F'];
  const [day, setDay] = useState(() => (days.includes(todayKey()) ? todayKey() : 'M'));
  const { copy, clear } = usePlanActions(p);
  const download = () => downloadTimetable(m, p);

  useEffect(() => { if (intent) setSearch(true); }, [intent]);
  useEffect(() => { setView('week'); }, []);

  return (
    <>
      <ScreenHeader
        eyebrow={<Eyebrow m={m} />}
        title="Planner"
        mobileActions={
          <Menu.Root>
            <Menu.Trigger asChild>
              <button type="button" aria-label="More" className="grid size-10 place-items-center rounded-[12px] bg-surface text-fg-2 shadow-soft active:scale-[0.97]">
                <MoreHorizontal className="size-[18px]" strokeWidth={1.75} />
              </button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content align="end" sideOffset={8} className="z-50 min-w-[200px] rounded-xl bg-surface p-1 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
                <MenuItem onSelect={() => setSuggest(true)}>Suggest timetables</MenuItem>
                <MenuItem onSelect={() => share(m, p)} disabled={!p.chosen.length}>Share timetable</MenuItem>
                <MenuItem onSelect={() => setCalendar(true)} disabled={!p.chosen.length}>Add to calendar</MenuItem>
                <MenuItem onSelect={download} disabled={!p.chosen.length}>Download image</MenuItem>
                <MenuItem onSelect={copy} disabled={!p.chosen.length}>Copy course list</MenuItem>
                <MenuItem onSelect={clear} disabled={!p.chosen.length} danger>Clear plan</MenuItem>
                {m.bare ? <MenuItem onSelect={actions.addTranscript}>Add transcript</MenuItem> : null}
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        }
      />

      <div className="flex flex-col gap-4">
        <SharedBar m={m} p={p} />
        <TermCard m={m} p={p} onOpen={() => setSearch(true)} />

        <PlanAlerts m={m} p={p} />

        {p.chosen.length ? (
          <Card className="px-3 pb-4 pt-4">
            <div className="mb-4 flex items-center justify-between gap-2 px-1">
              <Segmented<View>
                label="View"
                size="sm"
                value={view}
                onChange={setView}
                options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]}
              />
              <div className="flex items-center gap-1 text-sm text-fg-3">
                <span className="mr-1">{plural(p.chosen.length, 'course')}</span>
                <GridTools m={m} p={p} download={download} />
              </div>
            </div>
            {view === 'day' ? (
                <div key="day" className="animate-rise">
                  <Segmented
                    label="Day"
                    full
                    value={day}
                    onChange={setDay}
                    options={days.map((d) => ({ value: d, label: DAY_SHORT[d]!.slice(0, 3), marked: used.includes(d as never) && d !== day }))}
                  />
                  <div className="mt-3">
                    <DayAgenda m={m} p={p} day={day} onSelect={ui.select} />
                  </div>
                </div>
              ) : (
                <div key="week" className="animate-rise">
                  <PlanGrid m={m} p={p} ghost={[]} compact />
                </div>
              )}
          </Card>
        ) : null}
        {p.chosen.length ? null : (
          <Card>
            <Empty title="Nothing planned yet">
              {m.bare ? (
                <div className="mt-2 flex flex-col gap-2">
                  <p className="mb-2">Find a course, pick a section, and it lands on your week. Clashes are flagged as you go.</p>
                  <Button variant="primary" size="lg" onClick={() => setSearch(true)}>Browse courses</Button>
                  <button type="button" onClick={actions.addTranscript} className="mt-1 text-sm text-fg-3 underline decoration-line underline-offset-4">Add a transcript to see what you still need</button>
                </div>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  <p className="mb-2">Let it build clash-free weeks from what you still need, or pick sections yourself.</p>
                  <Button variant="primary" size="lg" onClick={() => setSuggest(true)}>Suggest timetables</Button>
                  <Button variant="secondary" size="lg" onClick={() => setSearch(true)}>Browse courses</Button>
                </div>
              )}
            </Empty>
          </Card>
        )}
        <div className="h-12" aria-hidden />
      </div>

      {/* Search bar that sits above the tab bar. Portalled so page transitions can't offset it. */}
      {createPortal(
        <button
          type="button"
          onClick={() => { setTyping(true); setSearch(true); }}
          aria-label="Search courses"
          className="fixed right-4 z-30 flex h-11 items-center gap-2 rounded-full bg-fg pl-3.5 pr-4 text-base font-medium text-bg shadow-[0_8px_24px_-6px_rgb(0_0_0/0.35)] transition-transform active:scale-[0.96]"
          style={{ bottom: 'calc(78px + var(--safe-b))' }}
        >
          <Search className="size-[18px]" strokeWidth={2} />
          Courses
        </button>,
        document.body,
      )}

      <Sheet open={search} onOpenChange={(o) => { setSearch(o); if (!o) setTyping(false); }} autoFocus={typing} title="Courses" tall hideTitle className="flex flex-col pt-2">
        <CourseSearch m={m} p={p} touch className="flex-1" />
      </Sheet>
      <SectionSheet m={m} p={p} />
      <Suggest m={m} p={p} open={suggest} onOpenChange={setSuggest} />
      <CalendarSheet m={m} p={p} open={calendar} onOpenChange={setCalendar} />
    </>
  );
}

/** Small icon buttons over the timetable: copy a share link, download it as an image. */
function GridTools({ m, p, download }: { m: Model; p: PlanState; download: () => void }) {
  const none = !p.chosen.length;
  const tool = 'grid size-8 place-items-center rounded-md text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40';
  return (
    <>
      <button type="button" aria-label="Copy share link" title="Copy share link" disabled={none} onClick={() => share(m, p)} className={tool}>
        <Link2 className="size-4" strokeWidth={1.5} />
      </button>
      <button type="button" aria-label="Download timetable" title="Download image" disabled={none} onClick={download} className={tool}>
        <Download className="size-4" strokeWidth={1.5} />
      </button>
    </>
  );
}

/** Shown while a timetable from a share link is open: it's a preview until it's kept. */
function SharedBar({ m, p }: { m: Model; p: PlanState }) {
  if (!p.shared) return null;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 md:px-6">
      <div className="min-w-0">
        <p className="text-[15px] font-medium">Shared timetable</p>
        <p className="text-sm text-fg-3">A preview. Your own plan is unchanged.</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={actions.closeShared}>Close</Button>
        <Button size="sm" variant="primary" onClick={() => actions.keepShared(m.registered.map((s) => s.course))}>Use as my plan</Button>
      </div>
    </Card>
  );
}

/** Share, calendar, download, copy and clear: kept out of the header so Suggest is the one action that stands out. */
function PlanMenu({ m, p, download, copy, clear, calendar }: { m: Model; p: PlanState; download: () => void; copy: () => void; clear: () => void; calendar: () => void }) {
  const none = !p.chosen.length;
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" aria-label="Plan options" className="grid size-9 place-items-center rounded-[10px] bg-surface text-fg-2 shadow-soft transition-colors hover:text-fg data-[state=open]:text-fg">
          <MoreHorizontal className="size-[18px]" strokeWidth={1.75} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className="z-50 min-w-[210px] rounded-xl bg-surface p-1 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
          <MenuItem onSelect={() => share(m, p)} disabled={none}><Link2 className="size-4 text-fg-3" strokeWidth={1.5} />Copy share link</MenuItem>
          <MenuItem onSelect={calendar} disabled={none}><CalendarPlus className="size-4 text-fg-3" strokeWidth={1.5} />Add to calendar</MenuItem>
          <MenuItem onSelect={download} disabled={none}><Download className="size-4 text-fg-3" strokeWidth={1.5} />Download image</MenuItem>
          <MenuItem onSelect={copy} disabled={none}><Copy className="size-4 text-fg-3" strokeWidth={1.5} />Copy course list</MenuItem>
          {m.bare ? <MenuItem onSelect={actions.addTranscript}><Plus className="size-4 text-fg-3" strokeWidth={1.5} />Add transcript</MenuItem> : null}
          <Menu.Separator className="mx-2 my-1 h-px bg-line" />
          <MenuItem onSelect={clear} disabled={none} danger><Trash2 className="size-4" strokeWidth={1.5} />Clear plan</MenuItem>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function MenuItem({ children, onSelect, disabled, danger }: { children: React.ReactNode; onSelect: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Menu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn('flex h-10 items-center gap-3 rounded-lg px-3 text-base outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2', danger ? 'text-bad' : 'text-fg')}
    >
      {children}
    </Menu.Item>
  );
}
