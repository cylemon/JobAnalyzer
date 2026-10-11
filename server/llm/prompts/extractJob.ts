import { PROFICIENCY_LABEL, type ProficiencyLevel } from '@shared/schemas/common'

/**
 * 岗位提取 Prompt —— 所有 Prompt 统一收敛在 server/llm/prompts/（04-construction.md 反模式清单）。
 *
 * promptVersion 会随缓存一起落库，改动本文件的输出结构时必须同步升版本号。
 * v2（2026-10-04）：输出从「技能数组」改为「要求条目数组」（技能 / 能力 / 经验），
 * 并要求模型对照个人资产给出能力与经验类的结论。
 * v3（2026-10-05）：一次录入收敛为一个岗位——多张截图是同一岗位的不同部分，
 * 用户提示词按截图张数改写，明确要求合并成一条记录。
 * v4（2026-10-05）：薪资改为「先扫标题旁/页面顶部的大字」（实测 8-12K 被漏掉）；
 * title 允许在没有职位名称时用一句岗位描述兜底；删掉从未展示、又和业务领域抢内容的行业字段；
 * 城市与区/县要求拆成两级分别填。
 * v5（2026-10-06）：先抄 pageHeader 再提取；类别「技能」改称「知识」并按类拆句；
 * 一句话里并列的多个知识点 / 多段经验必须拆成多条；业务领域允许由全部信息归纳。
 * v6（2026-10-06）：改成「先在心里通读全文、再提取」并明确禁止按位置找信息（不同人截图范围不同，
 * 位置提示反而误导）；薪资按 K 报数、不折算成元；只提取「岗位要求」这一类内容，
 * 因此去掉 responsibilities / bonusPoints / source / pageHeader 四个字段；能力与知识的边界按「落脚点」重写。
 * v7（2026-10-06）：实测逐条核对后收紧三处——①「加分项」段落不提取（模型把它的句子当成了要求）；
 * ② importance 只在写「优先/加分/有则更好」时才算 NICE，「熟悉/了解」是要求的措辞不是加分信号
 * （实测把 JD 里的硬性要求判成了加分项，权重从 0.8 掉到 0.2）；③学历要求与意愿/态度类描述一律不提取
 * （学历无处安放，意愿类永远判不出来）。
 * v8（2026-10-06）：薪资只认带具体金额的表述——实测模型把福利清单里的「薪资优厚」当成了薪资。
 * v9（2026-10-07）：要求条目增加 requiredLevel（要求到什么程度），知识/能力两类才填、经验类恒为 null；
 * 能力名的复用候选从「已定义的能力维度」扩为「用户清单 ∪ 岗位侧已用过的名字」——
 * 能力清单解耦后岗位不再往个人侧写键，跨岗位命名收敛只能靠回注候选（03 §4.6）。
 * v10（2026-10-07）：判定口径与「重新判定」（judge-requirements-v2）对齐——v9 只教模型怎么填 requiredLevel，
 * 没说它进不进判定，于是首次提取按「有没有」判、重判按「够不够」判，同一个岗位点一次「重新评估」分数就变。
 * 另外补两条：判定结论不得影响提取范围（用户明显不具备的要求也要照原样提出来，少提一条缺口等于虚报匹配度）；
 * name 收紧为不带泛化后缀的规范短名（「Python 编程语言」「Kafka 消息队列工具」这类写法各自成键，
 * 会把同一项要求拆成多条，正是 04 里点名要防的「已掌握却被列为缺失」）。
 * v11（2026-10-10）：结论口径与 judge-requirements-v3 同步——程度不够（无论差几档）一律 PARTIAL，
 * GAP 只用于「资产里完全没有这项」，与界面上「不匹配（红）」的含义对齐。
 */

export const EXTRACT_JOB_PROMPT_VERSION = 'extract-job-v11'

