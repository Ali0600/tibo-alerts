import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createECDH } from 'node:crypto';
import webpush from 'web-push';
import { sendDelivery } from '../worker/transport';
import type { Delivery } from '../core/types';
const now = Date.now();
const email: Delivery = {
  id: 'job',
  attemptId: 'attempt',
  channel: 'email',
  kind: 'announcement',
  destination: { email: 'opted-in@example.com', manageToken: 'token' },
  subject: 'Reset announced',
  text: 'Scheduled reset time',
  url: 'https://alerts.example/',
  expiresAt: now + 100000,
  tag: 'reset',
  unsubscribeUrl: 'https://alerts.example/unsubscribe',
};
await test('email submits one recipient with an attempt identity and unsubscribe headers', async () => {
  let called = 0;
  const result = await sendDelivery(
    email,
    { EMAIL_FROM: 'sender@example.com', BREVO_API_KEY: 'test' },
    async (url, init) => {
      called++;
      assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
      assert.equal(typeof init?.body, 'string');
      const body = JSON.parse(init!.body as string);
      assert.deepEqual(body.to, [{ email: 'opted-in@example.com' }]);
      assert.equal(body.headers.idempotencyKey, 'attempt');
      assert.equal(
        body.headers['List-Unsubscribe-Post'],
        'List-Unsubscribe=One-Click',
      );
      assert.equal(init?.redirect, 'error');
      return Response.json({ messageId: 'provider-id' }, { status: 201 });
    },
    now,
  );
  assert.equal(called, 1);
  assert.deepEqual(result, { outcome: 'sent', providerId: 'provider-id' });
});
await test('expired delivery never contacts the provider', async () => {
  const result = await sendDelivery(
    { ...email, expiresAt: now },
    {},
    async () => {
      throw new Error('provider must not be called');
    },
    now,
  );
  assert.equal(result.outcome, 'expired');
});
await test('unknown provider outcomes are not automatically retried', async () => {
  for (const status of [500, 502, 503])
    assert.equal(
      (
        await sendDelivery(
          email,
          { EMAIL_FROM: 'sender@example.com', BREVO_API_KEY: 'test' },
          async () => new Response('', { status }),
          now,
        )
      ).outcome,
      'unknown',
    );
  assert.equal(
    (
      await sendDelivery(
        email,
        { EMAIL_FROM: 'sender@example.com', BREVO_API_KEY: 'test' },
        async () => {
          throw new TypeError('lost response');
        },
        now,
      )
    ).outcome,
    'unknown',
  );
  assert.equal(
    (
      await sendDelivery(
        email,
        { EMAIL_FROM: 'sender@example.com', BREVO_API_KEY: 'test' },
        async () => new Response('', { status: 429 }),
        now,
      )
    ).outcome,
    'retry',
  );
});
await test('Web Push expires at the job deadline and removes invalid devices', async () => {
  const keys = webpush.generateVAPIDKeys();
  const delivery = {
    ...email,
    channel: 'push' as const,
    destination: {
      manageToken: 'token',
      push: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/device',
        keys: {
          p256dh: createECDH('prime256v1').generateKeys().toString('base64url'),
          auth: randomBytes(16).toString('base64url'),
        },
      },
    },
  };
  const result = await sendDelivery(
    delivery,
    {
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: 'mailto:operator@example.com',
    },
    async (url, init) => {
      assert.equal(url, delivery.destination.push.endpoint);
      assert.equal(Number(new Headers(init?.headers).get('TTL')), 100);
      assert(init?.body);
      return new Response('', { status: 410 });
    },
    now,
  );
  assert.equal(result.outcome, 'invalid');
});
