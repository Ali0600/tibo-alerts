import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLegacy,
  validateGraphql,
  guardedGather,
} from '../worker/source-normalize';
import { validateCoverage, unitKey } from '../core/coverage';
const now = Date.parse('2026-09-08T12:00:00Z');
const legacy = () => ({
  id_str: '101',
  user_id_str: '123',
  full_text: 'We will reset Codex limits in two hours.',
  created_at: '2026-09-08T12:00:00Z',
  truncated: false,
});
await test('GraphQL errors inside HTTP-success data fail closed', () => {
  assert.throws(
    () =>
      validateGraphql({
        data: { user: {} },
        errors: [{ message: 'Unauthorized' }],
      }),
    /GRAPHQL/,
  );
  assert.throws(() => validateGraphql({}), /MISSING_DATA/);
});
await test('source normalization deduplicates identical posts and rejects conflicting copies', () => {
  assert.equal(normalizeLegacy([legacy(), legacy()], '123', now).length, 1);
  assert.throws(
    () =>
      normalizeLegacy(
        [legacy(), { ...legacy(), full_text: 'Changed time.' }],
        '123',
        now,
      ),
    /CONFLICTING_DUPLICATE/,
  );
});
await test('authorship, publication time, and full text are required', () => {
  for (const change of [
    { user_id_str: '999' },
    { truncated: true },
    { created_at: 'bad' },
    { full_text: '' },
  ])
    assert.throws(() =>
      normalizeLegacy([{ ...legacy(), ...change }], '123', now),
    );
});
await test('quote content never replaces the source author’s words', () => {
  const p = normalizeLegacy(
    [
      {
        ...legacy(),
        full_text: 'Interesting.',
        is_quote_status: true,
        quoted_status: { ...legacy(), full_text: 'Codex reset now.' },
      },
    ],
    '123',
    now,
  )[0];
  assert.equal(p.text, 'Interesting.');
  assert.equal(p.isQuote, true);
});
await test('reposts are excluded', () => {
  assert.throws(
    () => normalizeLegacy([{ ...legacy(), retweeted_status: {} }], '123', now),
    /EMPTY_SOURCE_WINDOW/,
  );
});
await test('raw subscriber-only previews fail before gathering', () => {
  const unit = {
    entryId: 'tweet-101',
    content: {
      itemContent: {
        tweet_results: {
          result: {
            __typename: 'TweetPreviewDisplay',
            tweet: { core: { user_results: { result: { rest_id: '123' } } } },
          },
        },
      },
    },
  };
  assert.throws(
    () =>
      guardedGather(unit, '123', () => {
        throw new Error('must not gather');
      }),
    /INCOMPLETE_SOURCE_PREVIEW/,
  );
});
await test('raw quote preview cannot invalidate complete source text', () => {
  const p = legacy();
  const tweet = {
    rest_id: '101',
    legacy: p,
    quoted_status_result: { result: { __typename: 'TweetPreviewDisplay' } },
  };
  const result = guardedGather(
    {
      entryId: 'tweet-101',
      content: { itemContent: { tweet_results: { result: tweet } } },
    },
    '123',
    () => [p],
  );
  assert.equal(result.completeStructure, true);
});
await test('full notes recover only the exact truncated legacy instance', () => {
  const p = { ...legacy(), truncated: true };
  const note = {
    text: 'Full note text.',
    entity_set: { hashtags: [], symbols: [], urls: [], user_mentions: [] },
  };
  const unit = {
    entryId: 'tweet-101',
    content: {
      itemContent: {
        tweet_results: {
          result: {
            rest_id: '101',
            legacy: p,
            note_tweet: { note_tweet_results: { result: note } },
          },
        },
      },
    },
  };
  const result = guardedGather(unit, '123', () => {
    p.full_text = note.text;
    return [p];
  });
  assert.equal(result.legacy[0].truncated, false);
  assert.equal(result.legacy[0].full_text, note.text);
});
await test('nested roots and changed conversation ranks cannot satisfy primary coverage', () => {
  const ids = new Set(['101', '200']);
  const [head] = validateCoverage(
    [{ entryId: 'tweet-101', sortIndex: '101', sourcePostIds: ['101'] }],
    ids,
  );
  for (const candidate of [
    {
      entryId: 'profile-conversation-101',
      sortIndex: '200',
      sourcePostIds: ['101', '200'],
    },
    { entryId: 'tweet-101', sortIndex: '200', sourcePostIds: ['101'] },
  ])
    assert.notEqual(
      unitKey(head),
      unitKey(validateCoverage([candidate], ids)[0]),
    );
  assert.throws(() => validateCoverage([], ids));
});
await test('missing conversation child identity fails before any posts are dropped', () => {
  const tweet = { rest_id: '101', legacy: legacy() };
  const unit = {
    entryId: 'profile-conversation-100',
    content: {
      items: [
        { item: { itemContent: { tweet_results: { result: tweet } } } },
        {
          entryId: 'tweet-102',
          item: {
            itemContent: {
              tweet_results: {
                result: {
                  rest_id: '102',
                  legacy: { ...legacy(), id_str: '102' },
                },
              },
            },
          },
        },
      ],
    },
  };
  assert.throws(
    () =>
      guardedGather(unit, '123', () => {
        throw new Error('must not gather');
      }),
    /INVALID_CONVERSATION_ITEM/,
  );
});
