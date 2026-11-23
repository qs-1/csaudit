import { useState } from 'react';
import { cn } from '@/lib/utils';
import { applyPalette, PALETTES, storedPalette } from '@/lib/palette';

/** Colour palette choice for Settings: courses, progress and figures all take their colours from it. */
export function PalettePicker() {
  const [id, setId] = useState(() => storedPalette().id);
  return (
    <div role="radiogroup" aria-label="Colours" className="grid grid-cols-2 gap-2">
      {PALETTES.map((p) => {
        const on = p.id === id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => { applyPalette(p); setId(p.id); }}
            className={cn(
              'flex flex-col gap-2 rounded-[12px] p-2.5 text-left transition-[background-color,box-shadow]',
              on ? 'bg-surface-2 shadow-[inset_0_0_0_1.5px_rgb(var(--fg))]' : 'hover:bg-surface-2',
            )}
          >
            <span className="flex h-6 gap-[3px]">
              {p.hex.map((h) => <span key={h} className="flex-1 rounded-[5px]" style={{ background: `#${h}` }} />)}
            </span>
            <span className={cn('text-sm', on ? 'text-fg' : 'text-fg-2')}>{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}
