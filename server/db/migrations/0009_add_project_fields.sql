ALTER TABLE `ability_dimension` DROP COLUMN `domain`;--> statement-breakpoint
ALTER TABLE `ability_dimension` DROP COLUMN `builtin`;--> statement-breakpoint
ALTER TABLE `personal_skill` DROP COLUMN `category`;--> statement-breakpoint
CREATE TABLE `__new_personal_experience` (
	`id` text PRIMARY KEY NOT NULL,
	`company` text NOT NULL,
	`role` text NOT NULL,
	`type` text NOT NULL,
	`period` text NOT NULL,
	`years` real NOT NULL,
	`highlights` text NOT NULL,
	`tech_stack` text NOT NULL,
	`project` text NOT NULL,
	`duration_months` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
-- 履历 → 项目经验：旧的「公司 / 岗位 / 起止时间 / 核心成果」拼成项目描述，
-- 年限换算成月（1 年 = 12 个月），不丢用户已经写下的内容。
INSERT INTO `__new_personal_experience` (`id`, `company`, `role`, `type`, `period`, `years`, `highlights`, `tech_stack`, `project`, `duration_months`, `created_at`, `updated_at`)
SELECT
	`id`, `company`, `role`, `type`, `period`, `years`, `highlights`, `tech_stack`,
	trim(
		`company` || ' · ' || `role` || '（' || `period` || '）' || char(10)
		|| coalesce((SELECT group_concat(json_each.value, char(10)) FROM json_each(`highlights`)), '')
	),
	CAST(round(`years` * 12) AS INTEGER),
	`created_at`, `updated_at`
FROM `personal_experience`;
--> statement-breakpoint
DROP TABLE `personal_experience`;
--> statement-breakpoint
ALTER TABLE `__new_personal_experience` RENAME TO `personal_experience`;