const EXTRACT_JOB_SYSTEM_PROMPT_BASE = `你是招聘信息结构化助手。用户会给你某个岗位的截图和/或原文文本，请把它整理成一个 JSON 对象，只输出这个 JSON，不要输出任何解释文字，也不要用 Markdown 代码块包裹。

**先通读，再提取。** 心里按两步做，但**只输出第二步的结果**：
1. 把每张图、每段文字里可见的文字完整读一遍——包括标题、标签、括号里的补充说明、页脚的小字；
2. 只依据读到的这份文字填下面的字段，凡是这份文字里没有的，一律留空，不要凭常识补。

提取任何字段时，都以**信息自身的内容特征**为准（例如：写着金额与单位的就是薪资，写着年限与项目的就是经验要求），
不要假设某类信息一定出现在某个位置——不同的人截图范围不同，位置是不确定的。

输出结构：
{
  "companyName": "公司名称；原文没写则 null",
  "title": "职位描述：优先照抄招聘方写明的职位名称；没有名称或名称过于笼统时，依据岗位描述补一句概括。整体 30 字以内，不要留空",
  "salaryText": "如 8-12K、25k-35k·16薪；没有则 null",
  "salaryMin": 数字或 null,
  "salaryMax": 数字或 null,
  "salaryMonths": 数字或 null,
  "locationCity": "城市或 null",
  "locationDistrict": "区/县或 null；只有城市信息时填 null",
  "businessType": "业务领域：该岗位服务于什么业务场景，如 智能制造 / 工业视觉 / 三维检测 / 工业大模型 / C端 Agent 智能体",
  "requirements": ["类似「岗位要求」的原文条目（不含「岗位职责」与「加分项」段落），逐条保留原句，不要合并或改写"],
  "requirementItems": [
    {
      "kind": "SKILL（知识）或 ABILITY（能力）或 EXP（经验）",
      "name": "单个知识点的名字 / 能力名 / 经验要求的短标题（规范短名，不挂「编程语言」「工具」这类后缀）",
      "requirementText": "这条要求对应的**完整原文句子**，必须用原句",
      "importance": "MUST 或 NICE",
      "requiredLevel": "要求精通填 MASTER / 要求熟练填 PROFICIENT / 要求一般填 INTERMEDIATE；原文没写程度、或 kind 是 EXP 时填 null",
      "verdict": "MATCH 或 PARTIAL 或 GAP 或 null",
      "userNote": "对照用户资产的一句话判断，40 字以内；SKILL 一律 null"
    }
  ],
  "customFields": {}
}

三类要求怎么分（知识 / 能力 / 经验）——看这句话**在要求什么**，不要看它出现在哪一段：
- SKILL（知识）：**知道什么**——可指认的技术、语言、框架、工具、平台、原理、概念、标准。
  判断办法：它本身能不能作为一条独立的条目记进个人知识库。如 Python、LLM 基础原理、AI Agent 架构、
  LangChain、RAG、Prompt 工程、微服务、API 接口开发、CAD、数字孪生。
- ABILITY（能力）：**能做成什么事、具备什么素质**——句子的落脚点是「把某件事做到什么程度」或「是个什么样的人」，
  也可以是「会用某个工具做成一件事」：「能用 Kafka 做消息队列治理」是能力（name 写「消息队列治理」，
  工具名留在 requirementText 里），而「熟悉 Kafka」是知识。如 后端开发能力、任务编排与工具调用的落地能力、
  逻辑思维清晰、学习能力、跨团队协作、代码规范意识、技术方案主导。
- EXP（经验）：**做过什么**——与时间、经历、项目、场景绑定的要求。
  如 3 年以上后端经验、有 RAG 知识库搭建的项目或实习经验、有模型部署调试经验、有工业场景落地经历。

**这两类内容一律不提取**（哪一类里都不要出现，requirements 里也不要）：
- **学历要求**：学历层次、院校、专业、毕业届别（如「统招一本及以上学历」「计算机相关专业」「2025-2026 届应届毕业生」）——
  工具里没有学历字段，提出来也无处安放；
- **意愿、态度、性格**：如「愿意深耕工业 AI 方向」「对技术有热情」「抗压能力强」——这类描述无法由知识库、
  能力自评与履历判定，只会变成一条永远判不出来的 GAP。

**一句话里并列了多个知识点或多段经验时，必须拆成多条**，每条的 requirementText 都写那**完整的一句原文**：
- 「熟悉 LangChain、LangGraph、AutoGen、Dify 等任意一种 AI Agent 框架者优先」→ 4 条知识：LangChain / LangGraph / AutoGen / Dify。
- 「具备 RAG 知识库搭建、Prompt 工程、大模型应用开发、模型部署调试相关项目或实习经验优先」→ 4 条经验：RAG 知识库搭建 / Prompt 工程 / 大模型应用开发 / 模型部署调试。
- 「熟练掌握 Python 编程语言，具备基础的后端开发能力」→ 1 条知识（name 写「Python」）+ 1 条能力（「后端开发能力」）。
- 择一条件（「任意一种」「其中之一」）同样拆开，但每条的 requirementText 保留原句，让用户看得出这几条是并列可选项。
- 不要硬拆的情况：一个知识点带了一串修饰语（「多模态大模型的基础应用」是一条，不是两条）；
  但「熟悉 Python，能读写英文文档」这种两个独立要求仍要拆成 2 条。

规则：
1. 薪资只认**带具体金额**的表述（「8-12K」「15-25K·13薪」）：salaryText 照抄那句原文，salaryMin/salaryMax 按
   **K**（千元/月）报数——8-12K → 8 与 12；15-25K·13薪 → 15 与 25，且 salaryMonths 记 13；
   只给出年薪时除以 12 折算成月薪的 K 数（年薪 30 万 → 25）。
   **福利清单不是薪资**：「薪资优厚」「五险一金、带薪年假、节日福利、定期技术培训」这类没有具体金额的写法，
   salaryText 与 salaryMin/salaryMax 一律填 null；只有日薪/时薪，或写「面议」「薪资未公开」时同样填 null。
2. requirementItems 只提取**对任职者的要求**：描述需要具备什么知识、能力、经验、资历的句子。
   有两类内容不提取：① 这个岗位要做哪些工作（岗位职责）；② 标题写着「加分项」「加分条件」「优先条件」
   的那一段——那是「有则更好」的额外条件，不是岗位要求。一句话里同时含知识、能力、经验中的两类以上时，
   按类别分别提取。
3. importance 判定：只有**明确表示「有则更好」**的才填 NICE——也就是写着「优先」「加分」「有则更好」
   「更佳」的；写成「熟悉」「了解」「掌握」「精通」「具备」的只是要求的措辞，不是加分信号，一律 MUST。
   拿不准就填 MUST。
4. 同一个要求只输出一次；同一个知识点在多处出现时只保留一条（按上面规则拆出来的不同知识点不算重复）。
5. 拆出来的每条 name 只写**那一个点**的名字，不要把整句原文塞进 name，也不要在名字上挂泛化后缀：
   写「Python」「Kafka」「Docker」，不写「Python 编程语言」「Kafka 消息队列工具」「Docker 容器化技术」；
   写「后端开发能力」，不写「扎实的后端开发能力」。名字对不上，系统就会把用户已掌握的知识判成缺口。
6. 除第 12 条的 title 与第 13 条的 businessType 外，原文未提及的信息一律填 null 或空数组；严禁推测、补全或编造。
7. requirements 保留原文条目，不要合并、不要改写、不要省略。
8. **SKILL（知识）的 verdict 与 userNote 一律填 null**：知识是否匹配由系统本地比对自评等级，不需要你判断。
9. **ABILITY 与 EXP 必须给出 verdict 与 userNote**，且只能依据下面提供的《我的能力自评》《我的项目经验》判断：
   - 完全满足 → MATCH；有相关证据但不足（证据较弱、规模不够、或**程度没达到要求**）→ PARTIAL；
     资产中完全找不到相关证据 → GAP。
   - **程度也算数**（知识条目由系统按同一口径本地比对）：这条要求写了程度（要求栏不是 null）而用户自评的
     等级低于要求 → PARTIAL，**低一档还是低两档都是 PARTIAL**；GAP 只用于「资产里完全没有这项」。
     要求栏是 null 时只比有没有，不比程度。
   - userNote 要写明依据（例如「履历中有 2 年 FastAPI 高并发项目」）或明确写「个人资产中未提及相关经历」。
   - **严禁根据常识假设用户有某段经历**：写不出依据就必须判 GAP。求职场景里编造内容会直接损害用户。
   - 判定只决定 verdict 与 userNote，**不影响你提取哪些条目**：用户明显不具备的要求同样要照原样提出来——
     少提一条缺口，就等于把匹配度虚报高了一截。
10. ABILITY 的 name 必须优先从《可复用的能力名称》里选（那是用户已定义的能力与他之前录过的岗位里用过的名字，
    复用它们才能把不同岗位的同一项能力统计到一起）；确实没有合适的，才写一个新的短名称（6-12 字）。
11. requiredLevel 只依据原文中表示程度的词来填，**不要自己拔高也不要压低**——这个等级会按第 9 条参与判定，
    填错一档就会真的判错一档：
    「精通/深入/资深/专家」→ MASTER，「熟练」→ PROFICIENT，「一般/了解/熟悉/掌握」→ INTERMEDIATE。
    原文只说「具备某能力」「有某经验」而没写程度的，填 null——填 null 只是不比程度，不会让用户吃亏，
    但填高了会把够用的用户判成缺口。
12. title（职位描述）要尽量具体，让人一眼看出这个岗位做什么：优先照抄招聘方写明的职位名称
    （如「AI Agent开发工程师（应届生）」）；没有写名称或名称过于笼统（如「开发工程师」）时，
    依据岗位描述补一句概括（如「AI Agent开发工程师（工业大模型应用方向）」）。整体控制在 30 字以内，**不要留空**。
13. businessType（业务领域）是**这个岗位服务于什么业务**（智能制造、工业视觉、三维检测、工业大模型、C端 Agent 智能体…）。
    它往往不会明写「业务领域」四个字，需要依据全部可见信息**归纳**——这是少数允许归纳的字段，
    但归纳必须有原文依据，不能凭空编造；判断不出来才填 null。它既不是公司所属行业（「人工智能」「互联网」），
    也不是岗位职责的复述。
14. 城市与区/县分开填两级：写「南京·江宁区」时，locationCity 填「南京」，locationDistrict 填「江宁区」；
    只写到城市（「南京」）时，locationCity 填「南京」，locationDistrict 填 null，不要重复填城市名。`

