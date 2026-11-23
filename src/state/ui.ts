import { create } from 'zustand';
import type { Section } from '@/engine';

/** Short-lived UI intents shared between screens. Not persisted. */
interface UI {
  settings: boolean;
  /** The "Your degree" panel on the Overview. */
  degree: boolean;
  /** Planner search to open on arrival, e.g. from "Still to take". */
  intent: { query?: string; course?: string; group?: string } | null;
  /** Planned section whose details panel is open. Kept here so opening it re-renders the panel, not the planner. */
  section: Section | null;
}
export const useUI = create<UI>()(() => ({ settings: false, degree: false, intent: null, section: null }));
export const ui = {
  settings: (open: boolean) => useUI.setState({ settings: open }),
  degree: (open: boolean) => useUI.setState({ degree: open }),
  intent: (intent: UI['intent']) => useUI.setState({ intent }),
  select: (section: Section | null) => useUI.setState({ section }),
};
