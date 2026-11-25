import { useSyncExternalStore } from 'react';

export const ROUTES = ['import', 'overview', 'planner', 'gpa', 'transcript', 'seats', 'docs'] as const;
export type Route = (typeof ROUTES)[number];

const read = (): Route => {
  const h = window.location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(h) ? h : 'import';
};

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); },
    read,
    () => 'import' as Route,
  );
}

export function go(route: Route) {
  // The shell scrolls to the top once the new screen is in place.
  if (window.location.hash !== `#/${route}`) window.location.hash = `/${route}`;
}
