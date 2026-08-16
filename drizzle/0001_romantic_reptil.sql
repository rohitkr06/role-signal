CREATE TABLE `application_events` (
	`id` text PRIMARY KEY NOT NULL,
	`packet_id` text NOT NULL,
	`user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`detail_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_application_events_packet` ON `application_events` (`packet_id`);--> statement-breakpoint
CREATE TABLE `application_packets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`status` text NOT NULL,
	`answers_json` text NOT NULL,
	`blockers_json` text NOT NULL,
	`resume_strategy_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_application_packets_user_job` ON `application_packets` (`user_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `idx_application_packets_user_status` ON `application_packets` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `career_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`resume_id` text,
	`raw_text` text NOT NULL,
	`extracted_json` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_id` text,
	`fingerprint` text NOT NULL,
	`company` text NOT NULL,
	`role` text NOT NULL,
	`location` text NOT NULL,
	`work_mode` text NOT NULL,
	`platform` text NOT NULL,
	`application_url` text NOT NULL,
	`posted_date` text,
	`description` text NOT NULL,
	`compensation` text,
	`match_score` integer NOT NULL,
	`classification` text NOT NULL,
	`status` text NOT NULL,
	`score_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_job_matches_user_fingerprint` ON `job_matches` (`user_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `idx_job_matches_user_score` ON `job_matches` (`user_id`,`match_score`);--> statement-breakpoint
CREATE INDEX `idx_job_matches_user_status` ON `job_matches` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `job_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`source_token` text NOT NULL,
	`label` text NOT NULL,
	`active` integer NOT NULL,
	`last_scanned_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_job_sources_user_provider_token` ON `job_sources` (`user_id`,`provider`,`source_token`);