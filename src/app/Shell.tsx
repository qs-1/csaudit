import * as Tip from '@radix-ui/react-tooltip';
import { AlertTriangle, Bell, CalendarRange, FileText, FileUp, LayoutGrid, PanelLeftClose, PanelLeftOpen, RotateCcw, Settings2, TrendingUp, type LucideIcon } from 'lucide-react';
import { useCallback, useLayoutEffect, useState, type ReactNode } from 'react';
import { Gpa } from '@/features/gpa/Gpa';
import { Overview } from '@/features/overview/Overview';
import { Planner } from '@/features/planner/Planner';
import { SeatsScreen } from '@/features/seats/Seats';
import { Settings } from '@/features/settings/Settings';
import { TranscriptScreen } from '@/features/transcript/Transcript';
import { useHotkey, useIsMobile, useMedia } from '@/lib/hooks';
import { NEW_ISSUE, REPO } from '@/lib/links';
import { go, useRoute, type Route } from '@/lib/route';
import { cn } from '@/lib/utils';
import { useModel } from '@/state/model';
import { actions } from '@/state/store';
import { ui } from '@/state/ui';
import { Mark } from './Mark';

type ScreenRoute = Exclude<Route, 'import'>;

const NAV: { id: ScreenRoute; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'planner', label: 'Planner', icon: CalendarRange },
  { id: 'seats', label: 'Seats', icon: Bell },
  { id: 'gpa', label: 'GPA', icon: TrendingUp },
  { id: 'transcript', label: 'Transcript', icon: FileText },
  // Docs is hidden until it's tidied up; its screen stays in features/docs.
];

const SCREENS: Record<ScreenRoute, () => ReactNode> = {
  overview: () => <Overview />,
  planner: () => <Planner />,
  gpa: () => <Gpa />,
  transcript: () => <TranscriptScreen />,
  seats: () => <SeatsScreen />,
  docs: () => <Overview />,
};

const FOOT = 'flex h-10 items-center gap-3 whitespace-nowrap rounded-[12px] px-[11px] text-base text-fg-3 transition-colors hover:bg-fg/[0.04] hover:text-fg';
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const COLLAPSED_KEY = 'fccu-audit:sidebar-collapsed';

