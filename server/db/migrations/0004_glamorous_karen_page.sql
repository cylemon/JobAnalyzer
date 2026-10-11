CREATE TABLE `schema_field_config` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text DEFAULT 'JOB' NOT NULL,
	`field_name` text NOT NULL,
	`field_label` text NOT NULL,
	`field_type` text NOT NULL,
	`options` text,
	`hint` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schema_field_config_name_unique` ON `schema_field_config` (`entity_type`,`field_name`);