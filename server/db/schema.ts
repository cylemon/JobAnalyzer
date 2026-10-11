import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * 数据模型（Drizzle / SQLite）。
 * 逻辑模型见 03-architecture.md §3。表随后续变更通过新迁移加入（禁止提前建表 —— 原则 ④ YAGNI）。
 */

/** 2. 个人知识库 (PersonalSkill) */
export const personalSkill = sqliteTable(
  'personal_skill',
  {
    id: text('id').primaryKey(),
    /** 展示名，如 "Kubernetes" */
    name: text('name').notNull(),
    /** 归一化键，如 "kubernetes"；写入时由服务端生成，全局唯一（唯一口径，见原则 ⑤） */
    skillKey: text('skill_key').notNull(),
    /** 熟练度等级：MASTER | PROFICIENT | INTERMEDIATE（F-1.1，用于展示与能力雷达） */
    level: text('level'),
    /** 掌握日期（YYYY-MM-DD）；用于后续进度快照与回顾 */
    acquiredAt: text('acquired_at'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('personal_skill_skill_key_unique').on(t.skillKey)],
)

/**
 * 3b. 技能向量缓存 (SkillEmbedding)：语义相似度的本地基础。
 *
 * 设计要点：**每个技能名只嵌入一次**。之后所有"哪些技能可能指同一个东西"的比对
 * 都是纯本地余弦计算，零 Token、零网络。技能名总数很少且增长缓慢，
 * 所以这个功能的边际成本趋近于零。
 *
 * 按 (skillKey, model) 缓存：换嵌入模型时重算，但不清掉旧模型的缓存。
 */
export const skillEmbedding = sqliteTable(
  'skill_embedding',
  {
    id: text('id').primaryKey(),
    skillKey: text('skill_key').notNull(),
    /** 产出该向量的模型标识（换模型必须重算，不同模型的向量不可比） */
    model: text('model').notNull(),
    /** 维度，用于校验缓存与当前模型是否匹配 */
    dim: integer('dim').notNull(),
    /** JSON Array<number> */
    vector: text('vector').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('skill_embedding_key_model_unique').on(t.skillKey, t.model)],
)

/** 3. 技能别名 (SkillAlias)：解决 k8s → kubernetes、py → python 这类误判 */
export const skillAlias = sqliteTable(
  'skill_alias',
  {
    id: text('id').primaryKey(),
    /** 归一化后的别名键，如 "k8s" */
    aliasKey: text('alias_key').notNull(),
    /** 指向的归一化技能键，如 "kubernetes" */
    skillKey: text('skill_key').notNull(),
  },
  (t) => [uniqueIndex('skill_alias_alias_key_unique').on(t.aliasKey)],
)

/** 1. 目标岗位分类 (JobCategory) */
export const jobCategory = sqliteTable('job_category', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

/** 4. 岗位 (JobPost) */
export const jobPost = sqliteTable(
  'job_post',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => jobCategory.id, { onDelete: 'cascade' }),
    companyName: text('company_name').notNull(),
    title: text('title').notNull(),
    /** NOT_APPLIED | APPLIED | INTERVIEWING | OFFER | REJECTED | CLOSED（CLOSED 永久排除于统计） */
    status: text('status').notNull().default('NOT_APPLIED'),
    /** 薪资原始文本，如 "25k-35k·13薪"，仅用于展示 */
    salaryText: text('salary_text'),
    /** 数值化薪资（元/月），用于排序与聚合 */
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    salaryMonths: integer('salary_months'),
    locationCity: text('location_city'),
    locationDistrict: text('location_district'),
    industry: text('industry'),
    /** 业务方向，如 "C端大模型 Agent 智能体链"（F-2.3） */
    businessType: text('business_type'),
    originalUrl: text('original_url'),
    /** JSON Array（纯展示文本） */
    responsibilities: text('responsibilities').notNull(),
    requirements: text('requirements').notNull(),
    bonusPoints: text('bonus_points').notNull(),
    /** JSON Object：动态字段键值对（暂缓特性，保留数据） */
    customFields: text('custom_fields').notNull(),
    /**
     * 能力/经验类判定的个人资产快照（03-architecture.md §4.5）。
     * 与当前快照不一致 = 判词过时：界面标记「待重新评估」，
     * 自动流程在去抖窗口结束后重跑（见 05-architecture-overview.md §8.4）。
     */
    assetSnapshot: text('asset_snapshot'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('job_post_category_status_idx').on(t.categoryId, t.status)],
)

/**
 * 5. 岗位技能（规范化关系表 —— 全项目的核心统计都建立在这张表上）
 * skillKey 不设外键：岗位要求的技能未必在用户技能库中，这正是「缺失技能」的题中之义。
 */
export const jobPostSkill = sqliteTable(
  'job_post_skill',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobPost.id, { onDelete: 'cascade' }),
    skillKey: text('skill_key').notNull(),
    rawName: text('raw_name').notNull(),
    /** MUST | NICE */
    importance: text('importance').notNull(),
    /** REQUIREMENT | BONUS */
    source: text('source').notNull(),
  },
  (t) => [index('job_post_skill_key_idx').on(t.skillKey), index('job_post_skill_job_idx').on(t.jobId)],
)

