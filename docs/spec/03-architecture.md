# 该文档是本项目的架构和技术选型文档

> 本版（2026-10-04）按 `prototype/` 的新原型重写数据模型（§3）与关键算法（§4）。
> 需求见 02 文档，构建顺序见 04 文档。
>
> **术语**：本文档里的「知识」= 代码里的 `Skill`（`RequirementKind.SKILL` / `skillKey` / `personalSkill` / `match.skill`），
> 指的是同一件东西——个人侧的技术资产，以及岗位要求里「知道什么」的那一类。详见 02 文档开头的术语说明。

## 1. 技术选型 (Technology Stack)

| 层级 | 选用技术 | 选型理由与说明 |
| --- | --- | --- |
| **前端框架** | React 19 + Vite + TypeScript | 组件化开发、开发构建极快；TS 保证类型安全。 |
| **UI 样式** | TailwindCSS v4 + 自建组件层 | 现代美观，适合 Chip / Tag 标签化交互；组件层在 `web/components/ui/`，不引第三方组件库。 |
| **本地服务** | Node.js (LTS) + Hono | 只监听 `127.0.0.1`。轻量、TS 优先、SSE 支持好；同时承载 LLM 转发（规避浏览器直连的 CORS 限制与密钥暴露）。*可逆细节：HTTP 框架可替换，只要路由层足够薄。* |
| **数据库** | SQLite（`better-sqlite3`） | 单文件无服务、同步 API 简单可靠；支持 JSON 函数与窗口函数（SQLite ≥ 3.25）。 |
| **ORM / 迁移** | Drizzle ORM + drizzle-kit | TS 类型推导完整，SQL-like 语法适合本项目的聚合查询；迁移文件可读可审查。 |
| **运行时校验** | zod | 校验 LLM 返回的 JSON 与前后端数据契约，是 `shared/schemas/` 的唯一类型来源。 |
| **LLM 接入** | 自建适配器 `LLMService` + OpenAI-compatible Chat Completions 协议 | **不绑定任何厂商**：厂商以「预设表」形式内置（DeepSeek / 通义千问 / 智谱 / Kimi / OpenAI / SiliconFlow / OpenRouter / 本地 Ollama / 自定义），Base URL 与模型名均可由用户修改，用户自带 API Key。默认实现走 OpenAI 兼容协议；非兼容协议（如 Claude 原生 Messages API、Ollama 原生）各新增一个 `protocol` 与适配器即可，业务代码不动。**岗位截图解析依赖所选模型支持图像输入**，设置页提供图像能力探测（见 02 文档 F-2.2）。 |
| **流式输出** | 服务端 SSE → 前端 `fetch` 流式读取 | 由本地服务代理转发，避免浏览器直连厂商 API。 |

### 1.1 关于桌面端的决策：不做

Tauri / Electron 这类桌面壳在本项目里只解决「双击启动」一个问题，却要额外维护一套打包与权限体系。
本地服务 + 浏览器已经满足「单机、数据不出本机」的全部要求，故不做桌面端。

## 2. 总体系统架构 (System Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│  浏览器（web/）                                              │
│  岗位模块 · 个人信息 · 综合看板 · 系统设置                     │
│  —— 只做展示与交互，不含业务计算（唯一的例外：纯展示格式化）     │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTP / SSE  （只连 127.0.0.1:8787）
┌───────────────▼─────────────────────────────────────────────┐
│  本地服务（server/）                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │ routes/      │  │ services/     │  │ llm/             │  │
│  │ 路由与入参校验 │→│ 领域计算与聚合 │→│ 适配器 / Prompt   │  │
│  └──────────────┘  └───────┬───────┘  └──────────────────┘  │
│                            │                                 │
│                      ┌─────▼─────┐                           │
│                      │ SQLite    │  数据全在本机              │
│                      └───────────┘                           │
└──────────────────────────────────────────────────────────────┘
                │
                ▼  仅两处出网：解析岗位、生成成长路线
        ┌───────────────────┐
        │ 用户配置的 LLM 厂商 │
        └───────────────────┘
