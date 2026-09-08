import type { Runtime, SourcePost, ResetEvent, Statement } from './types';
import { validateCoverage, unitKey, type CoverageUnit } from './coverage';
import { assert } from './security';
import { parseReset } from './parser';
import { getState, nowOf, stateStatement, launchReady } from './service';
export const CONNECTOR_COMMIT = '865f1cf5af3973dffaa2cb8c2d73ee0538043c12';
const EXPANSION_LIMIT = 5000;
export type SourceState = {
  state: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  observedIds: string[];
  head: CoverageUnit | null;
  coverageGap: boolean;
  error?: string;
};
export const emptySource: SourceState = {
  state: 'unconfigured',
  lastSuccessAt: null,
  lastAttemptAt: null,
  observedIds: [],
  head: null,
  coverageGap: false,
};
export function validateBatch(
  body: Record<string, unknown>,
  expected: string | undefined,
  now: number,
) {
  assert(
    expected && /^\d{1,25}$/.test(expected),
    'The source identity has not been pinned.',
    503,
  );
  assert(
    typeof body.scanId === 'string' && /^[a-f0-9-]{36}$/.test(body.scanId),
    'Invalid scan identity.',
  );
  assert(
    body.connectorCommit === CONNECTOR_COMMIT,
    'Unrecognized source reader.',
  );
  const at = Date.parse(String(body.fetchedAt));
  assert(
    Number.isFinite(at) && at <= now + 60000 && at >= now - 15 * 60000,
    'Stale source batch.',
  );
  assert(
    Array.isArray(body.posts) &&
      body.posts.length > 0 &&
      body.posts.length <= 100,
    'Invalid source window.',
  );
  const seen = new Set<string>();
  const posts: SourcePost[] = [];
  for (const raw of body.posts) {
    assert(raw && typeof raw === 'object', 'Invalid post.');
    const p = raw as SourcePost;
    assert(
      typeof p.id === 'string' && /^\d{1,25}$/.test(p.id) && !seen.has(p.id),
      'Invalid post identity.',
    );
    seen.add(p.id);
    assert(
      p.authorId === expected &&
        p.authorHandle === 'thsottiaux' &&
        p.url === `https://x.com/thsottiaux/status/${p.id}`,
      'Source identity mismatch.',
    );
    assert(
      typeof p.text === 'string' &&
        p.text.trim().length > 0 &&
        p.text.length <= 30000,
      'Invalid post text.',
    );
    const published = Date.parse(p.publishedAt);
    assert(
      Number.isFinite(published) &&
        published <= at + 60000 &&
        published >= Date.UTC(2006, 0, 1),
      'Invalid post timestamp.',
    );
    assert(
      p.replyToId === null ||
        (typeof p.replyToId === 'string' && /^\d{1,25}$/.test(p.replyToId)),
      'Invalid reply identity.',
    );
    assert(
      p.possiblyTruncated !== true,
      'The source returned incomplete post text.',
    );
    posts.push({ ...p, publishedAt: new Date(published).toISOString() });
  }
  return posts.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}
