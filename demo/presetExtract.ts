import { PROFICIENCY_LABEL, type ProficiencyLevel } from '@shared/schemas/common'

/**
 * 演示模式的岗位提取：从用户粘贴的 JD 原文里就地整理出一份结构化草稿。
 *
 * 为什么不是"返回一段事先录好的 JSON"：演示站里用户粘什么 JD 是无法预料的，
 * 回一段固定内容会立刻穿帮（标题与原文对不上）。这里做的是**真的在解析**，
 * 只是把"交给大模型判断"换成了启发式规则——所以同一份 JD 在本地跑和演示站跑，
 * 结构一致、内容各有依据，差别只在判别力（规则比模型笨，这是明摆着的）。
 *
 * 规则是照着 server/llm/prompts/extractJob.ts 那份提示词的判据写的，
 * 连"不提取职责与加分项"这种边界也照做——演示站如果比本地宽松，
 * 面试官看到的就是一个并不存在的能力。
 */

export type DemoAssets = {
  /** 已掌握的知识项名称 */
  skills: string[]
  /** 能力自评：名称 + 中文等级 */
  abilities: { name: string; level: string }[]
  /** 项目经验：一行一条 */
  experiences: string[]
}

/**
 * 个人资产那几节都排在「岗位原文：」之前，判定只能看这之前的文字。
 *
 * 不切开的话，最后一个【我的项目经验】小节会一路吃到 JD 正文里，
 * 于是"JD 里的那句要求"变成了"你的履历里有这句" —— 拿岗位原文给自己判匹配，
 * 结果全部条目都成 MATCH。这个 bug 在界面上看不出来（分数只会虚高），
 * 正是这工具最不能出的那种错。
 */
export function assetBlock(prompt: string): string {
  const index = prompt.indexOf('岗位原文：')
  return index < 0 ? prompt : prompt.slice(0, index)
}

/** 取出提示词里 `【标题】` 那一小节的内容（下一节标题之前） */
export function section(text: string, title: string): string {
  const marker = `【${title}】`
  const start = text.indexOf(marker)
  if (start < 0) return ''
  const rest = text.slice(start + marker.length)
  const next = rest.indexOf('【')
  return (next < 0 ? rest : rest.slice(0, next)).trim()
}

function bulletLines(block: string): string[] {
  return block
    .split('\n')
    .map((line) => line.replace(/^[-•·*\d.、)\s]+/, '').trim())
    .filter((line) => line !== '' && !line.startsWith('（'))
}

/** 拼装一份"从提示词里读到的个人资产"。规则判定只能靠这些线索，读不到就一律判缺口 */
export function parseAssets(prompt: string): DemoAssets {
  const skillBlock = section(prompt, '已掌握的知识')
  const abilityBlock = section(prompt, '我的能力自评')
  const experienceBlock = section(prompt, '我的项目经验')

  const skills = skillBlock.includes('尚未录入') ? [] : skillBlock.split('、').map((s) => s.trim()).filter(Boolean)

  const abilities = bulletLines(abilityBlock)
    .map((line) => {
      const [name, level] = line.split('：')
      return { name: (name ?? '').trim(), level: (level ?? '').trim() }
    })
    .filter((item) => item.name !== '')

  return { skills, abilities, experiences: bulletLines(experienceBlock) }
}

const LEVEL_WORDS: { pattern: RegExp; level: ProficiencyLevel }[] = [
  { pattern: /精通|深入|资深|专家/, level: 'MASTER' },
  { pattern: /熟练/, level: 'PROFICIENT' },
  { pattern: /熟悉|掌握|一般|了解/, level: 'INTERMEDIATE' },
]

/** 程度词 → requiredLevel。原文没写程度就填 null，让判定只比"有没有" */
function levelFromText(text: string): ProficiencyLevel | null {
  for (const { pattern, level } of LEVEL_WORDS) {
    if (pattern.test(text)) return level
  }
  return null
}

/** 一句话只留名称：去掉引导动词、语气词与后半段解释 */
const LEADING_NOISE =
  /^(熟练掌握|熟悉|精通|了解|掌握|具备|具有|拥有|有|要求|需要|能|能够|会|善于|良好的|较强的|扎实的|一定的|至少)+/

