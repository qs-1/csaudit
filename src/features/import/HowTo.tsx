import { ClipboardPaste, FileUp } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useIsMobile } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { Sheet } from '@/ui/sheet';
import './howto.css';

/**
 * Shows, on a small copy of Empower's unofficial transcript page, how to get the transcript into the audit:
 * open it, select all, copy, paste here. Keyboard shortcuts with a mouse; press and hold, then the phone's own
 * text menu, on phones. Plays on a loop while open.
 */

const SEEN = 'howto-seen';
export const seenHowTo = () => { try { return localStorage.getItem(SEEN) === '1'; } catch { return true; } };
export const markHowTo = () => { try { localStorage.setItem(SEEN, '1'); } catch { /* private mode */ } };

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? '⌘' : 'Ctrl';
const Key = ({ k }: { k: string }) => <kbd>{k}</kbd>;

// Made-up rows in the transcript's own columns. Nothing here is anyone's record.
type R = string[];
const TERMS: { label: string; rows: R[]; totals: R }[] = [
  {
    label: '2025 Fall',
    rows: [
      ['COMP', '201', 'A', 'Data Structures', 'M W', '09:00/10:15', 'SBLOCK', 'S316', 'B+', '3', '3', '9.9'],
      ['MATH', '231', 'B', 'Linear Algebra', 'T R', '11:00/12:15', 'SBLOCK', 'S412', 'A-', '3', '3', '11.1'],
      ['ENGL', '102', 'C', 'Academic Writing', 'M W F', '10:00/10:50', 'EBLOCK', 'E121', 'B', '3', '3', '9'],
      ['PHYS', '120', 'A', 'Physics for Computing', 'T R', '02:00/03:15', 'SBLOCK', 'S219', 'A', '3', '3', '12'],
    ],
    totals: ['12.00', '12.00', '42.00', '3.500'],
  },
  {
    label: '2025 Spring',
    rows: [
      ['COMP', '101', 'B', 'Programming I', 'M W', '08:00/09:15', 'SBLOCK', 'S120', 'A', '3', '3', '12'],
      ['MATH', '111', 'A', 'Calculus I', 'T R', '09:30/10:45', 'SBLOCK', 'S029', 'B', '3', '3', '9'],
      ['URDU', '101', 'D', 'Urdu Language', 'M W F', '12:00/12:50', 'EBLOCK', 'E229', 'A-', '3', '3', '11.1'],
    ],
    totals: ['9.00', '9.00', '32.10', '3.567'],
  },
];
const HEAD = ['Dept', 'Crse', 'Sec', 'Title', 'Days', 'Time', 'Building', '', 'Gr', 'Att', 'Ern', 'Pts', 'GPA'];
const TABS: [string, boolean][] = [
  ['Student Records', true], ['Financials', true], ['Housing Request', false], ['Settings and Tools', true],
  ['FAQ\'s', true], ['FCCU LMS', false], ['Events Reservation', true], ['Course Trailers', false],
  ['Tax information', false], ['Course Trailers', false], ['Society Registration', true], ['Technology Survey', true], ['Course Withdrawal', true],
];
const PASTED = [
  'Unofficial Transcript', '(Undergraduate Classes)', 'Dept Crse Sec Title Days Time Building',
  'COMP 201 A Data Structures M W 09:00/10:15', 'MATH 231 B Linear Algebra T R 11:00/12:15',
  'ENGL 102 C Academic Writing M W F 10:00/10:50', 'PHYS 120 A Physics for Computing T R',
  'Term Totals 12.00 12.00 42.00 3.500',
];

