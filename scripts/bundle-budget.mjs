import { readFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { startProdServer } from 'vinext/server/prod-server';
import { pathToFileURL } from 'node:url';
const limit = 150000;
const dist = resolve('dist');
// Every external JS preload/script plus its static dependencies; inline scripts are
// included conservatively with all HTML so changes to hydration data cannot hide cost.
export async function verifyBundle(html) {
  const manifest = JSON.parse(
    await readFile(join(dist, 'client/.vite/manifest.json'), 'utf8'),
  );
  const byFile = new Map(
    Object.entries(manifest).map(([key, value]) => [value.file, key]),
  );
  const roots = [];
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/^<script/i.test(tag) && !/rel=["']modulepreload["']/.test(tag))
      continue;
    const path = tag.match(/(?:src|href)=["']([^"']+\.js)["']/)?.[1];
    if (path) {
      if (!path.startsWith('/'))
        throw new Error('Unexpected external initial script.');
      roots.push(path.slice(1));
    }
  }
  if (!roots.length) throw new Error('No initial scripts found.');
  const files = new Set();
  function visit(key) {
    const entry = manifest[key];
    if (!entry) throw new Error('Missing manifest dependency.');
    if (files.has(entry.file)) return;
    files.add(entry.file);
    for (const dependency of entry.imports || []) visit(dependency);
  }
  for (const file of roots) {
    const key = byFile.get(file);
    if (!key) throw new Error('Initial script is absent from the manifest.');
    visit(key);
  }
  let external = 0;
  for (const file of files) {
    const path = resolve(dist, 'client', file);
    if (relative(join(dist, 'client'), path).startsWith('..'))
      throw new Error('Invalid manifest path.');
    external += gzipSync(await readFile(path), { level: 9 }).length;
  }
  const htmlBytes = gzipSync(html, { level: 9 }).length;
  const conservative = external + htmlBytes;
  console.log(
    JSON.stringify({
      initialExternalJavaScriptGzipBytes: external,
      entireHtmlGzipBytes: htmlBytes,
      conservativeInitialBudgetBytes: conservative,
      limitBytes: limit,
      files: files.size,
    }),
  );
  if (conservative > limit)
    throw new Error(`Initial payload exceeds ${limit} bytes.`);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { server, port } = await startProdServer({
    port: 0,
    host: '127.0.0.1',
    outDir: dist,
    silent: true,
  });
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    if (!response.ok) throw new Error('Production homepage did not render.');
    await verifyBundle(await response.text());
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
