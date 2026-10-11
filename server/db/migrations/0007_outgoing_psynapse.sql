CREATE TABLE `ability_dimension` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ability_dimension_key_unique` ON `ability_dimension` (`key`);--> statement-breakpoint
CREATE TABLE `category_ai_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`skill_roadmap` text NOT NULL,
	`ability_roadmap` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`asset_snapshot` text NOT NULL,
	`generated_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `job_category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_ai_cache_category_unique` ON `category_ai_cache` (`category_id`);--> statement-breakpoint
CREATE TABLE `job_requirement` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`raw_name` text NOT NULL,
	`requirement_text` text NOT NULL,
	`importance` text NOT NULL,
	`source` text NOT NULL,
	`verdict` text,
	`user_note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job_post`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_requirement_job_idx` ON `job_requirement` (`job_id`);--> statement-breakpoint
CREATE INDEX `job_requirement_kind_key_idx` ON `job_requirement` (`kind`,`key`);--> statement-breakpoint
CREATE TABLE `personal_ability` (
	`id` text PRIMARY KEY NOT NULL,
	`dimension_key` text NOT NULL,
	`level` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_ability_dimension_unique` ON `personal_ability` (`dimension_key`);--> statement-breakpoint
CREATE TABLE `personal_experience` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`role` text NOT NULL,
	`type` text NOT NULL,
	`period` text NOT NULL,
	`years` real NOT NULL,
	`highlights` text NOT NULL,
	`tech_stack` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `job_post` ADD `business_type` text;--> statement-breakpoint
ALTER TABLE `job_post` ADD `asset_snapshot` text;--> statement-breakpoint
ALTER TABLE `personal_skill` ADD `level` text;--> statement-breakpoint
INSERT INTO `job_requirement` (`id`, `job_id`, `kind`, `key`, `raw_name`, `requirement_text`, `importance`, `source`, `verdict`, `user_note`, `sort_order`)
SELECT lower(hex(randomblob(16))), `job_id`, 'SKILL', `skill_key`, `raw_name`, `raw_name`, `importance`, `source`, NULL, NULL, `rowid`
FROM `job_post_skill`;
