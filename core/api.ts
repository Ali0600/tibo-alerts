import type {
  Runtime,
  SubscriptionRow,
  Destination,
  JobRow,
  Delivery,
  Statement,
} from './types';
import {
  ApiError,
  assert,
  readJson,
  normalizeEmail,
  validTimezone,
  validPreference,
  validatePush,
  requireBearer,
  requireOrigin,
  appOrigin,
  randomToken,
  hash,
  encrypt,
  decrypt,
  destinationKey,
} from './security';
import {
  nowOf,
  launchReady,
  getState,
  setState,
  rateLimit,
  lookupManage,
  getCookie,
  cookie,
  queueTransactional,
  suppress,
  jobMessage,
  maintenance,
  eventJobs,
} from './service';
import { ingest, emptySource, CONNECTOR_COMMIT } from './ingest';

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extra,
    },
  });
}
const genericSignup = {
  message:
    'If this address can receive alerts, a confirmation or management link will arrive shortly.',
};
const permittedSend =
  "((kind='confirmation' AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.id=jobs.subscription_id AND s.status='pending')) OR (kind='test' AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.id=jobs.subscription_id AND s.status='verification')) OR (kind='management' AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.id=jobs.subscription_id AND s.status='active')) OR (kind IN ('announcement','reminder') AND EXISTS(SELECT 1 FROM subscriptions s JOIN events e ON e.id=jobs.event_id WHERE s.id=jobs.subscription_id AND s.status='active' AND e.revision=jobs.event_revision AND ((jobs.kind='announcement' AND s.preference<>'reminder') OR (jobs.kind='reminder' AND s.preference<>'announcement')))))";

