CREATE TABLE `alert_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`message_key` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`jobs_found` integer NOT NULL,
	`imported` integer NOT NULL,
	`duplicates` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_alert_imports_user_message` ON `alert_imports` (`user_id`,`message_key`);--> statement-breakpoint
CREATE INDEX `idx_alert_imports_user_created` ON `alert_imports` (`user_id`,`created_at`);
