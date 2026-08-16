CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_applications_user_status` ON `applications` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`role` text NOT NULL,
	`location` text NOT NULL,
	`work_mode` text NOT NULL,
	`platform` text NOT NULL,
	`application_url` text NOT NULL,
	`match_score` integer NOT NULL,
	`classification` text NOT NULL,
	`payload_json` text NOT NULL,
	`discovered_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_match_score` ON `jobs` (`match_score`);--> statement-breakpoint
CREATE TABLE `preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`target_roles_json` text NOT NULL,
	`locations_json` text NOT NULL,
	`work_modes_json` text NOT NULL,
	`match_threshold` integer NOT NULL,
	`daily_limit` integer NOT NULL,
	`auto_apply` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resumes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_resumes_user_id` ON `resumes` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text,
	`display_name` text,
	`created_at` text NOT NULL
);
