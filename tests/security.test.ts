import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import {
  validatePush,
  validTimezone,
  encrypt,
  decrypt,
  normalizeEmail,
  readJson,
} from '../core/security';
const keys = () => ({
  p256dh: createECDH('prime256v1').generateKeys().toString('base64url'),
  auth: randomBytes(16).toString('base64url'),
});
await test('push accepts valid standard subscription', () => {
  const value = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: keys(),
  };
  assert.deepEqual(validatePush(value), value);
});
await test('push rejects outbound request targets and deceptive hostnames', () => {
  for (const endpoint of [
    'http://fcm.googleapis.com/x',
    'https://127.0.0.1/x',
    'https://localhost/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evil.example@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:444/x',
    'https://[::1]/x',
    'https://fcm.googleapis.com/x#fragment',
  ])
    assert.throws(
      () => validatePush({ endpoint, keys: keys() }),
      /push/,
      endpoint,
    );
});
await test('push key arrays cannot coerce into validated strings', () => {
  const k = keys();
  assert.throws(() =>
    validatePush({
      endpoint: 'https://fcm.googleapis.com/x',
      keys: { ...k, auth: [k.auth] },
    }),
  );
  assert.throws(() =>
    validatePush({
      endpoint: 'https://fcm.googleapis.com/x',
      keys: { ...k, p256dh: [k.p256dh] },
    }),
  );
});
await test('timezone rejects fixed offsets while accepting IANA names', () => {
  assert.equal(validTimezone('Europe/Berlin'), 'Europe/Berlin');
  assert.equal(validTimezone('UTC'), 'UTC');
  assert.throws(() => validTimezone('+01:00'));
  assert.throws(() => validTimezone('Mars/Olympus'));
});
await test('stored contacts are authenticated ciphertext', async () => {
  const key = randomBytes(32).toString('base64');
  const value = { email: 'person@example.com' };
  const ciphertext = await encrypt(value, key);
  assert(!ciphertext.includes(value.email));
  assert.deepEqual(await decrypt(ciphertext, key), value);
  await assert.rejects(decrypt(ciphertext, randomBytes(32).toString('base64')));
});
await test('email input cannot add recipients or headers', () => {
  for (const email of [
    'a@example.com,b@example.com',
    'a@example.com\r\nBcc: b@example.com',
    'a@localhost',
  ])
    assert.throws(() => normalizeEmail(email));
  assert.equal(normalizeEmail(' Person@Example.com '), 'person@example.com');
});
await test('JSON size limit applies when Content-Length is absent', async () => {
  const request = new Request('https://example.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(9000) }),
  });
  await assert.rejects(readJson(request), /too large/);
});
