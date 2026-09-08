import {
  mkdtemp,
  cp,
  symlink,
  readFile,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const original = resolve('.');
const target = await mkdtemp(join(tmpdir(), 'tibo-guards-'));
const mutations = [
  {
    file: 'core/api.ts',
    pattern: /status='active'\)<50 RETURNING/,
    replacement: "status='active')<51 RETURNING",
    test: 'tests/api.test.ts',
    name: 'email confirmation cannot activate a fifty-first subscriber',
  },
  {
    file: 'core/ingest.ts',
    pattern: /const EXPANSION_LIMIT\s*=\s*5000/,
    replacement: 'const EXPANSION_LIMIT = 100000',
    test: 'tests/api.test.ts',
    name: 'excessive notification expansion fails before advancing source coverage',
  },
  {
    file: 'core/service.ts',
    pattern: /r\.env\.SOURCE_VERIFIED\s*===\s*'true'/,
    replacement: 'true',
    test: 'tests/api.test.ts',
    name: 'launch stays closed before source and delivery verification',
  },
  {
    file: 'core/api.ts',
    pattern: /category\s*===\s*'transactional'\s*\?\s*50\s*:\s*200/,
    replacement: "category === 'transactional' ? 50 : 1000",
    test: 'tests/api.test.ts',
    name: 'free email quota stops provider authorization atomically',
  },
  {
    file: 'core/security.ts',
    pattern: /pushHosts\.includes\(url\.hostname\)/,
    replacement: 'true',
    test: 'tests/security.test.ts',
    name: 'push rejects outbound request targets and deceptive hostnames',
  },
  {
    file: 'worker/source-normalize.ts',
    pattern:
      /r\.errors\s*==\s*null\s*\|\|\s*\(Array\.isArray\(r\.errors\)\s*&&\s*r\.errors\.length\s*===\s*0\)/,
    replacement: 'true',
    test: 'tests/source.test.ts',
    name: 'GraphQL errors inside HTTP-success data fail closed',
  },
  {
    file: 'core/parser.ts',
    pattern: /const eligible\s*=\s*clauses\.filter\([\s\S]*?\);/,
    replacement: 'const eligible = clauses;',
    test: 'tests/parser.test.ts',
    name: 'upgrade and redemption deadlines are never reset timestamps',
  },
  {
    file: 'core/service.ts',
    pattern: /SET state='unknown',last_result='send_outcome_unknown'/,
    replacement: "SET state='pending',last_result='send_outcome_unknown'",
    test: 'tests/api.test.ts',
    name: 'one runner owns a job; uncertain sends cannot be reclaimed',
  },
];
try {
  for (const path of [
    'core',
    'worker',
    'runtime',
    'db',
    'drizzle',
    'tests',
    'package.json',
    'tsconfig.json',
  ])
    await cp(join(original, path), join(target, path), { recursive: true });
  await symlink(
    join(original, 'node_modules'),
    join(target, 'node_modules'),
    'dir',
  );
  const run = (file) =>
    spawnSync(
      process.execPath,
      [join(original, 'node_modules/tsx/dist/cli.mjs'), '--test', file],
      {
        cwd: target,
        encoding: 'utf8',
        timeout: 30000,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      },
    );
  for (const item of mutations) {
    const file = join(target, item.file),
      source = await readFile(file, 'utf8');
    if (!item.pattern.test(source))
      throw new Error(`Mutation target missing: ${item.name}`);
    const baseline = run(item.test);
    if (baseline.status !== 0) throw new Error(`Baseline failed: ${item.name}`);
    await writeFile(file, source.replace(item.pattern, item.replacement));
    const broken = run(item.test);
    await writeFile(file, source);
    if (
      broken.status === 0 ||
      !broken.stdout
        .split('\n')
        .some((line) => /^not ok \d+ - /.test(line) && line.endsWith(item.name))
    )
      throw new Error(`Guard mutation escaped its test: ${item.name}`);
    console.log(`Caught disabled guard: ${item.name}`);
  }
} finally {
  await rm(target, { recursive: true, force: true });
}
