'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
export default function Confirm() {
  const [token, setToken] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    const value = location.hash.slice(1);
    history.replaceState(null, '', '/confirm');
    const frame = requestAnimationFrame(() => setToken(value));
    return () => cancelAnimationFrame(frame);
  }, []);
  async function confirm() {
    setBusy(true);
    try {
      const response = await fetch('/api/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setNotice(data.message);
      setDone(true);
      setToken('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="site-shell content-page">
      <Link prefetch={false} className="back-link" href="/">
        ← Tibo Alerts
      </Link>
      <h1>One last click.</h1>
      <p>
        Confirm that you want to receive Codex reset alerts at this email
        address. You can change your preferences or unsubscribe at any time.
      </p>
      {!done ? (
        <Button disabled={!token || busy} onClick={confirm}>
          {busy ? 'Confirming…' : 'Confirm my email'}
        </Button>
      ) : (
        <Link prefetch={false} href="/manage">
          Manage my alerts →
        </Link>
      )}
      <output>
        {notice ||
          (!token && !done
            ? 'Open the confirmation link from your email.'
            : '')}
      </output>
    </main>
  );
}
