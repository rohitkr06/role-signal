CREATE TABLE `tailored_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`resume_id` text,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`content_json` text NOT NULL,
	`evidence_json` text NOT NULL,
	`grounding_score` integer NOT NULL,
	`docx_object_key` text,
	`pdf_object_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`approved_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tailored_documents_user_job_version` ON `tailored_documents` (`user_id`,`job_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_tailored_documents_user_updated` ON `tailored_documents` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_tailored_documents_user_job_status` ON `tailored_documents` (`user_id`,`job_id`,`status`);