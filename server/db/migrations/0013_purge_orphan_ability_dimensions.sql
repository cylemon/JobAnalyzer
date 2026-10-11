-- 能力清单解耦：岗位侧不再写入 ability_dimension，清单改为纯用户自有（见 04-construction.md §7.10）。
--
-- 判据是「从未被自评过」：这类维度是旧版「解析岗位时自动落键」的产物，
-- 用户从未对它们表过态，留在个人信息页只会变成一串待自评项。
--
-- 与 0011 的保留规则**相反**，这里故意不排除被 job_requirement 引用的维度：
-- 解耦之后岗位侧的键不再需要「词表里存在」（key = normalizeKey(raw_name)，
-- 两条创建路径都成立），而被删岗位留下的残留——本次要修的另一半问题——
-- 也只有这个判据能覆盖。
DELETE FROM `ability_dimension`
WHERE `key` NOT IN (SELECT DISTINCT `dimension_key` FROM `personal_ability`);
--> statement-breakpoint
-- 熟练度由四档改三档：取消「入门」档，已有的归入最低档「一般」。
-- 「已录入但没标注等级」保持 NULL 不变——界面仍显示「未标注」，判定时按已掌握计。
UPDATE `personal_skill` SET `level` = 'INTERMEDIATE' WHERE `level` = 'BASIC';
--> statement-breakpoint
UPDATE `personal_ability` SET `level` = 'INTERMEDIATE' WHERE `level` = 'BASIC';
