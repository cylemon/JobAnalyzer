CREATE TABLE `skill_alias` (
	`id` text PRIMARY KEY NOT NULL,
	`alias_key` text NOT NULL,
	`skill_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_alias_alias_key_unique` ON `skill_alias` (`alias_key`);