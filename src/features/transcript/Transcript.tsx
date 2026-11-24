import * as Menu from '@radix-ui/react-dropdown-menu';
import { AlertTriangle, Check, Copy, Ellipsis, FileDown, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ScreenHeader } from '@/app/Shell';
import { GP, GRADES, sortTerms, tableText, termLabel, type Row } from '@/engine';
import { cn, num } from '@/lib/utils';
import { useModel, type Model } from '@/state/model';
import { actions, regrade, useStore } from '@/state/store';
import { Button } from '@/ui/button';
import { Card, Code, Label } from '@/ui/card';
import { useIsMobile } from '@/lib/hooks';
import { Input, SwitchRow } from '@/ui/controls';
import { Sheet } from '@/ui/sheet';

const ALL_GRADES = [...GRADES, 'P', 'W', 'NP', 'I'];

export function TranscriptScreen() {
  const m = useModel();
  const [editing, setEditing] = useState<number | null>(null);
  if (!m) return null;
  const rows = m.transcript.rows;
  const terms = sortTerms([...new Set(rows.map((r) => r.term))]).reverse();

  const copy = () => {
    navigator.clipboard.writeText(tableText(rows)).then(() => toast.success('Copied as a table'), () => toast.error('Copy failed'));
  };
  // pdf-lib and the fonts only load when a PDF is asked for.
  const pdf = () => {
    const id = toast.loading('Making the PDF');
    import('@/pdf/transcriptPdf')
      .then(({ downloadTranscriptPdf }) => downloadTranscriptPdf(m))
      .then(() => toast.success('Transcript downloaded', { id, description: 'Choose it on the start screen to load this transcript again.' }))
      .catch(() => toast.error('Could not make the PDF', { id }));
  };
  const add = () => {
    const term = terms[0] ?? '';
    actions.setRows([...rows, { term, code: '', title: '', lab: false, ip: true, grade: '', rep: false, att: 0, ern: 0, pts: 0 }]);
    setEditing(rows.length);
  };

  return (
    <>
      <ScreenHeader
        eyebrow={`${rows.length} courses · ${terms.length} terms`}
        title="Transcript"
        actions={
          <>
            <MoreMenu copy={copy} pdf={pdf} />
            <Button variant="primary" onClick={add}><Plus strokeWidth={1.75} />Add course</Button>
          </>
        }
        mobileActions={
          <>
            <button type="button" aria-label="Add course" onClick={add} className="grid size-10 place-items-center rounded-[12px] bg-fg text-bg active:scale-[0.97]">
              <Plus className="size-[18px]" strokeWidth={1.75} />
            </button>
            <MoreMenu copy={copy} pdf={pdf} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 md:gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start xl:grid-cols-[320px_minmax(0,1fr)]">
        <Summary m={m} terms={terms} />
        <div className="flex min-w-0 flex-col gap-5 md:gap-6">
          {terms.map((t) => {
            const these = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.term === t);
            const graded = these.filter(({ r }) => !r.ip && r.grade in GP);
            const att = graded.reduce((a, { r }) => a + r.att, 0);
            const pts = graded.reduce((a, { r }) => a + r.pts, 0);
            const earned = these.reduce((a, { r }) => a + (r.rep ? 0 : r.ern), 0);
            const load = these.reduce((a, { r }) => a + (r.ip ? r.att || r.ern : 0), 0);
            const ip = these.every(({ r }) => r.ip);
            return (
              <Card key={t || 'none'} id={termId(t)} className="scroll-mt-6 pb-3">
                <div className="flex items-start justify-between gap-4 px-5 pt-6 md:px-6">
                  <div className="min-w-0">
                    <h2 className="display truncate text-[19px] leading-7 md:text-[21px]">{t ? termLabel(t) : 'No term'}</h2>
                    <p className="mt-0.5 text-sm text-fg-3">
                      {these.length} {these.length === 1 ? 'course' : 'courses'}{ip ? (load ? <> · <span className="tnum">{load}</span> cr</> : null) : <> · <span className="tnum">{earned}</span> cr earned</>}
                    </p>
                  </div>
                  {ip ? (
                    <span className="mt-1 shrink-0 rounded-full bg-doing/25 px-2.5 py-0.5 text-xs text-fg">In progress</span>
                  ) : (
                    <div className="shrink-0 text-right">
                      <p className="tnum text-[22px] font-medium leading-7">{att ? num(pts / att) : '–'}</p>
                      <p className="text-xs text-fg-3">term GPA</p>
                    </div>
                  )}
                </div>
                <ul className="mt-3">
                  {these.map(({ r, i }) => (
                    <li key={i}>
                      <button type="button" onClick={() => setEditing(i)} className={cn('flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2/60 md:gap-4 md:px-6', r.rep && 'opacity-50')}>
                        <Code className="hidden w-[84px] shrink-0 text-[13px] text-fg-2 md:block">{r.code || '—'}</Code>
                        <div className="min-w-0 flex-1">
                          <p className={cn('truncate text-base', r.rep && 'line-through decoration-fg-3')}>{r.title || 'Untitled'}</p>
                          <p className="num text-xs text-fg-3 md:hidden">{r.code || '—'}</p>
                          {r.rep ? <p className="text-xs text-fg-3">Replaced by a later attempt</p> : null}
                          {r.odd && !r.rep ? <p className="text-xs text-warn">Grade not recognised, counted as in progress</p> : null}
                          {retakeOf(m, r) ? <p className="text-xs text-fg-2">Retake: replaces the {retakeOf(m, r)!.replaces}, adds no credits</p> : null}
                        </div>
                        <span className="num w-8 shrink-0 text-right text-sm text-fg-3">{r.att || r.ern || ''}</span>
                        <span className={cn('num w-9 shrink-0 text-right text-base font-medium', r.odd ? 'text-warn' : r.ip ? 'text-fg-3' : gradeTone(r.grade))}>
                          {r.odd ?? (r.ip ? 'IP' : r.grade)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </div>

      <EditRow index={editing} onClose={() => setEditing(null)} terms={terms} />
    </>
  );
}

/** An in-progress retake of a course already passed. */
const retakeOf = (m: Model, r: Row) => (r.ip ? m.result.retakes.find((x) => x.code === r.code && x.term === r.term) : undefined);

const termId = (t: string) => `term-${t.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'none'}`;

/** Totals and every term's GPA at a glance; each term jumps to its card. Sticks beside the list on wide screens. */
function Summary({ m, terms }: { m: Model; terms: string[] }) {
  const s = m.result.stats;
  const mobile = useIsMobile();
  const still = useReducedMotion();
  const gpaOf = new Map(m.series.map((p) => [p.term, p.gpa]));
  const figs: [string, string][] = [
    ['CGPA', s.att ? num(s.cgpa) : '–'],
    ['Earned', `${m.result.earned}`],
    ['Graded', `${s.att}`],
  ];
  return (
    <Card className="px-5 pb-5 pt-6 md:px-6 lg:sticky lg:top-6">
      <dl className="grid grid-cols-3 gap-4">
        {figs.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-sm text-fg-3">{label}</dt>
            <dd className="tnum mt-1.5 text-[24px] font-medium leading-none">{value}</dd>
          </div>
        ))}
      </dl>
      <TotalsCheck m={m} />
      <ul className="mt-5 border-t border-line pt-3">
        {terms.map((t, i) => {
          const g = gpaOf.get(t);
          return (
            <li key={t || 'none'}>
              <a href={`#${termId(t)}`} onClick={(e) => { e.preventDefault(); document.getElementById(termId(t))?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' }); }} className={cn('-mx-2 flex items-center gap-3 rounded-[10px] px-2 text-sm transition-colors hover:bg-surface-2', mobile ? 'h-10' : 'h-9')}>
                <span className="w-[92px] shrink-0 truncate text-fg-2">{t ? termLabel(t) : 'No term'}</span>
                <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-fg/[0.07]">
                  {g !== undefined ? (
                    <motion.span
                      className="absolute inset-y-0 left-0 rounded-full bg-done"
                      initial={still ? false : { width: 0 }}
                      animate={{ width: `${(g / 4) * 100}%` }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: still ? 0 : 0.1 + i * 0.04 }}
                    />
                  ) : null}
                </span>
                <span className="tnum w-9 shrink-0 text-right text-fg">{g !== undefined ? num(g) : <span className="text-fg-3">IP</span>}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function MoreMenu({ copy, pdf }: { copy: () => void; pdf: () => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" aria-label="Transcript options" className="grid size-10 place-items-center rounded-[12px] bg-surface text-fg-2 shadow-soft transition-colors hover:text-fg data-[state=open]:text-fg md:size-9 md:rounded-[10px]">
          <Ellipsis className="size-[18px]" strokeWidth={1.75} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={8} className="z-50 min-w-[210px] rounded-xl bg-surface p-1 shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1">
          <Menu.Item onSelect={copy} className="flex h-10 items-center gap-3 rounded-lg px-3 text-base outline-none data-[highlighted]:bg-surface-2">
            <Copy className="size-4 text-fg-3" strokeWidth={1.5} />Copy as a table
          </Menu.Item>
          <Menu.Item onSelect={pdf} className="flex h-10 items-center gap-3 rounded-lg px-3 text-base outline-none data-[highlighted]:bg-surface-2">
            <FileDown className="size-4 text-fg-3" strokeWidth={1.5} />Download PDF
          </Menu.Item>
          <Menu.Item onSelect={actions.startOver} className="flex h-10 items-center gap-3 rounded-lg px-3 text-base outline-none data-[highlighted]:bg-surface-2">
            <RotateCcw className="size-4 text-fg-3" strokeWidth={1.5} />New transcript
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function gradeTone(g: string) {
  const v = GP[g];
  if (v === undefined) return 'text-fg-3';
  if (v >= 1.7) return 'text-fg';
  if (v >= 1) return 'text-warn';
  return 'text-bad';
}

function TotalsCheck({ m }: { m: Model }) {
  if (!m.transcript.totals) return null;
  if (!m.problems.length) {
    return (
      <p className="mt-5 flex items-center gap-2 text-sm text-fg-3">
        <Check className="size-4" strokeWidth={1.75} />
        Matches the transcript's own totals
      </p>
    );
  }
  return (
    <div className="mt-5 flex gap-2.5 rounded-[14px] bg-warn/[0.1] p-3.5">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={1.5} />
      <div className="min-w-0">
        <p className="text-sm font-medium">Doesn't match the transcript totals</p>
        <ul className="mt-1 text-sm text-fg-2">{m.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      </div>
    </div>
  );
}

function EditRow({ index, onClose, terms }: { index: number | null; onClose: () => void; terms: string[] }) {
  const rows = useStore((s) => s.transcript?.rows ?? []);
  const r = index !== null ? rows[index] : undefined;
  const set = (patch: Partial<Row>) => { if (index !== null && r) actions.updateRow(index, { ...r, ...patch }); };
  const n = (v: string) => (v === '' || Number.isNaN(+v) ? 0 : +v);
  return (
    <Sheet
      open={!!r}
      onOpenChange={(o) => { if (!o) { if (r && !r.code && !r.title && index !== null) actions.removeRow(index); onClose(); } }}
      title={r?.code || 'New course'}
      footer={r ? (
        <div className="flex gap-2">
          <Button variant="danger" size="lg" onClick={() => { actions.removeRow(index!); onClose(); }}><Trash2 />Delete</Button>
          <Button variant="primary" size="lg" className="flex-1" onClick={onClose}>Done</Button>
        </div>
      ) : undefined}
    >
      {r ? (
        <div className="flex flex-col gap-4 pt-1">
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <Field label="Code"><Input className="num uppercase" value={r.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="COMP 101" /></Field>
            <Field label="Title"><Input value={r.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          </div>
          <Field label="Term">
            <Input list="term-list" value={r.term} onChange={(e) => set({ term: e.target.value })} placeholder="2026 Fall" />
            <datalist id="term-list">{terms.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
          <div>
            <Label className="mb-2">Grade</Label>
            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8">
              <GradeBtn on={r.ip} onClick={() => actions.updateRow(index!, regrade(r, ''))}>…</GradeBtn>
              {ALL_GRADES.map((g) => <GradeBtn key={g} on={!r.ip && r.grade === g} onClick={() => actions.updateRow(index!, regrade(r, g))}>{g}</GradeBtn>)}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Attempted"><Input className="num" inputMode="decimal" value={r.att} onChange={(e) => set({ att: n(e.target.value) })} /></Field>
            <Field label="Earned"><Input className="num" inputMode="decimal" value={r.ern} onChange={(e) => set({ ern: n(e.target.value) })} /></Field>
            <Field label="Points"><Input className="num" inputMode="decimal" value={r.pts} onChange={(e) => set({ pts: n(e.target.value) })} /></Field>
          </div>
          <SwitchRow title="Replaced by a later attempt" checked={r.rep} onChange={(v) => set({ rep: v })} />
        </div>
      ) : null}
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><Label className="mb-1.5">{label}</Label>{children}</label>;
}

function GradeBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cn('num h-10 rounded-[10px] text-sm transition-colors', on ? 'bg-fg text-bg' : 'bg-surface-2 text-fg-2 hover:bg-fg/[0.08] hover:text-fg')}>
      {children}
    </button>
  );
}
