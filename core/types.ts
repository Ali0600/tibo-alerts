export type Channel = 'email' | 'push';
export type Preference = 'announcement' | 'reminder' | 'both';
export type SqlValue = string | number | null;
export type Statement = { sql: string; args?: SqlValue[] };
export interface Database {
  query<T = Record<string, unknown>>(
    sql: string,
    args?: SqlValue[],
  ): Promise<T[]>;
  batch(statements: Statement[]): Promise<Record<string, unknown>[][]>;
}
export interface Runtime {
  db: Database;
  env: Record<string, string | undefined>;
  now?: () => number;
  trustedIpHeader?: string;
}
export type SourcePost = {
  id: string;
  authorId: string;
  authorHandle: string;
  url: string;
  text: string;
  publishedAt: string;
  replyToId: string | null;
  isQuote?: boolean;
  possiblyTruncated?: boolean;
};
export type ResetEvent = {
  id: string;
  kind: 'announced' | 'completed' | 'grant' | 'cancelled';
  text: string;
  sourceUrl: string;
  publishedAt: string;
  scheduledAt: string | null;
  timingText: string | null;
  revision: number;
};
export type PushDestination = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
export type Destination = {
  email?: string;
  push?: PushDestination;
  manageToken: string;
  unsubscribeToken?: string;
};
export type SubscriptionRow = {
  id: string;
  channel: Channel;
  destination_key: string;
  encrypted_destination: string;
  timezone: string;
  preference: Preference;
  status: string;
  manage_hash: string;
  consent_at: number;
  created_at: number;
  updated_at: number;
};
export type JobRow = {
  id: string;
  subscription_id: string;
  event_id: string | null;
  event_revision: number | null;
  kind: 'announcement' | 'reminder' | 'confirmation' | 'management' | 'test';
  payload: string | null;
  due_at: number;
  expires_at: number;
  state: string;
  lease_token: string | null;
  lease_until: number | null;
  attempts: number;
  attempt_id: string | null;
  provider_id: string | null;
  last_result: string | null;
  created_at: number;
};
export type Delivery = {
  id: string;
  attemptId: string;
  channel: Channel;
  kind: JobRow['kind'];
  destination: Destination;
  subject: string;
  text: string;
  url: string;
  expiresAt: number;
  tag: string;
  unsubscribeUrl?: string;
};
