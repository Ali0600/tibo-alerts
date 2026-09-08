import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { collectSource, CONNECTOR_COMMIT } from './source-check.mjs';
const args = process.argv.slice(2);
if (args.includes('--help'))
  console.log(
    'Usage: npm run verify:source -- --fixture=/private/expected-posts.json\nManually check genuine X posts and enter authorId plus at least one recent post and one reply, with id/text/publishedAt/replyToId. This diagnostic matches exact authorship, text and timestamps, and compares consecutive primary timeline windows. See docs/OPERATIONS.md. Does not enable alerts.',
  );
else
  try {
    if (args.length !== 1 || !args[0].startsWith('--fixture='))
      throw new Error('A manually checked fixture is required; see --help.');
    const raw = await readFile(args[0].slice(10));
    if (raw.length > 100000) throw new Error('Fixture is too large.');
    const expected = JSON.parse(raw);
    if (
      !/^\d{1,25}$/.test(expected.authorId || '') ||
      !Array.isArray(expected.posts) ||
      expected.posts.length < 2 ||
      !expected.posts.some((p) => p.replyToId)
    )
      throw new Error(
        'Fixture needs the source identity, a genuine post and a genuine reply.',
      );
    const batch = await collectSource({
      ...process.env,
      EXPECTED_SOURCE_ID: expected.authorId,
    });
    for (const want of expected.posts) {
      const got = batch.posts.find((p) => p.id === want.id);
      if (
        !got ||
        got.authorId !== expected.authorId ||
        got.text !== want.text ||
        got.publishedAt !== new Date(want.publishedAt).toISOString() ||
        got.replyToId !== want.replyToId
      )
        throw new Error('Live source did not match manually checked evidence.');
    }
    if (!batch.coverageUnits?.length)
      throw new Error('Primary timeline coverage missing.');
    const sorted = [...batch.coverageUnits].sort((a, b) =>
      BigInt(a.sortIndex) > BigInt(b.sortIndex) ? -1 : 1,
    );
    const head = JSON.stringify(sorted[0]);
    const second = await collectSource({
      ...process.env,
      EXPECTED_SOURCE_ID: expected.authorId,
    });
    if (!second.coverageUnits?.some((u) => JSON.stringify(u) === head))
      throw new Error(
        'Consecutive reads did not preserve the primary timeline checkpoint.',
      );
    await mkdir('.artifacts', { recursive: true });
    await writeFile(
      '.artifacts/source-proof.json',
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          authorId: expected.authorId,
          connectorCommit: CONNECTOR_COMMIT,
          matchedIds: expected.posts.map((p) => p.id),
          consecutiveWindowOverlap: true,
          liveNewPostObserved: false,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      'Matched genuine posts, authorship, full text, timestamps and replies; a second read preserved the primary-window checkpoint. Proof saved to .artifacts/source-proof.json. Observe a newly published post reaching the site before marking SOURCE_VERIFIED=true; this command does not prove ongoing completeness.',
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
