import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const [mode, origin] = process.argv.slice(2);
if (!['write', 'verify'].includes(mode) || !origin)
  throw new Error(
    'Usage: persistence-smoke.mjs write|verify http://localhost:PORT',
  );
const url = new URL(origin);
if (!['localhost', '127.0.0.1'].includes(url.hostname))
  throw new Error(
    'Persistence smoke is restricted to isolated localhost deployments.',
  );
const proof = '.artifacts/persistence-proof.json';
const state = async () =>
  (await (await fetch(origin + '/api/public')).json()).delivery;
if (mode === 'write') {
  if (!process.env.DELIVERY_SECRET)
    throw new Error('DELIVERY_SECRET is required.');
  const response = await fetch(origin + '/api/internal/jobs/heartbeat', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.DELIVERY_SECRET,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state: 'healthy' }),
  });
  assert.equal(response.status, 200);
  const value = await state();
  assert(value.lastSuccessAt);
  await mkdir('.artifacts', { recursive: true });
  await writeFile(proof, JSON.stringify(value));
  console.log(
    'Persisted an authenticated database marker. Recreate the app before verifying.',
  );
} else {
  const before = JSON.parse(await readFile(proof, 'utf8'));
  const after = await state();
  assert.equal(after.lastSuccessAt, before.lastSuccessAt);
  console.log('Exact database marker survived container recreation.');
}
