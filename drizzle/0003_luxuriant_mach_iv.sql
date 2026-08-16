CREATE TABLE `discovery_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`search_id` text,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`providers_json` text NOT NULL,
	`discovered` integer NOT NULL,
	`imported` integer NOT NULL,
	`duplicates` integer NOT NULL,
	`qualified` integer NOT NULL,
	`report_json` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_discovery_runs_user_completed` ON `discovery_runs` (`user_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `idx_discovery_runs_search` ON `discovery_runs` (`search_id`);--> statement-breakpoint
CREATE TABLE `discovery_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`keywords_json` text NOT NULL,
	`locations_json` text NOT NULL,
	`work_modes_json` text NOT NULL,
	`portals_json` text NOT NULL,
	`min_score` integer NOT NULL,
	`active` integer NOT NULL,
	`last_run_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_discovery_searches_user_name` ON `discovery_searches` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_discovery_searches_user_updated` ON `discovery_searches` (`user_id`,`updated_at`);