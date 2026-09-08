const origin = process.argv[2];
if (!origin) throw new Error('Pass the test origin.');
for (const path of [
  '/',
  '/api/health',
  '/api/public',
  '/manage',
  '/confirm',
  '/sw.js',
  '/manifest.webmanifest',
]) {
  const response = await fetch(origin + path, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(`Smoke failed: ${path} (${response.status})`);
  if (path === '/api/health') {
    const value = await response.json();
    if (value.service !== 'tibo-alerts' || value.database !== true)
      throw new Error('Wrong app or broken database.');
  } else if (path === '/api/public') {
    const value = await response.json();
    if (value.capabilities.email || value.capabilities.push)
      throw new Error('Unconfigured deployment enabled notifications.');
  }
}
console.log(
  'Production pages, database, service worker and closed launch gates verified.',
);
