import type { PushDestination } from './types';
const encoder = new TextEncoder();
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(
  value: unknown,
  message: string,
  status = 400,
): asserts value {
  if (!value) throw new ApiError(status, message);
}
export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
export async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function equalSecret(left: string, right: string) {
  const [a, b] = await Promise.all([hash(left), hash(right)]);
  let delta = 0;
  for (let i = 0; i < a.length; i++) delta |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return delta === 0;
}
export async function requireBearer(
  request: Request,
  expected: string | undefined,
) {
  assert(
    expected && expected.length >= 32,
    'This service is not configured.',
    503,
  );
  const value = request.headers.get('authorization') || '';
  assert(
    value.startsWith('Bearer ') &&
      (await equalSecret(value.slice(7), expected)),
    'Unauthorized.',
    401,
  );
}
export function normalizeEmail(value: unknown) {
  assert(
    typeof value === 'string' && value.length <= 254,
    'Enter a valid email address.',
  );
  const email = value.trim().toLowerCase();
  assert(
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
      email,
    ),
    'Enter a valid email address.',
  );
  return email;
}
export function validTimezone(value: unknown): string {
  assert(
    typeof value === 'string' &&
      value.length <= 80 &&
      /^(?:UTC|GMT|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/.test(value),
    'Enter a valid IANA timezone.',
  );
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
  } catch {
    throw new ApiError(
      400,
      'Enter a valid IANA timezone, such as Europe/Berlin.',
    );
  }
  return value;
}
export function validPreference(value: unknown) {
  assert(
    value === 'announcement' || value === 'reminder' || value === 'both',
    'Choose an alert preference.',
  );
  return value;
}
const pushHosts = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
];
export function validatePush(value: unknown): PushDestination {
  assert(value && typeof value === 'object', 'Invalid push subscription.');
  const v = value as PushDestination;
  assert(
    typeof v.endpoint === 'string' && v.endpoint.length <= 2048,
    'Invalid push endpoint.',
  );
  let url: URL;
  try {
    url = new URL(v.endpoint);
  } catch {
    throw new ApiError(400, 'Invalid push endpoint.');
  }
  assert(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      pushHosts.includes(url.hostname),
    'Unsupported push service.',
  );
  assert(
    v.keys &&
      typeof v.keys === 'object' &&
      !Array.isArray(v.keys) &&
      typeof v.keys.p256dh === 'string' &&
      typeof v.keys.auth === 'string' &&
      /^[A-Za-z0-9_-]{87}=?$/.test(v.keys.p256dh) &&
      /^[A-Za-z0-9_-]{22}={0,2}$/.test(v.keys.auth),
    'Invalid push keys.',
  );
  const publicKey = Uint8Array.from(
    atob(v.keys.p256dh.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  );
  assert(
    publicKey.length === 65 && publicKey[0] === 4,
    'Invalid push public key.',
  );
  assert(
    atob(v.keys.auth.replace(/-/g, '+').replace(/_/g, '/')).length === 16,
    'Invalid push auth key.',
  );
  return {
    endpoint: url.href,
    keys: { p256dh: v.keys.p256dh, auth: v.keys.auth },
  };
}
export async function readJson(
  request: Request,
  maxBytes = 8192,
): Promise<Record<string, unknown>> {
  assert(
    request.headers.get('content-type')?.split(';')[0] === 'application/json',
    'Expected JSON.',
    415,
  );
  assert(
    Number(request.headers.get('content-length') || 0) <= maxBytes,
    'Request too large.',
    413,
  );
  const reader = request.body?.getReader();
  assert(reader, 'Missing request body.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, 'Request too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    assert(
      value && typeof value === 'object' && !Array.isArray(value),
      'Expected an object.',
    );
    return value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Invalid JSON.');
  }
}
function decodeKey(key: string | undefined) {
  assert(
    key && /^[A-Za-z0-9+/]{43}=$/.test(key),
    'This service is not configured.',
    503,
  );
  return Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
}
export async function encrypt(value: unknown, secret: string | undefined) {
  const key = await crypto.subtle.importKey(
    'raw',
    decodeKey(secret),
    'AES-GCM',
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(JSON.stringify(value)),
    ),
  );
  return (
    btoa(String.fromCharCode(...iv)) + '.' + btoa(String.fromCharCode(...bytes))
  );
}
export async function decrypt<T>(
  value: string,
  secret: string | undefined,
): Promise<T> {
  const [i, c] = value.split('.');
  const key = await crypto.subtle.importKey(
    'raw',
    decodeKey(secret),
    'AES-GCM',
    false,
    ['decrypt'],
  );
  const bytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Uint8Array.from(atob(i), (c) => c.charCodeAt(0)) },
    key,
    Uint8Array.from(atob(c), (c) => c.charCodeAt(0)),
  );
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function destinationKey(
  value: string,
  secret: string | undefined,
) {
  const key = await crypto.subtle.importKey(
    'raw',
    decodeKey(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, encoder.encode(value)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export function appOrigin(env: Record<string, string | undefined>) {
  assert(env.APP_ORIGIN, 'This service is not configured.', 503);
  const url = new URL(env.APP_ORIGIN);
  assert(
    url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)),
    'This service is not configured.',
    503,
  );
  assert(
    url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    'This service is not configured.',
    503,
  );
  return url.origin;
}
export function requireOrigin(
  request: Request,
  env: Record<string, string | undefined>,
) {
  assert(
    request.headers.get('origin') === appOrigin(env),
    'Request origin not allowed.',
    403,
  );
}
