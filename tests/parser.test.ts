import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReset, wallTimeToUtc, formatLocal } from '../core/parser';
import type { SourcePost } from '../core/types';
const post = (
  text: string,
  publishedAt = '2026-09-08T12:00:00Z',
): SourcePost => ({
  id: '100',
  authorId: '123',
  authorHandle: 'thsottiaux',
  url: 'https://x.com/thsottiaux/status/100',
  text,
  publishedAt,
  replyToId: null,
});
await test('relative time uses publication timestamp, not detection time', () => {
  assert.equal(
    parseReset(post('We will reset Codex limits in three hours.'))?.scheduledAt,
    '2026-09-08T15:00:00.000Z',
  );
});
await test('scheduled limits reset is future, not completed', () => {
  const event = parseReset(post('Codex limits reset tomorrow at 10am PT.'));
  assert.equal(event?.kind, 'announced');
  assert.equal(event?.scheduledAt, '2026-09-09T17:00:00.000Z');
});
await test('a negative completion claim does not become a completed reset', () => {
  assert.notEqual(
    parseReset(post('Codex reset is not done yet.'))?.kind,
    'completed',
  );
});
await test('upgrade and redemption deadlines are never reset timestamps', () => {
  for (const text of [
    'Banked Codex reset lands end of day. Upgrade before 8pm PT.',
    'Claim your banked Codex reset by 10am PT.',
    'Your banked Codex reset is available until 10am PT.',
    'Codex reset eligibility ends at 10am PT.',
  ])
    assert.equal(parseReset(post(text))?.scheduledAt, null, text);
});
await test('compound relative durations are not partially parsed', () => {
  assert.equal(
    parseReset(post('We will reset Codex limits in 2 hours 30 minutes.'))
      ?.scheduledAt,
    '2026-09-08T14:30:00.000Z',
  );
});
await test('invalid calendar date and ambiguous clock stay unresolved', () => {
  for (const text of [
    'Codex reset at 2026-02-30T14:00Z.',
    'Codex reset at 3 PT.',
    'Codex reset at 10am PT or 11am PT.',
  ])
    assert.equal(parseReset(post(text))?.scheduledAt, null, text);
});
await test('approximate announcements retain wording without exact reminders', () => {
  const event = parseReset(
    post('Banked Codex resets arrive in about three hours.'),
  );
  assert.equal(event?.scheduledAt, null);
  assert.match(event?.timingText || '', /about three hours/);
});
await test('past completion recognized and unrelated resets rejected', () => {
  assert.equal(
    parseReset(post('We have reset Codex limits.'))?.kind,
    'completed',
  );
  assert.equal(parseReset(post('How do I reset my password?')), null);
  assert.equal(parseReset(post('Will Codex limits reset today?')), null);
});
await test('cancelled reply supersedes existing schedule', () => {
  const parent = parseReset(post('Codex reset tomorrow at 10am PT.'))!;
  const child = parseReset(
    {
      ...post("We won't reset Codex limits tomorrow."),
      id: '101',
      replyToId: '100',
    },
    parent,
  );
  assert.equal(child?.kind, 'cancelled');
  assert.equal(child?.scheduledAt, null);
  assert.equal(child?.id, '100');
  assert.equal(child?.revision, 2);
});
await test('negative future claim never schedules a reset', () => {
  assert.equal(
    parseReset(post('Codex reset will not happen tomorrow at 10am PT.')),
    null,
  );
});
await test('explicit PT observes daylight saving; duplicate or missing wall time is unresolved', () => {
  assert.equal(
    new Date(
      wallTimeToUtc(2026, 1, 8, 10, 0, 'America/Los_Angeles')!,
    ).toISOString(),
    '2026-01-08T18:00:00.000Z',
  );
  assert.equal(
    new Date(
      wallTimeToUtc(2026, 9, 8, 10, 0, 'America/Los_Angeles')!,
    ).toISOString(),
    '2026-09-08T17:00:00.000Z',
  );
  assert.equal(wallTimeToUtc(2026, 3, 8, 2, 30, 'America/Los_Angeles'), null);
  assert.equal(wallTimeToUtc(2026, 11, 1, 1, 30, 'America/Los_Angeles'), null);
});
await test('local formatting includes recipient calendar date and timezone', () => {
  assert.match(
    formatLocal('2026-09-08T23:30:00Z', 'Europe/Berlin'),
    /Sep 9, 2026/,
  );
  assert.match(
    formatLocal('2026-09-08T23:30:00Z', 'America/Los_Angeles'),
    /Sep 8, 2026/,
  );
});
await test('negated resets and questions cannot become announcements', () => {
  for (const text of [
    "We haven't reset Codex limits yet.",
    'We have reached 9M users. Should we reset Codex usage again?',
  ])
    assert.equal(parseReset(post(text)), null, text);
});
await test('unrelated replies preserve schedules and explicit completion supersedes them', () => {
  const parent = parseReset(post('Codex reset tomorrow at 10am PT.'))!;
  assert.equal(
    parseReset(
      {
        ...post('Thanks, looking into this now.'),
        id: '101',
        replyToId: '100',
      },
      parent,
    ),
    null,
  );
  assert.equal(
    parseReset(
      { ...post('Hi. It is done.'), id: '102', replyToId: '100' },
      parent,
    )?.kind,
    'completed',
  );
  assert.equal(
    parseReset({ ...post('Confirmed.'), id: '103', replyToId: '100' }, parent),
    null,
  );
});
await test('trailing uncertainty never produces an exact reminder', () => {
  assert.equal(
    parseReset(post('Codex reset in two hours or so.'))?.scheduledAt,
    null,
  );
});
await test('unrelated future sentences do not override a completed reset', () => {
  assert.equal(
    parseReset(
      post('We have reset Codex limits. We will continue monitoring tomorrow.'),
    )?.kind,
    'completed',
  );
});
await test('an additional reset is its own event', () => {
  const parent = parseReset(post('Codex reset tomorrow at 10am PT.'))!;
  assert.equal(
    parseReset(
      {
        ...post('Another Codex reset tomorrow at 10am PT.'),
        id: '101',
        replyToId: '100',
      },
      parent,
    )?.id,
    '101',
  );
});
