ALTER TABLE `resumes` ADD COLUMN `version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `resumes` ADD COLUMN `profile_version_id` text;
--> statement-breakpoint
ALTER TABLE `career_profiles` ADD COLUMN `active_profile_version_id` text;
--> statement-breakpoint
CREATE TABLE `career_profile_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`resume_id` text,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`raw_text` text NOT NULL,
	`extracted_json` text NOT NULL,
	`created_at` text NOT NULL,
	`activated_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_profile_versions_user_version` ON `career_profile_versions` (`user_id`,`version`);
--> statement-breakpoint
CREATE INDEX `idx_profile_versions_user_status` ON `career_profile_versions` (`user_id`,`status`);
--> statement-breakpoint
ALTER TABLE `job_matches` ADD COLUMN `profile_version_id` text;
--> statement-breakpoint
ALTER TABLE `job_matches` ADD COLUMN `resume_id` text;
--> statement-breakpoint
ALTER TABLE `application_packets` ADD COLUMN `profile_version_id` text;
--> statement-breakpoint
ALTER TABLE `application_packets` ADD COLUMN `resume_id` text;
--> statement-breakpoint
ALTER TABLE `application_kits` ADD COLUMN `profile_version_id` text;
--> statement-breakpoint
ALTER TABLE `application_kits` ADD COLUMN `resume_id` text;
--> statement-breakpoint
ALTER TABLE `tailored_documents` ADD COLUMN `profile_version_id` text;
--> statement-breakpoint
ALTER TABLE `application_executions` ADD COLUMN `profile_version_id` text;
--> statement-breakpoint
ALTER TABLE `application_executions` ADD COLUMN `resume_id` text;
--> statement-breakpoint
CREATE TABLE `source_health` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`response_count` integer NOT NULL,
	`accepted_count` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`last_error` text,
	`last_attempt_at` text NOT NULL,
	`last_success_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_source_health_user_provider` ON `source_health` (`user_id`,`provider`);
--> statement-breakpoint
UPDATE `job_matches` SET `status` = 'STALE';
--> statement-breakpoint
UPDATE `application_packets` SET `status` = 'STALE';
--> statement-breakpoint
UPDATE `application_kits` SET `status` = 'STALE';
--> statement-breakpoint
UPDATE `tailored_documents` SET `status` = 'STALE' WHERE `status` != 'SUPERSEDED';
--> statement-breakpoint
UPDATE `application_executions` SET `status` = 'STALE' WHERE `status` != 'SUBMITTED';
