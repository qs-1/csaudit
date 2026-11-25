import { X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Drawer } from 'vaul';
import { useIsMobile } from '@/lib/hooks';
import { cn } from '@/lib/utils';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Visually hidden title, for sheets that bring their own header. */
  hideTitle?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  /** Desktop: side panel or centred dialog. Phones always get a bottom drawer. */
  side?: 'right' | 'left' | 'center';
  /** Phone drawer height: fit content or nearly full screen. */
  tall?: boolean;
  className?: string;
  /** Phones: focus the first field on open, which brings up the keyboard. */
  autoFocus?: boolean;
  /** Desktop dialog: 600px instead of 520px. */
  wide?: boolean;
}

/**
 * Callers clear their content as they close (a sheet for "the selected section" has nothing once it's closed).
 * Keep showing what was there, so the sheet slides out with it instead of emptying and jumping mid-animation.
 */
function useLatched<T>(open: boolean, value: T): T {
  const last = useRef(value);
  if (open) last.current = value;
  return open ? value : last.current;
}

/**
 * Lift a bottom drawer above the mobile virtual keyboard using `visualViewport` (where `position: fixed; bottom: 0`
 * and `dvh` stay behind the keyboard on iOS Safari and default Android Chrome). Vaul's own `repositionInputs`
 * has height/toggle bugs on multi-step keyboard animations, so we measure the inset directly.
 */
function useKeyboardInset(active: boolean) {
  const [kb, setKb] = useState<{ inset: number; maxH?: number }>({ inset: 0 });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) { setKb({ inset: 0 }); return; }
    const update = () => {
      if (vv.scale > 1.01 || window.innerHeight - vv.height <= 80) { setKb({ inset: 0 }); return; }
      setKb({
        inset: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)),
        maxH: Math.floor(vv.height * 0.94),
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return kb;
}

/** A bottom drawer on phones and a panel or dialog on larger screens. */
export function Sheet({ open, onOpenChange, title, hideTitle, children, footer, side = 'right', tall, className, autoFocus, wide }: SheetProps) {
  const mobile = useIsMobile();
  const shown = useLatched(open, { title, children, footer });
  const kb = useKeyboardInset(mobile && open);

  if (mobile) {
    ({ title, children, footer } = shown);
    return (
      <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false} autoFocus={autoFocus}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Drawer.Content
            className={cn(
              'fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[20px] bg-surface outline-none',
              tall ? 'h-[94dvh]' : 'max-h-[94dvh]',
            )}
            style={kb.inset || kb.maxH ? { bottom: kb.inset || undefined, maxHeight: kb.maxH } : undefined}
          >
            <div aria-hidden className="mx-auto mb-1 mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-fg-3/30" />
            <Drawer.Title className={cn('px-5 pb-2 pt-2 text-lg font-medium', hideTitle && 'sr-only')}>{title}</Drawer.Title>
            <Drawer.Description className="sr-only">{typeof title === 'string' ? title : 'Details'}</Drawer.Description>
            <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4', className)}>{children}</div>
            {footer ? <div className="shrink-0 border-t px-5 pt-3" style={{ paddingBottom: kb.inset ? 12 : 'calc(12px + var(--safe-b))' }}>{footer}</div> : <div className="pb-safe" />}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return <Panel {...{ open, onOpenChange, title, hideTitle, children, footer, side, className, wide }} />;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Runs `fn` once the browser is idle, so panels are built before anyone opens them. */
function useIdle(fn: () => void) {
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = requestIdleCallback(fn, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(fn, 300);
    return () => clearTimeout(id);
  }, []);
}

/**
 * Desktop side panel or dialog. Hand-rolled instead of a Radix dialog: that locked pointer events and scroll across the
 * whole page on every open and close, and rebuilt the panel each time, which cost 60 to 110 ms per toggle on the
 * planner. This one is built once while the page is idle, stays mounted, and opening it only flips an attribute that
 * a CSS transition picks up. Closed, it is `inert` and invisible, so it can't take focus or clicks.
 */
function Panel({ open, onOpenChange, title, hideTitle, children, footer, side = 'right', className, wide }: Omit<SheetProps, 'tall' | 'autoFocus'>) {
  const [built, setBuilt] = useState(open);
  useIdle(() => setBuilt(true));
  if (open && !built) setBuilt(true);
  const shown = useLatched(open, { title, children, footer });

  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // React 18 has no `inert` prop. Closed panels can't be focused or clicked.
  useLayoutEffect(() => { root.current?.toggleAttribute('inert', !open); }, [open, built]);
  const change = useRef(onOpenChange);
  change.current = onOpenChange;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    body.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // Menus and popovers inside the panel close themselves first and mark the key as handled.
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); change.current(false); return; }
      if (e.key !== 'Tab' || !panel.current?.contains(document.activeElement)) return;
      const f = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!f.length) return;
      const first = f[0]!, end = f[f.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === body.current)) { e.preventDefault(); end.focus(); }
      else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (back?.isConnected && !panel.current?.contains(back)) back.focus({ preventScroll: true });
    };
  }, [open]);

  // The page doesn't scroll behind an open panel. Wheel events need a non-passive listener to be cancelled.
  useEffect(() => {
    const el = overlay.current;
    if (!el) return;
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    el.addEventListener('touchmove', stop, { passive: false });
    return () => { el.removeEventListener('wheel', stop); el.removeEventListener('touchmove', stop); };
  }, [built]);

  if (!built) return null;
  return createPortal(
    <div ref={root}>
      <div
        ref={overlay}
        aria-hidden
        data-open={open ? '' : undefined}
        onPointerDown={() => change.current(false)}
        className={cn('sheet-fade fixed inset-0 z-50', side === 'left' ? 'bg-black/10' : 'bg-black/40')}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={open ? undefined : true}
        data-open={open ? '' : undefined}
        data-side={side}
        className={cn(
          'sheet-panel fixed z-50 flex flex-col bg-surface shadow-pop outline-none',
          side === 'left' && 'inset-y-3 left-3 w-[420px] max-w-[calc(100vw-24px)] rounded-card',
          side === 'right' && 'inset-y-3 right-3 w-[440px] max-w-[calc(100vw-24px)] rounded-card',
          side === 'center' && cn('inset-0 m-auto h-fit max-h-[86vh] max-w-[calc(100vw-32px)] rounded-card', wide ? 'w-[600px]' : 'w-[520px]'),
        )}
      >
        <div className={cn('flex shrink-0 items-center justify-between gap-3 px-6 pb-2 pt-5', hideTitle && 'absolute right-0 top-0 z-10 pt-5')}>
          <h2 id={titleId} className={cn('text-lg font-medium', hideTitle && 'sr-only')}>{shown.title}</h2>
          <button type="button" onClick={() => change.current(false)} className="-mr-2 grid size-8 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div ref={body} tabIndex={-1} className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 outline-none', hideTitle && 'pt-8', className)}>{shown.children}</div>
        {shown.footer ? <div className="shrink-0 border-t px-6 py-4">{shown.footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
