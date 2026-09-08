'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ChannelPicker } from '@/app/channel-picker';
type Subscription = {
  channel: string;
  address: string;
  timezone: string;
  preference: string;
  status: string;
};
export default function Manage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]),
    [channel, setChannel] = useState('email'),
    [email, setEmail] = useState(''),
    [notice, setNotice] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const sub = subscriptions.find((s) => s.channel === channel);
  const update = (value: Subscription) =>
    setSubscriptions((all) =>
      all.map((s) => (s.channel === value.channel ? value : s)),
    );
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        let selected = '';
        const token = location.hash.slice(1);
        if (token) {
          history.replaceState(null, '', '/manage');
          const response = await fetch('/api/manage/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          });
          if (!response.ok)
            throw new Error('This management link is invalid or expired.');
          selected = (await response.json()).channel;
        }
        const all = await Promise.all(
          ['email', 'push'].map(async (channel) => {
            const response = await fetch(
              `/api/subscriptions/me?channel=${channel}`,
            );
            return response.ok ? response.json() : null;
          }),
        );
        const active = all.filter(Boolean);
        if (!cancelled) {
          setSubscriptions(active);
          setChannel(selected || active[0]?.channel || 'email');
        }
      } catch (error) {
        if (!cancelled)
          setNotice(
            error instanceof Error
              ? error.message
              : 'Could not load your subscription.',
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  async function action(
    path: string,
    body: unknown,
    method: 'POST' | 'PATCH' = 'POST',
  ) {
    setBusy(true);
    try {
      const response = await fetch(
        path + (path === '/api/manage/request' ? '' : `?channel=${channel}`),
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setNotice(data.message);
      if (path === '/api/unsubscribe') {
        setSubscriptions((all) => all.filter((s) => s.channel !== channel));
        if (channel === 'push' && 'serviceWorker' in navigator) {
          try {
            const registration =
              await navigator.serviceWorker.getRegistration();
            const device = await registration?.pushManager.getSubscription();
            await device?.unsubscribe();
          } catch {
            setNotice(
              'Alerts stopped. Remove this site’s notification permission in browser settings before signing up again.',
            );
          }
        }
      }
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
      <h1>
        Your alerts,
        <br />
        your way.
      </h1>
      {loading ? (
        <p>Loading your preferences…</p>
      ) : (
        <>
          <ChannelPicker value={channel} onChange={setChannel} />
          {sub ? (
            <>
              <p>
                {sub.address} · {sub.status}
              </p>
              <label className="field-label" htmlFor="manage-zone">
                Timezone
              </label>
              <Input
                id="manage-zone"
                value={sub.timezone}
                onChange={(e) => update({ ...sub, timezone: e.target.value })}
                className="form-input"
              />
              <span id="manage-preference" className="field-label">
                Notify me
              </span>
              <RadioGroup
                value={sub.preference}
                onValueChange={(value) =>
                  update({ ...sub, preference: String(value) })
                }
                aria-labelledby="manage-preference"
              >
                {[
                  ['announcement', 'When announced'],
                  ['reminder', 'At the scheduled time'],
                  ['both', 'Both'],
                ].map(([value, label]) => (
                  <label key={value} className="preference-option">
                    <RadioGroupItem value={value} />
                    <span>{label}</span>
                  </label>
                ))}
              </RadioGroup>
              <Button
                disabled={busy || sub.status !== 'active'}
                onClick={() =>
                  action(
                    '/api/subscriptions/me',
                    { timezone: sub.timezone, preference: sub.preference },
                    'PATCH',
                  )
                }
              >
                Save preferences
              </Button>
              <p>
                <Button
                  variant="outline"
                  disabled={busy || sub.status === 'suppressed'}
                  onClick={() => action('/api/unsubscribe', {})}
                >
                  Unsubscribe and remove contact details
                </Button>
              </p>
            </>
          ) : channel === 'push' ? (
            <p>
              No managed push subscription on this browser.{' '}
              <Link prefetch={false} href="/#subscribe">
                Enable notifications
              </Link>{' '}
              on the device where you want alerts.
            </p>
          ) : (
            <>
              <p>
                Open the management link in any alert email, or request a new
                link.
              </p>
              <label className="field-label" htmlFor="manage-email">
                Email address
              </label>
              <Input
                id="manage-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
                placeholder="you@example.com"
                autoComplete="email"
              />
              <Button
                disabled={busy || !email}
                onClick={() => action('/api/manage/request', { email })}
              >
                Email me a management link
              </Button>
            </>
          )}
        </>
      )}
      <output aria-live="polite">{notice}</output>
    </main>
  );
}
