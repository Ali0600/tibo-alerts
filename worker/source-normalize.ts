import type { SourcePost } from '../core/types';
export class SourceFailure extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export function requireSource(value: unknown, code: string): asserts value {
  if (!value) throw new SourceFailure(code);
}
export function normalizeLegacy(
  tweets: unknown[],
  authorId: string,
  fetchedAt: number,
): SourcePost[] {
  const seen = new Map<string, SourcePost>();
  for (const value of tweets) {
    requireSource(value && typeof value === 'object', 'INVALID_POST');
    const p = value as Record<string, unknown>;
    if (p.retweeted_status) continue;
    requireSource(p.user_id_str === authorId, 'AUTHOR_MISMATCH');
    requireSource(
      typeof p.id_str === 'string' && /^\d{1,25}$/.test(p.id_str),
      'INVALID_POST_ID',
    );
    const text = p.full_text ?? p.text;
    const published = Date.parse(String(p.created_at));
    requireSource(
      typeof text === 'string' &&
        text.trim().length > 0 &&
        text.length <= 30000 &&
        p.truncated !== true,
      'INVALID_POST_TEXT',
    );
    requireSource(
      Number.isFinite(published) &&
        published <= fetchedAt + 60000 &&
        published >= Date.UTC(2006, 0, 1),
      'INVALID_POST_TIME',
    );
    const normalized: SourcePost = {
      id: p.id_str,
      authorId,
      authorHandle: 'thsottiaux',
      url: `https://x.com/thsottiaux/status/${p.id_str}`,
      publishedAt: new Date(published).toISOString(),
      text,
      replyToId:
        typeof p.in_reply_to_status_id_str === 'string' &&
        /^\d{1,25}$/.test(p.in_reply_to_status_id_str)
          ? p.in_reply_to_status_id_str
          : null,
      isQuote: p.is_quote_status === true,
      possiblyTruncated: false,
    };
    const old = seen.get(p.id_str);
    requireSource(
      !old || JSON.stringify(old) === JSON.stringify(normalized),
      'CONFLICTING_DUPLICATE',
    );
    seen.set(p.id_str, normalized);
  }
  requireSource(seen.size > 0, 'EMPTY_SOURCE_WINDOW');
  return [...seen.values()].sort((a, b) =>
    BigInt(a.id) < BigInt(b.id) ? -1 : 1,
  );
}
export function validateGraphql(response: unknown) {
  requireSource(response && typeof response === 'object', 'INVALID_RESPONSE');
  const r = response as Record<string, unknown>;
  requireSource(
    r.errors == null || (Array.isArray(r.errors) && r.errors.length === 0),
    'UPSTREAM_GRAPHQL_ERROR',
  );
  requireSource(r.data && typeof r.data === 'object', 'MISSING_DATA');
  return r.data as Record<string, unknown>;
}
type Legacy = Record<string, unknown>;
type Tweet = {
  __typename?: string;
  tweet?: Tweet;
  rest_id?: string;
  legacy?: Legacy;
  core?: { user_results?: { result?: { rest_id?: string } } };
  note_tweet?: {
    note_tweet_results?: {
      result?: { text?: unknown; entity_set?: Record<string, unknown> };
    };
  };
};
type Content = {
  items?: Entry[];
  content?: { tweetResult?: { result?: Tweet } };
  itemContent?: { tweet_results?: { result?: Tweet } };
};
type Entry = { entryId?: string; content?: Content; item?: Content };
export function guardedGather(
  raw: unknown,
  authorId: string,
  gather: (items: unknown[], prefixes: string[], author: string) => Legacy[],
) {
  requireSource(raw && typeof raw === 'object', 'INVALID_UNIT');
  const unit = raw as Entry;
  const notes = new WeakMap<object, string>();
  let completeStructure = true;
  const conversation =
    typeof unit.entryId === 'string' &&
    unit.entryId.startsWith('profile-conversation-');
  if (conversation)
    requireSource(Array.isArray(unit.content?.items), 'INVALID_CONVERSATION');
  for (const item of conversation ? unit.content!.items! : [unit]) {
    requireSource(item && typeof item === 'object', 'INVALID_ITEM');
    if (conversation)
      requireSource(
        typeof item.entryId === 'string' && item.entryId.length > 0,
        'INVALID_CONVERSATION_ITEM',
      );
    const content = item.content || item.item;
    let tweet =
      content?.content?.tweetResult?.result ||
      content?.itemContent?.tweet_results?.result;
    if (!tweet) {
      completeStructure = false;
      continue;
    }
    function preview(value: Tweet | undefined) {
      if (value?.__typename !== 'TweetPreviewDisplay') return false;
      const owner = value.tweet?.core?.user_results?.result?.rest_id;
      requireSource(
        /^\d{1,25}$/.test(owner ?? ''),
        'UNVERIFIED_PREVIEW_AUTHOR',
      );
      requireSource(owner !== authorId, 'INCOMPLETE_SOURCE_PREVIEW');
      return true;
    }
    if (preview(tweet)) continue;
    if (tweet.tweet) tweet = tweet.tweet;
    if (preview(tweet)) continue;
    const legacy = tweet?.legacy;
    if (!legacy || typeof legacy !== 'object') {
      completeStructure = false;
      continue;
    }
    requireSource(
      typeof legacy.user_id_str === 'string' &&
        /^\d{1,25}$/.test(legacy.user_id_str),
      'UNVERIFIED_POST_AUTHOR',
    );
    if (legacy.user_id_str !== authorId) continue;
    requireSource(/^\d{1,25}$/.test(tweet.rest_id ?? ''), 'INVALID_POST_ID');
    const owner = tweet.core?.user_results?.result?.rest_id;
    requireSource(owner == null || owner === authorId, 'AUTHOR_MISMATCH');
    if (legacy.retweeted_status_result) continue;
    if (tweet.note_tweet != null) {
      const note = tweet.note_tweet?.note_tweet_results?.result;
      requireSource(
        note &&
          typeof note.text === 'string' &&
          note.text.trim().length > 0 &&
          note.text.length <= 30000 &&
          note.entity_set &&
          ['hashtags', 'symbols', 'urls', 'user_mentions'].every((k) =>
            Array.isArray(note.entity_set?.[k]),
          ),
        'INCOMPLETE_NOTE',
      );
      notes.set(legacy, note!.text as string);
    } else requireSource(legacy.truncated !== true, 'INCOMPLETE_POST_TEXT');
  }
  const legacy = gather([unit], ['profile-conversation-'], authorId).map(
    (post) => {
      const text = notes.get(post);
      if (text === undefined) return post;
      requireSource(post.full_text === text, 'NOTE_RECOVERY_FAILED');
      return { ...post, truncated: false };
    },
  );
  return { legacy, completeStructure };
}
