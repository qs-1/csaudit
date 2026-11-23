import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { Import } from '@/features/import/Import';
import { useMedia } from '@/lib/hooks';
import { useRoute } from '@/lib/route';
import { useStore } from '@/state/store';
import { Shell } from './Shell';

function useTheme() {
  const theme = useStore((s) => s.theme);
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141415' : '#f8f8f6');
  }, [dark]);
  return dark;
}

export default function App() {
  const dark = useTheme();
  const hasTranscript = useStore((s) => s.transcript !== null || s.planOnly);
  const route = useRoute();
  // The import screen shows for any route while nothing is loaded; the address should say so too,
  // not keep #/overview from a transcript that was cleared.
  useEffect(() => {
    if (!hasTranscript && route !== 'import') history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, [hasTranscript, route]);
  return (
    <>
      {hasTranscript && route !== 'import' ? <Shell /> : <Import />}
      <Toaster
        theme={dark ? 'dark' : 'light'}
        position="top-center"
        offset={16}
        toastOptions={{ className: '!rounded-xl !border-line !bg-surface !text-fg !shadow-pop !font-sans' }}
      />
    </>
  );
}
