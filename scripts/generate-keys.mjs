import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import webpush from 'web-push';
if (process.argv.includes('--help'))
  console.log(
    'Usage: npm run keys -- --write\nCreate .env with independent secrets and VAPID keys. Refuses to overwrite an existing file. No keys are printed.',
  );
else if (process.argv.length !== 3 || process.argv[2] !== '--write') {
  console.error(
    'Use --write to create a new .env. Existing files are never overwritten.',
  );
  process.exitCode = 1;
} else {
  try {
    let contents = await readFile('.env.example', 'utf8');
    const vapid = webpush.generateVAPIDKeys();
    const values = {
      DATA_KEY: randomBytes(32).toString('base64'),
      SCANNER_SECRET: randomBytes(32).toString('hex'),
      DELIVERY_SECRET: randomBytes(32).toString('hex'),
      BREVO_WEBHOOK_SECRET: randomBytes(32).toString('hex'),
      VAPID_PUBLIC_KEY: vapid.publicKey,
      VAPID_PRIVATE_KEY: vapid.privateKey,
    };
    for (const [key, value] of Object.entries(values))
      contents = contents.replace(
        new RegExp(`^${key}=.*$`, 'm'),
        `${key}=${value}`,
      );
    await writeFile('.env', contents, { mode: 0o600, flag: 'wx' });
    console.log('Created .env with launch gates disabled.');
  } catch (error) {
    console.error(
      error.code === 'EEXIST'
        ? '.env already exists; nothing changed.'
        : 'Could not create .env.',
    );
    process.exitCode = 1;
  }
}
