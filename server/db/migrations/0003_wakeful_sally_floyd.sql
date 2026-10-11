CREATE TABLE `job_ai_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`resume_advice` text NOT NULL,
	`learning_path` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`skill_snapshot` text NOT NULL,
	`had_resume` integer NOT NULL,
	`generated_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job_post`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_ai_cache_job_unique` ON `job_ai_cache` (`job_id`);