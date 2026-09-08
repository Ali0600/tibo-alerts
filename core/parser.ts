import type { SourcePost, ResetEvent } from './types';
const resetWord = /\breset(?:s|ting)?\b/i;
const contextWord = /\b(codex|usage|limits?|banked|weekly|rate[- ]?limits?)\b/i;
const numberWords: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  twenty: 20,
  thirty: 30,
  sixty: 60,
};
const zoneMap: Record<string, string | number> = {
  PT: 'America/Los_Angeles',
  PST: -480,
  PDT: -420,
  ET: 'America/New_York',
  EST: -300,
  EDT: -240,
  UTC: 0,
  GMT: 0,
  CET: 60,
  CEST: 120,
};
function parts(at: number, zone: string) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  return Object.fromEntries(
    p.filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
}
// Match wall-clock values in the source zone; ambiguous or nonexistent DST times stay unresolved.
export function wallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string | number,
): number | null {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const date = new Date(wall);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  )
    return null;
  if (typeof zone === 'number') return wall - zone * 60000;
  const candidates = new Set<number>();
  for (const delta of [-36, -12, 0, 12, 36]) {
    const probe = wall + delta * 3600000;
    const p = parts(probe, zone);
    const offset =
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - probe;
    const candidate = wall - offset;
    const q = parts(candidate, zone);
    if (
      q.year === year &&
      q.month === month &&
      q.day === day &&
      q.hour === hour &&
      q.minute === minute
    )
      candidates.add(candidate);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}
