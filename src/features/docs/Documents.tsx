import { ArrowUpRight } from 'lucide-react';
import { ScreenHeader } from '@/app/Shell';
import { asset, PROGRAMS, TERMS } from '@/data/registry';
import type { Catalog } from '@/engine';
import { cn } from '@/lib/utils';
import { useModel } from '@/state/model';
import { Card, CardHead } from '@/ui/card';

const KINDS = [
  { kind: 'checklist', label: 'Degree checklist' },
  { kind: 'roadmap', label: 'Roadmap' },
  { kind: 'catalogue', label: 'Course catalogue' },
] as const;

/** Official documents, one card per batch. The student's own batch comes first. */
export function Documents() {
  const m = useModel();
  const mine = m && !m.bare ? m.catalog.id : null;
  const batches = [...PROGRAMS].sort((a, b) => (a.id === mine ? -1 : b.id === mine ? 1 : b.batch - a.batch));
  const term = TERMS[TERMS.length - 1];

  return (
    <>
      <ScreenHeader eyebrow="BS Computer Science" title="Documents" />
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
        {batches.map((p) => <Batch key={p.id} p={p} mine={p.id === mine} />)}
        {term?.links?.length ? (
          <Card className="pb-3">
            <CardHead title={term.label} sub="Registration" />
            <div className="mt-3 px-2 md:px-3">
              {term.links.map((l) => <Row key={l.href} label={l.label} href={l.href} />)}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function Batch({ p, mine }: { p: Catalog; mine: boolean }) {
  return (
    <Card className={cn('pb-3', mine && 'md:col-span-2')}>
      <CardHead title={`Batch ${p.batch}`} sub={`${mine ? 'Your batch · admitted' : 'Admitted'} ${p.admits.join(', ')} · ${p.catalogYear} checklist`} />
      <div className="mt-3 px-2 md:px-3">
        {KINDS.map(({ kind, label }) => {
          const l = p.links?.find((x) => (x.kind ?? 'checklist') === kind);
          return <Row key={kind} label={label} note={l?.note} href={l?.href} />;
        })}
      </div>
    </Card>
  );
}

/** A document row. Without a link it stays in place, muted, so every batch reads the same way. */
function Row({ label, note, href }: { label: string; note?: string; href?: string }) {
  const body = (
    <>
      <span className={cn('min-w-0 flex-1 truncate text-base', !href && 'text-fg-3')}>{label}</span>
      <span className="shrink-0 text-sm text-fg-3">{href ? note ?? (href.endsWith('.pdf') ? 'PDF' : 'Page') : 'Not added yet'}</span>
      <ArrowUpRight className={cn('size-4 shrink-0 text-fg-3 transition-colors group-hover:text-fg', !href && 'invisible')} strokeWidth={1.5} />
    </>
  );
  const cls = 'group flex h-12 items-center gap-3 rounded-[12px] px-3';
  return href
    ? <a href={asset(href)} target="_blank" rel="noreferrer" className={cn(cls, 'transition-colors hover:bg-fg/[0.04]')}>{body}</a>
    : <div className={cls}>{body}</div>;
}