/** 7. 动态字段定义配置 (SchemaFieldConfig)：零代码扩展岗位字段（F-3.1） */
export const schemaFieldConfig = sqliteTable(
  'schema_field_config',
  {
    id: text('id').primaryKey(),
    /** 当前仅 "JOB"；技能相关字段留待真实需求出现时再启用 */
    entityType: text('entity_type').notNull().default('JOB'),
    /** 字段标识 key，如 travel_required */
    fieldName: text('field_name').notNull(),
    /** 展示名称，如 接受出差 */
    fieldLabel: text('field_label').notNull(),
    /** TEXT | NUMBER | SELECT | TAGS */
    fieldType: text('field_type').notNull(),
    /** SELECT 类型的选项 JSON Array */
    options: text('options'),
    /** 注入 Prompt 的补充说明 */
    hint: text('hint'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('schema_field_config_name_unique').on(t.entityType, t.fieldName)],
)

/**
 * 9. 进度快照 (TrackProgressSnapshot)：技能库变更时追加，用于趋势回顾（F-6.2）。
 * 只存"当时算出来的数字"，不重算历史——技能库变了以后，过去的匹配度是无法还原的。
 */
export const trackProgressSnapshot = sqliteTable(
  'track_progress_snapshot',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => jobCategory.id, { onDelete: 'cascade' }),
    /** 分类名冗余保存，便于分类改名后仍能读懂历史 */
    categoryName: text('category_name').notNull(),
    takenAt: integer('taken_at', { mode: 'timestamp_ms' }).notNull(),
    /** 该分类下有效（非 CLOSED）岗位数 */
    activeJobs: integer('active_jobs').notNull(),
    avgScore: integer('avg_score'),
    /** JSON Array：[{ skillKey, displayName, count }] */
    missingTop: text('missing_top').notNull(),
    /** SKILL_ADDED | SKILL_REMOVED | SKILL_UPDATED | ALIAS_APPLIED | MANUAL */
    triggerReason: text('trigger_reason').notNull(),
  },
  (t) => [index('track_progress_category_time_idx').on(t.categoryId, t.takenAt)],
)

/*
 * 原第 8 张表 `profile`（简历原文单行表）已于 2026-10-10 随「简历原文」功能一并移除。
 * **表本身留在库里不动**（迁移只增不删，见 05-architecture-overview.md §12.4 C.3）——这里只是不再声明它，
 * 所以它也不再进导出。要恢复这个功能，加回定义与路由即可，数据还在。
 */

