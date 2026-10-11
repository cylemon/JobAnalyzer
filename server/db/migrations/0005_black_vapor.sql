CREATE TABLE `track_progress_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`category_name` text NOT NULL,
	`taken_at` integer NOT NULL,
	`active_jobs` integer NOT NULL,
	`avg_score` integer,
	`missing_top` text NOT NULL,
	`trigger_reason` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `job_category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `track_progress_category_time_idx` ON `track_progress_snapshot` (`category_id`,`taken_at`);