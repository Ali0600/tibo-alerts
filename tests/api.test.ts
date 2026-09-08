import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createECDH } from 'node:crypto';
import { SqliteDatabase } from '../runtime/sqlite';
import { handleRequest } from '../core/api';
import { CONNECTOR_COMMIT } from '../core/ingest';
import { decrypt } from '../core/security';
import type { JobRow, Runtime } from '../core/types';
function fixture(t: { after: (fn: () => void) => void }) {
  const db = new SqliteDatabase(':memory:');
  t.after(() => db.close());
  let now = Date.parse('2026-09-08T12:00:00Z');
  const env = {
    APP_ORIGIN: 'https://alerts.example',
    DATA_KEY: randomBytes(32).toString('base64'),
    SCANNER_SECRET: 's'.repeat(64),
    DELIVERY_SECRET: 'd'.repeat(64),
    BREVO_WEBHOOK_SECRET: 'w'.repeat(64),
    EXPECTED_SOURCE_ID: '123',
    ALERTS_ENABLED: 'true',
    SOURCE_VERIFIED: 'true',
    DELIVERY_VERIFIED: 'true',
    EMAIL_ENABLED: 'true',
    PUSH_ENABLED: 'true',
    VAPID_PUBLIC_KEY: 'test-public-key',
  };
  const runtime: Runtime = { db, env, now: () => now };
  async function call(
    path: string,
    body?: unknown,
    options: {
      method?: string;
      cookie?: string;
      secret?: string;
      origin?: string;
    } = {},
  ) {
    const headers: Record<string, string> = {
      Origin: options.origin ?? env.APP_ORIGIN,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.secret) headers.Authorization = `Bearer ${options.secret}`;
    const response = await handleRequest(
      new Request(env.APP_ORIGIN + path, {
        method: options.method || (body === undefined ? 'GET' : 'POST'),
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      runtime,
    );
    const result = await response.json();
    return { response, result };
  }
  async function email() {
    const subscribed = await call('/api/subscriptions', {
      channel: 'email',
      email: 'person@example.com',
      timezone: 'Europe/Berlin',
      preference: 'both',
      consent: true,
    });
    assert.equal(subscribed.response.status, 202);
    const [job] = await db.query<JobRow>(
      "SELECT * FROM jobs WHERE kind='confirmation'",
    );
    const payload = await decrypt<{ url: string }>(job.payload!, env.DATA_KEY);
    const confirmation = await call('/api/confirm', {
      token: payload.url.split('#')[1],
    });
    assert.equal(
      confirmation.response.status,
      200,
      JSON.stringify(confirmation.result),
    );
    return confirmation.response.headers.get('set-cookie')!;
  }
  const sourcePost = (
    id: string,
    text: string,
    publishedAt = new Date(now).toISOString(),
    replyToId: string | null = null,
  ) => ({
    id,
    authorId: '123',
    authorHandle: 'thsottiaux',
    url: `https://x.com/thsottiaux/status/${id}`,
    text,
    publishedAt,
    replyToId,
  });
  async function scan(posts: unknown[], scanId = crypto.randomUUID()) {
    return call(
      '/api/internal/source/ingest',
      {
        scanId,
        connectorCommit: CONNECTOR_COMMIT,
        fetchedAt: new Date(now).toISOString(),
        posts,
        coverageUnits: posts.map((p) => {
          const id = (p as { id: string }).id;
          return { entryId: 'tweet-' + id, sortIndex: id, sourcePostIds: [id] };
        }),
      },
      { secret: env.SCANNER_SECRET },
    );
  }
  async function bootstrap() {
    return scan([sourcePost('100', 'Working on Codex today.')]);
  }
  async function claim() {
    return call(
      '/api/internal/jobs/claim',
      {},
      { secret: env.DELIVERY_SECRET },
    );
  }
  return {
    db,
    runtime,
    env,
    call,
    email,
    sourcePost,
    scan,
    bootstrap,
    claim,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
await test('email requires consent, verification, and correct request origin', async (t) => {
  const f = fixture(t);
  const input = {
    channel: 'email',
    email: 'person@example.com',
    timezone: 'Europe/Berlin',
    preference: 'both',
    consent: true,
  };
  assert.equal(
    (await f.call('/api/subscriptions', { ...input, consent: false })).response
      .status,
    400,
  );
  assert.equal(
    (
      await f.call('/api/subscriptions', input, {
        origin: 'https://evil.example',
      })
    ).response.status,
    403,
  );
  assert.equal(
    (await f.call('/api/subscriptions', input)).response.status,
    202,
  );
  assert.equal(
    (
      await f.db.query<{ status: string }>('SELECT status FROM subscriptions')
    )[0].status,
    'pending',
  );
  const publicData = await f.call('/api/public');
  assert(!JSON.stringify(publicData.result).includes('person@example.com'));
});
await test('launch stays closed before source and delivery verification', async (t) => {
  const f = fixture(t);
  f.env.SOURCE_VERIFIED = 'false';
  const response = await f.call('/api/public');
  assert.equal(response.result.capabilities.email, false);
  assert.equal(
    (
      await f.call('/api/subscriptions', {
        channel: 'email',
        email: 'person@example.com',
        timezone: 'UTC',
        preference: 'both',
        consent: true,
      })
    ).response.status,
    503,
  );
});
await test('confirmed subscriber can manage and remove stored contact details', async (t) => {
  const f = fixture(t);
  const cookie = await f.email();
  const me = await f.call('/api/subscriptions/me', undefined, { cookie });
  assert.equal(me.result.status, 'active');
  assert.equal(
    (
      await f.call(
        '/api/subscriptions/me',
        { timezone: 'America/New_York', preference: 'reminder' },
        { cookie, method: 'PATCH' },
      )
    ).response.status,
    200,
  );
  assert.equal(
    (await f.call('/api/unsubscribe', {}, { cookie })).response.status,
    200,
  );
  const [sub] = await f.db.query<{
    encrypted_destination: string;
    status: string;
  }>('SELECT * FROM subscriptions');
  assert.equal(sub.status, 'suppressed');
  assert.equal(sub.encrypted_destination, '');
});
await test('repeated source batches create one event and one recipient job per alert kind', async (t) => {
  const f = fixture(t);
  await f.email();
  await f.bootstrap();
  const posts = [
    f.sourcePost('100', 'Working on Codex today.'),
    f.sourcePost('101', 'We will reset Codex limits in three hours.'),
  ];
  const id = crypto.randomUUID();
  assert.equal((await f.scan(posts, id)).response.status, 200);
  assert.equal((await f.scan(posts, id)).result.duplicate, true);
  await f.scan(posts);
  const jobs = await f.db.query<JobRow>(
    "SELECT * FROM jobs WHERE event_id='101'",
  );
  assert.deepEqual(jobs.map((j) => j.kind).sort(), [
    'announcement',
    'reminder',
  ]);
  assert.equal(
    jobs.find((j) => j.kind === 'reminder')!.due_at,
    Date.parse('2026-09-08T15:00:00Z'),
  );
});
await test('scanner and delivery secrets cannot access each other’s endpoints', async (t) => {
  const f = fixture(t);
  assert.equal(
    (
      await f.call('/api/internal/source/checkpoint', undefined, {
        secret: f.env.DELIVERY_SECRET,
      })
    ).response.status,
    401,
  );
  assert.equal(
    (
      await f.call(
        '/api/internal/jobs/claim',
        {},
        { secret: f.env.SCANNER_SECRET },
      )
    ).response.status,
    401,
  );
  assert.equal(
    (await f.call('/api/internal/source/checkpoint')).response.status,
    401,
  );
});
await test('empty or wrong-author source batches do not refresh successful health', async (t) => {
  const f = fixture(t);
  await f.bootstrap();
  f.advance(60000);
  assert.equal((await f.scan([])).response.status, 400);
  assert.equal(
    (
      await f.scan([
        { ...f.sourcePost('101', 'Codex limits reset now.'), authorId: '999' },
      ])
    ).response.status,
    400,
  );
  const status = await f.call('/api/public');
  assert.equal(status.result.source.lastSuccessAt, '2026-09-08T12:00:00.000Z');
});
await test('coverage gaps stay visible after subsequent overlapping reads', async (t) => {
  const f = fixture(t);
  await f.bootstrap();
  await f.scan([f.sourcePost('200', 'Another update.')]);
  await f.scan([
    f.sourcePost('200', 'Another update.'),
    f.sourcePost('201', 'A later post.'),
  ]);
  assert.equal((await f.call('/api/public')).result.source.coverageGap, true);
});
await test('one runner owns a job; uncertain sends cannot be reclaimed', async (t) => {
  const f = fixture(t);
  await f.email();
  await f.bootstrap();
  await f.scan([
    f.sourcePost('100', 'Working on Codex today.'),
    f.sourcePost('101', 'We will reset Codex limits in three hours.'),
  ]);
  await f.db.query("DELETE FROM jobs WHERE kind='confirmation'");
  const [a, b] = await Promise.all([f.claim(), f.claim()]);
  const leases = [...a.result.jobs, ...b.result.jobs];
  assert.equal(leases.length, 1);
  const auth = await f.call('/api/internal/jobs/authorize', leases[0], {
    secret: f.env.DELIVERY_SECRET,
  });
  assert.equal(auth.response.status, 200, JSON.stringify(auth.result));
  assert.match(auth.result.text, /Sep 8, 2026/);
  f.advance(121000);
  assert.equal((await f.claim()).result.jobs.length, 0);
  assert.equal(
    (
      await f.db.query<{ state: string }>(
        "SELECT state FROM jobs WHERE kind='announcement'",
      )
    )[0].state,
    'unknown',
  );
});
await test('unsubscribe after claim blocks authorization and spending', async (t) => {
  const f = fixture(t);
  const cookie = await f.email();
  await f.bootstrap();
  await f.scan([
    f.sourcePost('100', 'Working on Codex today.'),
    f.sourcePost('101', 'We will reset Codex limits in three hours.'),
  ]);
  await f.db.query("DELETE FROM jobs WHERE kind='confirmation'");
  const lease = (await f.claim()).result.jobs[0];
  await f.call('/api/unsubscribe', {}, { cookie });
  assert.equal(
    (
      await f.call('/api/internal/jobs/authorize', lease, {
        secret: f.env.DELIVERY_SECRET,
      })
    ).response.status,
    409,
  );
  assert.equal((await f.db.query('SELECT * FROM email_attempts')).length, 0);
});
await test('free email quota stops provider authorization atomically', async (t) => {
  const f = fixture(t);
  await f.email();
  await f.bootstrap();
  await f.scan([
    f.sourcePost('100', 'Working on Codex today.'),
    f.sourcePost('101', 'We will reset Codex limits in three hours.'),
  ]);
  await f.db.query("DELETE FROM jobs WHERE kind='confirmation'");
  for (let i = 0; i < 200; i++)
    await f.db.query('INSERT INTO email_attempts(id,kind,at) VALUES(?,?,?)', [
      String(i),
      'alert',
      Date.parse('2026-09-08T12:00:00Z'),
    ]);
  const lease = (await f.claim()).result.jobs[0];
  assert.equal(
    (
      await f.call('/api/internal/jobs/authorize', lease, {
        secret: f.env.DELIVERY_SECRET,
      })
    ).response.status,
    409,
  );
  assert.equal((await f.db.query('SELECT * FROM email_attempts')).length, 200);
});
await test('correction cancels the old reminder and creates a revised one', async (t) => {
  const f = fixture(t);
  await f.email();
  await f.bootstrap();
  const old = [
    f.sourcePost('100', 'Working on Codex today.'),
    f.sourcePost('101', 'We will reset Codex limits in three hours.'),
  ];
  await f.scan(old);
  await f.scan([
    ...old,
    f.sourcePost(
      '102',
      'Correction: Codex reset in four hours.',
      undefined,
      '101',
    ),
  ]);
  const reminders = await f.db.query<JobRow>(
    "SELECT * FROM jobs WHERE kind='reminder' ORDER BY event_revision",
  );
  assert.equal(reminders.length, 2);
  assert.equal(reminders[0].state, 'cancelled');
  assert.equal(reminders[1].due_at, Date.parse('2026-09-08T16:00:00Z'));
});
await test('expired reminders do not get sent late', async (t) => {
  const f = fixture(t);
  await f.email();
  await f.bootstrap();
  await f.scan([
    f.sourcePost('100', 'Working on Codex today.'),
    f.sourcePost('101', 'We will reset Codex limits in one minute.'),
  ]);
  f.advance(17 * 60000);
  const jobs = (await f.claim()).result.jobs;
  assert(!jobs.some((j: { id: string }) => j.id.includes('reminder')));
  assert.equal(
    (
      await f.db.query<{ state: string }>(
        "SELECT state FROM jobs WHERE kind='reminder'",
      )
    )[0].state,
    'expired',
  );
});
await test('forged bounce does nothing; authenticated suppression is monotonic', async (t) => {
  const f = fixture(t);
  await f.email();
  const bounce = { id: 7, event: 'hard_bounce', email: 'person@example.com' };
  assert.equal(
    (await f.call('/api/webhooks/brevo', bounce)).response.status,
    401,
  );
  assert.equal(
    (
      await f.db.query<{ status: string }>('SELECT status FROM subscriptions')
    )[0].status,
    'active',
  );
  assert.equal(
    (
      await f.call('/api/webhooks/brevo', bounce, {
        secret: f.env.BREVO_WEBHOOK_SECRET,
      })
    ).response.status,
    200,
  );
  await f.call(
    '/api/webhooks/brevo',
    { id: 7, event: 'delivered', 'message-id': 'something' },
    { secret: f.env.BREVO_WEBHOOK_SECRET },
  );
  assert.equal(
    (
      await f.db.query<{ status: string }>('SELECT status FROM subscriptions')
    )[0].status,
    'suppressed',
  );
});
const pushInput = () => ({
  channel: 'push',
  subscription: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-device',
    keys: {
      p256dh: createECDH('prime256v1').generateKeys().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  },
  timezone: 'Europe/Berlin',
  preference: 'both',
  consent: true,
});
await test('new push subscribers receive existing future reminders', async (t) => {
  const f = fixture(t);
  await f.bootstrap();
  await f.scan([
    f.sourcePost('100', 'Working on Codex today.'),
    f.sourcePost('101', 'We will reset Codex limits in three hours.'),
  ]);
  const res = await f.call('/api/subscriptions', pushInput());
  assert.equal(res.response.status, 201);
  assert.equal(
    (await f.db.query("SELECT id FROM jobs WHERE kind='reminder'")).length,
    1,
  );
});
await test('email and push management sessions coexist and unsubscribe independently', async (t) => {
  const f = fixture(t);
  const push = await f.call('/api/subscriptions', pushInput());
  const pushCookie = push.response.headers.get('set-cookie')!.split(';')[0];
  const emailCookie = (await f.email()).split(';')[0];
  assert.notEqual(pushCookie.split('=')[0], emailCookie.split('=')[0]);
  const cookie = pushCookie + '; ' + emailCookie;
  assert.equal(
    (await f.call('/api/subscriptions/me?channel=push', undefined, { cookie }))
      .result.channel,
    'push',
  );
  assert.equal(
    (await f.call('/api/subscriptions/me?channel=email', undefined, { cookie }))
      .result.channel,
    'email',
  );
  await f.call('/api/unsubscribe?channel=push', {}, { cookie });
  assert.equal(
    (await f.call('/api/subscriptions/me?channel=email', undefined, { cookie }))
      .result.status,
    'active',
  );
});
await test('an expired unsent lease remains reclaimable while the alert is fresh', async (t) => {
  const f = fixture(t);
  await f.email();
  const old = (await f.claim()).result.jobs[0];
  f.advance(121000);
  assert.equal(
    (
      await f.call('/api/internal/jobs/authorize', old, {
        secret: f.env.DELIVERY_SECRET,
      })
    ).response.status,
    409,
  );
  const next = (await f.claim()).result.jobs;
  assert.equal(next.length, 1);
  assert.equal(next[0].id, old.id);
  assert.notEqual(next[0].leaseToken, old.leaseToken);
});
await test('disabled email cannot block enabled push delivery', async (t) => {
  const f = fixture(t);
  await f.email();
  await f.call('/api/subscriptions', pushInput());
  await f.bootstrap();
  await f.scan([
    f.sourcePost('100', 'Working on Codex today.'),
    f.sourcePost('101', 'We will reset Codex limits in three hours.'),
  ]);
  f.env.EMAIL_ENABLED = 'false';
  const jobs = (await f.claim()).result.jobs;
  assert(jobs.length > 0);
  for (const job of jobs) {
    const authorized = await f.call('/api/internal/jobs/authorize', job, {
      secret: f.env.DELIVERY_SECRET,
    });
    assert.equal(authorized.response.status, 200);
    assert.equal(authorized.result.channel, 'push');
  }
});
await test('old conversation roots cannot mask a missing latest checkpoint', async (t) => {
  const f = fixture(t);
  await f.scan([
    f.sourcePost('100', 'Older post.'),
    f.sourcePost('101', 'Latest post.'),
  ]);
  await f.scan([
    f.sourcePost('100', 'Older post.'),
    f.sourcePost('200', 'A later post.'),
  ]);
  assert.equal((await f.call('/api/public')).result.source.coverageGap, true);
});
await test('verification bypass is scoped to an allowlisted test job and still counts quota', async (t) => {
  const f = fixture(t);
  f.env.ALERTS_ENABLED = 'false';
  Object.assign(f.env, {
    VERIFICATION_MODE: 'true',
    TEST_EMAIL: 'test@example.com',
  });
  const body = { channel: 'email', email: 'test@example.com', consent: true };
  assert.equal(
    (
      await f.call(
        '/api/internal/jobs/test',
        { ...body, email: 'other@example.com' },
        { secret: f.env.DELIVERY_SECRET },
      )
    ).response.status,
    403,
  );
  const queued = await f.call('/api/internal/jobs/test', body, {
    secret: f.env.DELIVERY_SECRET,
  });
  assert.equal(queued.response.status, 201);
  assert.equal((await f.claim()).response.status, 503);
  const claimed = await f.call(
    '/api/internal/jobs/claim',
    { testId: queued.result.jobId },
    { secret: f.env.DELIVERY_SECRET },
  );
  const result = await f.call(
    '/api/internal/jobs/authorize',
    claimed.result.jobs[0],
    { secret: f.env.DELIVERY_SECRET },
  );
  assert.equal(result.response.status, 200, JSON.stringify(result.result));
  assert.equal(result.result.destination.email, 'test@example.com');
  assert.equal((await f.db.query('SELECT id FROM email_attempts')).length, 1);
});
await test('transactional reserve survives full alert allocation and stops at 250 attempts', async (t) => {
  const f = fixture(t);
  await f.call('/api/subscriptions', {
    channel: 'email',
    email: 'pending@example.com',
    timezone: 'UTC',
    preference: 'both',
    consent: true,
  });
  for (let i = 0; i < 249; i++)
    await f.db.query('INSERT INTO email_attempts(id,kind,at) VALUES(?,?,?)', [
      String(i),
      i < 200 ? 'alert' : 'transactional',
      Date.parse('2026-09-08T12:00:00Z'),
    ]);
  let lease = (await f.claim()).result.jobs[0];
  assert.equal(
    (
      await f.call('/api/internal/jobs/authorize', lease, {
        secret: f.env.DELIVERY_SECRET,
      })
    ).response.status,
    200,
  );
  await f.call('/api/subscriptions', {
    channel: 'email',
    email: 'another@example.com',
    timezone: 'UTC',
    preference: 'both',
    consent: true,
  });
  lease = (await f.claim()).result.jobs[0];
  assert.equal(
    (
      await f.call('/api/internal/jobs/authorize', lease, {
        secret: f.env.DELIVERY_SECRET,
      })
    ).response.status,
    409,
  );
  assert.equal((await f.db.query('SELECT id FROM email_attempts')).length, 250);
});
await test('test jobs cannot escape verification mode or be stolen by normal claims', async (t) => {
  const f = fixture(t);
  Object.assign(f.env, {
    VERIFICATION_MODE: 'true',
    TEST_EMAIL: 'test@example.com',
  });
  const queued = await f.call(
    '/api/internal/jobs/test',
    { channel: 'email', email: 'test@example.com', consent: true },
    { secret: f.env.DELIVERY_SECRET },
  );
  assert.equal((await f.claim()).result.jobs.length, 0);
  const lease = (
    await f.call(
      '/api/internal/jobs/claim',
      { testId: queued.result.jobId },
      { secret: f.env.DELIVERY_SECRET },
    )
  ).result.jobs[0];
  Object.assign(f.env, { VERIFICATION_MODE: 'false' });
  assert.equal(
    (
      await f.call('/api/internal/jobs/authorize', lease, {
        secret: f.env.DELIVERY_SECRET,
      })
    ).response.status,
    503,
  );
  assert.equal(
    (
      await f.call(
        '/api/internal/jobs/claim',
        { testId: queued.result.jobId },
        { secret: f.env.DELIVERY_SECRET },
      )
    ).response.status,
    503,
  );
});

await test('maximum source windows stay within the free database query budget', async (t) => {
  const f = fixture(t);
  let statements = 0;
  f.runtime.db = {
    async query(sql, args) {
      statements++;
      return f.db.query(sql, args);
    },
    async batch(batch) {
      statements += batch.length;
      return f.db.batch(batch);
    },
  };
  const posts = Array.from({ length: 100 }, (_, i) =>
    f.sourcePost(String(100 + i), 'We will reset Codex limits in three hours.'),
  );
  assert.equal((await f.scan(posts)).response.status, 200);
  assert(
    statements <= 50,
    `${statements} SQL statements exceed the Free invocation budget`,
  );
  assert.equal((await f.db.query('SELECT id FROM posts')).length, 100);
  assert.equal((await f.db.query('SELECT id FROM events')).length, 100);
});

await test('two corrections to a stored parent advance revisions in publication order', async (t) => {
  const f = fixture(t);
  await f.email();
  await f.bootstrap();
  const original = f.sourcePost(
    '101',
    'We will reset Codex limits in three hours.',
  );
  await f.scan([f.sourcePost('100', 'Working on Codex today.'), original]);
  await f.scan([
    original,
    f.sourcePost(
      '102',
      'Correction: Codex reset in four hours.',
      undefined,
      '101',
    ),
    f.sourcePost(
      '103',
      'Correction: Codex reset in five hours.',
      undefined,
      '101',
    ),
  ]);
  const [event] = await f.db.query<{ revision: number }>(
    "SELECT revision FROM events WHERE id='101'",
  );
  assert.equal(event.revision, 3);
  const [job] = await f.db.query<JobRow>(
    "SELECT * FROM jobs WHERE kind='reminder' AND state='pending'",
  );
  assert.equal(job.event_revision, 3);
  assert.equal(job.due_at, Date.parse('2026-09-08T17:00:00Z'));
});

await test('excessive notification expansion fails before advancing source coverage', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 51; i++)
    await f.db.query(
      "INSERT INTO subscriptions(id,channel,destination_key,encrypted_destination,timezone,preference,status,manage_hash,consent_at,created_at,updated_at) VALUES(?,'push',?,'test','UTC','both','active',?,0,0,0)",
      [String(i), String(i), String(i)],
    );
  const posts = Array.from({ length: 100 }, (_, i) =>
    f.sourcePost(String(100 + i), 'We will reset Codex limits in three hours.'),
  );
  assert.equal((await f.scan(posts)).response.status, 503);
  assert.equal((await f.db.query('SELECT id FROM posts')).length, 0);
  assert.equal((await f.db.query('SELECT id FROM jobs')).length, 0);
  assert.equal((await f.db.query('SELECT id FROM scans')).length, 0);
});

await test('a concurrent signup cannot bypass the transactional expansion cap', async (t) => {
  const f = fixture(t);
  const insert = (id: number) =>
    f.db.query(
      "INSERT INTO subscriptions(id,channel,destination_key,encrypted_destination,timezone,preference,status,manage_hash,consent_at,created_at,updated_at) VALUES(?,'push',?,'test','UTC','both','active',?,0,0,0)",
      [String(id), String(id), String(id)],
    );
  for (let i = 0; i < 50; i++) await insert(i);
  f.runtime.db = {
    async query(sql, args) {
      const rows = await f.db.query(sql, args);
      if (sql.includes('GROUP BY preference')) await insert(50);
      return rows as never;
    },
    batch: (statements) => f.db.batch(statements),
  };
  const posts = Array.from({ length: 100 }, (_, i) =>
    f.sourcePost(String(100 + i), 'We will reset Codex limits in three hours.'),
  );
  assert.equal((await f.scan(posts)).response.status, 500);
  assert.equal((await f.db.query('SELECT id FROM posts')).length, 0);
  assert.equal((await f.db.query('SELECT id FROM jobs')).length, 0);
  assert.equal((await f.db.query('SELECT id FROM scans')).length, 0);
});

await test('email confirmation cannot activate a fifty-first subscriber', async (t) => {
  const f = fixture(t);
  await f.call('/api/subscriptions', {
    channel: 'email',
    email: 'pending@example.com',
    timezone: 'UTC',
    preference: 'both',
    consent: true,
  });
  const [job] = await f.db.query<JobRow>(
    "SELECT * FROM jobs WHERE kind='confirmation'",
  );
  const payload = await decrypt<{ url: string }>(job.payload!, f.env.DATA_KEY);
  for (let i = 0; i < 50; i++)
    await f.db.query(
      "INSERT INTO subscriptions(id,channel,destination_key,encrypted_destination,timezone,preference,status,manage_hash,consent_at,created_at,updated_at) VALUES(?,'email',?,'test','UTC','both','active',?,0,0,0)",
      [String(i), String(i), String(i)],
    );
  const result = await f.call('/api/confirm', {
    token: payload.url.split('#')[1],
  });
  assert.equal(result.response.status, 409);
  assert.equal(
    (await f.db.query("SELECT id FROM subscriptions WHERE status='active'"))
      .length,
    50,
  );
});