function toName(clause: string): string {
  let name = clause.trim().replace(LEADING_NOISE, '').trim()
  name = name.split(/[，,：:（(【[]/)[0] ?? name
  // 「PostgreSQL、Redis 等常用存储」里的"等…"是举例的尾巴，不是名字的一部分
  name = name.replace(/\s*等(等)?.*$/, '')
  name = name.replace(/(者优先|优先考虑|优先|加分项?|更佳|有则更好)$/g, '').trim()
  return name
}

type Kind = 'SKILL' | 'ABILITY' | 'EXP'

function classify(name: string, sentence: string): Kind {
  // 与时间、经历、项目绑定的要求归为经验（提示词第 3 条）
  if (/\d+\s*年|经验|经历|实习|项目经历|落地经历/.test(sentence)) return 'EXP'
  if (/能力|思维|意识|沟通|协作|表达|学习能力|自驱/.test(name)) return 'ABILITY'
  if (/能力|素质|思维/.test(sentence) && !/框架|语言|数据库|工具|平台|原理/.test(name)) return 'ABILITY'
  return 'SKILL'
}

/** 小节标题（「岗位要求：」「任职要求」这类）本身不是要求，别把它当成一条提出来 */
const SECTION_HEADING = /^(岗位|任职|职位|招聘)?(要求|需求|条件|职责|描述|内容)[:：]?$/

/** 这一句是不是"对任职者的要求"——职责、加分项、学历与意愿类都要排除 */
function isRequirement(sentence: string): boolean {
  if (sentence.length < 4) return false
  if (SECTION_HEADING.test(sentence)) return false
  // 岗位职责：这个岗位要做什么，不是对任职者的要求
  if (/^(负责|参与|协助|配合|完成|你将|工作内容|岗位职责|职责描述|我们希望你做)/.test(sentence)) return false
  // 学历与专业：工具里没有对应字段，提出来也无处安放
  if (/学历|统招|本科|硕士|博士|大专|专科|院校|专业要求|应届|毕业|届生/.test(sentence)) return false
  // 意愿、态度、性格：知识库、能力自评与履历都判不出来
  if (/愿意|热爱|热情|抗压|责任心|积极主动|性格|态度端正|吃苦/.test(sentence)) return false
  return /熟悉|掌握|精通|了解|具备|具有|要求|经验|能力|优先|加分|善于|能够|能独立/.test(sentence)
}

/** 拆句：换行、句号、分号都算边界 */
function splitSentences(text: string): string[] {
  return text
    .split(/[\n。；;！!？?]+/)
    .map((line) => line.replace(/^[-•·*\d.、)\s]+/, '').trim())
    .filter(Boolean)
}

/** 去掉「加分项」那一段——提示词明确规定它不算岗位要求 */
function stripBonusSection(text: string): string {
  const lines = text.split('\n')
  const index = lines.findIndex((line) => /加分项|加分条件|优先条件|有以下条件者优先/.test(line.trim()))
  if (index < 0) return text
  // 从标题行起截断：那一段的内容与"要求"界限模糊，宁可不提
  return lines.slice(0, index).join('\n')
}

/** 分句自带的要求动词——一句话里几个分句都以此开头，就是并列的多条要求 */
const CLAUSE_VERB =
  /^(熟悉|熟练掌握|掌握|精通|了解|具备|具有|有|要求|能|能够|善于|至少|会|参与过)/

/**
 * 一句话里并列了两个独立要求时拆成两条（提示词第 5 条）。
 * 「熟悉 Docker 容器化部署，了解 K8s 者优先」是两个要求，不是一条；
 * 但只要有一个分句不是要求（例如后半句在解释原因），就整句当作一条，不乱拆。
 */
function requirementClauses(sentence: string): string[] {
  const clauses = sentence
    .split(/[，,]/)
    .map((clause) => clause.trim())
    .filter(Boolean)
  if (clauses.length < 2) return [sentence]
  return clauses.every((clause) => CLAUSE_VERB.test(clause)) ? clauses : [sentence]
}

/** 一句话里并列了多个知识点时拆成多条（提示词第 5 条） */
function splitParallel(head: string, sentence: string): string[] {
  if (!head.includes('、')) return [head]

  const parts = head
    .split('、')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2 || parts.length > 6) return [head]

  // 长度看的是去掉引导动词之后的样子：「熟练掌握 PostgreSQL」要按「PostgreSQL」算
  const lengths = parts.map((part) => part.replace(LEADING_NOISE, '').trim().length)
  if (!lengths.every((length) => length >= 2 && length <= 12)) return [head]

  // 只有一个点时也可能是排比（「Java、Go 任一」），但拿不准就不拆——宁少勿错
  if (!/任意一种|其中之一|任选|或类似|等$|等[^，,。]/.test(sentence)) return [head]
  return parts
}

