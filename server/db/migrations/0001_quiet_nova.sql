CREATE TABLE `job_category` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_post` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`company_name` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'NOT_APPLIED' NOT NULL,
	`salary_text` text,
	`salary_min` integer,
	`salary_max` integer,
	`salary_months` integer,
	`location_city` text,
	`location_district` text,
	`industry` text,
	`original_url` text,
	`responsibilities` text NOT NULL,
	`requirements` text NOT NULL,
	`bonus_points` text NOT NULL,
	`custom_fields` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `job_category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_post_category_status_idx` ON `job_post` (`category_id`,`status`);--> statement-breakpoint
CREATE TABLE `job_post_skill` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`skill_key` text NOT NULL,
	`raw_name` text NOT NULL,
	`importance` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job_post`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_post_skill_key_idx` ON `job_post_skill` (`skill_key`);--> statement-breakpoint
CREATE INDEX `job_post_skill_job_idx` ON `job_post_skill` (`job_id`);