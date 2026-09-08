'use client';
import Link from 'next/link';

import { registerAlertTools } from './webmcp';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Bell, Clock3, Globe, RefreshCw } from './icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChannelPicker } from '@/app/channel-picker';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';

type Preference = 'announcement' | 'reminder' | 'both';
type Event = {
  id: string;
  kind: string;
  text: string;
  sourceUrl: string;
  publishedAt: string;
  scheduledAt: string | null;
  timingText: string | null;
};
type PublicData = {
  events: Event[];
  source: { state: string; lastSuccessAt: string | null };
  delivery: { state: string; lastSuccessAt: string | null };
  capabilities: {
    email: boolean;
    push: boolean;
    vapidPublicKey: string | null;
  };
  emailSlots: number;
  repositoryUrl?: string;
};
const initial: PublicData = {
  events: [],
  source: { state: 'unconfigured', lastSuccessAt: null },
  delivery: { state: 'unconfigured', lastSuccessAt: null },
  capabilities: { email: false, push: false, vapidPublicKey: null },
  emailSlots: 50,
};

export function AlertApp() {
  const [data, setData] = useState(initial);
  const [timezone, setTimezone] = useState('UTC');
  const [preference, setPreference] = useState<Preference>('both');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [channel, setChannel] = useState('email');
  const [loadError, setLoadError] = useState(false);
  const [requested, setRequested] = useState<Event | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventMissing, setEventMissing] = useState(false);
  useEffect(() => {
    const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const controller = new AbortController();
    const id = new URL(location.href).searchParams.get('event');
    const frame = requestAnimationFrame(() => {
      setTimezone(detectedTimezone);
      setEventId(id);
    });
    async function refresh() {
      try {
        const response = await fetch('/api/public', {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unavailable');
        setData(await response.json());
        setLoadError(false);
        if (id) {
          const event = await fetch(
            '/api/events?id=' + encodeURIComponent(id),
            { signal: controller.signal },
          );
          if (event.ok) {
            setRequested(await event.json());
            setEventMissing(false);
          } else {
            setRequested(null);
            setEventMissing(true);
          }
        }
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      }
    }
    void refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => registerAlertTools(setTimezone), []);
  const date = (value: string) => {
    try {
      return new Intl.DateTimeFormat('en', {
        timeZone: timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(new Date(value));
    } catch {
      return 'Choose a valid timezone';
    }
  };
  async function subscribe() {
    setNotice('');
    setBusy(true);
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
      let subscription;
      if (channel === 'push') {
        if (!('serviceWorker' in navigator) || !('PushManager' in window))
          throw new Error(
            'This browser does not support push. On iPhone, add this site to your Home Screen first.',
          );
        if (!data.capabilities.vapidPublicKey)
          throw new Error('Push alerts are not connected yet.');
        if ((await Notification.requestPermission()) !== 'granted')
          throw new Error(
            'Notifications were not enabled. You can use email instead.',
          );
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        const key = Uint8Array.from(
          atob(
            data.capabilities.vapidPublicKey
              .replace(/-/g, '+')
              .replace(/_/g, '/'),
          ),
          (c) => c.charCodeAt(0),
        );
        subscription = (
          (await registration.pushManager.getSubscription()) ||
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          }))
        ).toJSON();
      }
      const response = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          email,
          subscription,
          timezone,
          preference,
          consent,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (channel === 'push' && response.status === 409) {
          const registration = await navigator.serviceWorker.getRegistration();
          await (
            await registration?.pushManager.getSubscription()
          )?.unsubscribe();
        }
        throw new Error(
          result.error || 'Could not subscribe. Please try again.',
        );
      }
      setNotice(
        channel === 'email'
          ? 'Check your inbox for a confirmation link. Alerts begin after you confirm.'
          : 'Notifications enabled. You can manage this device below.',
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Could not subscribe. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  const latest = eventId ? requested : data.events[0];
  const sourceLabel: Record<string, string> = {
    healthy: 'Watching for resets',
    unconfigured: 'Scanner not yet verified',
    failed: 'Source check failed',
    stale: 'Source check overdue',
    gap: 'Source coverage incomplete',
  };
  const ready =
    channel === 'email'
      ? data.capabilities.email && data.emailSlots > 0
      : data.capabilities.push;
  return (
    <section className="main-grid" aria-label="Reset announcements and signup">
      <div className="announcements">
        <div className="section-kicker">
          <span>LATEST SIGNAL</span>
          <a
            href="https://x.com/thsottiaux"
            target="_blank"
            rel="noopener noreferrer"
          >
            @thsottiaux <ArrowUpRight size={13} />
          </a>
        </div>
        <article className="signal-card">
          <div className="signal-top">
            <span className="quiet-badge">
              <span
                className={`status-dot ${data.source.state === 'healthy' ? '' : 'amber'}`}
              />
              {loadError
                ? 'Status unavailable'
                : sourceLabel[data.source.state] || 'Source unavailable'}
            </span>
            <RefreshCw size={19} className="muted" />
          </div>
          {latest ? (
            <>
              <p className="signal-label">
                {latest.kind === 'cancelled'
                  ? 'RESET CANCELLED'
                  : latest.kind === 'completed'
                    ? 'RESET ANNOUNCED AS COMPLETE'
                    : latest.kind === 'grant'
                      ? 'BANKED RESET GRANT'
                      : 'RESET ANNOUNCEMENT'}
              </p>
              <h2>
                {latest.scheduledAt
                  ? date(latest.scheduledAt)
                  : latest.timingText ||
                    (latest.kind === 'cancelled'
                      ? 'Scheduled reset cancelled'
                      : 'A fresh start for Codex')}
              </h2>
              <p className="post-text">{latest.text}</p>
              <a
                className="text-link"
                href={latest.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Read Tibo’s announcement <ArrowUpRight size={15} />
              </a>
              <p className="small muted">Posted {date(latest.publishedAt)}</p>
            </>
          ) : (
            <>
              <div className="empty-icon">
                <Clock3 size={31} strokeWidth={1.4} />
              </div>
              <h2>
                {eventMissing
                  ? 'Announcement unavailable.'
                  : 'Ready for the next reset.'}
              </h2>
              <p className="empty-copy">
                Verified announcements will appear here,
                <br />
                with the time translated to your timezone.
              </p>
              <div className="empty-note">
                {eventMissing
                  ? 'This link may refer to an expired announcement.'
                  : 'No verified announcements yet.'}
              </div>
            </>
          )}
          <div className="signal-footer">
            <Globe size={14} />
            <span>
              Times shown in <strong>{timezone.replaceAll('_', ' ')}</strong>
            </span>
          </div>
        </article>
        <div className="status-line">
          <span>
            <span
              className={`status-dot ${data.source.state === 'healthy' ? '' : 'amber'}`}
            />{' '}
            Source{' '}
            {data.source.lastSuccessAt
              ? `checked ${date(data.source.lastSuccessAt)}`
              : 'awaiting verification'}
          </span>
          <span>
            <span
              className={`status-dot ${data.delivery.state === 'healthy' ? '' : 'amber'}`}
            />{' '}
            Delivery{' '}
            {data.delivery.state === 'failed'
              ? 'check failed · '
              : data.delivery.state === 'stale'
                ? 'check overdue · '
                : ''}
            {data.delivery.lastSuccessAt
              ? `checked ${date(data.delivery.lastSuccessAt)}`
              : 'not connected'}
          </span>
        </div>
        <p className="source-note">
          A community project following Tibo’s public announcements. We can’t
          see or change your Codex usage limits.
        </p>
      </div>
      <aside className="signup-card" id="subscribe">
        <div className="signup-heading">
          <div>
            <h2>Get the next heads-up.</h2>
            <p>Choose where we should find you.</p>
          </div>
          <Bell size={23} strokeWidth={1.5} />
        </div>
        <div>
          <ChannelPicker
            value={channel}
            onChange={(v) => {
              setChannel(v);
              setNotice('');
            }}
          />
          {channel === 'email' ? (
            <div>
              <label className="field-label" htmlFor="email">
                Email address
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
              />
            </div>
          ) : (
            <div>
              <p className="push-explanation">
                A notification on this device, even with this page closed. On
                iPhone or iPad, add this site to your Home Screen, open it
                there, then enable notifications.
              </p>
            </div>
          )}
        </div>
        <label className="field-label" htmlFor="timezone">
          Your timezone <span>Auto-detected</span>
        </label>
        <div className="timezone-field">
          <Globe size={16} />
          <Input
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="form-input"
            spellCheck={false}
            autoComplete="off"
            aria-describedby="timezone-help"
          />
        </div>
        <p id="timezone-help" className="field-help">
          Use a timezone like Europe/Berlin or America/New_York.
        </p>
        <span className="field-label" id="preference-label">
          Notify me
        </span>
        <RadioGroup
          value={preference}
          onValueChange={(v) => setPreference(v as Preference)}
          aria-labelledby="preference-label"
          className="preference-options"
        >
          {[
            [
              'announcement',
              'When announced',
              'A heads-up as soon as we detect the post.',
            ],
            [
              'reminder',
              'At the scheduled time',
              'A reminder when a clear reset time is given.',
            ],
            [
              'both',
              'Both, please',
              'The announcement and a scheduled reminder.',
            ],
          ].map(([value, title, copy]) => (
            <label
              className="preference-option"
              key={value}
              htmlFor={`preference-${value}`}
            >
              <RadioGroupItem id={`preference-${value}`} value={value} />
              <span>
                <strong>{title}</strong>
                <small>{copy}</small>
              </span>
            </label>
          ))}
        </RadioGroup>
        <label className="consent" htmlFor="alert-consent">
          <Checkbox
            id="alert-consent"
            checked={consent}
            onCheckedChange={(v) => setConsent(v === true)}
          />
          <span>
            I’d like reset alerts. I can unsubscribe anytime.{' '}
            <Link prefetch={false} href="/privacy">
              Privacy
            </Link>
          </span>
        </label>
        <Button
          className="subscribe-button"
          onClick={subscribe}
          disabled={
            !consent || busy || !ready || (channel === 'email' && !email)
          }
        >
          {busy
            ? 'One moment…'
            : ready
              ? channel === 'email'
                ? 'Send me reset alerts'
                : 'Enable notifications'
              : 'Alerts opening soon'}
          <ArrowUpRight size={17} />
        </Button>
        <p className="signup-footnote">
          {ready
            ? 'Just resets. No marketing. No noise.'
            : 'Signup opens after the scanner and delivery checks pass.'}
        </p>
        <output className="notice" aria-live="polite">
          {notice}
        </output>
      </aside>
    </section>
  );
}
