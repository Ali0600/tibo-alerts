// Runs only inside the isolated, SHA-pinned RSSHub checkout. Never expose its raw logs.
import { writeFileSync } from 'node:fs';
import {
  normalizeLegacy,
  guardedGather,
  requireSource,
  SourceFailure,
  validateGraphql,
} from './_tibo_source_normalize.ts';
const SHA = '865f1cf5af3973dffaa2cb8c2d73ee0538043c12';
async function collect() {
  const token = process.env.TWITTER_AUTH_TOKEN;
  requireSource(
    token && token.length <= 512 && !/[\s,;]/.test(token),
    'AUTH_CONFIGURATION',
  );
  const { config, setConfig } = await import('./lib/config.ts');
  setConfig({
    IS_PACKAGE: 'true',
    NO_LOGFILES: 'true',
    LOGGER_LEVEL: 'error',
    DEBUG_INFO: 'false',
    CACHE_TYPE: 'memory',
    REQUEST_RETRY: '0',
    TWITTER_AUTH_TOKEN: token,
    TWITTER_THIRD_PARTY_API: '',
    TWITTER_CONSUMER_KEY: '',
    TWITTER_CONSUMER_SECRET: '',
  });
  const { default: logger } = await import('./lib/utils/logger.ts');
  logger.silent = true;
  const constants =
    await import('./lib/routes/twitter/api/web-api/constants.ts');
  const { twitterGot, gatherLegacyFromData } =
    await import('./lib/routes/twitter/api/web-api/utils.ts');
  if (process.env.TIBO_IMPORT_ONLY === 'true') return { importReady: true };
  await constants.initGqlMap();
  function session() {
    requireSource(
      config.twitter.authToken?.length === 1 &&
        config.twitter.authToken[0] === token,
      'AUTH_LOST',
    );
  }
  async function gql(operation, variables) {
    session();
    requireSource(
      constants.gqlMap[operation] && constants.gqlFeatures[operation],
      'UPSTREAM_OPERATION_CHANGED',
    );
    let response;
    try {
      response = await twitterGot(
        constants.baseUrl + constants.gqlMap[operation],
        {
          variables: JSON.stringify(variables),
          features: JSON.stringify(constants.gqlFeatures[operation]),
        },
        { allowNoAuth: false },
      );
    } catch {
      throw new SourceFailure('UPSTREAM_REQUEST_FAILED');
    }
    session();
    return validateGraphql(response);
  }
  const lookup = await gql('UserByScreenName', {
    screen_name: 'thsottiaux',
    withSafetyModeUserFields: true,
  });
  const user = lookup.user?.result;
  requireSource(
    /^\d{1,25}$/.test(user?.rest_id ?? '') &&
      user?.core?.screen_name?.toLowerCase() === 'thsottiaux',
    'SOURCE_IDENTITY_MISMATCH',
  );
  const authorId = user.rest_id;
  if (process.env.EXPECTED_SOURCE_ID)
    requireSource(
      authorId === process.env.EXPECTED_SOURCE_ID,
      'SOURCE_IDENTITY_CHANGED',
    );
  const data = await gql('UserTweetsAndReplies', {
    userId: authorId,
    count: 20,
    includePromotedContent: false,
    withCommunity: true,
    withVoice: true,
    withV2Timeline: true,
  });
  const result = data.user?.result;
  requireSource(
    !result?.rest_id || result.rest_id === authorId,
    'SOURCE_IDENTITY_MISMATCH',
  );
  const timeline =
    result?.timeline?.timeline ??
    result?.timeline?.timeline_v2 ??
    result?.timeline_v2?.timeline;
  requireSource(Array.isArray(timeline?.instructions), 'MISSING_TIMELINE');
  const entries = [];
  for (const instruction of timeline.instructions) {
    if (instruction.type === 'TimelineAddEntries') {
      requireSource(Array.isArray(instruction.entries), 'INVALID_ENTRIES');
      entries.push(...instruction.entries);
    } else if (instruction.type === 'TimelineAddToModule')
      throw new SourceFailure('UNSUPPORTED_MODULE_COVERAGE');
  }
  requireSource(entries.length > 0 && entries.length <= 512, 'INVALID_WINDOW');
  const bottom = entries.find((e) => e.content?.cursorType === 'Bottom')
    ?.content?.value;
  const all = [];
  const coverageUnits = [];
  for (const entry of entries) {
    if (entry.content?.cursorType) continue;
    requireSource(
      /^(?:tweet|profile-conversation)-\d{1,25}$/.test(entry.entryId ?? '') &&
        /^\d{1,40}$/.test(entry.sortIndex ?? ''),
      'UNSUPPORTED_TIMELINE_SHAPE',
    );
    const { legacy, completeStructure } = guardedGather(
      entry,
      authorId,
      gatherLegacyFromData,
    );
    requireSource(completeStructure, 'INCOMPLETE_TIMELINE_COVERAGE');
    all.push(...legacy);
    const ids = legacy.filter((p) => !p.retweeted_status).map((p) => p.id_str);
    if (ids.length)
      coverageUnits.push({
        entryId: entry.entryId,
        sortIndex: entry.sortIndex,
        sourcePostIds: [...new Set(ids)].sort((a, b) =>
          BigInt(a) < BigInt(b) ? -1 : 1,
        ),
      });
  }
  requireSource(coverageUnits.length > 0, 'EMPTY_SOURCE_COVERAGE');
  const posts = normalizeLegacy(all, authorId, Date.now());
  return {
    scanId: crypto.randomUUID(),
    connectorCommit: SHA,
    fetchedAt: new Date().toISOString(),
    source: { authorId, handle: 'thsottiaux' },
    observedIds: posts.map((p) => p.id),
    coverageUnits,
    posts,
    bottomCursor: typeof bottom === 'string' ? bottom : null,
  };
}
try {
  const result = await collect();
  writeFileSync(process.env.TIBO_SCAN_OUTPUT, JSON.stringify(result), {
    mode: 0o600,
  });
} catch (error) {
  writeFileSync(
    process.env.TIBO_SCAN_OUTPUT,
    JSON.stringify({
      error: error instanceof SourceFailure ? error.code : 'SOURCE_FAILED',
    }),
    { mode: 0o600 },
  );
  process.exitCode = 1;
}
