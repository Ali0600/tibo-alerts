import type {
  Runtime,
  Channel,
  JobRow,
  SubscriptionRow,
  Destination,
  ResetEvent,
  Statement,
} from './types';
import { assert, hash, encrypt, decrypt, appOrigin } from './security';
import { formatLocal } from './parser';
export const nowOf = (r: Runtime) => r.now?.() ?? Date.now();
export const launchReady = (r: Runtime) =>
  r.env.ALERTS_ENABLED === 'true' &&
  r.env.SOURCE_VERIFIED === 'true' &&
  r.env.DELIVERY_VERIFIED === 'true' &&
  !!r.env.DATA_KEY &&
  !!r.env.APP_ORIGIN;
export async function getState<T>(
  r: Runtime,
  key: string,
  fallback: T,
): Promise<T> {
  const rows = await r.db.query<{ value: string }>(
    'SELECT value FROM state WHERE key=?',
    [key],
  );
  return rows.length ? JSON.parse(rows[0].value) : fallback;
}
export const stateStatement = (key: string, value: unknown): Statement => ({
  sql: 'INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  args: [key, JSON.stringify(value)],
});
export async function setState(r: Runtime, key: string, value: unknown) {
  const s = stateStatement(key, value);
  await r.db.query(s.sql, s.args);
}
export async function rateLimit(
  r: Runtime,
  key: string,
  limit: number,
  window: number,
) {
  const now = nowOf(r);
  const bucket = `${key}:${Math.floor(now / window)}`;
  const rows = await r.db.query<{ count: number }>(
    'INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count',
    [bucket, now + window, limit],
  );
  assert(rows.length, 'Too many requests. Please try again later.', 429);
}
export async function lookupManage(
  r: Runtime,
  token: string,
): Promise<SubscriptionRow> {
  assert(
    /^[a-f0-9]{64}$/.test(token),
    'This management link is invalid or expired.',
    401,
  );
  const rows = await r.db.query<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE manage_hash=?',
    [await hash(token)],
  );
  assert(rows[0], 'This management link is invalid or expired.', 401);
  return rows[0];
}
export function getCookie(request: Request, channel?: Channel) {
  const selected = channel || new URL(request.url).searchParams.get('channel');
  if (selected && selected !== 'email' && selected !== 'push') return '';
  const cookies =
    request.headers
      .get('cookie')
      ?.split(';')
      .map((v) => v.trim()) || [];
  for (const name of selected
    ? [`tibo_manage_${selected}`]
    : ['tibo_manage_email', 'tibo_manage_push']) {
    const entry = cookies.find((v) => v.startsWith(name + '='));
    if (entry) return entry.slice(name.length + 1);
  }
  return '';
}
export function cookie(token: string, r: Runtime, channel: Channel) {
  return `tibo_manage_${channel}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? '31536000' : '0'}${appOrigin(r.env).startsWith('https:') ? '; Secure' : ''}`;
}
export async function queueTransactional(
  r: Runtime,
  sub: SubscriptionRow,
  kind: 'confirmation' | 'management',
  confirmationToken?: string,
) {
  const now = nowOf(r);
  const origin = appOrigin(r.env);
  const destination = await decrypt<Destination>(
    sub.encrypted_destination,
    r.env.DATA_KEY,
  );
  const url =
    kind === 'confirmation'
      ? `${origin}/confirm#${confirmationToken}`
      : `${origin}/manage#${destination.manageToken}`;
  const payload = await encrypt(
    {
      subject:
        kind === 'confirmation'
          ? 'Confirm your Tibo Alerts subscription'
          : 'Manage your Tibo Alerts',
      text:
        kind === 'confirmation'
          ? `Confirm your email to receive Codex reset alerts:\n\n${url}\n\nThis link expires in 24 hours. If you did not request this, ignore this email.`
          : `Manage your preferences or unsubscribe:\n\n${url}\n\nIf you did not request this link, you can ignore this email.`,
      url,
    },
    r.env.DATA_KEY,
  );
  await r.db.query(
    'INSERT INTO jobs(id,subscription_id,kind,payload,due_at,expires_at,state,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [
      crypto.randomUUID(),
      sub.id,
      kind,
      payload,
      now,
      now + 30 * 60000,
      'pending',
      now,
    ],
  );
}
export async function suppress(r: Runtime, id: string) {
  const now = nowOf(r);
  await r.db.batch([
    {
      sql: "UPDATE subscriptions SET status='suppressed',encrypted_destination='',updated_at=? WHERE id=?",
      args: [now, id],
    },
    {
      sql: "UPDATE jobs SET state='cancelled',payload=NULL,last_result='unsubscribed' WHERE subscription_id=? AND state IN ('pending','leased','sending')",
      args: [id],
    },
    { sql: 'DELETE FROM tokens WHERE subscription_id=?', args: [id] },
  ]);
}
export async function jobMessage(
  r: Runtime,
  job: JobRow,
  sub: SubscriptionRow,
  destination: Destination,
) {
  if (job.payload)
    return decrypt<{ subject: string; text: string; url: string }>(
      job.payload,
      r.env.DATA_KEY,
    );
  const rows = await r.db.query<{ body: string }>(
    'SELECT body FROM events WHERE id=?',
    [job.event_id],
  );
  assert(rows[0], 'Announcement is no longer available.', 409);
  const event = JSON.parse(rows[0].body) as ResetEvent;
  assert(
    event.revision === job.event_revision && event.kind !== 'cancelled',
    'This announcement has changed.',
    409,
  );
  const title =
    job.kind === 'reminder'
      ? 'Scheduled Codex reset time'
      : event.kind === 'completed'
        ? 'Codex reset announced as complete'
        : event.kind === 'grant'
          ? 'Banked Codex reset grant'
          : 'Codex reset announcement';
  const time = event.scheduledAt
    ? `Scheduled time: ${formatLocal(event.scheduledAt, sub.timezone)} (${sub.timezone}).`
    : event.timingText
      ? `Timing as announced: ${event.timingText}`
      : 'No exact reset time was stated.';
  const origin = appOrigin(r.env);
  const manage = `${origin}/manage#${destination.manageToken}`;
  return {
    subject: title,
    text: `${title}\n\n${time}\n${job.kind === 'reminder' ? 'This is a reminder of the announced time, not independent confirmation that a reset has occurred.\n' : ''}\n${event.text}\n\nSource: ${event.sourceUrl}\n\nManage or unsubscribe: ${manage}\n\nTibo Alerts is an unofficial community project.`,
    url: `${origin}/?event=${encodeURIComponent(event.id)}`,
  };
}
export function eventJobs(
  event: ResetEvent,
  sub: SubscriptionRow,
  now: number,
): Statement[] {
  if (event.kind === 'cancelled') return [];
  const jobs: Statement[] = [];
  const add = (kind: string, due: number, expiry: number) =>
    jobs.push({
      sql: 'INSERT OR IGNORE INTO jobs(id,subscription_id,event_id,event_revision,kind,due_at,expires_at,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      args: [
        crypto.randomUUID(),
        sub.id,
        event.id,
        event.revision,
        kind,
        due,
        expiry,
        'pending',
        now,
      ],
    });
  if (
    sub.preference !== 'reminder' &&
    Date.parse(event.publishedAt) >= now - 30 * 60000
  )
    add('announcement', now, now + 30 * 60000);
  if (sub.preference !== 'announcement' && event.scheduledAt) {
    const at = Date.parse(event.scheduledAt);
    if (at > now && at < now + 31 * 86400000)
      add('reminder', at, at + 15 * 60000);
  }
  return jobs;
}
export async function maintenance(r: Runtime) {
  const now = nowOf(r);
  await r.db.batch([
    {
      sql: "UPDATE jobs SET state='unknown',last_result='send_outcome_unknown',payload=NULL WHERE state='sending' AND lease_until<?",
      args: [now],
    },
    {
      sql: "UPDATE jobs SET state='pending',lease_token=NULL,lease_until=NULL WHERE state='leased' AND lease_until<?",
      args: [now],
    },
    {
      sql: "UPDATE jobs SET state='expired',payload=NULL WHERE state IN ('pending','leased') AND expires_at<=?",
      args: [now],
    },
    { sql: 'DELETE FROM tokens WHERE expires_at<?', args: [now] },
    { sql: 'DELETE FROM rate_limits WHERE expires_at<?', args: [now] },
    {
      sql: 'DELETE FROM email_attempts WHERE at<?',
      args: [now - 2 * 86400000],
    },
    { sql: 'DELETE FROM scans WHERE at<?', args: [now - 7 * 86400000] },
    {
      sql: 'DELETE FROM posts WHERE received_at<?',
      args: [now - 90 * 86400000],
    },
    {
      sql: 'DELETE FROM events WHERE updated_at<?',
      args: [now - 90 * 86400000],
    },
    {
      sql: "DELETE FROM jobs WHERE created_at<? AND state NOT IN ('pending','leased','sending')",
      args: [now - 30 * 86400000],
    },
    {
      sql: "DELETE FROM subscriptions WHERE (status IN ('pending','verification') AND created_at<?) OR (status='suppressed' AND updated_at<?)",
      args: [now - 2 * 86400000, now - 30 * 86400000],
    },
  ]);
}
