import { PROGRAMS } from '@/data/registry';
import type { Model } from '@/state/model';
import { actions, useStore } from '@/state/store';
import { ui, useUI } from '@/state/ui';
import { Stepper, SwitchRow } from '@/ui/controls';
import { PanelSection } from '@/features/settings/Settings';
import { Sheet } from '@/ui/sheet';

/**
 * What the audit assumes about this student: which checklist, how many credits, pre-med, specialization, exemptions.
 * Lives with the Overview because every switch here changes what the Overview says.
 */
export function DegreePanel({ m }: { m: Model }) {
  const open = useUI((s) => s.degree);
  const programId = useStore((s) => s.programId);
  const as = useStore((s) => s.assumptions);
  const { catalog } = m;
  // Courses already passed can't be exempted, so they aren't offered.
  const passed = new Set(m.result.lines.filter((l) => l.state === 'done').map((l) => l.code));
  const exemptible = catalog.exemptible.filter((c) => !passed.has(c));
  const titles = Object.fromEntries(catalog.groups.flatMap((g) => (g.kind === 'all' ? g.courses.map((c) => [c.code, c.title]) : [])));

  return (
    <Sheet open={open} onOpenChange={ui.degree} title="Your degree">
      <div className="divide-y divide-line/70">
        {PROGRAMS.length > 1 ? (
          <PanelSection title="Checklist">
            <select
              aria-label="Degree checklist"
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-base"
              value={programId ?? ''}
              onChange={(e) => actions.setProgram(e.target.value || null)}
            >
              <option value="">Detect from transcript ({catalog.label})</option>
              {PROGRAMS.map((p) => <option key={p.id} value={p.id}>{p.label} · {p.catalogYear}</option>)}
            </select>
          </PanelSection>
        ) : null}

        <PanelSection title="Requirements">
          <div className="flex min-h-12 items-center justify-between gap-4 py-2">
            <div>
              <p className="text-base">Credits to graduate</p>
              <p className="text-sm text-fg-3">{catalog.catalogYear} checklist: {catalog.totalCredits}</p>
            </div>
            <Stepper
              label="Credits to graduate"
              value={as.totalCredits ?? catalog.totalCredits}
              min={100}
              max={170}
              onChange={(v) => actions.assume({ totalCredits: v === catalog.totalCredits ? null : v })}
            />
          </div>
          {catalog.tracks?.length ? (
            <div className="flex min-h-12 items-center justify-between gap-4 py-2">
              <div>
                <p className="text-base">Specialization</p>
                <p className="text-sm text-fg-3">Optional. Counts electives from the chosen cluster.</p>
              </div>
              <select
                aria-label="Specialization"
                className="h-10 rounded-xl border border-line bg-surface px-3 text-base"
                value={catalog.tracks.some((t) => t.id === as.track) ? as.track! : ''}
                onChange={(e) => actions.assume({ track: e.target.value || null })}
              >
                <option value="">None</option>
                {catalog.tracks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          ) : null}
          {catalog.deficiency.length ? (
            <SwitchRow
              title="Pre-medical background"
              sub={`Adds ${catalog.deficiency.map((c) => c.code).join(' and ')}`}
              checked={as.premed}
              onChange={(v) => actions.assume({ premed: v })}
            />
          ) : null}
        </PanelSection>

        {exemptible.length ? (
          <PanelSection title="Exemptions">
            {exemptible.map((code) => (
              <SwitchRow
                key={code}
                title={<><span className="num text-sm font-medium">{code}</span> <span className="text-fg-2">{titles[code]}</span></>}
                checked={as.exempt.includes(code)}
                onChange={(v) => actions.toggleExempt(code, v)}
              />
            ))}
          </PanelSection>
        ) : null}
      </div>
    </Sheet>
  );
}
