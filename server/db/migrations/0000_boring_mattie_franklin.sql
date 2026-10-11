CREATE TABLE `personal_skill` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`skill_key` text NOT NULL,
	`category` text,
	`acquired_at` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `personal_skill_skill_key_unique` ON `personal_skill` (`skill_key`);--> statement-breakpoint
CREATE TABLE `profile` (
	`id` text PRIMARY KEY NOT NULL,
	`resume_text` text NOT NULL,
	`updated_at` integer NOT NULL
);