function verdictFromAssets(
  kind: 'ABILITY' | 'EXP',
  name: string,
  assets: DemoAssets,
): { verdict: 'MATCH' | 'PARTIAL' | 'GAP'; note: string } {
  const pool = kind === 'ABILITY' ? assets.abilities.map((a) => `${a.name}：${a.level}`) : assets.experiences

  const hit = pool.find((line) => line.includes(name))
  if (hit !== undefined) return { verdict: 'MATCH', note: `个人资产中有相关记录：${hit.slice(0, 24)}` }

  // 名称没直接命中，就看有没有共享的关键片段——有则只算"相关但不足"
  const grams = name.length >= 2 ? Array.from({ length: name.length - 1 }, (_, i) => name.slice(i, i + 2)) : []
  const related = pool.find((line) => grams.filter((gram) => line.includes(gram)).length >= 2)
  if (related !== undefined) {
    return { verdict: 'PARTIAL', note: `个人资产中相关但不等同：${related.slice(0, 24)}` }
  }
  return { verdict: 'GAP', note: '个人资产中未提及相关经历' }
}

const CITY_PATTERN =
  /(北京|上海|深圳|广州|杭州|南京|成都|武汉|西安|苏州|天津|重庆|长沙|郑州|合肥|厦门|青岛|宁波|无锡|东莞|佛山|济南|福州|大连|沈阳|昆明|南昌|贵阳|石家庄|太原|南宁|常州|温州|珠海)市?/

const BUSINESS_HINTS: { pattern: RegExp; label: string }[] = [
  { pattern: /大模型|LLM|Agent|智能体|AIGC|人工智能/, label: '大模型与智能体应用' },
  { pattern: /工业|制造|产线|智能制造|数字孪生/, label: '智能制造' },
  { pattern: /电商|商城|交易|订单/, label: '电商交易' },
  { pattern: /金融|银行|支付|风控/, label: '金融科技' },
  { pattern: /医疗|健康|医药/, label: '医疗健康' },
  { pattern: /游戏/, label: '游戏' },
  { pattern: /教育|培训|课程/, label: '在线教育' },
]

function detectBusinessType(text: string): string | null {
  for (const hint of BUSINESS_HINTS) {
    if (hint.pattern.test(text)) return hint.label
  }
  return null
}

export type ExtractedPayload = {
  companyName: string | null
  title: string
  salaryText: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryMonths: number | null
  locationCity: string | null
  locationDistrict: string | null
  businessType: string | null
  requirements: string[]
  requirementItems: {
    kind: Kind
    name: string
    requirementText: string
    importance: 'MUST' | 'NICE'
    requiredLevel: ProficiencyLevel | null
    verdict: 'MATCH' | 'PARTIAL' | 'GAP' | null
    userNote: string | null
  }[]
  customFields: Record<string, string>
}

