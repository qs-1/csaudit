import { toast } from 'sonner';
import { create } from 'zustand';
import {
  DEFAULT_ASSUMPTIONS, DEFAULT_PREFS, GP, NO_CREDIT, parseTranscript, type CreditLookup,
  type Assumptions, type Prefs, type Row, type Transcript,
} from '@/engine';
import { SAMPLE_TRANSCRIPT } from '@/data/sample';
import { TERMS } from '@/data/registry';

export type Theme = 'system' | 'light' | 'dark';
export type Plan = Record<string, string>; // course -> section, or DROPPED for a registered course taken off
/** In a plan: this course is registered on the transcript but dropped in the plan. */
export const DROPPED = '';

export interface State {
  transcript: Transcript | null;
  transcriptText: string;
  planOnly: boolean; // planner without a transcript
  programId: string | null; // null: detect from the transcript
  assumptions: Assumptions;
  termId: string | null; // null: the term after the transcript
  plans: Record<string, Plan>; // term id -> plan
  retakes: Record<string, string>; // course -> hoped-for grade
  prefs: Prefs;
  target: number | null; // null: a little above the current CGPA
  theme: Theme;
}

const initial = (): State => ({
  transcript: null,
  transcriptText: '',
  planOnly: false,
  programId: null,
  assumptions: { ...DEFAULT_ASSUMPTIONS, exempt: [] },
  termId: null,
  plans: {},
  retakes: {},
  prefs: { ...DEFAULT_PREFS, daysOff: [] },
  target: null,
  theme: 'system',
});

/** Kept for this tab only (session storage): a reload keeps it, closing the tab forgets it. A reload happens
 *  without the user asking (an app update, the dev server), and losing the transcript to one looked like a crash. */
const SESSION = 'fccu-audit-session';
const restore = (): State => {
  try {
    const saved = sessionStorage.getItem(SESSION);
    if (saved) return { ...initial(), ...(JSON.parse(saved) as Partial<State>) };
  } catch { /* storage blocked or unreadable */ }
  return initial();
};

export const useStore = create<State>()(restore);

let pending = 0;
useStore.subscribe((s) => {
  // Coalesced: dragging a grade or typing a target changes state many times a second.
  if (typeof window === 'undefined') return;
  window.clearTimeout(pending);
  pending = window.setTimeout(() => { try { sessionStorage.setItem(SESSION, JSON.stringify(s)); } catch { /* full or blocked */ } }, 150);
});
// A reload inside the coalescing window would lose the last change; save it as the page goes.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { try { sessionStorage.setItem(SESSION, JSON.stringify(useStore.getState())); } catch { /* blocked */ } });
}

// Earlier builds saved to local storage. Clear anything they left behind.
try { localStorage.removeItem('fccu-audit'); } catch { /* storage blocked */ }

const set = useStore.setState;
const UNDO = 'start-over';
const get = useStore.getState;

/** When a grade is edited by hand, earned credits and points follow it. */
export function regrade(row: Row, grade: string): Row {
  const { odd: _, ...r } = row; // picking a grade settles one the reader didn't know
  if (grade === '') return { ...r, grade: '', ip: true, att: 0, ern: 0, pts: 0 };
  const credits = r.att || r.ern || 3;
  const counts = grade in GP;
  return { ...r, grade, ip: false, att: counts ? credits : 0, ern: NO_CREDIT.has(grade) ? 0 : credits, pts: (GP[grade] ?? 0) * credits };
}

export const actions = {
  /** Reads pasted or extracted text. Returns false when no courses were found. */
  /** `credits` fills in credits for transcripts that don't list them (see isScheduleTranscript). */
  load(raw: string, credits?: CreditLookup): boolean {
    const tr = parseTranscript(raw, credits);
    if (!tr.rows.length) return false;
    toast.dismiss(UNDO); // the undo offer is about the transcript this one replaces
    // Plans made before are kept, except picks for courses the transcript now shows registered in that term:
    // the registration is the truth, and a stale pick would hide the section actually registered.
    const plans = Object.fromEntries(Object.entries(get().plans).map(([id, plan]) => {
      const key = TERMS.find((t) => t.id === id)?.key;
      const registered = new Set(tr.rows.filter((r) => r.ip && r.term === key).map((r) => r.code));
      return [id, Object.fromEntries(Object.entries(plan).filter(([c]) => !registered.has(c)))];
    }));
    set({ transcript: tr, transcriptText: raw, planOnly: false, programId: null, termId: null, plans });
    return true;
  },
  /** Opens the planner without a transcript. One loaded earlier (back on the import screen) is dropped; plans stay. */
  planOnly() { set({ planOnly: true, transcript: null, transcriptText: '', programId: null, termId: null }); },
  /** From the planner-only mode to the import screen, keeping the plan. */
  addTranscript() { set({ planOnly: false }); },
  setRows(rows: Row[]) { set((s) => ({ transcript: s.transcript ? { ...s.transcript, rows } : s.transcript })); },
  updateRow(i: number, row: Row) {
    const t = get().transcript;
    if (t) actions.setRows(t.rows.map((r, j) => (j === i ? row : r)));
  },
  removeRow(i: number) {
    const t = get().transcript;
    if (t) actions.setRows(t.rows.filter((_, j) => j !== i));
  },
  setProgram(programId: string | null) { set({ programId }); },
  assume(p: Partial<Assumptions>) { set((s) => ({ assumptions: { ...s.assumptions, ...p } })); },
  toggleExempt(code: string, on: boolean) {
    set((s) => {
      const ex = s.assumptions.exempt.filter((c) => c !== code);
      return { assumptions: { ...s.assumptions, exempt: on ? [...ex, code] : ex } };
    });
  },
  setTerm(termId: string) { set({ termId }); },
  pick(termId: string, course: string, sec: string) {
    set((s) => ({ plans: { ...s.plans, [termId]: { ...s.plans[termId], [course]: sec } } }));
  },
  merge(termId: string, p: Plan) { set((s) => ({ plans: { ...s.plans, [termId]: { ...s.plans[termId], ...p } } })); },
  unpick(termId: string, course: string) {
    set((s) => {
      const { [course]: _, ...rest } = s.plans[termId] ?? {};
      return { plans: { ...s.plans, [termId]: rest } };
    });
  },
  /** Opens a timetable from a share link: its term and sections, in the planner. A transcript can be added after. */
  openShared(termId: string, p: Plan) {
    set((s) => ({ termId, planOnly: s.transcript === null, plans: { ...s.plans, [termId]: p } }));
  },
  replacePlan(termId: string, p: Plan) { set((s) => ({ plans: { ...s.plans, [termId]: p } })); },
  retake(code: string, grade: string | undefined) {
    set((s) => {
      const { [code]: _, ...rest } = s.retakes;
      return { retakes: grade ? { ...rest, [code]: grade } : rest };
    });
  },
  prefs(p: Partial<Prefs>) { set((s) => ({ prefs: { ...s.prefs, ...p } })); },
  target(target: number) { set({ target }); },
  theme(theme: Theme) { set({ theme }); },
  /** Starts over with a different transcript. Keeps the theme. */
  reset() { set({ ...initial(), theme: get().theme }); },
  /** Back to the import screen, with a few seconds to undo. The cleared transcript is gone after that. */
  startOver() {
    const prev = get();
    actions.reset();
    // The sample is one click away on the import screen, so clearing it needs no undo.
    if (prev.transcriptText === SAMPLE_TRANSCRIPT) return;
    toast('Transcript cleared', { id: UNDO, action: { label: 'Undo', onClick: () => set(prev) }, duration: 8000 });
  },
};
