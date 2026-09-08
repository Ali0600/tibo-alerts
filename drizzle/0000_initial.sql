CREATE TABLE `email_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_attempt_window` ON `email_attempts` (`at`,`kind`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_recent` ON `events` (`updated_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`event_id` text,
	`event_revision` integer,
	`kind` text NOT NULL,
	`payload` text,
	`due_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`state` text NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`attempt_id` text,
	`provider_id` text,
	`last_result` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_event_recipient` ON `jobs` (`subscription_id`,`event_id`,`event_revision`,`kind`);--> statement-breakpoint
CREATE INDEX `job_due` ON `jobs` (`state`,`due_at`);--> statement-breakpoint
CREATE INDEX `job_subscriber` ON `jobs` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `job_provider` ON `jobs` (`provider_id`);--> statement-breakpoint
CREATE INDEX `job_expiry` ON `jobs` (`expires_at`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`body` text NOT NULL,
	`published_at` integer NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `post_retention` ON `posts` (`received_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_expiry` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_retention` ON `scans` (`at`);--> statement-breakpoint
CREATE TABLE `state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`destination_key` text NOT NULL,
	`encrypted_destination` text NOT NULL,
	`timezone` text NOT NULL,
	`preference` text NOT NULL,
	`status` text NOT NULL,
	`manage_hash` text NOT NULL,
	`consent_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_destination` ON `subscriptions` (`channel`,`destination_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_manage` ON `subscriptions` (`manage_hash`);--> statement-breakpoint
CREATE INDEX `subscription_active` ON `subscriptions` (`status`,`channel`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`hash` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `token_expiry` ON `tokens` (`expires_at`);