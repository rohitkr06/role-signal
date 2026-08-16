CREATE TABLE `automation_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`cadence_hours` integer NOT NULL,
	`min_score` integer NOT NULL,
	`browser_alerts` integer NOT NULL,
	`last_run_at` text,
	`next_run_at` text NOT NULL,
	`last_status` text NOT NULL,
	`last_error` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_automation_settings_due` ON `automation_settings` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `job_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`discovery_run_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_job_alerts_user_job_kind` ON `job_alerts` (`user_id`,`job_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_job_alerts_user_status_created` ON `job_alerts` (`user_id`,`status`,`created_at`);