/** Desktop sidebar collapsed to icons. Remembered on this device; it's only a layout preference. */
function useCollapsed(): [boolean, () => void] {
  const [collapsed, set] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const toggle = useCallback(() => set((c) => {
    try { localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1'); } catch { /* private mode */ }
    return !c;
  }), []);
  return [collapsed, toggle];
}

/** Tooltip to the right of a sidebar item. With `off` the child renders alone (its label is already visible). */
function SideTip({ label, keys, off, children }: { label: string; keys?: string; off?: boolean; children: ReactNode }) {
  if (off) return <>{children}</>;
  return (
    <Tip.Root>
      <Tip.Trigger asChild>{children}</Tip.Trigger>
      <Tip.Portal>
        <Tip.Content side="right" sideOffset={10} className="z-[70] flex items-center gap-2 rounded-lg bg-fg px-2.5 py-1.5 text-sm text-bg shadow-pop data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:slide-in-from-left-1">
          {label}
          {keys ? <kbd className="num text-2xs opacity-60">{keys}</kbd> : null}
        </Tip.Content>
      </Tip.Portal>
    </Tip.Root>
  );
}

export function Shell() {
  const model = useModel();
  const bare = model?.bare ?? false; // planner only, no transcript
  const routed = useRoute();
  // Without a transcript only the planner makes sense. A docs link from before lands on the overview.
  // Seat alerts don't need a transcript either.
  const route: ScreenRoute = bare ? (routed === 'seats' ? 'seats' : 'planner') : routed === 'import' || routed === 'docs' ? 'overview' : routed;
  const nav = bare ? NAV.filter((n) => n.id === 'planner' || n.id === 'seats') : NAV;
  const tabs = nav.length > 1; // a tab bar with one tab is just in the way
  const mobile = useIsMobile();
  const problems = model?.problems.length ?? 0;
  // Before paint, so the new screen appears at the top instead of scrolling there.
  useLayoutEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [route]);
  const [userCollapsed, toggle] = useCollapsed();
  // Tablet widths can't spare 240px: the sidebar is an icon rail there whatever the saved preference.
  const narrow = useMedia('(max-width: 1023px)');
  const collapsed = userCollapsed || narrow;
  useHotkey('mod+b', useCallback((e: KeyboardEvent) => { if (mobile || narrow) return; e.preventDefault(); toggle(); }, [mobile, narrow, toggle]));

  return (
    <div className="min-h-dvh">
      {mobile ? null : (
        <aside
          className={cn('group/side fixed inset-y-0 left-0 z-30 flex flex-col overflow-hidden px-3 pb-4 pt-5 transition-[width] duration-200 ease-out', collapsed ? 'w-[64px]' : 'w-[240px]')}
        >
          <Tip.Provider delayDuration={300} skipDelayDuration={0}>
            <div className="flex items-center gap-2.5 pb-8">
              {narrow ? (
                <span className="grid size-10 shrink-0 place-items-center"><Mark className="size-7" /></span>
              ) : collapsed ? (
                <SideTip label="Expand sidebar" keys={`${MOD} B`}>
                  <button type="button" onClick={toggle} aria-label="Expand sidebar" className="group relative grid size-10 shrink-0 place-items-center rounded-lg hover:bg-fg/[0.05]">
                    <Mark className="size-7 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0" />
                    <PanelLeftOpen className="absolute size-[18px] text-fg-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" strokeWidth={1.5} />
                  </button>
                </SideTip>
              ) : (
                <>
                  <span className="grid size-10 shrink-0 place-items-center"><Mark className="size-7" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="display truncate text-[15px] leading-5">FCCU CS Audit</p>
                    <p className="truncate text-xs leading-4 text-fg-3">{bare ? 'Timetable' : model?.catalog.label}</p>
                  </div>
                  <SideTip label="Collapse sidebar" keys={`${MOD} B`}>
                    {/* Shown on hover. */}
                    <button type="button" onClick={toggle} aria-label="Collapse sidebar" className="grid size-8 shrink-0 place-items-center rounded-[10px] text-fg-3 opacity-0 transition-[opacity,color,background-color] hover:bg-fg/[0.05] hover:text-fg focus-visible:opacity-100 group-hover/side:opacity-100">
                      <PanelLeftClose className="size-[18px]" strokeWidth={1.5} />
                    </button>
                  </SideTip>
                </>
              )}
            </div>
            <nav className="relative flex flex-col gap-1" aria-label="Main">
              {/* Active-row highlight sliding between fixed 44px slots. Plain CSS: a measured layout animation
                  picked up the page's scroll position. */}
              {nav.some((n) => n.id === route) ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-10 rounded-[12px] bg-surface shadow-soft transition-transform duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ transform: `translateY(${nav.findIndex((n) => n.id === route) * 44}px)` }}
                />
              ) : null}
              {nav.map((n) => {
                const on = n.id === route;
                return (
                  <SideTip key={n.id} label={n.label} off={!collapsed}>
                    <a
                      href={`#/${n.id}`}
                      aria-current={on ? 'page' : undefined}
                      aria-label={collapsed ? n.label : undefined}
                      className={cn(
                        'group/item relative flex h-10 items-center gap-3 whitespace-nowrap rounded-[12px] px-[11px] text-base transition-colors',
                        on ? 'font-medium text-fg' : 'text-fg-2 hover:bg-fg/[0.04] hover:text-fg',
                      )}
                    >
                      <span className="relative shrink-0">
                        <n.icon className={cn('size-[18px] transition-colors', on ? 'text-fg' : 'text-fg-3 group-hover/item:text-fg-2')} strokeWidth={on ? 1.9 : 1.5} />
                        {collapsed && n.id === 'transcript' && problems ? <span className="absolute -right-1 -top-1 size-2 rounded-full bg-warn ring-2 ring-bg" aria-label="Needs review" /> : null}
                      </span>
                      {collapsed ? null : <span className="truncate">{n.label}</span>}
                      {!collapsed && n.id === 'transcript' && problems ? <AlertTriangle className="ml-auto size-4 text-warn" strokeWidth={1.5} aria-label="Needs review" /> : null}
                    </a>
                  </SideTip>
                );
              })}
            </nav>
            <div className="mt-auto flex flex-col gap-0.5">
              {collapsed ? null : (
                <p className="mb-3 whitespace-nowrap px-[11px] text-xs text-fg-3">
                  <a href={REPO} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-fg">Source</a>
                  <span className="mx-1.5 opacity-60">·</span>
                  <a href={NEW_ISSUE} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-fg">Report an issue</a>
                </p>
              )}
              <SideTip label={bare ? 'Add transcript' : 'New transcript'} off={!collapsed}>
                <button type="button" onClick={bare ? actions.addTranscript : actions.startOver} aria-label={collapsed ? (bare ? 'Add transcript' : 'New transcript') : undefined} className={FOOT}>
                  {bare ? <FileUp className="size-[18px] shrink-0" strokeWidth={1.5} /> : <RotateCcw className="size-[18px] shrink-0" strokeWidth={1.5} />}
                  {collapsed ? null : <span className="truncate">{bare ? 'Add transcript' : 'New transcript'}</span>}
                </button>
              </SideTip>
              <SideTip label="Settings" off={!collapsed}>
                <button type="button" onClick={() => ui.settings(true)} aria-label={collapsed ? 'Settings' : undefined} className={FOOT}>
                  <Settings2 className="size-[18px] shrink-0" strokeWidth={1.5} />
                  {collapsed ? null : <span className="truncate">Settings</span>}
                </button>
              </SideTip>
            </div>
          </Tip.Provider>
        </aside>
      )}

      <main className={cn(mobile ? 'px-4 pt-safe' : cn('transition-[padding] duration-200 ease-out', collapsed ? 'pl-[64px]' : 'pl-[240px]'))} style={mobile ? { paddingBottom: tabs ? 'calc(92px + var(--safe-b))' : 'calc(32px + var(--safe-b))' } : undefined}>
        <div key={route} className={cn('animate-rise', !mobile && 'mx-auto max-w-[1280px] px-6 py-6 lg:px-8 lg:py-8')}>
          {SCREENS[route]()}
        </div>
      </main>

      {mobile && tabs ? (
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-bg"
          style={{ paddingBottom: 'var(--safe-b)' }}
        >
          <div className="grid h-[62px]" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
            {nav.map((n) => {
              const on = n.id === route;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => go(n.id)}
                  aria-current={on ? 'page' : undefined}
                  className={cn('relative flex flex-col items-center justify-center gap-1 text-2xs font-medium transition-colors', on ? 'text-fg' : 'text-fg-3')}
                >
                  <span className="relative">
                    <n.icon className="size-[22px]" strokeWidth={on ? 1.9 : 1.5} />
                    {n.id === 'transcript' && problems ? <AlertTriangle className="absolute -right-2.5 -top-1 size-3.5 text-warn" strokeWidth={2} aria-label="Needs review" /> : null}
                  </span>
                  {n.label}
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}

      <Settings />
    </div>
  );
}

/** Screen title. Phones get a large title with the settings button beside it. */
export function ScreenHeader({ eyebrow, title, actions, mobileActions }: { eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode; mobileActions?: ReactNode }) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <header className="flex items-end justify-between gap-3 pb-7 pt-6 md:pb-5">
        <div className="min-w-0">
          {eyebrow ? <p className="mb-1 text-sm text-fg-3">{eyebrow}</p> : null}
          <h1 className="display truncate text-[30px] leading-[1.1]">{title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1 pb-0.5">
          {mobileActions}
          <button type="button" aria-label="Settings" onClick={() => ui.settings(true)} className="grid size-10 place-items-center rounded-[12px] bg-surface text-fg-2 shadow-soft press">
            <Settings2 className="size-[18px]" strokeWidth={1.5} />
          </button>
        </div>
      </header>
    );
  }
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-sm text-fg-3">{eyebrow}</p> : null}
        <h1 className="display text-[28px] leading-tight">{title}</h1>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
