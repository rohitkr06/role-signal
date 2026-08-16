CREATE TABLE `answer_vault` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`field_key` text NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`status` text NOT NULL,
	`sensitive` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_answer_vault_user_field` ON `answer_vault` (`user_id`,`field_key`);--> statement-breakpoint
CREATE TABLE `application_kits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`packet_id` text NOT NULL,
	`summary` text NOT NULL,
	`why_answer` text NOT NULL,
	`resume_changes_json` text NOT NULL,
	`evidence_json` text NOT NULL,
	`form_answers_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_application_kits_user_job` ON `application_kits` (`user_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `idx_application_kits_packet` ON `application_kits` (`packet_id`);--> statement-breakpoint
CREATE TABLE `search_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`source_count` integer NOT NULL,
	`jobs_discovered` integer NOT NULL,
	`unique_jobs` integer NOT NULL,
	`analyzed` integer NOT NULL,
	`exceptional` integer NOT NULL,
	`strong` integer NOT NULL,
	`ready` integer NOT NULL,
	`needs_input` integer NOT NULL,
	`skipped` integer NOT NULL,
	`report_json` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_search_runs_user_completed` ON `search_runs` (`user_id`,`completed_at`);