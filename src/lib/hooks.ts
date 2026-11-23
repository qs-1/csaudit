import { useEffect, useState, useSyncExternalStore } from 'react';

export function useMedia(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}

/** Phone layout: bottom tabs, drawers and agenda views. */
export const useIsMobile = () => !useMedia('(min-width: 768px)', true);

export function useHotkey(key: string, fn: (e: KeyboardEvent) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const combo = key.startsWith('mod+') ? (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === key.slice(4) : !typing && e.key === key;
      if (combo) fn(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, fn, enabled]);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
