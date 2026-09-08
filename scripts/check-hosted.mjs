import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { verifyBundle } from './bundle-budget.mjs';

const serverDir = resolve('dist/server');
const config = JSON.parse(
  await readFile(join(serverDir, 'wrangler.json'), 'utf8'),
);
const entry = resolve(serverDir, config.main);
const paths = (await readdir(serverDir, { recursive: true }))
  .filter((p) => /\.m?js$/.test(p))
  .map((p) => join(serverDir, p));
const origin = 'https://hosted-test.example';
const secret = 's'.repeat(64);
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: [entry, ...paths.filter((p) => p !== entry)].map((path) => ({
      type: 'ESModule',
      path,
    })),
    modulesRoot: serverDir,
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    d1Databases: { DB: 'isolated-test-database' },
    assets: {
      directory: resolve(serverDir, config.assets.directory),
      routerConfig: { has_user_worker: true },
    },
    bindings: {
      APP_ORIGIN: origin,
      SCANNER_SECRET: secret,
      EXPECTED_SOURCE_ID: '123',
      ALERTS_ENABLED: 'false',
    },
    cf: false,
    telemetry: { enabled: false },
  }),
);
try {
  const db = await mf.getD1Database('DB');
  for (const name of (await readdir('drizzle'))
    .filter((n) => /^\d.*\.sql$/.test(n))
    .sort()) {
    const statements = (await readFile(join('drizzle', name), 'utf8'))
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(statements.map((s) => db.prepare(s)));
  }
  const fetchPage = (path) => mf.dispatchFetch(origin + path);
  const homepage = await fetchPage('/');
  assert.equal(homepage.status, 200);
  await verifyBundle(await homepage.text());
  const health = await (await fetchPage('/api/health')).json();
  assert.equal(health.database, true);
  const now = new Date().toISOString();
  const posts = Array.from({ length: 100 }, (_, i) => ({
    id: String(100 + i),
    authorId: '123',
    authorHandle: 'thsottiaux',
    url: `https://x.com/thsottiaux/status/${100 + i}`,
    text: 'We will reset Codex limits in three hours.',
    publishedAt: now,
    replyToId: null,
  }));
  const source = {
    scanId: crypto.randomUUID(),
    connectorCommit: '865f1cf5af3973dffaa2cb8c2d73ee0538043c12',
    fetchedAt: now,
    posts,
    coverageUnits: posts.map((p) => ({
      entryId: 'tweet-' + p.id,
      sortIndex: p.id,
      sourcePostIds: [p.id],
    })),
  };
  const ingest = () =>
    mf.dispatchFetch(origin + '/api/internal/source/ingest', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secret,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(source),
    });
  const accepted = await ingest();
  assert.equal(accepted.status, 200, await accepted.text());
  assert.equal((await (await ingest()).json()).duplicate, true);
  assert.equal(
    (await db.prepare('SELECT COUNT(*) AS count FROM events').first()).count,
    100,
  );
  const status = await (await fetchPage('/api/public')).json();
  assert.equal(status.source.state, 'healthy');
  assert.equal(status.capabilities.email, false);
  assert.equal(status.capabilities.push, false);
  await assert.rejects(
    db.batch([
      db.prepare("INSERT INTO state(key,value) VALUES('rollback-probe','{}')"),
      db.prepare("INSERT INTO state(key,value) VALUES('rollback-probe','{}')"),
    ]),
  );
  assert.equal(
    await db
      .prepare("SELECT key FROM state WHERE key='rollback-probe'")
      .first(),
    null,
  );
  assert.equal((await fetchPage('/sw.js')).status, 200);
  console.log(
    'Hosted Worker, D1 migrations, 100-post ingestion, deduplication, atomic rollback and closed launch gates verified.',
  );
} finally {
  await mf.dispose();
}
