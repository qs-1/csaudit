import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';
import { applyPalette, storedPalette } from './lib/palette';
import { decodePlan } from './engine/share';
import { TERMS } from './data/registry';
import { actions, useStore } from './state/store';

applyPalette(storedPalette());

// A share link (?plan=…) opens that timetable in the planner. The query is then dropped so a reload doesn't reapply it.
const query = new URLSearchParams(window.location.search);
if (query.has('plan')) {
  const shared = decodePlan(query.get('plan'));
  const known = shared && TERMS.some((t) => t.id === shared.termId);
  if (known) actions.openShared(shared.termId, shared.plan);
  history.replaceState(null, '', `${window.location.pathname}${known ? '#/planner' : window.location.hash}`);
  setTimeout(() => (known ? toast('Opened a shared timetable', { description: useStore.getState().transcript ? 'Your own plan is unchanged until you choose to use this one.' : 'Add a transcript to see what it does for your degree.' }) : toast.error('That link has no timetable in it')), 400);
}

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// The theme class goes on before the first render, so a reload never paints a light frame in dark mode.
{
  const { theme } = useStore.getState();
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

// An update waits until the tab is in the background, then reloads there. Reloading the moment it finished
// installing (a few seconds after opening the site following a deploy) flashed the page white mid-use.
if (import.meta.env.PROD) {
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      const apply = () => { if (document.visibilityState === 'hidden') { document.removeEventListener('visibilitychange', apply); void update(); } };
      document.addEventListener('visibilitychange', apply);
      apply();
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
