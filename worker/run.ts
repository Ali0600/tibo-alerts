import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { collectSource } from '../scripts/source-check.mjs';
import { sendDelivery } from './transport';
import type { Delivery } from '../core/types';
import { appOrigin } from '../core/security';
export async function runOnce(
  env: Record<string, string | undefined> = process.env,
) {
  const publicOrigin = appOrigin(env);
  const origin = env.INTERNAL_API_ORIGIN || publicOrigin;
  const internal = new URL(origin);
  if (
    !['http:', 'https:'].includes(internal.protocol) ||
    internal.username ||
    internal.password ||
    internal.pathname !== '/' ||
    internal.search ||
    internal.hash
  )
    throw new Error('INVALID_INTERNAL_ORIGIN');
  let scanFailed = false,
    deliveryFailed = false;
  async function api(path: string, secret: string | undefined, body?: unknown) {
    if (!secret) throw new Error('WORKER_NOT_CONFIGURED');
    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error('API_REQUEST_FAILED') as Error & {
        status: number;
      };
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  try {
    const checkpoint = await api(
      '/api/internal/source/checkpoint',
      env.SCANNER_SECRET,
    );
    const batch = await collectSource({
      ...env,
      EXPECTED_SOURCE_ID: checkpoint.expectedSourceId || env.EXPECTED_SOURCE_ID,
    });
    await api('/api/internal/source/ingest', env.SCANNER_SECRET, batch);
  } catch (error) {
    scanFailed = true;
    const code =
      error instanceof Error && /^[A-Z_]{1,60}$/.test(error.message)
        ? error.message
        : 'SOURCE_FAILED';
    try {
      await api('/api/internal/source/failure', env.SCANNER_SECRET, { code });
    } catch {}
    console.error('Source check failed; delivery will still run.');
  }
  const deadline = Date.now() + 180000;
  let processed = 0;
  try {
    while (Date.now() < deadline && processed < 1000) {
      const batch = await api(
        '/api/internal/jobs/claim',
        env.DELIVERY_SECRET,
        {},
      );
      if (!batch.jobs.length) break;
      // One claim at a time keeps provider delays from consuming another job’s lease.
      for (const lease of batch.jobs) {
        if (Date.now() > deadline) break;
        let delivery: Delivery;
        try {
          delivery = await api(
            '/api/internal/jobs/authorize',
            env.DELIVERY_SECRET,
            lease,
          );
        } catch (error) {
          if ((error as { status?: number }).status === 409) {
            deliveryFailed = true;
            continue;
          }
          throw error;
        }
        const result = await sendDelivery(delivery, env);
        await api('/api/internal/jobs/ack', env.DELIVERY_SECRET, {
          ...lease,
          ...result,
        });
        processed++;
        if (['unknown', 'permanent', 'retry'].includes(result.outcome))
          deliveryFailed = true;
      }
    }
  } catch {
    deliveryFailed = true;
    console.error('Delivery check failed. No recipient details are logged.');
  }
  try {
    await api('/api/internal/jobs/heartbeat', env.DELIVERY_SECRET, {
      state: deliveryFailed ? 'failed' : 'healthy',
    });
  } catch {
    deliveryFailed = true;
  }
  console.log(
    JSON.stringify({
      source: scanFailed ? 'failed' : 'healthy',
      delivery: deliveryFailed ? 'failed' : 'healthy',
      processed,
    }),
  );
  return !scanFailed && !deliveryFailed;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes('--help'))
    console.log(
      'Usage: npm run worker -- [--loop]\nChecks the source and dispatches due jobs once, or every five minutes with --loop. Secrets are read from environment variables.',
    );
  else {
    do {
      try {
        if (!(await runOnce())) process.exitCode = 1;
        else process.exitCode = 0;
      } catch {
        console.error('Worker configuration or service unavailable.');
        process.exitCode = 1;
      }
      if (process.argv.includes('--loop')) await sleep(300000);
    } while (process.argv.includes('--loop'));
  }
}
