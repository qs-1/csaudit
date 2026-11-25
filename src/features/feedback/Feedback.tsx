import { useState } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';
import { Button } from '@/ui/button';
import { Input } from '@/ui/controls';
import { Sheet } from '@/ui/sheet';

/** Feedback goes to the seats Worker, which posts it to the maintainer's Discord. Nothing else is sent with it. */
const useFeedback = create<{ open: boolean }>(() => ({ open: false }));
export const openFeedback = () => useFeedback.setState({ open: true });

export function Feedback() {
  const open = useFeedback((s) => s.open);
  const close = (v: boolean) => useFeedback.setState({ open: v });
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (message.trim().length < 3 || busy) return;
    setBusy(true);
    setError('');
    try {
      const page = window.location.hash.replace(/^#\/?/, '') || 'home';
      const res = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, contact, page }) });
      const body = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok || !body) throw new Error(body?.error ?? 'Couldn’t send it. Try again in a minute.');
      setMessage('');
      setContact('');
      close(false);
      toast('Sent. Thanks!');
    } catch (e) {
      setError(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'Couldn’t send it. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title="Send feedback"
      side="center"
      autoFocus
      footer={<Button variant="primary" className="w-full md:w-auto" disabled={busy || message.trim().length < 3} onClick={() => void send()}>{busy ? 'Sending' : 'Send'}</Button>}
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-3">A bug, something wrong for your batch, or an idea. It goes straight to the maintainer.</p>
        <textarea
          value={message}
          onChange={(e) => { setMessage(e.target.value); setError(''); }}
          maxLength={1500}
          rows={6}
          placeholder="What happened?"
          aria-label="Message"
          className="w-full resize-none rounded-lg border border-line bg-surface p-3 text-base text-fg outline-none placeholder:text-fg-3 focus:border-fg-3 focus-visible:ring-4 focus-visible:ring-info/15"
        />
        <Input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={100} placeholder="Email or Discord, if you want a reply (optional)" aria-label="Contact" />
        {error ? <p className="text-sm text-bad">{error}</p> : null}
      </div>
    </Sheet>
  );
}
