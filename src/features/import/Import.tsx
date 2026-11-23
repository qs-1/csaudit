import { CalendarRange, ChevronRight, CircleHelp, ClipboardPaste, FileUp, Loader2, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Mark } from '@/app/Mark';
import { SAMPLE_TRANSCRIPT } from '@/data/sample';
import { CURRENT, TERMS } from '@/data/registry';
import { isScheduleTranscript, type CreditLookup } from '@/engine';
import { NEW_ISSUE, REPO } from '@/lib/links';
import { go } from '@/lib/route';
import { cn } from '@/lib/utils';
import { actions, useStore } from '@/state/store';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { HowTo, markHowTo, seenHowTo } from './HowTo';

const NOT_FOUND = 'No courses found in that text. Open the unofficial transcript in Empower, select everything (Ctrl A), copy, and paste it here.';

export function Import() {
  const source = useStore((s) => s.transcriptText);
  // Back on this screen after the sample: start empty rather than showing the sample as if it were yours.
  const [text, setText] = useState(() => (source === SAMPLE_TRANSCRIPT ? '' : source ?? ''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // First visit: how to copy the transcript, once the screen has settled. After that it's one click away.
  const [howTo, setHowTo] = useState(false);
  useEffect(() => {
    if (seenHowTo()) return;
    // Marked as seen the moment it shows, so it never comes back on its own, even if the tab is closed with it open.
    const t = setTimeout(() => { markHowTo(); setHowTo(true); }, 700);
    return () => clearTimeout(t);
  }, []);

  const submit = async (raw: string, fail = NOT_FOUND) => {
    // The schedule-style transcript lists no credits per course; they come from the catalogs, loaded only for it.
    let credits: CreditLookup | undefined;
    if (isScheduleTranscript(raw)) {
      try { credits = await (await import('@/data/history')).historicCredits(); } catch { credits = (code) => CURRENT.credits[code]; }
    }
    if (actions.load(raw, credits)) { go('overview'); return true; }
    setError(fail);
    return false;
  };

  const readFile = async (file: File) => {
    setError('');
    setBusy(true);
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      let raw: string;
      if (isPdf) {
        const { readPdfText } = await import('@/pdf/readPdf');
        raw = await readPdfText(file);
        if (!raw.trim()) { setError('That PDF has no text layer, it may be a scan. Copy and paste the transcript instead.'); return; }
      } else raw = await file.text();
      setText(raw);
      await submit(raw, isPdf ? 'No courses found in that PDF. Copy and paste the transcript instead.' : NOT_FOUND);
    } catch {
      setError('That file could not be read. Copy and paste the transcript instead.');
    } finally {
      setBusy(false);
    }
  };

  const pasteClipboard = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      if (!raw.trim()) { setError('The clipboard is empty.'); return; }
      setText(raw);
      submit(raw);
    } catch {
      setError('Clipboard access was blocked. Long-press the box below and paste.');
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) void readFile(f);
  };

  return (
    <div className="flex min-h-dvh flex-col px-4 pt-safe md:items-center md:justify-center md:px-6 md:py-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto flex w-full max-w-[560px] flex-1 flex-col md:flex-none"
      >
        <div className="flex items-center gap-2.5 pt-6 md:pt-0">
          <Mark className="size-7" />
          <span className="text-base font-medium">FCCU CS Audit</span>
        </div>

        <h1 className="display mt-10 text-[34px] leading-[1.05] md:mt-12 md:text-[40px]">Import your<br className="md:hidden" /> transcript</h1>
        <p className="mt-3 text-md text-fg-2">Paste your unofficial transcript from Empower, or use the PDF.</p>
        <p className="mt-1 text-sm text-fg-3">For BS Computer Science only. Other majors' requirements aren't included yet.</p>

        <Card
          className={cn('relative mt-8 flex flex-col overflow-hidden transition-shadow', drag && 'ring-1 ring-fg-3')}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }}
          onDrop={onDrop}
        >
          <label htmlFor="transcript" className="sr-only">Transcript text</label>
          <textarea
            id="transcript"
            value={text}
            spellCheck={false}
            autoComplete="off"
            placeholder="Paste transcript text (Ctrl A, Ctrl C on Empower's unofficial transcript page works too)"
            onChange={(e) => { setText(e.target.value); setError(''); }}
            onPaste={(e) => {
              const raw = e.clipboardData.getData('text');
              if (raw.length > 200) { e.preventDefault(); setText(raw); submit(raw); }
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'import-error' : undefined}
            className="num h-[clamp(160px,30dvh,260px)] w-full resize-none bg-transparent p-5 text-sm leading-relaxed text-fg outline-none placeholder:font-sans placeholder:text-md placeholder:text-fg-3  md:h-[240px]"
          />
          {drag ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-surface/90 text-md text-fg">Drop to read</div>
          ) : null}
          <div className="flex items-center gap-2 border-t border-line/70 p-3">
            <Button variant="ghost" size="md" disabled={busy} onClick={() => fileRef.current?.click()}>
              {/* Same label while reading, so the row never changes width. */}
              {busy ? <Loader2 className="animate-spin" /> : <FileUp />}
              PDF
            </Button>
            <Button variant="ghost" size="md" className="md:hidden" onClick={pasteClipboard}>
              <ClipboardPaste />
              Paste
            </Button>
            <Button variant="ghost" size="icon" className="ml-auto" aria-label="How to copy it from Empower" title="How to copy it from Empower" onClick={() => setHowTo(true)}>
              <CircleHelp strokeWidth={1.75} />
            </Button>
            <Button variant="primary" size="md" className="px-5" disabled={!text.trim() || busy} onClick={() => submit(text)}>
              Continue
            </Button>
          </div>
        </Card>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf,text/plain,.txt"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }}
        />

        <div className="mt-5 flex items-center justify-between gap-4 text-sm">
          <span className="inline-flex items-center gap-1.5 text-fg-3"><Lock className="size-3.5" />Stays on this device</span>
          <button type="button" className="font-medium text-fg-2 underline decoration-line underline-offset-4 hover:text-fg" onClick={() => submit(SAMPLE_TRANSCRIPT)}>
            Use a sample
          </button>
        </div>

        {error ? (
          <p id="import-error" role="alert" className="mt-3 text-sm text-bad">{error}</p>
        ) : null}

        {/* The planner works without a transcript, just without degree requirements. */}
        <div className="mt-auto pt-8 md:mt-10 md:pt-0" style={{ paddingBottom: 'max(24px, var(--safe-b))' }}>
          <button
            type="button"
            onClick={() => { actions.planOnly(); go('planner'); }}
            className="flex w-full items-center gap-3 rounded-card border border-line px-4 py-3.5 text-left transition-colors hover:bg-fg/[0.03] active:scale-[0.99] md:pb-3.5"
          >
            <CalendarRange className="size-5 shrink-0 text-fg-2" strokeWidth={1.5} />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-medium">Make a schedule</span>
              <span className="block text-sm text-fg-3">{TERMS[TERMS.length - 1]?.label ?? 'Next term'} sections, no transcript needed</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-fg-3" strokeWidth={1.5} />
          </button>
          <p className="mt-5 text-center text-xs text-fg-3">
            <a href={REPO} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-fg">Open source</a>
            <span className="mx-1.5 opacity-60">·</span>
            <a href={NEW_ISSUE} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-fg">Report an issue</a>
          </p>
        </div>
      </motion.div>
      <HowTo open={howTo} onOpenChange={setHowTo} />
    </div>
  );
}
