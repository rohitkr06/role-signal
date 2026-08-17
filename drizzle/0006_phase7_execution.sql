CREATE TABLE `execution_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`min_score` integer NOT NULL,
	`daily_limit` integer NOT NULL,
	`mode` text NOT NULL,
	`require_tailored_resume` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `companion_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text NOT NULL,
	`last_seen_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_companion_devices_token_hash` ON `companion_devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_companion_devices_user_status` ON `companion_devices` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `application_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`packet_id` text NOT NULL,
	`document_id` text,
	`device_id` text,
	`platform` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`attempt_count` integer NOT NULL,
	`fields_filled` integer NOT NULL,
	`unknown_required_json` text NOT NULL,
	`last_error` text,
	`application_url` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`claimed_at` text,
	`completed_at` text,
	`submitted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_application_executions_user_job` ON `application_executions` (`user_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `idx_application_executions_user_status_updated` ON `application_executions` (`user_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_application_executions_device_status` ON `application_executions` (`device_id`,`status`);
