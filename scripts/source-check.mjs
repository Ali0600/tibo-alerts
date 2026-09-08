import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const CONNECTOR_COMMIT = '865f1cf5af3973dffaa2cb8c2d73ee0538043c12';
const root = fileURLToPath(new URL('../', import.meta.url));
/** @param {Record<string, string | undefined>} env */
export async function collectSource(env = process.env) {
  const smoke = env.TIBO_IMPORT_ONLY === 'true';
  if (!smoke && !env.TWITTER_AUTH_TOKEN) throw new Error('AUTH_CONFIGURATION');
  const source = resolve(env.RSSHUB_PATH || join(root, '.source-reader'));
  const revision = await readFile(
    join(source, '.tibo-reader-revision'),
    'utf8',
  ).catch(() => null);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: source,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const clean = spawnSync('git', ['diff', '--quiet', 'HEAD', '--'], {
    cwd: source,
    stdio: 'ignore',
  });
  if (
    clean.status !== 0 ||
    head.status !== 0 ||
    head.stdout.trim() !== CONNECTOR_COMMIT ||
    revision?.trim() !== CONNECTOR_COMMIT
  )
    throw new Error('PINNED_READER_NOT_INSTALLED');
  const temporary = await mkdtemp(join(tmpdir(), 'tibo-scan-'));
  const output = join(temporary, 'result.json');
  try {
    await copyFile(
      join(root, 'worker/rsshub-collector.mjs'),
      join(source, '_tibo_collector.mjs'),
    );
    // The type-only app import is erased by tsx; no project code or secrets enter the upstream checkout.
    const normalizer = await readFile(
      join(root, 'worker/source-normalize.ts'),
      'utf8',
    );
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(source, '_tibo_source_normalize.ts'),
      normalizer.replace(
        "import type { SourcePost } from '../core/types';",
        'type SourcePost = {id:string;authorId:string;authorHandle:string;url:string;text:string;publishedAt:string;replyToId:string|null;isQuote?:boolean;possiblyTruncated?:boolean};',
      ),
    );
    const childEnv = Object.fromEntries(
      ['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT']
        .filter((k) => env[k])
        .map((k) => [k, env[k]]),
    );
    Object.assign(childEnv, {
      TWITTER_AUTH_TOKEN: smoke ? 'import-smoke-only' : env.TWITTER_AUTH_TOKEN,
      TIBO_IMPORT_ONLY: smoke ? 'true' : 'false',
      EXPECTED_SOURCE_ID: env.EXPECTED_SOURCE_ID || '',
      TIBO_SCAN_OUTPUT: output,
      NODE_ENV: 'production',
    });
    await new Promise((resolvePromise, reject) => {
      const child = spawn(
        process.execPath,
        [
          join(source, 'node_modules/tsx/dist/cli.mjs'),
          '--tsconfig',
          join(source, 'tsconfig.json'),
          join(source, '_tibo_collector.mjs'),
        ],
        {
          cwd: source,
          env: childEnv,
          stdio: 'ignore',
          detached: process.platform !== 'win32',
        },
      );
      const timer = setTimeout(() => {
        try {
          if (process.platform === 'win32') child.kill('SIGKILL');
          else if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {}
        reject(new Error('SOURCE_TIMEOUT'));
      }, 45000);
      child.on('error', () => {
        clearTimeout(timer);
        reject(new Error('SOURCE_START_FAILED'));
      });
      child.on('exit', () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
    const raw = await readFile(output);
    if (raw.length > 1024 * 1024) throw new Error('SOURCE_RESPONSE_TOO_LARGE');
    const batch = JSON.parse(raw.toString());
    if (batch.error)
      throw new Error(
        /^[A-Z_]{1,60}$/.test(batch.error) ? batch.error : 'SOURCE_FAILED',
      );
    if (smoke) {
      if (batch.importReady !== true) throw new Error('IMPORT_SMOKE_FAILED');
      return batch;
    }
    if (!Array.isArray(batch.posts) || !batch.posts.length)
      throw new Error('EMPTY_SOURCE_WINDOW');
    return batch;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes('--help'))
    console.log(
      'Usage: npm run source:check\nRequires TWITTER_AUTH_TOKEN and a pinned RSSHUB_PATH. Reports public source evidence only; never sends alerts.',
    );
  else
    try {
      const batch = await collectSource(
        process.argv.includes('--smoke')
          ? { ...process.env, TIBO_IMPORT_ONLY: 'true' }
          : process.env,
      );
      if (batch.importReady) {
        console.log(
          'Pinned reader imports successfully. No X request was made.',
        );
      } else
        console.log(
          JSON.stringify(
            {
              authorId: batch.source.authorId,
              handle: batch.source.handle,
              posts: batch.posts.map((p) => ({
                id: p.id,
                publishedAt: p.publishedAt,
                replyToId: p.replyToId,
                text: p.text,
                url: p.url,
              })),
              connectorCommit: batch.connectorCommit,
            },
            null,
            2,
          ),
        );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
}
