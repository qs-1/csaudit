import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';
import { applyPalette, storedPalette } from './lib/palette';
import { decodePlan } from './engine/share';
import { TERMS } from './data/registry';
import { actions } from './state/store';

applyPalette(storedPalette());

// A share link (?plan=…) opens that timetable in the planner. The query is then dropped so a reload doesn't reapply it.
const query = new URLSearchParams(window.location.search);
if (query.has('plan')) {
  const shared = decodePlan(query.get('plan'));
  const known = shared && TERMS.some((t) => t.id === shared.termId);
  if (known) actions.openShared(shared.termId, shared.plan);
  history.replaceState(null, '', `${window.location.pathname}${known ? '#/planner' : window.location.hash}`);
  setTimeout(() => (known ? toast('Opened a shared timetable', { description: 'Add a transcript to see what it does for your degree.' }) : toast.error('That link has no timetable in it')), 400);
}

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

if (import.meta.env.PROD) registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