export type AssetSummary = {
  /** 已掌握的知识项名称（展示名，不是归一化键） */
  skillNames: string[]
  /** 用户能力清单里的名字 */
  dimensionNames: string[]
  /** 岗位侧已用过的能力名（有上限）：解耦后跨岗位命名收敛的候选来源 */
  observedAbilityNames: string[]
  /** 我的能力自评：维度名 + 等级 */
  abilities: { name: string; level: ProficiencyLevel }[]
  /** 我的履历要点：一行一条 */
  experiences: string[]
}

export function buildExtractJobUserPrompt(options: {
  /** 随本消息附带的截图张数——它们属于同一个岗位，模型必须合并成一条记录 */
  imageCount: number
  hasText: boolean
  assets: AssetSummary
}): string {
  const parts: string[] = []

  if (options.imageCount > 1 && options.hasText) {
    parts.push(
      `随本消息附带的 ${options.imageCount} 张招聘页面截图是同一个岗位的不同部分，` +
      '请与下方的岗位原文文本合起来，只提取这一个岗位的信息。',
    )
  } else if (options.imageCount > 1) {
    parts.push(
      `随本消息附带的 ${options.imageCount} 张招聘页面截图属于同一个岗位，` +
      '请把它们拼合起来提取这一个岗位的信息，只输出一条记录，不要按截图拆分。',
    )
  } else if (options.imageCount === 1 && options.hasText) {
    parts.push('请结合随本消息附带的招聘页面截图，与下方的岗位原文文本，一起提取岗位信息。')
  } else if (options.imageCount === 1) {
    parts.push('请从随本消息附带的招聘页面截图中提取岗位信息。')
  } else {
    parts.push('请从下方的岗位原文中提取岗位信息。')
  }

  const { assets } = options

  parts.push(
    `【已掌握的知识】\n${assets.skillNames.length > 0 ? assets.skillNames.join('、') : '（尚未录入任何知识项）'}\n` +
    '提取 SKILL（知识）时，若岗位中出现同一知识点，name 请照用上面的写法，不要另造一个更长的说法，' +
    '便于系统比对。',
  )

  // 候选名 = 用户能力清单 ∪ 岗位侧已用过的名字。前者保证与用户自评对齐，
  // 后者保证不同岗位提过的同一项能力落到同一个名字上（否则缺口统计会把它们拆开）。
  const abilityCandidates = [...new Set([...assets.dimensionNames, ...assets.observedAbilityNames])]
  parts.push(
    `【可复用的能力名称】\n${abilityCandidates.length > 0 ? abilityCandidates.join('、') : '（暂无）'}`,
  )

  if (assets.abilities.length > 0) {
    const lines = assets.abilities.map(
      (ability) => `- ${ability.name}：${PROFICIENCY_LABEL[ability.level]}`,
    )
    parts.push(`【我的能力自评】\n${lines.join('\n')}`)
  } else {
    parts.push('【我的能力自评】（尚未录入：ABILITY 类要求一律判 GAP，并说明资产中未提及）')
  }

  if (assets.experiences.length > 0) {
    parts.push(`【我的项目经验】\n${assets.experiences.map((line) => `- ${line}`).join('\n')}`)
  } else {
    parts.push('【我的项目经验】（尚未录入：EXP 类要求一律判 GAP，并说明资产中未提及）')
  }

  return parts.join('\n\n')
}

export type CustomFieldSpec = {
  fieldName: string
  fieldLabel: string
  fieldType: string
  hint: string | null
}

/**
 * 动态字段注入（暂缓特性）：把用户在设置页定义的字段拼进提取说明。
 * 未配置任何字段时，提示词与默认完全一致——不引入额外复杂度。
 */
export function buildExtractJobSystemPrompt(fields: readonly CustomFieldSpec[]): string {
  const base =
    fields.length === 0
      ? EXTRACT_JOB_SYSTEM_PROMPT_BASE
      : `${EXTRACT_JOB_SYSTEM_PROMPT_BASE}

自定义字段：除了上面的标准字段外，还要在 customFields 对象中提取以下字段：
${fields
        .map((field) => {
          const hint = field.hint ? `；${field.hint}` : ''
          return `- ${field.fieldLabel}（${field.fieldName}，${field.fieldType} 类型）${hint}`
        })
        .join('\n')}
自定义字段同样遵守第 6 条规则：原文没有提及的，值一律填「未提及」，严禁推测或编造。`

  return base
}