async function publicData(r: Runtime) {
  const now = nowOf(r);
  const source = await getState(r, 'source', emptySource);
  const delivery = await getState(r, 'delivery', {
    state: 'unconfigured',
    lastSuccessAt: null as string | null,
  });
  const rows = await r.db.query<{ body: string }>(
    'SELECT body FROM events ORDER BY updated_at DESC LIMIT 10',
  );
  const count = await r.db.query<{ n: number }>(
    "SELECT count(*) AS n FROM subscriptions WHERE channel='email' AND status='active'",
  );
  const quota = await r.db.query<{ n: number }>(
    'SELECT count(*) AS n FROM email_attempts WHERE at>?',
    [now - 86400000],
  );
  const ready = launchReady(r);
  const stale = (at: string | null) =>
    at !== null && now - Date.parse(at) > 15 * 60000;
  return {
    events: rows.map((v) => JSON.parse(v.body)),
    source: {
      state: stale(source.lastSuccessAt) ? 'stale' : source.state,
      lastSuccessAt: source.lastSuccessAt,
      coverageGap: source.coverageGap,
    },
    delivery: {
      state: stale(delivery.lastSuccessAt) ? 'stale' : delivery.state,
      lastSuccessAt: delivery.lastSuccessAt,
    },
    capabilities: {
      email: ready && r.env.EMAIL_ENABLED === 'true' && quota[0].n < 250,
      push: ready && r.env.PUSH_ENABLED === 'true' && !!r.env.VAPID_PUBLIC_KEY,
      vapidPublicKey: r.env.VAPID_PUBLIC_KEY || null,
    },
    emailSlots: Math.max(0, 50 - count[0].n),
    repositoryUrl: r.env.REPOSITORY_URL || null,
  };
}
async function subscribe(request: Request, r: Runtime) {
  requireOrigin(request, r.env);
  assert(
    launchReady(r),
    'Signup opens after source and delivery checks pass.',
    503,
  );
  const body = await readJson(request);
  assert(body.consent === true, 'Consent is required.');
  const channel = body.channel;
  assert(
    channel === 'email' || channel === 'push',
    'Choose email or browser push.',
  );
  assert(
    r.env[channel === 'email' ? 'EMAIL_ENABLED' : 'PUSH_ENABLED'] === 'true',
    'This alert channel is unavailable.',
    503,
  );
  const timezone = validTimezone(body.timezone),
    preference = validPreference(body.preference);
  const raw =
    channel === 'email'
      ? normalizeEmail(body.email)
      : validatePush(body.subscription);
  const key = await destinationKey(
    channel === 'email' ? (raw as string) : JSON.stringify(raw),
    r.env.DATA_KEY,
  );
  await rateLimit(r, `signup-destination:${key}`, 3, 3600000);
  await rateLimit(r, 'signup-global', 200, 3600000);
  const old = await r.db.query<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE channel=? AND destination_key=?',
    [channel, key],
  );
  if (old.length) {
    const sub = old[0];
    if (channel === 'email') {
      if (sub.status === 'active')
        await queueTransactional(r, sub, 'management');
      else if (sub.status === 'pending') {
        const token = randomToken();
        await r.db.query(
          'INSERT INTO tokens(hash,subscription_id,purpose,expires_at) VALUES(?,?,?,?)',
          [await hash(token), sub.id, 'confirm', nowOf(r) + 86400000],
        );
        await queueTransactional(r, sub, 'confirmation', token);
      }
      return json(genericSignup, 202);
    }
    assert(
      sub.status === 'active',
      'This device was unsubscribed. Clear its old browser subscription before enabling alerts again.',
      409,
    );
    // The complete Web Push auth key is a device capability; matching all keys
    // lets the same browser recover management after cookies are cleared.
    const destination = await decrypt<Destination>(
      sub.encrypted_destination,
      r.env.DATA_KEY,
    );
    return json({ message: 'This device is already subscribed.' }, 200, {
      'Set-Cookie': cookie(destination.manageToken, r, 'push'),
    });
  }
  const active = await r.db.query<{ n: number }>(
    'SELECT count(*) AS n FROM subscriptions WHERE channel=? AND status=?',
    [channel, 'active'],
  );
  assert(
    active[0].n < (channel === 'email' ? 50 : 1000),
    channel === 'email'
      ? 'The free email beta is full. Browser push may still be available.'
      : 'The push beta is currently full.',
    409,
  );
  const now = nowOf(r),
    id = crypto.randomUUID(),
    manageToken = randomToken(),
    unsubscribeToken = randomToken();
  const destination: Destination = {
    ...(channel === 'email'
      ? { email: raw as string }
      : { push: raw as Destination['push'] }),
    manageToken,
    unsubscribeToken,
  };
  const encrypted = await encrypt(destination, r.env.DATA_KEY);
  const manageHash = await hash(manageToken);
  const created = await r.db.query<SubscriptionRow>(
    "INSERT OR IGNORE INTO subscriptions(id,channel,destination_key,encrypted_destination,timezone,preference,status,manage_hash,consent_at,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM subscriptions WHERE channel=? AND status='active')<? RETURNING *",
    [
      id,
      channel,
      key,
      encrypted,
      timezone,
      preference,
      channel === 'email' ? 'pending' : 'active',
      manageHash,
      now,
      now,
      now,
      channel,
      channel === 'email' ? 50 : 1000,
    ],
  );
  if (!created.length) return json(genericSignup, 202);
  await r.db.query(
    'INSERT INTO tokens(hash,subscription_id,purpose,expires_at) VALUES(?,?,?,?)',
    [await hash(unsubscribeToken), id, 'unsubscribe', now + 366 * 86400000],
  );
  if (channel === 'email') {
    const token = randomToken();
    await r.db.query(
      'INSERT INTO tokens(hash,subscription_id,purpose,expires_at) VALUES(?,?,?,?)',
      [await hash(token), id, 'confirm', now + 86400000],
    );
    await queueTransactional(r, created[0], 'confirmation', token);
    return json(genericSignup, 202);
  }
  await addFutureReminders(r, created[0]);
  return json({ message: 'Notifications enabled.' }, 201, {
    'Set-Cookie': cookie(manageToken, r, 'push'),
  });
}
async function confirm(request: Request, r: Runtime) {
  requireOrigin(request, r.env);
  assert(launchReady(r), 'Confirmation is temporarily unavailable.', 503);
  const body = await readJson(request);
  assert(
    typeof body.token === 'string' && /^[a-f0-9]{64}$/.test(body.token),
    'Invalid confirmation link.',
  );
  const tokenHash = await hash(body.token),
    now = nowOf(r);
  const result = await r.db.batch([
    {
      sql: "UPDATE subscriptions SET status='active',updated_at=? WHERE status='pending' AND id=(SELECT subscription_id FROM tokens WHERE hash=? AND purpose='confirm' AND expires_at>?) AND (SELECT count(*) FROM subscriptions WHERE channel='email' AND status='active')<50 RETURNING *",
      args: [now, tokenHash, now],
    },
    {
      sql: "DELETE FROM tokens WHERE subscription_id IN (SELECT id FROM subscriptions WHERE status='active') AND purpose='confirm' AND hash=?",
      args: [tokenHash],
    },
  ]);
  const sub = result[0][0] as unknown as SubscriptionRow;
  assert(
    sub,
    'This link expired, was already used, or the email beta is full.',
    409,
  );
  const destination = await decrypt<Destination>(
    sub.encrypted_destination,
    r.env.DATA_KEY,
  );
  await addFutureReminders(r, sub);
  return json(
    { message: 'Email confirmed. Your alert preferences are active.' },
    200,
    { 'Set-Cookie': cookie(destination.manageToken, r, 'email') },
  );
}
async function addFutureReminders(r: Runtime, sub: SubscriptionRow) {
  if (sub.preference === 'announcement') return;
  const rows = await r.db.query<{ body: string }>(
    'SELECT body FROM events ORDER BY updated_at DESC LIMIT 20',
  );
  const statements = rows
    .flatMap((row) => eventJobs(JSON.parse(row.body), sub, nowOf(r)))
    .filter((s) => s.args?.[4] === 'reminder');
  if (statements.length) await r.db.batch(statements);
}
async function manage(request: Request, r: Runtime, path: string) {
  if (path.endsWith('/session')) {
    requireOrigin(request, r.env);
    const body = await readJson(request);
    assert(typeof body.token === 'string', 'Invalid management link.');
    const sub = await lookupManage(r, body.token);
    return json(
      { message: 'Management session ready.', channel: sub.channel },
      200,
      { 'Set-Cookie': cookie(body.token, r, sub.channel) },
    );
  }
  if (path.endsWith('/request')) {
    requireOrigin(request, r.env);
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const key = await destinationKey(email, r.env.DATA_KEY);
    await rateLimit(r, `manage:${key}`, 3, 3600000);
    const rows = await r.db.query<SubscriptionRow>(
      "SELECT * FROM subscriptions WHERE channel='email' AND destination_key=? AND status='active'",
      [key],
    );
    if (rows[0] && r.env.EMAIL_ENABLED === 'true')
      await queueTransactional(r, rows[0], 'management');
    return json(
      {
        message:
          'If you have an active subscription, a management link will arrive shortly.',
      },
      202,
    );
  }
  const sub = await lookupManage(r, getCookie(request));
  if (request.method === 'GET') {
    let address = 'This browser';
    if (sub.channel === 'email' && sub.encrypted_destination) {
      const d = await decrypt<Destination>(
        sub.encrypted_destination,
        r.env.DATA_KEY,
      );
      const [name, domain] = d.email!.split('@');
      address = `${name[0]}…@${domain}`;
    }
    return json({
      channel: sub.channel,
      address,
      timezone: sub.timezone,
      preference: sub.preference,
      status: sub.status,
    });
  }
  requireOrigin(request, r.env);
  assert(sub.status === 'active', 'This subscription is not active.', 409);
  const body = await readJson(request),
    timezone = validTimezone(body.timezone),
    preference = validPreference(body.preference),
    now = nowOf(r);
  await r.db.batch([
    {
      sql: 'UPDATE subscriptions SET timezone=?,preference=?,updated_at=? WHERE id=?',
      args: [timezone, preference, now, sub.id],
    },
    {
      sql: "UPDATE jobs SET state='cancelled',last_result='preference_changed' WHERE subscription_id=? AND state IN ('pending','leased') AND ((kind='announcement' AND ?='reminder') OR (kind='reminder' AND ?='announcement'))",
      args: [sub.id, preference, preference],
    },
    {
      sql: "UPDATE jobs SET state='pending',last_result=NULL WHERE subscription_id=? AND state='cancelled' AND last_result='preference_changed' AND kind='reminder' AND ?<>'announcement' AND due_at>? AND EXISTS(SELECT 1 FROM events WHERE events.id=jobs.event_id AND events.revision=jobs.event_revision)",
      args: [sub.id, preference, now],
    },
  ]);
  await addFutureReminders(r, { ...sub, timezone, preference });
  return json({ message: 'Preferences saved.' });
}
async function unsubscribe(request: Request, r: Runtime, oneClick: boolean) {
  if (oneClick) {
    const token = new URL(request.url).searchParams.get('token');
    assert(token && /^[a-f0-9]{64}$/.test(token), 'Invalid unsubscribe link.');
    const rows = await r.db.query<{ subscription_id: string }>(
      "SELECT subscription_id FROM tokens WHERE hash=? AND purpose='unsubscribe' AND expires_at>?",
      [await hash(token), nowOf(r)],
    );
    if (rows[0]) await suppress(r, rows[0].subscription_id);
    return json({ message: 'Unsubscribed.' });
  }
  requireOrigin(request, r.env);
  const sub = await lookupManage(r, getCookie(request));
  await suppress(r, sub.id);
  return json(
    { message: 'Unsubscribed. Your saved contact details have been removed.' },
    200,
    { 'Set-Cookie': cookie('', r, sub.channel) },
  );
}
async function claim(request: Request, r: Runtime) {
  const body = await readJson(request);
  const testing = typeof body.testId === 'string';
  if (testing)
    assert(
      r.env.VERIFICATION_MODE === 'true',
      'Private verification is disabled.',
      503,
    );
  if (testing) {
    await maintenance(r);
    const lease = randomToken();
    const jobs = await r.db.query<{ id: string }>(
      "UPDATE jobs SET state='leased',lease_token=?,lease_until=? WHERE id=? AND kind='test' AND state='pending' AND expires_at>? RETURNING id",
      [lease, nowOf(r) + 120000, String(body.testId), nowOf(r)],
    );
    return { jobs: jobs.map((j) => ({ id: j.id, leaseToken: lease })) };
  }
  assert(
    launchReady(r),
    'Live delivery is disabled until verification is complete.',
    503,
  );
  await maintenance(r);
  const now = nowOf(r),
    lease = randomToken();
  const jobs = await r.db.query<{ id: string }>(
    "UPDATE jobs SET state='leased',lease_token=?,lease_until=? WHERE id IN (SELECT id FROM jobs WHERE state='pending' AND kind<>'test' AND due_at<=? AND expires_at>? AND attempts<3 AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.id=jobs.subscription_id AND ((s.channel='email' AND ?='true') OR (s.channel='push' AND ?='true'))) ORDER BY CASE kind WHEN 'confirmation' THEN 0 WHEN 'management' THEN 0 WHEN 'reminder' THEN 1 ELSE 2 END,due_at LIMIT 1) AND state='pending' RETURNING id",
    [
      lease,
      now + 120000,
      now,
      now,
      r.env.EMAIL_ENABLED || 'false',
      r.env.PUSH_ENABLED || 'false',
    ],
  );
  return { jobs: jobs.map((j) => ({ id: j.id, leaseToken: lease })) };
}
async function authorize(request: Request, r: Runtime) {
  const body = await readJson(request);
  assert(
    typeof body.id === 'string' &&
      body.id.length < 200 &&
      typeof body.leaseToken === 'string',
    'Invalid job lease.',
  );
  const now = nowOf(r);
  const found = await r.db.query<JobRow>('SELECT * FROM jobs WHERE id=?', [
    body.id,
  ]);
  assert(found[0], 'Job not found.', 404);
  const job = found[0];
  if (job.kind === 'test')
    assert(
      r.env.VERIFICATION_MODE === 'true',
      'Private verification is disabled.',
      503,
    );
  const testing = job.kind === 'test' && r.env.VERIFICATION_MODE === 'true';
  assert(testing || launchReady(r), 'Live delivery is disabled.', 503);
  const subscribers = await r.db.query<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE id=?',
    [job.subscription_id],
  );
  const sub = subscribers[0];
  assert(sub, 'Subscription not found.', 409);
  if (
    !testing &&
    r.env[sub.channel === 'email' ? 'EMAIL_ENABLED' : 'PUSH_ENABLED'] !== 'true'
  ) {
    await r.db.query(
      "UPDATE jobs SET state='pending',lease_token=NULL,lease_until=NULL WHERE id=? AND state='leased' AND lease_token=?",
      [job.id, body.leaseToken],
    );
    throw new ApiError(409, 'Delivery channel disabled.');
  }
  if (
    job.state === 'leased' &&
    job.lease_token === body.leaseToken &&
    (job.lease_until || 0) <= now
  ) {
    await r.db.query(
      "UPDATE jobs SET state='pending',lease_token=NULL,lease_until=NULL WHERE id=? AND state='leased' AND lease_token=?",
      [job.id, body.leaseToken],
    );
    throw new ApiError(409, 'The lease expired before sending.');
  }
  const attemptId = crypto.randomUUID();
  const category = ['confirmation', 'management', 'test'].includes(job.kind)
    ? 'transactional'
    : 'alert';
  const eligibility = `id=? AND state='leased' AND lease_token=? AND lease_until>? AND due_at<=? AND expires_at>? AND ${permittedSend}`;
  const args = [job.id, body.leaseToken, now, now, now];
  const statements: Statement[] = [];
  if (sub.channel === 'email')
    statements.push({
      sql: `INSERT INTO email_attempts(id,kind,at) SELECT ?,?,? FROM jobs WHERE ${eligibility} AND (SELECT count(*) FROM email_attempts WHERE at>?)<250 AND (SELECT count(*) FROM email_attempts WHERE at>? AND kind=?)<?`,
      args: [
        attemptId,
        category,
        now,
        ...args,
        now - 86400000,
        now - 86400000,
        category,
        category === 'transactional' ? 50 : 200,
      ],
    });
  statements.push({
    sql: `UPDATE jobs SET state='sending',attempt_id=?,attempts=attempts+1 WHERE ${eligibility}${sub.channel === 'email' ? ' AND EXISTS(SELECT 1 FROM email_attempts WHERE id=?)' : ''} RETURNING *`,
    args: [attemptId, ...args, ...(sub.channel === 'email' ? [attemptId] : [])],
  });
  const results = await r.db.batch(statements);
  const sent = results.at(-1)?.[0];
  if (!sent) {
    await r.db.query(
      "UPDATE jobs SET state='skipped',last_result='quota_or_eligibility',payload=NULL WHERE id=? AND state='leased' AND lease_token=?",
      [job.id, body.leaseToken],
    );
    throw new ApiError(
      409,
      'This delivery was skipped because its quota or eligibility changed.',
    );
  }
  const destination = await decrypt<Destination>(
    sub.encrypted_destination,
    r.env.DATA_KEY,
  );
  if (destination.push) validatePush(destination.push);
  const message = await jobMessage(r, job, sub, destination);
  const delivery: Delivery = {
    id: job.id,
    attemptId,
    channel: sub.channel,
    kind: job.kind,
    destination,
    ...message,
    expiresAt: job.expires_at,
    tag: job.event_id ? `reset-${job.event_id}` : job.id,
    unsubscribeUrl: destination.unsubscribeToken
      ? `${appOrigin(r.env)}/api/unsubscribe/one-click?token=${destination.unsubscribeToken}`
      : undefined,
  };
  return json(delivery);
}
async function queueTest(request: Request, r: Runtime) {
  assert(
    r.env.VERIFICATION_MODE === 'true',
    'Private verification is disabled.',
    503,
  );
  const body = await readJson(request);
  assert(body.consent === true, 'Use an opted-in test recipient.');
  assert(
    body.channel === 'email' || body.channel === 'push',
    'Invalid test channel.',
  );
  const channel = body.channel;
  const raw =
    channel === 'email' ? normalizeEmail(body.email) : validatePush(body.push);
  if (channel === 'email')
    assert(
      r.env.TEST_EMAIL && normalizeEmail(r.env.TEST_EMAIL) === raw,
      'Test recipient is not allowlisted.',
      403,
    );
  await rateLimit(r, 'operator-tests', 5, 3600000);
  const id = crypto.randomUUID(),
    now = nowOf(r),
    jobId = crypto.randomUUID(),
    manageToken = randomToken();
  const destination: Destination = {
    ...(channel === 'email'
      ? { email: raw as string }
      : { push: raw as Destination['push'] }),
    manageToken,
  };
  const url = appOrigin(r.env) + '/';
  const payload = await encrypt(
    {
      subject: 'Tibo Alerts delivery test',
      text: 'This is the delivery test you requested. No reset is being announced. Confirm that this message arrived on your device or in your inbox.',
      url,
    },
    r.env.DATA_KEY,
  );
  await r.db.batch([
    {
      sql: "INSERT INTO subscriptions(id,channel,destination_key,encrypted_destination,timezone,preference,status,manage_hash,consent_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'verification',?,?,?,?)",
      args: [
        id,
        channel,
        id,
        await encrypt(destination, r.env.DATA_KEY),
        'UTC',
        'announcement',
        await hash(manageToken),
        now,
        now,
        now,
      ],
    },
    {
      sql: "INSERT INTO jobs(id,subscription_id,kind,payload,due_at,expires_at,state,created_at) VALUES(?,?,'test',?,?,?,'pending',?)",
      args: [jobId, id, payload, now, now + 15 * 60000, now],
    },
  ]);
  return json({ jobId }, 201);
}
async function acknowledge(request: Request, r: Runtime) {
  const body = await readJson(request);
  assert(
    typeof body.id === 'string' && typeof body.leaseToken === 'string',
    'Invalid job lease.',
  );
  const outcome = body.outcome;
  assert(
    ['sent', 'retry', 'unknown', 'invalid', 'permanent', 'expired'].includes(
      String(outcome),
    ),
    'Invalid delivery outcome.',
  );
  assert(
    body.providerId === undefined ||
      (typeof body.providerId === 'string' && body.providerId.length <= 255),
    'Invalid provider receipt.',
  );
  const now = nowOf(r),
    state =
      outcome === 'sent'
        ? 'sent'
        : outcome === 'retry'
          ? 'pending'
          : outcome === 'invalid'
            ? 'failed'
            : String(outcome);
  const rows = await r.db.query<JobRow>(
    "UPDATE jobs SET state=CASE WHEN ?='pending' AND attempts>=3 THEN 'failed' ELSE ? END,provider_id=?,last_result=?,due_at=CASE WHEN ?='pending' THEN ? ELSE due_at END,lease_token=NULL,lease_until=NULL,payload=CASE WHEN ?='sent' THEN NULL ELSE payload END WHERE id=? AND state='sending' AND lease_token=? RETURNING *",
    [
      state,
      state,
      typeof body.providerId === 'string' ? body.providerId : null,
      String(outcome),
      state,
      now + 5 * 60000,
      state,
      body.id,
      body.leaseToken,
    ],
  );
  if (rows[0] && outcome === 'invalid')
    await suppress(r, rows[0].subscription_id);
  return json({ acknowledged: rows.length > 0 });
}
async function webhook(request: Request, r: Runtime) {
  await requireBearer(request, r.env.BREVO_WEBHOOK_SECRET);
  const body = await readJson(request, 65536);
  const event = body.event;
  if (
    [
      'hard_bounce',
      'spam',
      'unsubscribed',
      'blocked',
      'invalid_email',
    ].includes(String(event))
  ) {
    const email = normalizeEmail(body.email);
    const key = await destinationKey(email, r.env.DATA_KEY);
    const rows = await r.db.query<{ id: string }>(
      "SELECT id FROM subscriptions WHERE channel='email' AND destination_key=?",
      [key],
    );
    if (rows[0]) await suppress(r, rows[0].id);
  } else if (event === 'delivered' && typeof body['message-id'] === 'string')
    await r.db.query(
      "UPDATE jobs SET state='delivered' WHERE provider_id=? AND state='sent'",
      [body['message-id']],
    );
  return json({ received: true });
}
export async function handleRequest(
  request: Request,
  r: Runtime,
): Promise<Response> {
  try {
    const url = new URL(request.url),
      path = url.pathname,
      method = request.method;
    if (path === '/api/health' && method === 'GET') {
      await r.db.query('SELECT 1');
      return json({ service: 'tibo-alerts', database: true });
    }
    if (path === '/api/public' && method === 'GET')
      return json(await publicData(r));
    if (path === '/api/events' && method === 'GET') {
      const id = url.searchParams.get('id');
      assert(id && /^\d{1,25}$/.test(id), 'Invalid event identity.');
      const rows = await r.db.query<{ body: string }>(
        'SELECT body FROM events WHERE id=?',
        [id],
      );
      assert(rows[0], 'This announcement is no longer available.', 404);
      return json(JSON.parse(rows[0].body));
    }
    if (path.startsWith('/api/internal/')) {
      const scanner = path.startsWith('/api/internal/source');
      await requireBearer(
        request,
        scanner ? r.env.SCANNER_SECRET : r.env.DELIVERY_SECRET,
      );
      if (path === '/api/internal/source/checkpoint' && method === 'GET')
        return json({
          ...(await getState(r, 'source', emptySource)),
          expectedSourceId: r.env.EXPECTED_SOURCE_ID || null,
          connectorCommit: CONNECTOR_COMMIT,
        });
      if (path === '/api/internal/source/ingest' && method === 'POST')
        return json(await ingest(r, await readJson(request, 1024 * 1024)));
      if (path === '/api/internal/source/failure' && method === 'POST') {
        const body = await readJson(request);
        const previous = await getState(r, 'source', emptySource);
        await setState(r, 'source', {
          ...previous,
          state: 'failed',
          lastAttemptAt: new Date(nowOf(r)).toISOString(),
          error:
            typeof body.code === 'string' && /^[A-Z_]{1,60}$/.test(body.code)
              ? body.code
              : 'SOURCE_FAILED',
        });
        return json({ recorded: true });
      }
      if (path === '/api/internal/source/ack-gap' && method === 'POST') {
        const previous = await getState(r, 'source', emptySource);
        await setState(r, 'source', {
          ...previous,
          coverageGap: false,
          state: previous.lastSuccessAt ? 'healthy' : 'unconfigured',
        });
        return json({ acknowledged: true });
      }
      if (path === '/api/internal/jobs/test' && method === 'POST')
        return await queueTest(request, r);
      if (path === '/api/internal/jobs/claim' && method === 'POST')
        return json(await claim(request, r));
      if (path === '/api/internal/jobs/authorize' && method === 'POST')
        return await authorize(request, r);
      if (path === '/api/internal/jobs/ack' && method === 'POST')
        return await acknowledge(request, r);
      if (path === '/api/internal/jobs/heartbeat' && method === 'POST') {
        const body = await readJson(request);
        assert(
          body.state === 'healthy' || body.state === 'failed',
          'Invalid heartbeat.',
        );
        const previous = await getState(r, 'delivery', {
          state: 'unconfigured',
          lastSuccessAt: null,
        });
        await setState(r, 'delivery', {
          state: body.state,
          lastSuccessAt:
            body.state === 'healthy'
              ? new Date(nowOf(r)).toISOString()
              : previous.lastSuccessAt,
          lastAttemptAt: new Date(nowOf(r)).toISOString(),
        });
        return json({ recorded: true });
      }
      throw new ApiError(404, 'Endpoint not found.');
    }
    if (path === '/api/webhooks/brevo' && method === 'POST')
      return await webhook(request, r);
    if (path === '/api/unsubscribe/one-click' && method === 'POST')
      return await unsubscribe(request, r, true);
    if (method !== 'GET') {
      // Only the runtime boundary may identify a trusted proxy header. Capability-protected
      // management and unsubscribe are never blocked by a shared anonymous IP bucket.
      if (path === '/api/subscriptions' || path === '/api/manage/request') {
        const ip = r.trustedIpHeader
          ? request.headers.get(r.trustedIpHeader)
          : null;
        if (ip)
          await rateLimit(r, `ip:${await hash(ip.slice(0, 128))}`, 30, 3600000);
        if (path === '/api/manage/request')
          await rateLimit(r, 'manage-global', 100, 3600000);
      }
    }
    if (path === '/api/subscriptions' && method === 'POST')
      return await subscribe(request, r);
    if (path === '/api/confirm' && method === 'POST')
      return await confirm(request, r);
    if (
      (path === '/api/manage/session' || path === '/api/manage/request') &&
      method === 'POST'
    )
      return await manage(request, r, path);
    if (
      path === '/api/subscriptions/me' &&
      (method === 'GET' || method === 'PATCH')
    )
      return await manage(request, r, path);
    if (path === '/api/unsubscribe' && method === 'POST')
      return await unsubscribe(request, r, false);
    throw new ApiError(404, 'Endpoint not found.');
  } catch (error) {
    if (error instanceof ApiError)
      return json({ error: error.message }, error.status);
    console.error('tibo_request_failed');
    return json(
      { error: 'Something went wrong. Please try again later.' },
      500,
    );
  }
}
