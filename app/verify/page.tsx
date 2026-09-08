'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
export default function Verify() {
  const [notice, setNotice] = useState('');
  async function device() {
    try {
      const data = await (await fetch('/api/public')).json();
      if (!data.capabilities.vapidPublicKey)
        throw new Error('The operator has not configured VAPID yet.');
      if (!('serviceWorker' in navigator) || !('PushManager' in window))
        throw new Error(
          'Use a supported browser. On iPhone, install this site on the Home Screen first.',
        );
      if ((await Notification.requestPermission()) !== 'granted')
        throw new Error('Notification permission was not granted.');
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
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        }));
      const blob = new Blob([JSON.stringify(subscription.toJSON())], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tibo-test-device.json';
      a.click();
      URL.revokeObjectURL(url);
      setNotice(
        'Device file downloaded. Keep it private and give it only to your operator for the test you requested. This does not subscribe you to public alerts.',
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Could not prepare this device.',
      );
    }
  }
  return (
    <main className="site-shell content-page">
      <Link prefetch={false} href="/">
        ← Tibo Alerts
      </Link>
      <h1>Test this device.</h1>
      <p>
        Operator setup only. Enable notifications on your own device, then
        download its private push subscription for a delivery test. No alert
        signup happens here.
      </p>
      <Button onClick={device}>
        Enable test notifications and download device file
      </Button>
      <output>{notice}</output>
    </main>
  );
}