/**
 * 10. 能力清单 (AbilityDimension) —— **用户自有的能力清单**（03-architecture.md §4.6）。
 *
 * 唯一写入者是个人信息页的「新增能力维度」。岗位侧解析能力名时只读匹配、绝不新建，
 * 否则每录入一个岗位，个人信息页就会多出一批待自评项，删岗位还清不掉。
 * 跨岗位的「有几家提过这项能力」靠归一化键 + 提取 Prompt 的候选名清单收敛（F-6.4）。
 */
export const abilityDimension = sqliteTable(
  'ability_dimension',
  {
    id: text('id').primaryKey(),
    /** 归一化维度键：名称归一化后的结果 */
    key: text('key').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('ability_dimension_key_unique').on(t.key)],
)

/** 11. 个人能力自评 (PersonalAbility)：一个维度最多一条 */
export const personalAbility = sqliteTable(
  'personal_ability',
  {
    id: text('id').primaryKey(),
    dimensionKey: text('dimension_key').notNull(),
    /** MASTER | PROFICIENT | INTERMEDIATE */
    level: text('level').notNull(),
    /** 补充说明，会作为判定素材送进 Prompt */
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('personal_ability_dimension_unique').on(t.dimensionKey)],
)

/** 12. 项目经验 (PersonalExperience)：经验类要求的判定素材（F-1.2） */
export const personalExperience = sqliteTable('personal_experience', {
  id: text('id').primaryKey(),
  /** 项目描述：做了什么、结果如何（多行文本） */
  project: text('project').notNull(),
  /** 项目持续时长（月），用于累计经验年限 */
  durationMonths: integer('duration_months').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

/**
 * 13. 要求条目 (JobRequirement) —— 全项目的原子单位（03-architecture.md §3.2）。
 *
 * 三维匹配度、缺口聚合、详情对比都只是「按 kind 分组、按 key 归并」的同一类查询。
 * verdict 仅对 ABILITY / EXP 有值：技能结论由本地在读取时计算，落库就会与技能库脱节。
 */
export const jobRequirement = sqliteTable(
  'job_requirement',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobPost.id, { onDelete: 'cascade' }),
    /** SKILL | ABILITY | EXP */
    kind: text('kind').notNull(),
    /** SKILL → skillKey；ABILITY → 能力维度键；EXP → 归一化文本键 */
    key: text('key').notNull(),
    /** 模型返回的原始写法 */
    rawName: text('raw_name').notNull(),
    /** 岗位要求原文（展示用） */
    requirementText: text('requirement_text').notNull(),
    /** MUST | NICE */
    importance: text('importance').notNull(),
    /** REQUIREMENT | BONUS */
    source: text('source').notNull(),
    /**
     * MASTER | PROFICIENT | INTERMEDIATE；null = 原文未写明程度（只比有没有）。
     * EXP 恒为 null —— 个人侧只有项目与时长，没有等级可比。
     */
    requiredLevel: text('required_level'),
    /** MATCH | PARTIAL | GAP；仅 ABILITY / EXP 有值 */
    verdict: text('verdict'),
    /** 用户情况说明：ABILITY/EXP 为模型判词，SKILL 由本地生成 */
    userNote: text('user_note'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('job_requirement_job_idx').on(t.jobId),
    index('job_requirement_kind_key_idx').on(t.kind, t.key),
  ],
)

/** 14. 分类级 AI 缓存 (CategoryAICache)：按分类缓存成长路线（F-4.3） */
export const categoryAiCache = sqliteTable(
  'category_ai_cache',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => jobCategory.id, { onDelete: 'cascade' }),
    /** JSON: [{ title, priority, desc }] */
    skillRoadmap: text('skill_roadmap').notNull(),
    /** JSON: [{ title, priority, desc }] */
    abilityRoadmap: text('ability_roadmap').notNull(),
    model: text('model').notNull(),
    promptVersion: text('prompt_version').notNull(),
    /** 生成时刻的个人资产快照，用于零 Token 的过时检测 */
    assetSnapshot: text('asset_snapshot').notNull(),
    generatedAt: integer('generated_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('category_ai_cache_category_unique').on(t.categoryId)],
)