function resetTiming(
  text: string,
  published: number,
): { scheduledAt: string | null; timingText: string | null } {
  // Never promote an account-upgrade cutoff into the time of a reset.
  const clauses = text.split(/(?:[.!?](?:\s|$)|[;\n]|\b(?:but|while)\b)/i);
  const eligible = clauses.filter(
    (c) =>
      !/\b(upgrade|sign\s?up|subscribe|eligible|eligibility|claim|redeem|expires?|until|by|create.{0,15}account|cutoff|deadline|before)\b/i.test(
        c,
      ),
  );
  const relevant = eligible.filter(
    (c) =>
      resetWord.test(c) ||
      /\b(lands?|roll(?:ing)?\s*out|available|happen|scheduled|instead|actually|correction)\b/i.test(
        c,
      ),
  );
  const value = (relevant.length ? relevant : eligible).join('. ');
  const approximate =
    /\b(about|around|roughly|approximately|within|soon|end of (?:the )?day|morning|afternoon|evening|few|couple|or so|maybe|perhaps|hopefully|or later)\b/i.test(
      value,
    );
  const relative = value.match(
    /\bin\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|sixty|\d{1,3})\s*(minutes?|mins?|hours?|hrs?|h|m)\b(?:\s*(?:and\s*)?(\d{1,2})\s*(minutes?|mins?|m)\b)?/i,
  );
  if (relative && !approximate) {
    const n = numberWords[relative[1].toLowerCase()] ?? Number(relative[1]);
    const extra = Number(relative[3] || 0);
    const ms = n * (/^h/i.test(relative[2]) ? 3600000 : 60000) + extra * 60000;
    if (ms > 0 && ms <= 7 * 86400000)
      return {
        scheduledAt: new Date(published + ms).toISOString(),
        timingText: relative[0],
      };
  }
  const iso = value.match(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})\b/i,
  );
  if (iso && !approximate) {
    const [y, m, d] = iso[0].slice(0, 10).split('-').map(Number);
    const valid =
      m >= 1 &&
      m <= 12 &&
      d >= 1 &&
      d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      scheduledAt:
        valid && Number.isFinite(Date.parse(iso[0]))
          ? new Date(iso[0]).toISOString()
          : null,
      timingText: iso[0],
    };
  }
  const clockPattern =
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(PT|PST|PDT|ET|EST|EDT|UTC|GMT|CET|CEST)\b/gi;
  const clocks = [...value.matchAll(clockPattern)];
  if (clocks.length > 1)
    return { scheduledAt: null, timingText: value.trim().slice(0, 240) };
  const clock = clocks[0];
  if (clock && !approximate) {
    let hour = Number(clock[1]);
    const minute = Number(clock[2] || 0);
    const meridiem = clock[3]?.toLowerCase();
    if ((!meridiem && !clock[2]) || (meridiem && (hour < 1 || hour > 12)))
      return { scheduledAt: null, timingText: clock[0] };
    if (meridiem) hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
    const zone = zoneMap[clock[4].toUpperCase()];
    const p =
      typeof zone === 'number'
        ? parts(published + zone * 60000, 'UTC')
        : parts(published, zone);
    const isoDate = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (isoDate) {
      p.year = Number(isoDate[1]);
      p.month = Number(isoDate[2]);
      p.day = Number(isoDate[3]);
    } else {
      const month = value.match(
        /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i,
      );
      if (month) {
        p.month =
          [
            'jan',
            'feb',
            'mar',
            'apr',
            'may',
            'jun',
            'jul',
            'aug',
            'sep',
            'oct',
            'nov',
            'dec',
          ].indexOf(month[1].slice(0, 3).toLowerCase()) + 1;
        p.day = Number(month[2]);
        if (month[3]) p.year = Number(month[3]);
      } else if (/\btomorrow\b/i.test(value)) {
        const d = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
        p.year = d.getUTCFullYear();
        p.month = d.getUTCMonth() + 1;
        p.day = d.getUTCDate();
      } else if (
        /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)\b/i.test(
          value,
        )
      )
        return { scheduledAt: null, timingText: value.trim().slice(0, 240) };
    }
    const at = wallTimeToUtc(p.year, p.month, p.day, hour, minute, zone);
    if (at !== null)
      return { scheduledAt: new Date(at).toISOString(), timingText: clock[0] };
  }
  return {
    scheduledAt: null,
    timingText:
      /\b(soon|tomorrow|today|around|about|within|end of|morning|afternoon|evening|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i.test(
        value,
      )
        ? value.trim().slice(0, 240)
        : null,
  };
}
export function parseReset(
  post: SourcePost,
  parent?: ResetEvent,
): ResetEvent | null {
  if (post.possiblyTruncated) return null;
  const text = post.text.replaceAll('’', "'");
  const resetClauses = text.match(/[^.!?\n]+[.!?]?/g) || [];
  if (resetClauses.some((c) => resetWord.test(c) && c.trim().endsWith('?')))
    return null;
  const explicitCompletion =
    !!parent &&
    /\b(?:it|this|that) (?:is |has been )?(?:done|completed)|^\s*(?:done|completed)[.!]?\s*$/i.test(
      text,
    ) &&
    !/\b(?:not|never|isn't)\b/i.test(text);
  const correction =
    !!parent &&
    !/\b(another|additional)\b/i.test(text) &&
    (explicitCompletion ||
      /\b(actually|correction|instead|delay|postpon|cancel|scratch|reset)\w*\b/i.test(
        text,
      ));
  if (!correction && (!resetWord.test(text) || !contextWord.test(text)))
    return null;
  const denied =
    /\b(?:won't|will not|not going to|no plans to)\b.{0,30}\breset\b|\breset\b.{0,30}\b(?:will not|won't|not happening)\b/i.test(
      text,
    );
  if (denied && !parent) return null;
  if (
    /\b(?:haven't|hasn't|have not|has not|didn't|did not|never)\b.{0,30}\breset\b|\breset\b.{0,15}\b(?:not done|not complete|isn't done)\b/i.test(
      text,
    )
  )
    return null;
  if (/\b(password|factory reset|reset button)\b/i.test(text) && !correction)
    return null;
  const cancelled =
    correction &&
    (denied || /\b(cancel(?:led|ed)?|scratch that|no reset)\b/i.test(text));
  const assertion = resetClauses.filter((c) => resetWord.test(c)).join(' ');
  const completed =
    !cancelled &&
    (explicitCompletion ||
      (!/\b(not|never|haven't|hasn't|will|tomorrow)\b/i.test(assertion) &&
        /\b((?:just|already|have|has) reset|limits (?:have been|were|are) reset|reset (?:is )?(?:complete|completed|done)|reset.{0,12}now)\b/i.test(
          assertion,
        )));
  const timing =
    cancelled || completed
      ? { scheduledAt: null, timingText: null }
      : resetTiming(text, Date.parse(post.publishedAt));
  return {
    id: correction ? parent!.id : post.id,
    kind: cancelled
      ? 'cancelled'
      : completed
        ? 'completed'
        : /\bbank(?:ed)?\b/i.test(text)
          ? 'grant'
          : 'announced',
    text,
    sourceUrl: post.url,
    publishedAt: post.publishedAt,
    ...timing,
    revision: correction ? parent!.revision + 1 : 1,
  };
}
export function formatLocal(at: string, timezone: string) {
  return new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(at));
}
