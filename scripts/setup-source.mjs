import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { CONNECTOR_COMMIT } from './source-check.mjs';
const root = resolve(process.env.RSSHUB_PATH || '.source-reader');
function run(command, args, quiet = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, TWITTER_AUTH_TOKEN: '' },
  });
  if (result.status !== 0) throw new Error('Source dependency setup failed.');
  return result.stdout?.trim();
}
if (process.argv.includes('--help'))
  console.log(
    'Usage: npm run source:setup\nInstalls the exact audited RSSHub revision and frozen dependencies. RSSHUB_PATH defaults to .source-reader. Requires git, npm, Node22.22.2+ or24.15.0+. Does not contact X.',
  );
else {
  try {
    await mkdir(root, { recursive: true });
    if (!existsSync(join(root, '.git'))) {
      if ((await readdir(root)).length)
        throw new Error('Refusing to initialize a nonempty reader directory.');
      run('git', ['init', '--quiet']);
      run('git', [
        'remote',
        'add',
        'origin',
        'https://github.com/DIYgod/RSSHub.git',
      ]);
      run('git', ['fetch', '--quiet', '--depth=1', 'origin', CONNECTOR_COMMIT]);
      run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    }
    const head = run('git', ['rev-parse', 'HEAD'], true);
    if (head !== CONNECTOR_COMMIT)
      throw new Error(
        'Existing reader has another revision; use a separate RSSHUB_PATH.',
      );
    run('git', ['diff', '--quiet', 'HEAD', '--'], true);
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    if (!/^pnpm@10\.34\.5(?:\+sha512\.[a-f0-9]+)?$/.test(pkg.packageManager))
      throw new Error('Reader package manager pin changed.');
    run('npm', [
      'exec',
      '--yes',
      '--package=pnpm@10.34.5',
      '--',
      'pnpm',
      'install',
      '--frozen-lockfile',
      '--ignore-scripts',
    ]);
    await writeFile(
      join(root, '.tibo-reader-revision'),
      CONNECTOR_COMMIT + '\n',
      { mode: 0o600 },
    );
    console.log(
      'Pinned source reader installed. Authentication remains unverified.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