const ARROW = (
  <svg width="16" height="22" viewBox="0 0 16 22" aria-hidden>
    <path d="M1 1v17l4.5-4.2 3 6.7 2.8-1.2-3-6.6H14.5z" fill="#111" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

/** A seal in the banner's blue: rings, a shield, a ribbon. Only there so the banner reads as the college's. */
const CREST = (
  <svg className="ht-crest" viewBox="0 0 72 74" fill="none" stroke="#3a62ad" strokeWidth="1.6" aria-hidden>
    <circle cx="36" cy="34" r="31" />
    <circle cx="36" cy="34" r="25" strokeWidth="1" />
    <path d="M26 20h20v12c0 8-5 13-10 15-5-2-10-7-10-15z" />
    <path d="M26 28h20M36 20v27" strokeWidth="1" />
    <path d="M12 58c8 4 16 6 24 6s16-2 24-6l-3 8c-7 3-14 4-21 4s-14-1-21-4z" fill="#fff" />
  </svg>
);

const STEPS = (touch: boolean): ReactNode[] => [
  <>In Empower, open <b className="font-medium">Student Records</b>, then <b className="font-medium">Unofficial Transcript</b>.</>,
  touch ? <>Press and hold on the page, then tap <b className="font-medium">Select all</b>.</> : <>Select the whole page with <Key k={MOD} /> <Key k="A" />.</>,
  touch ? <>Tap <b className="font-medium">Copy</b>.</> : <>Copy it with <Key k={MOD} /> <Key k="C" />.</>,
  touch ? <>Come back here and tap <b className="font-medium">Paste</b>.</> : <>Come back here, click the box and press <Key k={MOD} /> <Key k="V" />.</>,
];

export function HowTo({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const touch = useIsMobile();
  const [step, setStep] = useState(1);
  // A callback ref: the phone drawer mounts its content after `open` flips, so the stage arrives a render later.
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  useEffect(() => {
    const root = stage;
    if (!open || !root) return;
    let alive = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const wait = (ms: number) => new Promise<void>((ok, stop) => {
      const t = setTimeout(() => { timers.delete(t); if (alive) ok(); else stop(); }, ms);
      timers.add(t);
    });
    const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
    const page = $('.ht-page'), view = $('.ht-view'), cursor = $('.ht-cursor'), fx = $('.ht-fx');
    const finger = root.querySelector<HTMLElement>('.ht-finger');
    const on = (el: Element, c: string, yes = true) => el.classList.toggle(c, yes);

    const at = (el: Element, dx = 0.5, dy = 0.5): [number, number] => {
      const s = root.getBoundingClientRect(), r = el.getBoundingClientRect();
      return [r.left - s.left + r.width * dx, r.top - s.top + r.height * dy];
    };
    const moveTo = (p: [number, number]) => { cursor.style.transform = `translate(${p[0]}px, ${p[1]}px)`; };
    const tap = async (p: [number, number]) => {
      if (finger) { on(finger, 'ht-down'); await wait(120); on(finger, 'ht-down', false); }
      const d = document.createElement('div');
      d.className = 'ht-ripple';
      d.style.left = `${p[0]}px`;
      d.style.top = `${p[1]}px`;
      fx.append(d);
      setTimeout(() => d.remove(), 600);
      await wait(160);
    };
    const press = async (k: string) => {
      const keys = $(`.ht-keys[data-k="${k}"]`);
      on(keys, 'ht-show');
      await wait(350);
      for (const el of keys.children) { on(el, 'ht-dn'); await wait(90); }
      await wait(220);
      for (const el of keys.children) on(el, 'ht-dn', false);
      await wait(500);
      on(keys, 'ht-show', false);
    };
    // The whole page width first, like opening the site; then closer in on the classes.
    const place = (scale: number, y = 0, animate = false) => {
      on(page, 'ht-move', animate);
      page.style.transform = `translateY(${-y * scale}px) scale(${scale})`;
    };

    const reset = () => {
      root.querySelectorAll('.ht-show, .ht-open, .ht-on, .ht-hi, .ht-loaded, .ht-sel, .ht-swap, .ht-in, .ht-ready, .ht-hold')
        .forEach((el) => el.classList.remove('ht-show', 'ht-open', 'ht-on', 'ht-hi', 'ht-loaded', 'ht-sel', 'ht-swap', 'ht-in', 'ht-ready', 'ht-hold'));
      on(root, 'ht-swap', false);
      $('.ht-ph').style.opacity = '1';
      place(view.clientWidth / 1000);
      cursor.style.transition = 'none';
      moveTo([root.clientWidth * 0.62, root.clientHeight * 0.75]);
      void cursor.offsetWidth;
      cursor.style.transition = '';
    };

    const play = async () => {
      reset();
      setStep(1);
      on(root, 'ht-fade', false);
      if (finger) on(finger, 'ht-show');
      await wait(700);

      // 1. Student Records, then Unofficial Transcript
      const rec = $('.ht-rec');
      moveTo(at(rec, 0.5, 0.6)); await wait(850);
      await tap(at(rec, 0.5, 0.6));
      on(rec, 'ht-open'); on(rec, 'ht-on'); await wait(380);
      const ut = $('.ht-ut');
      moveTo(at(ut, 0.3, 0.6)); await wait(700);
      on(ut, 'ht-hi'); await wait(200);
      await tap(at(ut, 0.3, 0.6));
      on(rec, 'ht-open', false); on(page, 'ht-loaded');
      await wait(700);
      place(view.clientWidth / 784, $('.ht-body').offsetTop - 8, true); // the classes, with the sheet's 12px padding either side
      await wait(1300);

      // 2. Select everything
      const spot = at(root.querySelectorAll('.ht-page tbody tr')[1]!, 0.3, 0.5);
      setStep(2);
      moveTo(spot); await wait(800);
      if (finger) {
        on(finger, 'ht-hold'); await wait(800);
        const menu = $('.ht-menu-sel');
        menu.style.left = `${Math.max(8, Math.min(root.clientWidth - 200, spot[0] - 70))}px`;
        menu.style.top = `${spot[1] - 50}px`;
        on(menu, 'ht-show'); await wait(500);
        on(finger, 'ht-hold', false);
        const all = menu.children[1]!;
        moveTo(at(all)); await wait(650);
        on(all, 'ht-hi'); await tap(at(all));
        on(menu, 'ht-show', false);
        on(page, 'ht-sel'); await wait(1100);
      } else {
        await press('A');
        on(page, 'ht-sel'); await wait(900);
      }

      // 3. Copy
      setStep(3);
      if (finger) {
        const menu = $('.ht-menu-copy');
        menu.style.left = `${Math.max(8, Math.min(root.clientWidth - 200, spot[0] - 70))}px`;
        menu.style.top = `${spot[1] - 50}px`;
        await wait(300);
        on(menu, 'ht-show'); await wait(500);
        const copy = menu.children[0]!;
        moveTo(at(copy)); await wait(650);
        on(copy, 'ht-hi'); await tap(at(copy));
        on(menu, 'ht-show', false);
      } else {
        await wait(300);
        await press('C');
      }
      on($('.ht-toast'), 'ht-show'); await wait(1000); on($('.ht-toast'), 'ht-show', false);
      await wait(300);

      // 4. Paste here
      setStep(4);
      on(root, 'ht-swap'); await wait(800);
      const ta = $('.ht-ta');
      if (finger) {
        const paste = $('.ht-paste');
        moveTo(at(paste)); await wait(800);
        on(paste, 'ht-press'); await tap(at(paste)); on(paste, 'ht-press', false);
      } else {
        moveTo(at(ta, 0.4, 0.45)); await wait(800);
        await tap(at(ta, 0.4, 0.45));
        await press('V');
      }
      $('.ht-ph').style.opacity = '0';
      for (const l of root.querySelectorAll('.ht-ln')) { on(l, 'ht-in'); await wait(55); }
      const go = $('.ht-go');
      on(go, 'ht-ready'); await wait(600);
      moveTo(at(go)); await wait(800);
      on(go, 'ht-press'); await tap(at(go)); on(go, 'ht-press', false);
      setStep(5);

      // A moment on the finished state, then again from the top.
      await wait(2600);
      on(root, 'ht-fade'); await wait(350);
      void play();
    };

    // Starts once the dialog has finished opening, so measurements aren't taken mid-slide.
    wait(380).then(play).catch(() => { /* closed */ });
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, [open, touch, stage]);

  const steps = STEPS(touch);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="How to copy your transcript" hideTitle side="center" wide>
      <div className="pt-1 md:pt-0">
        <h2 className="display text-[19px] leading-tight md:text-[21px]">Copy your transcript from Empower</h2>
      </div>

      <div ref={setStage} className="ht-stage mt-4" aria-hidden>
        <div className="ht-win ht-emp">
          <div className="ht-bar"><div className="ht-url">mysis-fccollege.empower-xl.com/empower</div></div>
          <div className="ht-view">
            <div className="ht-page">
              <div className="ht-banner">
                {CREST}
                <div className="ht-name"><b className="ht-s">Forman Christian College</b><span className="ht-s">(A Chartered University)</span></div>
                <div className="ht-date">{date}</div>
              </div>
              <div className="ht-home"><a className="ht-s">Home</a><span className="ht-s">Logged in as Student | <span className="ht-link">LOGOUT</span></span></div>
              <ul className="ht-tabs">
                {TABS.map(([t, bold], i) => (
                  <li key={i} className={cn('ht-tab', bold && 'ht-b', i === 0 && 'ht-rec')}>
                    {t}
                    {i === 0 ? (
                      <div className="ht-drop">
                        <span>Course Schedule</span><span className="ht-ut">Unofficial Transcript</span>
                        <span>Student Schedule (Summary)</span><span>Student Enrollment Summary</span>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="ht-sheet">
                <div className="ht-placeholder"><i style={{ width: '24%' }} /><i style={{ width: '62%' }} /><i style={{ width: '48%' }} /><i style={{ width: '55%' }} /></div>
                <div className="ht-tr">
                  <div className="ht-title ht-s"><b>Unofficial</b> Transcript</div>
                  <div className="ht-filter"><span className="ht-link ht-s">Change</span> <span className="ht-s">Current filter settings:</span></div>
                  <div className="ht-body">
                    <div className="ht-green ht-s">(Current Information)</div>
                    <div className="ht-info">{['Major', 'Minor', 'Specialize1', 'Specialize2', 'Track'].map((h) => <span key={h} className="ht-s">{h}</span>)}</div>
                    <div className="ht-s">Computer Science</div>
                    <div className="ht-green ht-s">(Undergraduate Classes)</div>
                    {TERMS.map((term) => (
                      <div key={term.label}>
                        <div className="ht-sh ht-s">Show/Hide {term.label}</div>
                        <table>
                          <thead><tr>{HEAD.map((h, i) => <th key={i} className="ht-s">{h}</th>)}</tr></thead>
                          <tbody>
                            {term.rows.map((r, i) => (
                              <tr key={i}>{r.map((v, j) => <td key={j} className={cn('ht-s', j >= 9 && 'ht-r')}>{v}</td>)}<td /></tr>
                            ))}
                            <tr className="ht-tot"><td colSpan={9} className="ht-s">Term Totals</td>{term.totals.map((v, j) => <td key={j} className="ht-r ht-s">{v}</td>)}</tr>
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* The import box as it is on the page behind this dialog, smaller */}
        <div className="ht-win ht-audit">
          <p className="display text-[20px] leading-tight">Import your transcript</p>
          <p className="mt-1 truncate text-xs text-fg-2">Paste your unofficial transcript from Empower, or use the PDF.</p>
          <div className="mt-3 overflow-hidden rounded-[14px] bg-surface shadow-soft">
            <div className="ht-ta">
              <p className="ht-ph text-[13px] leading-[19px] text-fg-3">Paste transcript text (Ctrl A, Ctrl C on Empower's unofficial transcript page works too)</p>
              <div className="num text-[10.5px] leading-[15px] text-fg">{PASTED.map((l) => <div key={l} className="ht-ln">{l}</div>)}</div>
            </div>
            <div className="flex items-center gap-1 border-t border-line/70 p-2">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-fg"><FileUp className="size-3.5" />PDF</span>
              {touch ? <span className="ht-paste inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-fg transition-transform"><ClipboardPaste className="size-3.5" />Paste</span> : null}
              <span className="ht-go ml-auto inline-flex h-8 items-center rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-fg">Continue</span>
            </div>
          </div>
        </div>

        <div className="ht-toast">Copied</div>
        <div className="ht-menu ht-menu-sel"><span>Copy</span><span>Select all</span><span>Share</span></div>
        <div className="ht-menu ht-menu-copy"><span>Copy</span><span>Share</span><span>Translate</span></div>
        {['A', 'C', 'V'].map((k) => (
          <div key={k} className="ht-keys" data-k={k}><span className="ht-kbd">{MOD}</span><span className="ht-kbd">{k}</span></div>
        ))}
        <div className="ht-fx" />
        <div className="ht-cursor">{touch ? <div className="ht-finger" /> : ARROW}</div>
      </div>

      <div className="mt-4 flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="relative h-1 flex-1 overflow-hidden rounded-full bg-fg/[0.08]">
            <span className={cn('absolute inset-0 origin-left bg-done transition-transform duration-[400ms] ease-[cubic-bezier(.22,1,.36,1)]', step >= i ? 'scale-x-100' : 'scale-x-0')} />
          </span>
        ))}
      </div>
      {/* Every step is listed for screen readers; the animation only shows one at a time. */}
      <ol className="sr-only">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <div className="mt-3 min-h-[44px]" aria-hidden>
        <p key={Math.min(step, 4)} className="ht-cap text-md">
          <span className="block text-sm text-fg-3">Step {Math.min(step, 4)} of 4</span>
          {steps[Math.min(step, 4) - 1]}
        </p>
      </div>

      <div className="mt-5 flex justify-end">
        <Button variant="primary" size="md" className="h-11 w-full px-5 md:h-10 md:w-auto" onClick={() => onOpenChange(false)}>Got it</Button>
      </div>
    </Sheet>
  );
}