type JobTemplate = {
  eventId: string;
  revision: number;
  kind: string;
  due: number;
  expiry: number;
  excluded: string;
};
function jobTemplates(event: ResetEvent, now: number): JobTemplate[] {
  if (event.kind === 'cancelled') return [];
  const templates: JobTemplate[] = [];
  const add = (kind: string, due: number, expiry: number, excluded: string) =>
    templates.push({
      eventId: event.id,
      revision: event.revision,
      kind,
      due,
      expiry,
      excluded,
    });
  if (Date.parse(event.publishedAt) >= now - 30 * 60000)
    add('announcement', now, now + 30 * 60000, 'reminder');
  if (event.scheduledAt) {
    const scheduled = Date.parse(event.scheduledAt);
    if (scheduled > now && scheduled < now + 31 * 86400000)
      add('reminder', scheduled, scheduled + 15 * 60000, 'announcement');
  }
  return templates;
}
function jsonParameter(value: unknown) {
  const json = JSON.stringify(value);
  assert(
    new TextEncoder().encode(json).length < 1800000,
    'Source batch exceeds the storage limit.',
    413,
  );
  return json;
}
export async function ingest(r: Runtime, body: Record<string, unknown>) {
  const now = nowOf(r);
  const posts = validateBatch(body, r.env.EXPECTED_SOURCE_ID, now);
  if (
    (await r.db.query('SELECT id FROM scans WHERE id=?', [String(body.scanId)]))
      .length
  )
    return { accepted: true, duplicate: true };
  const units = validateCoverage(
    body.coverageUnits,
    new Set(posts.map((p) => p.id)),
  );
  const previous = await getState(r, 'source', emptySource);
  const overlap =
    previous.head !== null &&
    units.some((u) => unitKey(u) === unitKey(previous.head!));
  const bootstrap = previous.observedIds.length === 0;
  const gap = previous.coverageGap || (!bootstrap && !overlap);
  const pending = new Map<string, ResetEvent>();
  const postEvents = new Map<string, string>();
  const newPosts: {
    id: string;
    body: string;
    publishedAt: number;
    eventId: string | null;
  }[] = [];
  const ids = [
    ...new Set(
      posts.flatMap((p) => (p.replyToId ? [p.id, p.replyToId] : [p.id])),
    ),
  ];
  const stored = await r.db.query<{
    id: string;
    body: string;
    event_id: string | null;
    event_body: string | null;
  }>(
    'SELECT p.id,p.body,p.event_id,e.body AS event_body FROM posts p LEFT JOIN events e ON e.id=p.event_id WHERE p.id IN (SELECT value FROM json_each(?))',
    [jsonParameter(ids)],
  );
  const existing = new Map(stored.map((p) => [p.id, p]));
  let detected = 0;
  for (const post of posts) {
    const old = existing.get(post.id);
    if (old) {
      assert(
        JSON.parse(old.body).text === post.text,
        'An existing post changed; source review required.',
        409,
      );
      continue;
    }
    let parent: ResetEvent | undefined;
    if (post.replyToId) {
      const storedParent = existing.get(post.replyToId);
      const parentKey =
        postEvents.get(post.replyToId) || storedParent?.event_id;
      if (parentKey)
        parent =
          pending.get(parentKey) ||
          (storedParent?.event_body
            ? JSON.parse(storedParent.event_body)
            : undefined);
    }
    const event = parseReset(post, parent);
    newPosts.push({
      id: post.id,
      body: JSON.stringify(post),
      publishedAt: Date.parse(post.publishedAt),
      eventId: event?.id || null,
    });
    if (event) {
      pending.set(event.id, event);
      postEvents.set(post.id, event.id);
      detected++;
    }
  }
  const events = [...pending.values()];
  const templates = launchReady(r)
    ? events
        .flatMap((event) => jobTemplates(event, now))
        .filter((t) => !bootstrap || t.kind === 'reminder')
    : [];
  // Fail the whole scan before advancing its checkpoint if a source burst would
  // create excessive fan-out. A degraded scan is visible; silent truncation is not.
  if (templates.length) {
    const counts = await r.db.query<{ preference: string; count: number }>(
      "SELECT preference,COUNT(*) AS count FROM subscriptions WHERE status='active' GROUP BY preference",
    );
    const expansion = templates.reduce(
      (sum, template) =>
        sum +
        counts.reduce(
          (n, group) =>
            n + (group.preference === template.excluded ? 0 : group.count),
          0,
        ),
      0,
    );
    assert(
      expansion <= EXPANSION_LIMIT,
      'Source burst exceeds the notification expansion limit; operator review required.',
      503,
    );
  }
  const eventJson = jsonParameter(
    events.map((e) => ({
      id: e.id,
      body: JSON.stringify(e),
      revision: e.revision,
    })),
  );
  const statements: Statement[] = [
    // D1 batches serialize these writes. The NOT NULL checkpoint timestamp is
    // also an atomic cap assertion, before any fan-out or checkpoint can commit.
    {
      sql: "INSERT INTO scans(id,at) SELECT ?,CASE WHEN (SELECT COALESCE(SUM(s.count),0) FROM json_each(?) t CROSS JOIN (SELECT preference,COUNT(*) AS count FROM subscriptions WHERE status='active' GROUP BY preference) s WHERE s.preference<>json_extract(t.value,'$.excluded'))<=? THEN ? ELSE NULL END",
      args: [
        String(body.scanId),
        jsonParameter(templates),
        EXPANSION_LIMIT,
        now,
      ],
    },
    {
      sql: "INSERT INTO posts(id,body,published_at,received_at,event_id) SELECT json_extract(value,'$.id'),json_extract(value,'$.body'),json_extract(value,'$.publishedAt'),?,json_extract(value,'$.eventId') FROM json_each(?)",
      args: [now, jsonParameter(newPosts)],
    },
    {
      sql: "INSERT INTO events(id,body,revision,updated_at) SELECT json_extract(value,'$.id'),json_extract(value,'$.body'),json_extract(value,'$.revision'),? FROM json_each(?) WHERE true ON CONFLICT(id) DO UPDATE SET body=excluded.body,revision=excluded.revision,updated_at=excluded.updated_at",
      args: [now, eventJson],
    },
    {
      sql: "UPDATE jobs SET state='cancelled',last_result='event_updated',payload=NULL WHERE state IN ('pending','leased','sending') AND event_id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND event_revision<>(SELECT revision FROM events WHERE events.id=jobs.event_id)",
      args: [eventJson],
    },
    {
      sql: "INSERT OR IGNORE INTO jobs(id,subscription_id,event_id,event_revision,kind,due_at,expires_at,state,created_at) SELECT json_extract(t.value,'$.eventId')||':'||json_extract(t.value,'$.revision')||':'||json_extract(t.value,'$.kind')||':'||s.id,s.id,json_extract(t.value,'$.eventId'),json_extract(t.value,'$.revision'),json_extract(t.value,'$.kind'),json_extract(t.value,'$.due'),json_extract(t.value,'$.expiry'),'pending',? FROM json_each(?) t CROSS JOIN subscriptions s WHERE s.status='active' AND s.preference<>json_extract(t.value,'$.excluded')",
      args: [now, jsonParameter(templates)],
    },
  ];
  const source: SourceState = {
    state: gap ? 'gap' : 'healthy',
    lastSuccessAt: new Date(now).toISOString(),
    lastAttemptAt: new Date(now).toISOString(),
    observedIds: posts.map((p) => p.id),
    head: units[0],
    coverageGap: gap,
  };
  statements.push(stateStatement('source', source));
  await r.db.batch(statements);
  return {
    accepted: true,
    detected,
    coverage: bootstrap ? 'bootstrap' : gap ? 'gap' : 'overlap',
  };
}