```

### 2.1 架构约束

1. **计算在服务端**：`shared/domain/` 与 `server/services/` 承载全部业务计算，前端只负责渲染与交互。
   前端不得复制一份匹配算法——那必然导致两侧口径分裂。
2. **契约在 shared/**：`shared/schemas/` 是前后端类型的唯一来源；所有 API 响应经 zod 校验后才交给前端。
3. **纯函数优先**：算法（打分、分层、聚合、优先级）写成不依赖数据库的纯函数，放在 `shared/domain/`，
   由服务端调用、由单元测试覆盖。数据库只负责取数与写回。
4. **上传与解析分离**：图片只在上传的那一刻经过内存，解析完即丢弃；不落盘、不留副本。

### 2.2 配置与密钥管理

| 层级 | 载体 | 定位 |
| --- | --- | --- |
| 1 | 环境变量 `JOBANALYZER_LLM_{PROVIDER,BASE_URL,MODEL,API_KEY,VISION}` | 可选的高级覆盖：希望密钥完全不落到磁盘文件时使用 |
| 2 | 项目根 `.env` | 可选：习惯编辑文件的用户；已 gitignore |
| 3 | `data/config.json` | **默认路径**，由设置页写入，用户无需编辑文件 |
| 4 | 厂商预设表 | **模板，不是兜底**：只在用户点了名（添加厂商、或旧配置里写明了 providerId）时用来补地址与建议模型 |

**系统不预置任何厂商**：什么都没配时 `resolveSettings` 如实返回空地址、`sources` 标 `none`，
由调用方报「尚未配置模型服务商」。绝不替用户挑一家——否则报出来的错会是"没有密钥"，
用户根本不知道系统把他引导到了哪家。

**配置形态**：厂商列表 + 一个当前厂商；每个厂商带自己的模型清单（`model` 是当前模型，
一定在清单里），**每个模型带自己的推理参数**（只有温度）。参数跟随模型，不跟随厂商——
同一家的快模型与推理模型需要的数值本来就不同。
早期版本那份全局参数（`global`）在读取时折叠为各模型的初始值，写回时不再产生；
其中 `timeoutMs` / `stream` 已废弃，读取时直接忽略。

**不作为设置项的三个旋钮**——都属于「用户调不准、只会被配错」的一类，一律内置：
输出上限 `MAX_OUTPUT_TOKENS = 8192`（理由见 §4.7）、请求超时（按调用路径定死：
非流式对话 60 秒、流式生成 180 秒，见 `llm/openaiCompat.ts`）、是否流式输出
（成长路线只有流式一种方式，见 §4.8）。

**下发给界面时必须分成两个视角**，不能合成一个字段：

* `providers[]` —— 配置文件里**存着的值**，编辑器读写的就是这一份；
* `resolved` —— **实际生效的值**（含上面四层的覆盖），界面用它回答"这次会用到什么"。

合成一个字段（曾经如此）会出事：界面拿到的是生效值，保存时又原样送回，
环境变量的覆盖就被悄悄写进了配置文件——用户撤掉环境变量后行为却变了，且无从解释。
两者分开后，被环境变量盖住的字段由界面明确提示（附上具体的变量名），
而不是让人改完才发现没反应。

## 3. 数据模型设计 (Data Schema)

> 以下为**逻辑数据模型**；实际实现为 `server/db/schema.ts` 中的 Drizzle 定义 + drizzle-kit 迁移，
> 字段的运行时校验以 `shared/schemas/` 中的 zod 定义为准。
>
> **迁移铁律（N-1）**：迁移只增不删。已经存在的数据表和列一律保留（含暂缓特性的表），
> 新模型通过「新增表 + 新增列 + 数据搬迁」落地。

### 3.1 个人资产（匹配的「用户侧」输入）

```prisma
// 1. 个人知识库 (PersonalSkill)
model PersonalSkill {
  id         String   @id @default(uuid())
  name       String   // 展示名，如 "Kubernetes"
  skillKey   String   @unique  // 归一化键，写入时生成（唯一口径，见 §4.1）
  category   String?  // 领域展示名，如 "编程与后端"
  level      String?  // 精通 | 熟练 | 一般；null = 老数据里的未标注（判定按「一般」计，界面不再产生 null）
  acquiredAt DateTime? // 掌握日期；暂缓特性（进度快照）恢复时使用
  createdAt  DateTime @default(now())
}

// 2. 知识别名 (SkillAlias)：解决 k8s → kubernetes、大模型 → llm 等误判
model SkillAlias {
  id       String @id @default(uuid())
  aliasKey String @unique // 归一化后的别名键
  skillKey String         // 指向的归一化知识键
}