export function extractFromPrompt(prompt: string): ExtractedPayload {
  const jd = prompt.split('岗位原文：')[1]?.trim() ?? prompt
  // 资产只从「岗位原文」之前的那几节里读，见 assetBlock 的说明
  const assets = parseAssets(assetBlock(prompt))
  const body = stripBonusSection(jd)
  const sentences = splitSentences(body)

  const requirementSentences = sentences.filter(isRequirement)

  const requirementItems: ExtractedPayload['requirementItems'] = []
  const seen = new Set<string>()

  for (const sentence of requirementSentences) {
    for (const clause of requirementClauses(sentence)) {
      const head = clause.split(/[。：:]/)[0] ?? clause
      if (head === '') continue

      // 先按并列拆开、再逐个清洗：反过来的话，「PostgreSQL、Redis 等常用存储」会先被
      // 整条按长度截断（截到 "Redis" 的半个词），拆出来的名字就再也对不上了
      for (const raw of splitParallel(head, clause)) {
        const name = toName(raw)
        if (name === '' || name.length < 2 || name.length > 20) continue
        const kind = classify(name, clause)
        const key = `${kind}:${name}`
        if (seen.has(key)) continue
        seen.add(key)

        const judged =
          kind === 'SKILL'
            ? { verdict: null, note: null }
            : (() => {
                const outcome = verdictFromAssets(kind, name, assets)
                return { verdict: outcome.verdict, note: outcome.note }
              })()

        requirementItems.push({
          kind,
          name,
          // 拆出来的每条都写回**完整的那句原文**，用户才看得出这几条是并列的
          requirementText: sentence,
          // 加分信号按分句判：整句里出现「优先」，不该把同句的另一条硬性要求也降成加分项
          importance: /优先|加分|更佳|有则更好/.test(clause) ? 'NICE' : 'MUST',
          requiredLevel: kind === 'EXP' ? null : levelFromText(clause),
          verdict: judged.verdict,
          userNote: judged.note,
        })
      }
    }
  }

  // 薪资只认带具体金额的写法，「薪资优厚」这类不算（提示词第 1 条）
  const range = /(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)\s*[Kk千]/.exec(body)
  const single = /(\d+(?:\.\d+)?)\s*[Kk千](?![瓦])/.exec(body)
  const months = /[·・\s]?(\d{2})\s*薪/.exec(body)
  const salaryMin = range ? Number(range[1]) : single ? Number(single[1]) : null
  const salaryMax = range ? Number(range[2]) : single ? Number(single[1]) : null
  const salaryText = range ? `${range[1]}-${range[2]}K` : single ? `${single[1]}K` : null

  const city = CITY_PATTERN.exec(body)
  const district = /([一-龥]{2,4})(区|县)(?![域间])/.exec(body)

  // 公司名：招聘页的抬头一行通常写作「矩光科技 · 南京 · 江宁区」，
  // 所以不能只认"以公司后缀结尾"的整行，要从前缀里认出公司主体。
  // 限定短行是为了不把某条碰巧带"科技"二字的要求当成公司名。
  const COMPANY_TAIL = '有限公司|集团|科技|网络|信息技术|软件|研究院|股份|事业部'
  const companyLine = sentences.find(
    (line) => line.length <= 40 && new RegExp(COMPANY_TAIL).test(line),
  )
  const companyName =
    companyLine === undefined
      ? null
      : (new RegExp(`^([^\\s·，,、]{2,20}?(?:${COMPANY_TAIL}))`).exec(companyLine)?.[1] ??
        companyLine.slice(0, 20))

  // 标题：优先照抄写明的职位名称，其次从描述里挑出岗位词，最后兜底一句概括（不能留空）
  const named = /(?:职位名称|岗位名称|招聘岗位)[:：]\s*([^\n，,。]{2,30})/.exec(body)
  const roleWord = /((?:[A-Za-z一-龥]{0,10})?(?:工程师|开发|产品经理|设计师|分析师|架构师|运营|测试|实习生|顾问|专员|主管|专家))/.exec(
    body,
  )
  const title = named?.[1]?.trim() ?? roleWord?.[1]?.trim() ?? sentences[0]?.slice(0, 30) ?? '未识别名称的岗位'

  return {
    companyName,
    title,
    salaryText,
    salaryMin,
    salaryMax,
    salaryMonths: months ? Number(months[1]) : null,
    locationCity: city?.[1] ?? null,
    locationDistrict: district?.[1] !== undefined && district[1] !== city?.[1] ? `${district[1]}${district[2]}` : null,
    businessType: detectBusinessType(body),
    requirements: requirementSentences.slice(0, 40),
    requirementItems,
    customFields: {},
  }
}

/** 给界面用的一句话说明：这份演示草稿是怎么来的 */
export function describeExtraction(payload: ExtractedPayload): string {
  const counts = {
    SKILL: payload.requirementItems.filter((item) => item.kind === 'SKILL').length,
    ABILITY: payload.requirementItems.filter((item) => item.kind === 'ABILITY').length,
    EXP: payload.requirementItems.filter((item) => item.kind === 'EXP').length,
  }
  const levels = payload.requirementItems
    .map((item) => item.requiredLevel)
    .filter((level): level is ProficiencyLevel => level !== null)
    .map((level) => PROFICIENCY_LABEL[level])
  return `知识 ${counts.SKILL} · 能力 ${counts.ABILITY} · 经验 ${counts.EXP}${
    levels.length === 0 ? '' : ` · 提到程度 ${[...new Set(levels)].join('/')}`
  }`
}
