import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    channel: text('channel').notNull(),
    destinationKey: text('destination_key').notNull(),
    encryptedDestination: text('encrypted_destination').notNull(),
    timezone: text('timezone').notNull(),
    preference: text('preference').notNull(),
    status: text('status').notNull(),
    manageHash: text('manage_hash').notNull(),
    consentAt: integer('consent_at').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('subscription_destination').on(t.channel, t.destinationKey),
    uniqueIndex('subscription_manage').on(t.manageHash),
    index('subscription_active').on(t.status, t.channel),
  ],
);
export const tokens = sqliteTable(
  'tokens',
  {
    hash: text('hash').primaryKey(),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('token_expiry').on(t.expiresAt)],
);
export const posts = sqliteTable(
  'posts',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id'),
    body: text('body').notNull(),
    publishedAt: integer('published_at').notNull(),
    receivedAt: integer('received_at').notNull(),
  },
  (t) => [index('post_retention').on(t.receivedAt)],
);
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    body: text('body').notNull(),
    revision: integer('revision').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('event_recent').on(t.updatedAt)],
);
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    eventId: text('event_id'),
    eventRevision: integer('event_revision'),
    kind: text('kind').notNull(),
    payload: text('payload'),
    dueAt: integer('due_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    state: text('state').notNull(),
    leaseToken: text('lease_token'),
    leaseUntil: integer('lease_until'),
    attempts: integer('attempts').notNull().default(0),
    attemptId: text('attempt_id'),
    providerId: text('provider_id'),
    lastResult: text('last_result'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('job_event_recipient').on(
      t.subscriptionId,
      t.eventId,
      t.eventRevision,
      t.kind,
    ),
    index('job_due').on(t.state, t.dueAt),
    index('job_event_state').on(t.eventId, t.state),
    index('job_subscriber').on(t.subscriptionId),
    index('job_provider').on(t.providerId),
    index('job_expiry').on(t.expiresAt),
  ],
);
export const emailAttempts = sqliteTable(
  'email_attempts',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    at: integer('at').notNull(),
  },
  (t) => [index('email_attempt_window').on(t.at, t.kind)],
);
export const rateLimits = sqliteTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('rate_expiry').on(t.expiresAt)],
);
export const state = sqliteTable('state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
export const scans = sqliteTable(
  'scans',
  { id: text('id').primaryKey(), at: integer('at').notNull() },
  (t) => [index('scan_retention').on(t.at)],
);
