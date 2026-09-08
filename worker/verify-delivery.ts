import { readFile } from 'node:fs/promises';
import { appOrigin, normalizeEmail, validatePush } from '../core/security';
import { sendDelivery } from './transport';
const args = process.argv.slice(2);
if (args.includes('--help'))
  console.log(
    'Usage: npm run verify:delivery -- --email=you@example.com\n   or: npm run verify:delivery -- --push-file=/private/device.json\nRequires VERIFICATION_MODE=true on the app and its DELIVERY_SECRET. Email must match server TEST_EMAIL. Every attempt uses the durable queue and rolling quota. Check the actual inbox/device before marking delivery verified.',
  );
else {
  try {
    const emailArg = args.find((a) => a.startsWith('--email='));
    const pushArg = args.find((a) => a.startsWith('--push-file='));
    if (Number(!!emailArg) + Number(!!pushArg) !== 1 || args.length !== 1)
      throw new Error(
        'Choose exactly one opted-in test recipient; see --help.',
      );
    const origin = process.env.INTERNAL_API_ORIGIN || appOrigin(process.env);
    async function api(path: string, body: unknown) {
      const res = await fetch(origin + path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.DELIVERY_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok)
        throw new Error(
          `Verification API declined the request (${res.status}).`,
        );
      return res.json();
    }
    const destination = emailArg
      ? { email: normalizeEmail(emailArg.slice(8)) }
      : {
          push: validatePush(
            JSON.parse(await readFile(pushArg!.slice(12), 'utf8')),
          ),
        };
    const { jobId } = await api('/api/internal/jobs/test', {
      channel: emailArg ? 'email' : 'push',
      ...destination,
      consent: true,
    });
    const lease = (await api('/api/internal/jobs/claim', { testId: jobId }))
      .jobs[0];
    if (!lease) throw new Error('Test job was not claimed.');
    const delivery = await api('/api/internal/jobs/authorize', lease);
    const result = await sendDelivery(delivery, process.env);
    await api('/api/internal/jobs/ack', { ...lease, ...result });
    if (result.outcome !== 'sent')
      throw new Error(`Test delivery outcome: ${result.outcome}.`);
    console.log(
      'Provider accepted the test. Verify that it actually arrived in the inbox/device; provider acceptance alone is not delivery proof.',
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Verification failed.',
    );
    process.exitCode = 1;
  }
}
