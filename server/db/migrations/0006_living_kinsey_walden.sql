CREATE TABLE `skill_embedding` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_key` text NOT NULL,
	`model` text NOT NULL,
	`dim` integer NOT NULL,
	`vector` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_embedding_key_model_unique` ON `skill_embedding` (`skill_key`,`model`);