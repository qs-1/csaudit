import { ArrowUpRight, FileUp, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { NEW_ISSUE, REPO } from '@/lib/links';
import { useModel } from '@/state/model';
import { actions, useStore, type Theme } from '@/state/store';
import { ui, useUI } from '@/state/ui';
import { Button } from '@/ui/button';
import { Label } from '@/ui/card';
import { Segmented } from '@/ui/controls';
import { PalettePicker } from '@/ui/PalettePicker';
import { Sheet } from '@/ui/sheet';

/** A titled group in a side panel. */
export function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-4 first:pt-1">
      <Label className="mb-2">{title}</Label>
      {children}
    </section>
  );
}

export function Settings() {
  const open = useUI((s) => s.settings);
  const model = useModel();
  const theme = useStore((s) => s.theme);
  if (!model) return null;
  const { bare } = model;

  return (
    <Sheet open={open} onOpenChange={ui.settings} title="Settings">
      <div className="divide-y divide-line/70">
        <PanelSection title="Appearance">
          <Segmented<Theme>
            label="Theme"
            full
            value={theme}
            onChange={actions.theme}
            options={[
              { value: 'system', label: <span className="inline-flex items-center gap-1.5"><Monitor className="size-3.5" />Auto</span> },
              { value: 'light', label: <span className="inline-flex items-center gap-1.5"><Sun className="size-3.5" />Light</span> },
              { value: 'dark', label: <span className="inline-flex items-center gap-1.5"><Moon className="size-3.5" />Dark</span> },
            ]}
          />
        </PanelSection>

        <PanelSection title="Colours">
          <PalettePicker />
        </PanelSection>

        <PanelSection title="Transcript">
          <div className="flex min-h-12 items-center justify-between gap-4 py-2">
            <div className="min-w-0">
              <p className="text-base">{bare ? 'No transcript' : `${model.transcript.rows.length} courses loaded`}</p>
              <p className="text-sm text-fg-3">{bare ? 'Add one to check your degree. Your plan stays.' : 'Starting over clears plans and settings here.'}</p>
            </div>
            {bare
              ? <Button variant="secondary" onClick={() => { ui.settings(false); actions.addTranscript(); }}><FileUp strokeWidth={1.5} />Add transcript</Button>
              : <Button variant="secondary" onClick={() => { ui.settings(false); actions.startOver(); }}><RotateCcw strokeWidth={1.5} />New transcript</Button>}
          </div>
        </PanelSection>

        <PanelSection title="About">
          <p className="pb-1 text-sm text-fg-3">Free and open source. Something wrong for your batch? Say so.</p>
          {[{ href: REPO, label: 'Source code' }, { href: NEW_ISSUE, label: 'Report an issue' }].map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="-mx-2 flex h-11 items-center justify-between rounded-lg px-2 text-base transition-colors hover:bg-surface-2">
              {l.label}
              <ArrowUpRight className="size-4 text-fg-3" strokeWidth={1.5} />
            </a>
          ))}
        </PanelSection>
      </div>
    </Sheet>
  );
}