// 3. 能力条目 (AbilityDimension)：**用户自有的能力清单**（见 §4.6）
//    唯一写入者是个人信息页的新增操作；解析岗位时只读匹配同名键，绝不新建。
//    清单不预置任何条目，所以没有 builtin 标记、也没有分组字段
model AbilityDimension {
  id        String   @id @default(uuid())
  key       String   @unique  // 归一化键，如 "高并发与流量治理"
  name      String            // 展示名，如 "高并发与流量治理"
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
}

// 4. 个人能力自评 (PersonalAbility)：一个条目最多一条
model PersonalAbility {
  id           String   @id @default(uuid())
  dimensionKey String   @unique // 对应 AbilityDimension.key；没有外键，条目删了自评也删掉
  level        String   // 精通 | 熟练 | 一般
  note         String?  // 补充说明，会作为判定素材送进 Prompt
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

// 5. 项目经验 (PersonalExperience)
model PersonalExperience {
  id             String   @id @default(uuid())
  project        String   // 项目描述：做了什么、拿到什么结果（多行文本）
  durationMonths Int      // 项目持续时长（月），用于累计经验年限
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

### 3.2 岗位与要求条目

```prisma
// 6. 目标岗位分类 (JobCategory)
model JobCategory {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// 7. 岗位 (JobPost)
model JobPost {
  id         String      @id @default(uuid())
  categoryId String
  category   JobCategory @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  companyName String
  title       String
  status      String      @default("NOT_APPLIED")
  // NOT_APPLIED | APPLIED | INTERVIEWING | OFFER | REJECTED | CLOSED
  // CLOSED = 岗位下线/不再考虑；默认折叠，且永久排除于所有统计

  salaryMin    Int?      // 元/月；模型按 K 报数，服务端 ×1000 后入库
  salaryMax    Int?      // 元/月
  salaryMonths Int?
  salaryText   String?   // 原始文本，如 "25k-35k·16薪"，仅用于展示

  locationCity     String?
  locationDistrict String?
  industry         String?  // 旧数据保留；已在 v4 起停止提取（与「业务领域」语义重叠且界面从不展示）
  businessType     String?  // 业务领域：该岗位服务的业务方向，如 "工业视觉 / 智能制造"
  originalUrl      String?

  responsibilities String  // JSON Array；v6 起不再提取，恒为空（列保留仅为兼容旧数据）
  requirements     String  // JSON Array：岗位要求的原文条目
  bonusPoints      String? // JSON Array；v6 起不再提取，恒为空
  customFields     String  // JSON Object：动态字段（暂缓特性，保留数据）

  assetSnapshot String?   // 新增：判定能力/经验条目时的个人资产快照（见 §4.5）

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  requirements_ JobRequirement[]
}

// 8. 要求条目 (JobRequirement)：全项目的原子单位
model JobRequirement {
  id     String @id @default(uuid())
  jobId  String
  job    JobPost @relation(fields: [jobId], references: [id], onDelete: Cascade)

  kind String  // SKILL（界面显示为「知识」）| ABILITY | EXP
  key  String  // SKILL → skillKey；ABILITY → 归一化键（优先复用用户能力清单里的同名键）；EXP → 归一化文本键
  rawName String // 模型返回的原始写法，如 "K8s"

  requirementText String // 岗位要求原文（展示用）
  importance String      // MUST | NICE
  source     String      // REQUIREMENT | BONUS

  requiredLevel String? // 精通 | 熟练 | 一般；null = 原文没写程度（只比有没有）。**EXP 恒为 null**
  verdict  String? // MATCH | PARTIAL | GAP；**仅 ABILITY / EXP 有值**
  userNote String? // 用户情况说明；ABILITY/EXP = 模型判词，SKILL = 读取时本地生成

  sortOrder Int

  @@index([jobId])
  @@index([kind, key])
}

// 9. 分类级 AI 缓存 (CategoryAICache)：成长路线
model CategoryAICache {
  id         String @id @default(uuid())
  categoryId String @unique
  skillRoadmap   String // JSON: [{ title, priority, desc }]
  abilityRoadmap String // JSON: [{ title, priority, desc }]
  model         String
  promptVersion String
  assetSnapshot String   // 生成时刻的个人资产快照
  generatedAt   DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### 3.3 设计说明

* **为什么把知识 / 能力 / 经验合并成一张 `JobRequirement`**：三维匹配度、缺口聚合、详情对比三件事
  都只是「按 kind 分组、按 key 归并」的同一类查询。分三张表会让打分与聚合出现三条几乎相同的代码路径，
  而这类重复正是口径分裂的温床（旧设计中最危险的静默错误就是"匹配引擎与统计 SQL 各自处理知识名"）。
  合并后 `kind` 只影响**取值来源与判定方**，不影响存储形态。
* **`JobRequirement.verdict` 对 SKILL 行恒为空**：知识结论由本地在读取时计算（§4.2），
  一旦落库就会与用户知识库脱节——用户新增知识后分数却不变，这是必须避免的错误。
* **`key` 三类的取值**：知识来自 §4.1 的 `skillKey`；能力是条目名归一化后的键，
  **优先复用用户能力清单里同名的键**（只读匹配，不新建条目）；经验条目不参与跨岗位聚合，
  因此用归一化文本键（仅用于同岗位内去重）。
* **`JobRequirement.requiredLevel`**：回答「要求到什么程度」。知识与能力两类有意义，
  经验类恒为 null——个人侧只有项目与时长，没有等级可比。存量行为 null，判定口径与新增前完全一致。
* **`JobPost.assetSnapshot` 挂在岗位上而非条目上**：一次解析里所有能力/经验条目共用同一份快照，
  失效判定也是整岗级别的。
* **`salaryText` 与数值字段并存**：前者用于展示（含「·16薪」等信息），后者用于排序与聚合。
* **`JobPostSkill`（旧表）**：由迁移把既有行搬迁进 `JobRequirement(kind=SKILL)`；
  旧表保留但不再写入，避免任何数据丢失风险。

## 4. 关键算法与架构逻辑设计

### 4.1 知识归一化与别名解析（唯一口径）

```
normalizeSkillKey(raw) -> string:
  1. 全角转半角
  2. trim + 合并连续空白为单个空格
  3. 转小写
  4. 保留字母、数字、中文、+#.（如 c++ / c# / node.js 不被破坏）

resolveSkillKey(rawKeys) -> skillKey:
  1. key = normalizeSkillKey(raw)
  2. 若 key 命中 SkillAlias.aliasKey → 返回其 skillKey
  3. 否则返回 key
```

* **写入时归一化**：`PersonalSkill.skillKey`、`JobRequirement.key(kind=SKILL)` 均在写库时完成归一化与别名解析。
* 匹配算法与统计 SQL **只读 `key`，不做任何大小写或别名处理**。
* 归一化与别名解析**只有这一个实现**（`server/services/skillKey.ts`），不得复制到别处。

### 4.2 三维匹配度算法（对应 02 文档 F-3.1 / F-3.2）

```typescript
// shared/domain/matching.ts —— 常量集中于此，便于调整
export const IMPORTANCE_WEIGHT = { MUST: 0.8, NICE: 0.2 } as const
export const VERDICT_WEIGHT = { MATCH: 1, PARTIAL: 0.5, GAP: 0 } as const
export const DIMENSION_WEIGHT = { SKILL: 0.5, ABILITY: 0.3, EXP: 0.2 } as const

/** 单个维度：0-100；没有任何条目时返回 null（无法评估） */
function dimensionScore(items: Requirement[]): number | null {
  const total = items.reduce((sum, i) => sum + IMPORTANCE_WEIGHT[i.importance], 0)
  if (total === 0) return null
  const got = items.reduce(
    (sum, i) => sum + VERDICT_WEIGHT[i.verdict] * IMPORTANCE_WEIGHT[i.importance],
    0,
  )
  return Math.round((got / total) * 1000) / 10
}

/** 综合匹配度：对可评估的维度按权重重新归一化；三个维度都不可评估时为 null */
function compositeScore(scores: { SKILL: number|null; ABILITY: number|null; EXP: number|null }) {
  const dims = Object.entries(scores).filter(([, s]) => s !== null)
  const weight = dims.reduce((sum, [k]) => sum + DIMENSION_WEIGHT[k], 0)
  if (weight === 0) return null
  return Math.round(dims.reduce((sum, [k, s]) => sum + s * DIMENSION_WEIGHT[k], 0) / weight)
}

// 熟练度档位序（唯一口径，见 shared/schemas/common.ts）
export const PROFICIENCY_RANK = { MASTER: 2, PROFICIENT: 1, INTERMEDIATE: 0 } as const

/** 知识条：本地判定「有没有」与「够不够」 */
function skillVerdict(
  skillKey: string,
  requiredLevel: ProficiencyLevel | null,
  userSkills: ReadonlyMap<string, ProficiencyLevel | null>,
): MatchVerdict {
  if (!userSkills.has(skillKey)) return 'GAP'          // 没有这项知识
  if (requiredLevel === null) return 'MATCH'           // 岗位没写程度：只比有没有
  const userLevel = userSkills.get(skillKey) ?? 'INTERMEDIATE' // 老数据的未标注按「一般」计

  const deficit = PROFICIENCY_RANK[requiredLevel] - PROFICIENCY_RANK[userLevel]
  return deficit <= 0 ? 'MATCH' : 'PARTIAL'
}
```

**知识条结论的真值表**（`skillVerdict`，唯一口径）：

| 用户侧 | 要求 = null | 一般 | 熟练 | 精通 |
| --- | --- | --- | --- | --- |
| 未录入该知识 | GAP | GAP | GAP | GAP |
| 已录入、未标注等级（老数据，按「一般」计） | MATCH | MATCH | PARTIAL | PARTIAL |
| 一般 | MATCH | MATCH | PARTIAL | PARTIAL |
| 熟练 | MATCH | MATCH | MATCH | PARTIAL |
| 精通 | MATCH | MATCH | MATCH | MATCH |

界面文案：`MATCH` 完全匹配（绿）· `PARTIAL` 需提升（黄）· `GAP` 不匹配（红）。

* **知识条的结论由本地计算**，因此读取岗位时必须重新计算，**不得**使用任何缓存下来的知识结论。
* **`GAP` 只表示「完全没有这项」**：它是红档，必须真的是「要从零补」。有、但等级不够（差一档还是
  差两档）一律判 `PARTIAL`——红档里混进「学得不够」，用户就分不出哪几条该优先补（02 文档 F-3.2）。
* **未标注等级（老数据）按「一般」计**：熟练度没有「未标注」这一档，界面默认就是「一般」，
  新增知识项也只会从三档里选。判定口径必须与界面显示一致，否则会出现「卡片上写一般、
  判定却按已掌握算」（02 文档 F-1.1 / F-3.3）。
* **「要求一般」等价于不比较**：它是最低档，比不过任何已录入的等级。真正会扣分的只有
  「要求熟练」与「要求精通」。让模型填 INTERMEDIATE 是无副作用的。
* **能力/经验条的结论来自模型**（录入时判定，见 §4.5），落库保存。能力条目会把 `requiredLevel`
  一并送进判词 Prompt，让模型把程度算进去（程度不够判 `PARTIAL`，`GAP` 只用于资产里找不到相关证据，
  与知识侧同一口径）；能力不做本地等级比对——解耦后岗位侧与个人侧的键
  不再强制对齐，本地比对没有可靠依据。
* **单调性约束**：新增知识只会把某条 SKILL 的结论从 `GAP` 变为 `{GAP, PARTIAL, MATCH}`，
  分子单调不减、分母不变；档位调高时 `deficit` 单调不增，结论同样只升不降。故知识匹配度单调不减，
  综合分因知识维度权重为正也随之单调不减。必须有单元测试保障。
* **与旧算法的关系**：旧版是「知识单维 + 必须项/加分项覆盖率 + 零要求 0.6 折扣」。
  新版把「覆盖率」推广为「逐条结论加权覆盖率」，并取消了 0.6 折扣——当某维度没有任何条目时，
  该维度不参与综合分（而不是打折蒙一个分数），这比旧规则更不容易产生误导性的高分。
* **展示口径**：综合分按 §4.3 分六档着色；能力/经验分必须标注"模型判定"，知识分标注"本地计算"。

### 4.3 匹配度分层（六档，全站唯一口径）

| 档位 | 区间 | 用途 |
| --- | --- | --- |
| 满分匹配 | = 100 | 卡片分数着色、看板分层统计与堆叠条 |
| 极高匹配 | 90 – 99 | 同上 |
| 良好匹配 | 80 – 89 | 同上 |
| 中等匹配 | 70 – 79 | 同上 |
| 偏低匹配 | 60 – 69 | 同上 |
| 待提升 | < 60 | 同上 |

* 满分单列一档：100 分是「要求全部满足」，与 90 分段的「极高」不是一回事。
* 该色板定义在 `shared/domain/tiers.ts`，**前端与看板共用同一份**，不允许两处各写一套颜色。
  颜色值在 `web/index.css` 的色族里（`--amber-*` 等），"档位键 → 色族"的映射在 `web/lib/tiers.ts`。
* 无法评估（null）不参与分层，单独显示「—」。

### 4.4 缺口聚合与优先级（对应 02 文档 F-6.4）

```
输入：某分类（或全部）下的有效岗位（status ≠ CLOSED）
筛选：verdict ≠ MATCH 且 kind ∈ { SKILL, ABILITY }
      （知识条的 verdict 由 resolveVerdict 现场算——**等级不够（PARTIAL）同样是缺口**：
        「有这项知识」不等于「够用」，只判「在不在用户知识键集合里」会漏掉这类）
归并：按 (kind, key) 分组
计数：COUNT(DISTINCT jobId) —— 同一岗位内重复出现只计一次
排名：该类型内按 count 降序
分档：条目数 ≥ 3 时按排名分位三等分（前 1/3 高、中 1/3 中、后 1/3 低）；
      条目数 < 3 时全部标为「中」（样本太少，不下高低判断）
```

* 知识缺口的 `key` 是 `skillKey`，能力缺口的 `key` 是条目名归一化后的键。
  解耦之后能力键不再由共享词表强制收敛，跨岗位归并靠**提取 Prompt 的候选名清单**约束模型命名（§4.6）。
* 分母（"N 个岗位提及"里的 N 是分子；总岗位数另行展示）来自有效岗位数，与旧版 §4.3 的口径一致。
* 经验类缺口不进榜单：经验无法通过"补一项"解决，列出来只会制造焦虑。

### 4.5 AI 缓存与过时检测（对应 F-3.5 / F-4.3）

```
[录入岗位]
      │
      ▼
[发送：JD 原文 + 个人资产摘要] ──► [模型返回结构化要求条目 + 能力/经验判词]
      │                                        │
      ▼                                        ▼
[本地判定知识条目 conclusion]        [落库 verdict / userNote]
      │                                        │
      └──────────────► 写入 assetSnapshot ◄────┘

[读取岗位详情]  一律重新本地计算知识结论，能力/经验条读库
      │
      ▼
[比对 JobPost.assetSnapshot 与当前个人资产哈希]
      ├── 一致 ──► 正常展示
      └── 不一致 ► 显示"个人资产已变更，建议重新评估"（零 Token，不自动重算）
                  用户点击 → 重新调用模型 → 覆盖 verdict / userNote / 快照
```

* `assetSnapshot` = 个人知识键集合与等级 + 能力条目键与等级 + 项目经验描述与时长 的稳定哈希（排序后拼接再散列）。
  任一资产变更即导致快照变化。
* **成长路线的缓存同理**，只是快照挂在 `CategoryAICache` 上，按分类粒度失效。
* 无缓存时显示按钮、不自动请求；流式生成中断不落库（F-4.5）。

### 4.6 能力清单体系（用户自有）

**个人信息与岗位信息在这里是完全解耦的**（2026-10-07 修订，见 04 文档 §7.10）。
此前能力维度是一张「受控词表」，岗位侧解析时会把模型给出的能力名自动落键进去；结果每录一个岗位，
个人信息页就多出一批待自评项，删掉岗位也清不掉。现在：

* **清单是用户自己的**：`ability_dimension` 只有一个写入者——个人信息页的「新增能力维度」。
  清单不预置任何条目，页面按 `sortOrder` 平铺展示。删条目会连带删掉该条目的自评；
  岗位侧的历史条目保留（键仍在数据里），日后新增同名条目即可对回去。
* **改名只改显示名、不改键**（`PATCH /api/abilities/dimensions/:key`）：键是岗位侧条目与自评对齐的
  依据，跟着名字改会让已录入岗位的同类条目、以及这条自评当场成为孤儿。`matchAbilityKey` 先按名称
  归一化命中清单，所以改完名之后新提取的岗位照样对回同一个键——改个错别字不会让跨岗位统计断掉。
* **岗位侧只读匹配**：解析岗位时把能力名解析到**归一化键**（`matchAbilityKey`），
  命中清单里的同名条目就复用它的键，否则直接用归一化结果——**绝不新建条目**。
* **跨岗位命名收敛靠候选名清单**：解耦后不再有共享词表强制收敛，改由提取 Prompt 注入一份
  **有上限的**候选名（用户清单 ∪ 岗位侧已用过的能力名，按提及次数取前 40 个键），要求模型优先复用。
  上限是硬要求——无界的 `SELECT DISTINCT` 会让单次请求的注入量随岗位总量增长，违反 N-2。
* **能力雷达图（02 文档 F-5.5）**：取该分类下出现频次最高的至多 6 个轴；不足 6 个时按清单顺序补位。
  **轴候选 = 用户清单 ∪ 岗位提及过的键**——只按清单取轴的话，清单为空（解耦后的常见状态）时
  雷达会整块空掉，界面还会说「该方向还没有提取到能力类要求」，而事实是有的。
  * `岗位平均要求` = 100 × Σ(该轴条目的重要度权重) / 岗位数，上限 100（MUST 记 1、NICE 记 0.5）；
  * `我的当前匹配` = 自评等级映射（精通 100 / 熟练 75 / 一般 50），未自评该轴记 0；
  * 两个数值都是 0–100 的「强度」，同一张图上可直接比较，且口径写在图例里。

### 4.7 LLM 多模态提取（对应 F-2）

* 提取目标：把 JD 原文（文本/截图）转成 §3.2 的结构化岗位 + 要求条目。
* **Prompt 分两段拼装**：
  1. **固定指令段**：字段定义、要求条目的三类划分、重要度判定标准、要求等级的填法、输出 JSON Schema；
  2. **注入段**：个人资产摘要（知识名列表 / 能力清单与自评 / 项目经验摘要）+ 可复用的能力候选名
     + （暂缓特性启用时的）动态字段定义。
* **判词约束**：只允许基于注入的资产摘要判断能力/经验条目的结论，素材不足时结论取 `GAP` 并说明
  「资产中未提及相关经历」，严禁根据常识替用户假设经历（对应 F-4.4）。
* 返回结果必须经 zod 校验；校验失败不得重试成静默降级，必须把失败原因返回给用户（F-2.5）。
* **输出长度**：一份两屏的 JD 实测要 4000–6000 output token（拆分规则会产出 20+ 条要求条目），
  所以输出上限固定为 `MAX_OUTPUT_TOKENS = 8192`（config/settings.ts）——**不做成设置项**：
  实测它只会被配小、然后把长 JD 的解析整次截断。厂商限制更严时由适配器自动降档重试并记住（llm/openaiCompat.ts）。
* **薪资单位**：Prompt 约定模型按 K 报数（8-12K → 8 / 12），规整层 ×1000 折算成「元/月」入库
  （月薪 < 1000 元的写法不存在，模型偶尔仍按元给时不会被再乘一千）。
* **薪资本地兜底**：模型只抄回原文（如「8-12K」）却没给数值时，由 `server/services/salaryParse.ts`
  按同一口径本地换算（它的返回值已经是「元」）；读不出月薪（面议、日薪、缺单位）就留空并给出警告，绝不硬猜。
  每一次自动换算/纠正都必须写成 warning 让用户核对。
* 所有 Prompt 统一收敛在 `server/llm/prompts/`。

### 4.8 流式输出与中断策略

* 成长路线采用 SSE 流式渲染，**这是唯一的输出方式，没有开关**；流正常结束才写库，
  中断/报错则丢弃本次内容并保留旧缓存（F-4.5）。
* 解析岗位不使用流式（结果需要整体校验后才可用），但对多张图片逐个解析并逐项回报进度。

## 5. 项目代码目录结构规划

```
shared/
  schemas/     前后端契约（zod）：ability / experience / requirement / job / analysis / dashboard / settings …
  domain/      纯函数领域逻辑（无 IO、可单测）：matching / tiers / gap / snapshot
server/
  db/          schema.ts（Drizzle）+ migrations/（顺序执行，可增可删；删列时用表重建 + 数据搬迁）
  routes/      HTTP 路由与入参校验，只做参数转换与调用 service
  services/    领域服务：abilityStore(能力词表 + 个人资产快照) · jobStore · jobBoard · jobExtraction
               · analytics(缺口聚合 + 变更影响) · dashboard · roadmapCache · skillKey / skillAlias
  llm/         适配器 / 探测 / prompts（提取与成长路线）
web/
  views/       四个页面：JobsPage · ProfilePage · DashboardPage · SettingsPage
  components/  页面组件 + components/ui 基础组件层（按钮/卡片/徽章/弹窗/表单）
  services/    api.ts：只做 HTTP 调用与 zod 校验
prototype/     界面原型（HTML/CSS/JS 静态原型，作为视觉与交互的参照）
docs/spec/     本目录
```
