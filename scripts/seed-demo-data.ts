/**
 * 演示数据播种脚本（一次性工具，**不属于运行时**：服务端不 import 它，只在手动执行时跑一次）。
 *
 * 为什么是「脚本调接口」而不是「直接写库」或「服务端启动时播种」：
 *  - 岗位走 `POST /api/jobs`——正是前端「岗位录入 → 确认入库」那一步的接口，
 *    落库的数据与手动录入的完全同形：前端可以照常改状态、改分类、批量删除；
 *  - 个人侧（知识项 / 能力维度与自评 / 项目经验）走同一批公开接口；
 *  - 服务端代码里不留任何种子逻辑，数据只存在于 data/ 里，删掉这些记录不影响任何代码。
 *
 * 一个刻意的取舍：岗位的 requirementItems 由本文件直接给出（等价于「解析并预览」拿到草稿后
 * 点「确认入库」）。没有走 LLM 解析接口——不消耗 API 额度、结果确定，能把全部投递状态与匹配档位铺满。
 *
 * 幂等：按分类名 / 知识项名 / 能力维度名 / 项目描述 / 公司+职位 比对已有数据，已存在的跳过。
 * 重复执行不会制造重复记录。
 *
 * **唯一的例外**是「已录入天数」的回填（见 backdateJobs）：入库接口把 created_at 写死成「此刻」，
 * 公开接口造不出「25 天前录入」的数据，只能直接改库。它不参与任何匹配计算。
 *
 * 用法（服务端需先启动）：
 *   node --import tsx scripts/seed-demo-data.ts
 *   SEED_BASE_URL=http://127.0.0.1:8787 node --import tsx scripts/seed-demo-data.ts
 * 数据目录默认取 ./data，可用 JOBANALYZER_DATA_DIR 指定（回填那一步要读写它）。
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const BASE = (process.env.SEED_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')

/* ------------------------------------------------------------------ 接口小工具 */

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch (cause) {
    throw new Error(`无法连接本地服务（${BASE}${path}）：${(cause as Error).message}`)
  }

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error
    throw new ApiError(response.status, error?.code ?? 'UNKNOWN', error?.message ?? `HTTP ${response.status}`)
  }
  return payload as T
}

const get = <T>(path: string) => call<T>('GET', path)
const post = <T>(path: string, body: unknown) => call<T>('POST', path, body)
const patch = <T>(path: string, body: unknown) => call<T>('PATCH', path, body)
const put = <T>(path: string, body: unknown) => call<T>('PUT', path, body)

/* ------------------------------------------------------------------ 数据类型 */

type Level = 'MASTER' | 'PROFICIENT' | 'INTERMEDIATE'
type Kind = 'SKILL' | 'ABILITY' | 'EXP'
type Verdict = 'MATCH' | 'PARTIAL' | 'GAP'

type Item = {
  kind: Kind
  name: string
  /** 岗位要求原文（照抄 JD 里那句） */
  text: string
  importance: 'MUST' | 'NICE'
  /** 要求程度；原文没写程度时省略（EXP 一律省略——个人侧只有项目与时长） */
  level?: Level
  /** 仅 ABILITY / EXP：对照个人资产的判词；SKILL 不写（由系统本地比对） */
  verdict?: Verdict
  note?: string
}

type JobSeed = {
  category: string
  companyName: string
  title: string
  city: string
  district?: string
  salaryText: string
  salaryMin?: number
  salaryMax?: number
  salaryMonths?: number
  businessType: string
  url?: string
  status: 'NOT_APPLIED' | 'APPLIED' | 'INTERVIEWING' | 'OFFER' | 'REJECTED' | 'CLOSED'
  /** 目标综合匹配档位：播种后按接口返回的实际分数核对，落错档会报 ✗ */
  tier: 'perfect' | 'excellent' | 'good' | 'medium' | 'low' | 'poor' | 'unevaluated'
  /**
   * 「已录入 N 天」的 N：入库接口把它写死成 0，这里给出目标值供回填。
   * 三档配色见 web/lib/palette.ts 的 stalenessTone（≤10 天翠绿 / ≤20 天黄 / 更久玫瑰）。
   */
  ageDays: number
  items: Item[]
}

/* --------------------------------------------------------------- 个人资产 */

const SKILLS: { name: string; level: Level | null; acquiredAt: string | null }[] = [
  { name: 'Python', level: 'MASTER', acquiredAt: '2021-07-12' },
  { name: 'FastAPI', level: 'PROFICIENT', acquiredAt: '2022-09-05' },
  { name: 'Django', level: 'INTERMEDIATE', acquiredAt: '2022-02-18' },
  { name: 'PostgreSQL', level: 'PROFICIENT', acquiredAt: '2022-06-20' },
  { name: 'MySQL', level: 'INTERMEDIATE', acquiredAt: '2021-11-08' },
  { name: 'Redis', level: 'PROFICIENT', acquiredAt: '2022-11-15' },
  // 刻意留一项没标等级的老数据：熟练度没有「未标注」这一档，界面与判定都按「一般」计
  { name: 'Kafka', level: null, acquiredAt: null },
  { name: 'Docker', level: 'PROFICIENT', acquiredAt: '2023-01-09' },
  { name: 'Kubernetes', level: 'INTERMEDIATE', acquiredAt: '2023-09-23' },
  { name: 'Linux', level: 'PROFICIENT', acquiredAt: '2021-08-30' },
  { name: 'Git', level: 'MASTER', acquiredAt: '2021-07-12' },
  { name: 'CI/CD', level: 'PROFICIENT', acquiredAt: '2023-05-16' },
  { name: 'Pytest', level: 'MASTER', acquiredAt: '2022-03-11' },
  { name: 'Selenium', level: 'PROFICIENT', acquiredAt: '2022-05-24' },
  { name: 'Playwright', level: 'INTERMEDIATE', acquiredAt: '2024-09-02' },
  { name: 'LangChain', level: 'PROFICIENT', acquiredAt: '2024-03-18' },
  { name: 'RAG', level: 'PROFICIENT', acquiredAt: '2024-05-27' },
  { name: 'Prompt 工程', level: 'MASTER', acquiredAt: '2024-02-06' },
  { name: '向量数据库', level: 'INTERMEDIATE', acquiredAt: '2024-08-14' },
  { name: 'TypeScript', level: 'INTERMEDIATE', acquiredAt: '2023-03-21' },
]

/**
 * 能力清单。**每一项都写等级**：熟练度没有「未自评」这一档，
 * 维度建了就等于有这一项能力（没写的按「一般」计，见 server/services/abilityStore.ts）。
 *
 * 刻意**不留**「需求分析与拆解」这一项：岗位侧有 4 家明确要求它，而我的能力清单里
 * 根本没有 —— 这才是「不匹配」现在唯一的含义（完全没有），
 * 雷达图上该维度「我的当前匹配」为 0，缺口榜上它是一条真实短板。
 */
const ABILITIES: { name: string; level: Level; note?: string }[] = [
  { name: '后端服务开发', level: 'MASTER', note: '主导跨境电商订单服务重构，核心链路 QPS 提升 3 倍' },
  { name: '系统架构设计', level: 'PROFICIENT', note: '负责企业知识库问答应用的整体方案设计' },
  { name: '自动化测试体系搭建', level: 'PROFICIENT', note: '从 0 搭建接口自动化体系，用例 400+' },
  { name: '问题定位与排查', level: 'PROFICIENT', note: '习惯用链路日志 + 最小复现用例定位线上问题' },
  { name: '性能优化', level: 'INTERMEDIATE', note: '做过慢查询治理与多级缓存优化' },
  { name: '跨团队协作', level: 'INTERMEDIATE', note: '与产品、算法、测试多角色长期协作' },
  { name: '技术方案主导', level: 'PROFICIENT', note: '主导过 2 个中等规模模块的技术方案评审' },
]

const EXPERIENCES: { project: string; durationMonths: number }[] = [
  {
    project:
      '主导跨境电商后台订单服务的重构：用 FastAPI + PostgreSQL 重写下单与履约核心链路，QPS 从 600 提升到 1800；同期搭建 Pytest 接口自动化用例 400+，回归时间从 2 天压缩到 2 小时。',
    durationMonths: 18,
  },
  {
    project:
      '从 0 搭建企业知识库问答应用：LangChain + 向量库检索 + Prompt 调优，覆盖 3000+ 份内部文档，上线后重复咨询类工单下降约 30%。',
    durationMonths: 12,
  },
  {
    project:
      '参与 AI Agent 平台的任务编排模块：工具调用链路的失败重试与可观测性建设，技术栈 Python + Redis + Kafka。',
    durationMonths: 8,
  },
]

/* --------------------------------------------------------------- 岗位数据 */

/**
 * 20 个岗位，覆盖 4 个分类 / 5 个城市 / 6 种投递状态 / 6 个匹配档位 + 1 个「无法评估」。
 * 每个岗位的目标档位写在 tier 上，脚本结尾按接口返回的实际分数核对。
 */
const JOBS: JobSeed[] = [
  /* ---------------------------------------------------- AI Agent 开发 */
  {
    category: 'AI Agent 开发',
    companyName: '矩瞳科技',
    title: 'AI Agent 开发工程师（工业大模型方向）',
    city: '南京',
    district: '江宁区',
    salaryText: '25k-35k·14薪',
    salaryMin: 25000,
    salaryMax: 35000,
    salaryMonths: 14,
    businessType: '工业大模型与智能质检',
    url: 'https://www.zhipin.com/job_detail/4f8c1a23d9.html',
    status: 'OFFER',
    tier: 'perfect',
    ageDays: 34,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟悉 Python，具备良好的编码习惯与工程化意识', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'LangChain', text: '熟悉 LangChain，有 AI Agent 应用开发经验', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'RAG', text: '熟悉 RAG 检索增强生成，了解召回与重排的基本方法', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Prompt 工程', text: '掌握 Prompt 工程方法，能独立完成提示词设计与效果评测', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Docker', text: '熟悉 Docker 容器化部署', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备扎实的后端服务开发能力，能独立承担模块的设计与实现',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '订单服务重构与 RAG 应用接口均由本人实现，能力充足',
      },
      {
        kind: 'ABILITY',
        name: '系统架构设计',
        text: '具备系统架构设计能力，能对 Agent 链路做整体规划',
        importance: 'NICE',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '知识库问答应用的整体方案由本人设计',
      },
      {
        kind: 'EXP',
        name: 'LLM 应用落地经验',
        text: '有 LLM 应用从 0 到 1 的落地经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '有 RAG 知识库问答从 0 到 1 的完整项目（12 个月）',
      },
    ],
  },
  {
    category: 'AI Agent 开发',
    companyName: '智谱轻舟',
    title: '大模型应用开发工程师（RAG 方向）',
    city: '上海',
    district: '浦东新区',
    salaryText: '30k-45k·13薪',
    salaryMin: 30000,
    salaryMax: 45000,
    salaryMonths: 13,
    businessType: '企业知识库与智能问答',
    url: 'https://www.zhipin.com/job_detail/9b21ee74a0.html',
    status: 'APPLIED',
    tier: 'excellent',
    ageDays: 12,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟悉 Python，能写出可维护的服务端代码', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'LangChain', text: '熟悉 LangChain 及其生态组件的使用', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'RAG', text: '熟悉 RAG 全链路：切分、召回、重排、评估', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: '向量数据库', text: '掌握向量数据库的使用与索引调优', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Elasticsearch', text: '了解 Elasticsearch 的检索与聚合查询', importance: 'NICE', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '系统架构设计',
        text: '具备系统架构设计能力，能独立完成应用级方案设计',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '知识库问答应用从 0 到 1 的方案由本人设计',
      },
      {
        kind: 'ABILITY',
        name: '技术方案主导',
        text: '具备技术方案主导能力，能推动方案评审与落地',
        importance: 'NICE',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '主导过 2 个中等规模模块的方案评审',
      },
      {
        kind: 'EXP',
        name: 'RAG 知识库搭建',
        text: '有 RAG 知识库搭建的项目经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '企业知识库问答项目覆盖 3000+ 份文档',
      },
      {
        kind: 'EXP',
        name: '模型部署调试',
        text: '有模型部署与推理调试经验（vLLM、Ollama 等）',
        importance: 'NICE',
        verdict: 'GAP',
        note: '个人资产中未提及模型部署与推理调优经历',
      },
    ],
  },
  {
    category: 'AI Agent 开发',
    companyName: '云枢智能',
    title: 'AI 应用后端工程师',
    city: '杭州',
    district: '余杭区',
    salaryText: '28k-40K',
    salaryMin: 28000,
    salaryMax: 40000,
    businessType: '智能客服与对话中台',
    status: 'INTERVIEWING',
    tier: 'good',
    ageDays: 9,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟悉 Python，熟悉异步编程模型', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'FastAPI', text: '熟练使用 FastAPI 开发后端服务', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'PostgreSQL', text: '熟悉 PostgreSQL，能写复杂查询与索引优化', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Redis', text: '熟悉 Redis 的常用数据结构与缓存设计', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Dify', text: '了解 Dify 等低代码 Agent 编排平台', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备后端服务开发能力，能独立完成接口设计与实现',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '订单服务与知识库应用的接口均由本人实现',
      },
      {
        kind: 'ABILITY',
        name: '性能优化',
        text: '具备性能优化能力，能定位并解决接口耗时问题',
        importance: 'NICE',
        level: 'PROFICIENT',
        verdict: 'PARTIAL',
        note: '自评一般，做过慢查询治理但未做过系统级性能专项',
      },
      {
        kind: 'EXP',
        name: '后端服务开发经验',
        text: '有后端服务从设计到上线的完整经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '订单服务重构项目完整覆盖设计与上线（18 个月）',
      },
    ],
  },
  {
    category: 'AI Agent 开发',
    companyName: '启明数据',
    title: 'LLM 平台开发工程师',
    city: '北京',
    salaryText: '35k-50k·16薪',
    salaryMin: 35000,
    salaryMax: 50000,
    salaryMonths: 16,
    businessType: '大模型训练与推理平台',
    url: 'https://jobs.51job.com/beijing/158200431.html',
    status: 'NOT_APPLIED',
    tier: 'medium',
    ageDays: 3,
    items: [
      { kind: 'SKILL', name: 'Python', text: '精通 Python，具备大型项目开发经验', importance: 'MUST', level: 'MASTER' },
      { kind: 'SKILL', name: 'LangChain', text: '熟练掌握 LangChain 的组件化开发', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'RAG', text: '熟悉 RAG 链路与召回评估', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Kubernetes', text: '熟练使用 Kubernetes 部署与管理服务', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Go', text: '熟悉 Go 语言，能读写平台侧服务代码', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备后端服务开发能力，能承接平台侧模块',
        importance: 'MUST',
        level: 'MASTER',
        verdict: 'MATCH',
        note: '订单服务重构项目的主程，能力充足',
      },
      {
        kind: 'ABILITY',
        name: '系统架构设计',
        text: '具备系统架构设计能力',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '知识库问答应用的整体方案由本人设计',
      },
      {
        kind: 'ABILITY',
        name: '技术方案主导',
        text: '具备技术方案主导能力，能推动跨团队方案落地',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '主导过 2 个中等规模模块的技术方案',
      },
      {
        kind: 'ABILITY',
        name: '跨团队协作',
        text: '具备跨团队协作能力',
        importance: 'MUST',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '与产品、算法、测试多角色长期协作',
      },
      {
        kind: 'ABILITY',
        name: '需求分析与拆解',
        text: '具备需求分析与拆解能力，能承接模糊需求',
        importance: 'MUST',
        level: 'INTERMEDIATE',
        verdict: 'GAP',
        note: '个人资产中未提及相关经历',
      },
      {
        kind: 'EXP',
        name: '后端开发经验',
        text: '3 年以上后端开发经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '履历累计后端开发 38 个月',
      },
      {
        kind: 'EXP',
        name: '平台类项目经验',
        text: '有平台类产品的开发经验',
        importance: 'MUST',
        verdict: 'PARTIAL',
        note: '参与过 Agent 平台任务编排模块（8 个月），平台侧经验偏少',
      },
    ],
  },
  {
    category: 'AI Agent 开发',
    companyName: '星野科技',
    title: 'AI Agent 测试开发工程师',
    city: '深圳',
    salaryText: '22k-32k·13薪',
    salaryMin: 22000,
    salaryMax: 32000,
    salaryMonths: 13,
    businessType: 'C 端 Agent 智能体',
    status: 'REJECTED',
    tier: 'poor',
    ageDays: 27,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟练使用 Python 编写测试工具', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'LangChain', text: '熟悉 LangChain 的链路调试方式', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Pytest', text: '熟练使用 Pytest 组织测试用例', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'LangGraph', text: '熟悉 LangGraph 的状态图编排', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'AutoGen', text: '掌握 AutoGen 多智能体框架', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '自动化测试体系搭建',
        text: '具备自动化测试体系搭建能力',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '从 0 搭建过接口自动化体系，用例 400+',
      },
      {
        kind: 'ABILITY',
        name: '工具调用与任务编排',
        text: '具备工具调用与任务编排的落地能力',
        importance: 'MUST',
        level: 'INTERMEDIATE',
        verdict: 'GAP',
        note: '个人资产中未提及 Agent 编排的落地经历',
      },
      {
        kind: 'EXP',
        name: '测试平台开发经验',
        text: '有测试平台或测试工具的开发经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '接口自动化体系含自研用例调度脚本',
      },
      {
        kind: 'EXP',
        name: 'Agent 产品落地经验',
        text: '有 Agent 类产品的测试或研发经验',
        importance: 'MUST',
        verdict: 'GAP',
        note: '个人资产中未提及 Agent 产品经历',
      },
    ],
  },

  /* ------------------------------------------------------- 自动化测试 */
  {
    category: '自动化测试',
    companyName: '联启软件',
    title: '自动化测试工程师（Python 方向）',
    city: '南京',
    district: '雨花台区',
    salaryText: '15k-22k·13薪',
    salaryMin: 15000,
    salaryMax: 22000,
    salaryMonths: 13,
    businessType: '企业级 SaaS 交付',
    url: 'https://www.zhipin.com/job_detail/1c77d0a8b3.html',
    status: 'INTERVIEWING',
    tier: 'excellent',
    ageDays: 15,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟练使用 Python 编写自动化脚本', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Pytest', text: '熟练使用 Pytest 及其插件体系', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Selenium', text: '掌握 Selenium WebDriver 的常用操作', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Playwright', text: '熟练使用 Playwright 编写端到端用例', importance: 'NICE', level: 'PROFICIENT' },
      {
        kind: 'ABILITY',
        name: '自动化测试体系搭建',
        text: '具备自动化测试体系的搭建能力',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '从 0 搭建接口自动化体系，回归从 2 天压到 2 小时',
      },
      {
        kind: 'ABILITY',
        name: '问题定位与排查',
        text: '具备问题定位与排查能力',
        importance: 'MUST',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '习惯用链路日志与最小复现用例定位问题',
      },
      {
        kind: 'ABILITY',
        name: '跨团队协作',
        text: '具备跨团队协作能力，能与研发高效沟通缺陷',
        importance: 'NICE',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '与产品、研发、测试多角色长期协作',
      },
      {
        kind: 'EXP',
        name: '接口自动化项目经验',
        text: '有接口自动化测试项目经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '订单服务重构同期交付 400+ 接口自动化用例',
      },
    ],
  },
  {
    category: '自动化测试',
    companyName: '拾光互娱',
    title: '游戏自动化测试工程师',
    city: '上海',
    district: '徐汇区',
    salaryText: '20k-28k',
    salaryMin: 20000,
    salaryMax: 28000,
    businessType: '手游发行与运营',
    url: 'https://www.zhipin.com/job_detail/6d31b95c22.html',
    status: 'OFFER',
    tier: 'perfect',
    ageDays: 40,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟悉 Python，能独立编写测试脚本', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Pytest', text: '熟练使用 Pytest 编写与组织用例', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Selenium', text: '掌握 Selenium 的页面元素定位与操作', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Git', text: '熟悉 Git 的日常协作流程', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '自动化测试体系搭建',
        text: '具备自动化测试体系搭建能力',
        importance: 'MUST',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '从 0 搭建过接口自动化体系',
      },
      {
        kind: 'ABILITY',
        name: '问题定位与排查',
        text: '具备问题定位与排查能力，能复现并定位偶现缺陷',
        importance: 'NICE',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '擅长用日志与最小复现用例定位偶现问题',
      },
      {
        kind: 'EXP',
        name: '测试用例设计经验',
        text: '有测试用例设计经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '接口自动化 400+ 用例的用例设计由本人负责',
      },
    ],
  },
  {
    category: '自动化测试',
    companyName: '汇川智能',
    title: '测试开发工程师（接口自动化）',
    city: '杭州',
    district: '滨江区',
    salaryText: '18k-26k·14薪',
    salaryMin: 18000,
    salaryMax: 26000,
    salaryMonths: 14,
    businessType: '工业自动化设备',
    status: 'APPLIED',
    tier: 'good',
    ageDays: 6,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟练使用 Python 开发测试工具与框架', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Pytest', text: '熟练使用 Pytest 搭建测试框架', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'FastAPI', text: '熟悉 FastAPI，能编写被测服务的桩接口', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'MySQL', text: '掌握 MySQL 的增删改查与数据校验', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Jenkins', text: '熟悉 Jenkins 持续集成流水线配置', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '自动化测试体系搭建',
        text: '具备自动化测试体系搭建能力',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '从 0 搭建接口自动化体系，用例 400+',
      },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备后端服务开发能力，能自研测试平台模块',
        importance: 'NICE',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '订单服务与知识库应用均由本人实现，能力充足',
      },
      {
        kind: 'EXP',
        name: '接口自动化项目经验',
        text: '有接口自动化测试的项目经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '订单服务重构同期交付 400+ 接口用例',
      },
      {
        kind: 'EXP',
        name: '性能测试经验',
        text: '有性能测试与压测经验',
        importance: 'NICE',
        verdict: 'GAP',
        note: '个人资产中未提及压测与性能测试经历',
      },
    ],
  },
  {
    category: '自动化测试',
    companyName: '木鸟出行',
    title: '自动化测试工程师',
    city: '深圳',
    salaryText: '16k-24k',
    salaryMin: 16000,
    salaryMax: 24000,
    businessType: '共享出行平台',
    status: 'NOT_APPLIED',
    tier: 'medium',
    ageDays: 1,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟悉 Python 语言', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Pytest', text: '熟练使用 Pytest', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Selenium', text: '掌握 Selenium 自动化测试', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Linux', text: '熟悉 Linux 常用命令，能独立排查环境问题', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Postman', text: '了解 Postman 的接口调试与集合管理', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '自动化测试体系搭建',
        text: '具备自动化测试体系搭建能力',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '从 0 搭建接口自动化体系，覆盖核心链路',
      },
      {
        kind: 'ABILITY',
        name: '性能优化',
        text: '具备性能优化能力，能配合研发做接口性能分析',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'PARTIAL',
        note: '自评一般，缺少系统级性能专项经验',
      },
      {
        kind: 'EXP',
        name: '接口自动化项目经验',
        text: '有接口自动化项目经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '订单服务重构同期交付 400+ 接口用例',
      },
      {
        kind: 'EXP',
        name: 'UI 自动化项目经验',
        text: '有 UI 自动化项目经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '知识库问答应用中有基于 Selenium 的端到端用例',
      },
      {
        kind: 'EXP',
        name: '测试环境搭建经验',
        text: '有独立搭建成套测试环境的经验',
        importance: 'MUST',
        verdict: 'GAP',
        note: '个人资产中未提及独立搭建测试环境的经历',
      },
    ],
  },
  {
    category: '自动化测试',
    companyName: '恒信金融科技',
    title: '测试开发工程师（CI/CD 方向）',
    city: '北京',
    district: '朝阳区',
    salaryText: '面议',
    businessType: '金融核心系统测试中台',
    status: 'NOT_APPLIED',
    tier: 'low',
    ageDays: 22,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟练使用 Python 开发测试工具', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Pytest', text: '熟练使用 Pytest 组织测试用例', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'CI/CD', text: '熟悉 CI/CD 流水线的设计与维护', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Jenkins', text: '熟悉 Jenkins Pipeline 编写', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'SonarQube', text: '了解 SonarQube 静态扫描与质量门禁', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '自动化测试体系搭建',
        text: '具备自动化测试体系搭建能力',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '从 0 搭建接口自动化体系并接入流水线',
      },
      {
        kind: 'ABILITY',
        name: '技术方案主导',
        text: '具备技术方案主导能力，能牵头质量平台选型',
        importance: 'MUST',
        level: 'MASTER',
        verdict: 'PARTIAL',
        note: '自评熟练，低于要求的精通；主导过中等规模方案',
      },
      {
        kind: 'EXP',
        name: '测试平台开发经验',
        text: '有测试平台或质量工具的开发经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '接口自动化体系的调度脚本由本人开发',
      },
      {
        kind: 'EXP',
        name: '金融行业测试经验',
        text: '有金融行业系统测试经验',
        importance: 'NICE',
        verdict: 'GAP',
        note: '个人资产中未提及金融行业经历',
      },
    ],
  },

  /* --------------------------------------------------------- 后端开发 */
  {
    category: '后端开发',
    companyName: '天枢网络',
    title: '后端开发工程师（Python）',
    city: '南京',
    district: '江宁区',
    salaryText: '12k-18k·13薪',
    salaryMin: 12000,
    salaryMax: 18000,
    salaryMonths: 13,
    businessType: '通信网络管理系统',
    status: 'NOT_APPLIED',
    // 解析没读到任何要求条目：岗位照样成立（公司/地区/薪资都在），但不参与匹配计算
    tier: 'unevaluated',
    ageDays: 0,
    items: [],
  },
  {
    category: '后端开发',
    companyName: '潮汐云',
    title: '高级后端开发工程师（Python）',
    city: '上海',
    district: '浦东新区',
    salaryText: '32k-48k',
    salaryMin: 32000,
    salaryMax: 48000,
    businessType: '云原生 PaaS 平台',
    url: 'https://www.zhipin.com/job_detail/2a90f7c4e1.html',
    status: 'APPLIED',
    tier: 'excellent',
    ageDays: 18,
    items: [
      { kind: 'SKILL', name: 'Python', text: '精通 Python，具备扎实的工程能力', importance: 'MUST', level: 'MASTER' },
      { kind: 'SKILL', name: 'FastAPI', text: '熟练使用 FastAPI 或同类框架', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'PostgreSQL', text: '熟练使用 PostgreSQL 与 SQL 调优', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Redis', text: '熟练使用 Redis 做缓存与分布式锁', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Docker', text: '熟悉 Docker 镜像构建与容器化交付', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Kubernetes', text: '熟悉 Kubernetes 的基本编排与排障', importance: 'NICE', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备后端服务开发能力，能主导核心模块',
        importance: 'MUST',
        level: 'MASTER',
        verdict: 'MATCH',
        note: '主导订单服务重构，QPS 提升 3 倍',
      },
      {
        kind: 'ABILITY',
        name: '系统架构设计',
        text: '具备系统架构设计能力',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '知识库问答应用的整体方案由本人设计',
      },
      {
        kind: 'ABILITY',
        name: '性能优化',
        text: '具备性能优化能力，能主导链路性能专项',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'PARTIAL',
        note: '自评一般，做过慢查询与缓存优化但缺少系统级专项',
      },
      {
        kind: 'EXP',
        name: '高并发服务经验',
        text: '有高并发场景下的服务开发经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '订单服务重构后 QPS 600 → 1800',
      },
      {
        kind: 'EXP',
        name: '技术方案主导经验',
        text: '有主导技术方案设计与评审的经验',
        importance: 'NICE',
        verdict: 'MATCH',
        note: '主导过 2 个中等规模模块的技术方案',
      },
    ],
  },
  {
    category: '后端开发',
    companyName: '海纳数科',
    title: '后端开发工程师（数据服务）',
    city: '杭州',
    district: '西湖区',
    salaryText: '20k-30k·15薪',
    salaryMin: 20000,
    salaryMax: 30000,
    salaryMonths: 15,
    businessType: '数据要素与隐私计算',
    status: 'NOT_APPLIED',
    tier: 'good',
    ageDays: 4,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟悉 Python 服务端开发', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'MySQL', text: '掌握 MySQL 的建模与查询优化', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Redis', text: '熟悉 Redis 缓存设计', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Kubernetes', text: '熟练使用 Kubernetes 完成服务部署', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Flink', text: '了解 Flink 流处理的基本用法', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备后端服务开发能力',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '订单服务与知识库应用均由本人实现',
      },
      {
        kind: 'ABILITY',
        name: '问题定位与排查',
        text: '具备问题定位与排查能力',
        importance: 'MUST',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '习惯用链路日志与最小复现用例定位问题',
      },
      {
        kind: 'EXP',
        name: '后端接口开发经验',
        text: '有后端接口设计与开发经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '订单服务重构完整覆盖接口设计到上线',
      },
    ],
  },
  {
    category: '后端开发',
    companyName: '律动科技',
    title: '后端开发工程师（Go/Python）',
    city: '北京',
    district: '朝阳区',
    salaryText: '26k-36k·13薪',
    salaryMin: 26000,
    salaryMax: 36000,
    salaryMonths: 13,
    businessType: '音视频社交平台',
    status: 'INTERVIEWING',
    tier: 'medium',
    ageDays: 8,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟练使用 Python 开发后端服务', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'PostgreSQL', text: '熟练使用 PostgreSQL', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Redis', text: '熟悉 Redis 的缓存与计数场景', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Kubernetes', text: '熟练使用 Kubernetes 部署微服务', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Go', text: '熟悉 Go 语言，能承接部分服务迁移', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备后端服务开发能力',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '订单服务重构的主程',
      },
      {
        kind: 'ABILITY',
        name: '系统架构设计',
        text: '具备系统架构设计能力，能设计微服务边界',
        importance: 'MUST',
        level: 'MASTER',
        verdict: 'PARTIAL',
        note: '自评熟练，低于要求的精通；有应用级方案设计经验',
      },
      {
        kind: 'EXP',
        name: '微服务项目经验',
        text: '有微服务架构下的开发经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '订单服务按微服务边界拆分过模块',
      },
      {
        kind: 'EXP',
        name: '跨国团队协作经验',
        text: '有与海外团队协作的经验',
        importance: 'NICE',
        verdict: 'GAP',
        note: '个人资产中未提及跨国协作经历',
      },
    ],
  },
  {
    category: '后端开发',
    companyName: '千帆智造',
    title: '后端开发工程师（工业 IoT）',
    city: '深圳',
    district: '南山区',
    salaryText: '24k-34k',
    salaryMin: 24000,
    salaryMax: 34000,
    businessType: '工业设备物联网',
    status: 'REJECTED',
    tier: 'low',
    ageDays: 31,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟练使用 Python 开发服务端程序', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'FastAPI', text: '熟悉 FastAPI 框架', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'PostgreSQL', text: '熟悉 PostgreSQL 与时序数据的存储设计', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Kubernetes', text: '熟练使用 Kubernetes 部署边缘服务', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'MQTT', text: '了解 MQTT 协议与设备接入', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备后端服务开发能力',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '订单服务与知识库应用的接口均由本人实现',
      },
      {
        kind: 'ABILITY',
        name: '需求分析与拆解',
        text: '具备需求分析与拆解能力，能对接硬件团队',
        importance: 'MUST',
        level: 'INTERMEDIATE',
        verdict: 'GAP',
        note: '个人资产中未提及相关经历',
      },
      {
        kind: 'EXP',
        name: '后端服务开发经验',
        text: '有后端服务开发经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '订单服务重构（18 个月）与知识库应用（12 个月）',
      },
      {
        kind: 'EXP',
        name: '硬件对接经验',
        text: '有与嵌入式/硬件团队对接的经验',
        importance: 'NICE',
        verdict: 'GAP',
        note: '个人资产中未提及硬件对接经历',
      },
    ],
  },
  {
    category: '后端开发',
    companyName: '云筑信息',
    title: '后端开发工程师（建筑 SaaS）',
    city: '南京',
    district: '雨花台区',
    salaryText: '18k-25k',
    salaryMin: 18000,
    salaryMax: 25000,
    businessType: '建筑工程数字化',
    status: 'CLOSED',
    tier: 'poor',
    ageDays: 45,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟悉 Python 开发', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Django', text: '熟悉 Django 框架', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'MySQL', text: '熟悉 MySQL 数据库设计', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: '微服务架构', text: '熟悉微服务架构与治理', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Go', text: '熟悉 Go 语言', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备后端服务开发能力',
        importance: 'MUST',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '订单服务重构的主程，能力充足',
      },
      {
        kind: 'ABILITY',
        name: '需求分析与拆解',
        text: '具备需求分析与拆解能力',
        importance: 'MUST',
        level: 'INTERMEDIATE',
        verdict: 'GAP',
        note: '个人资产中未提及相关经历',
      },
      {
        kind: 'EXP',
        name: 'SaaS 项目经验',
        text: '有 SaaS 产品的开发经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '订单服务属跨境电商 SaaS 后台',
      },
      {
        kind: 'EXP',
        name: '团队管理经验',
        text: '有 3 人以上小组的管理经验',
        importance: 'MUST',
        verdict: 'GAP',
        note: '个人资产中未提及团队管理经历',
      },
    ],
  },

  /* --------------------------------------------------------- 数据工程 */
  {
    category: '数据工程',
    companyName: '澜海数据',
    title: '数据工程师（Python）',
    city: '上海',
    district: '徐汇区',
    salaryText: '22k-30k·14薪',
    salaryMin: 22000,
    salaryMax: 30000,
    salaryMonths: 14,
    businessType: '跨境电商数据中台',
    url: 'https://jobs.51job.com/shanghai/160338275.html',
    status: 'APPLIED',
    tier: 'good',
    ageDays: 7,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟练使用 Python 做数据处理与任务开发', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'PostgreSQL', text: '熟练使用 PostgreSQL 与窗口函数', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'MySQL', text: '熟悉 MySQL 的数据同步与查询优化', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Kafka', text: '熟悉 Kafka 的消息订阅与消费', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Spark', text: '了解 Spark 批处理任务的开发', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备后端服务开发能力，能承接数据服务接口',
        importance: 'MUST',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '订单服务与知识库应用的后端均由本人实现',
      },
      {
        kind: 'ABILITY',
        name: '问题定位与排查',
        text: '具备问题定位与排查能力',
        importance: 'NICE',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '习惯用链路日志定位数据链路问题',
      },
      {
        kind: 'EXP',
        name: '后端开发经验',
        text: '有后端开发经验，能承接数据服务',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '订单服务重构（18 个月）+ 知识库应用（12 个月）',
      },
      {
        kind: 'EXP',
        name: '大数据平台经验',
        text: '有大数据平台（Hadoop/Spark）的使用经验',
        importance: 'NICE',
        verdict: 'GAP',
        note: '个人资产中未提及大数据平台经历',
      },
    ],
  },
  {
    category: '数据工程',
    companyName: '城际物流科技',
    title: '数据工程师（实时数仓）',
    city: '杭州',
    salaryText: '19k-28k',
    salaryMin: 19000,
    salaryMax: 28000,
    businessType: '城际物流调度平台',
    status: 'NOT_APPLIED',
    tier: 'medium',
    ageDays: 2,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟练使用 Python 开发数据任务', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'PostgreSQL', text: '熟悉 PostgreSQL 的数据建模', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Kafka', text: '熟悉 Kafka 消息队列', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'MySQL', text: '熟悉 MySQL 的读写与分库分表', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Flink', text: '熟悉 Flink 实时计算的开发', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备后端服务开发能力',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '订单服务重构的主程，能力充足',
      },
      {
        kind: 'ABILITY',
        name: '性能优化',
        text: '具备性能优化能力，能优化数据任务耗时',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'PARTIAL',
        note: '自评一般，缺少系统级性能专项',
      },
      {
        kind: 'EXP',
        name: '后端开发经验',
        text: '有后端开发经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '累计后端开发 38 个月',
      },
      {
        kind: 'EXP',
        name: '实时数仓建设经验',
        text: '有实时数仓的建设经验',
        importance: 'MUST',
        verdict: 'GAP',
        note: '个人资产中未提及数仓建设经历',
      },
    ],
  },
  {
    category: '数据工程',
    companyName: '星轨智算',
    title: '数据平台开发工程师',
    city: '北京',
    district: '海淀区',
    salaryText: '25k-38k·16薪',
    salaryMin: 25000,
    salaryMax: 38000,
    salaryMonths: 16,
    businessType: '算力调度与数据平台',
    status: 'CLOSED',
    tier: 'low',
    ageDays: 26,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟练使用 Python 开发平台侧服务', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'PostgreSQL', text: '熟悉 PostgreSQL', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Redis', text: '熟悉 Redis', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Kubernetes', text: '熟练使用 Kubernetes 做多租户隔离', importance: 'MUST', level: 'PROFICIENT' },
      { kind: 'SKILL', name: 'Go', text: '熟悉 Go 语言', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备后端服务开发能力',
        importance: 'MUST',
        level: 'INTERMEDIATE',
        verdict: 'MATCH',
        note: '订单服务与知识库应用均由本人实现',
      },
      {
        kind: 'ABILITY',
        name: '系统架构设计',
        text: '具备系统架构设计能力，能设计多租户方案',
        importance: 'MUST',
        level: 'MASTER',
        verdict: 'PARTIAL',
        note: '自评熟练，低于要求的精通',
      },
      {
        kind: 'EXP',
        name: '平台类项目经验',
        text: '有平台类产品的开发经验',
        importance: 'MUST',
        verdict: 'GAP',
        note: '个人资产中未提及平台类产品经历',
      },
      {
        kind: 'EXP',
        name: '后端开发经验',
        text: '有后端开发经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '累计后端开发 38 个月',
      },
    ],
  },
  {
    category: '数据工程',
    companyName: '亿维信息',
    title: '数据开发工程师',
    city: '南京',
    salaryText: '14k-20k·13薪',
    salaryMin: 14000,
    salaryMax: 20000,
    salaryMonths: 13,
    businessType: '政务数据治理',
    status: 'NOT_APPLIED',
    tier: 'poor',
    ageDays: 16,
    items: [
      { kind: 'SKILL', name: 'Python', text: '熟悉 Python 脚本开发', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Linux', text: '熟悉 Linux 环境下的任务部署', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'MySQL', text: '熟悉 MySQL 的日常开发', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'SQL', text: '熟悉 SQL 与存储过程', importance: 'MUST', level: 'INTERMEDIATE' },
      { kind: 'SKILL', name: 'Hive', text: '了解 Hive 数仓的分层建模', importance: 'MUST', level: 'INTERMEDIATE' },
      {
        kind: 'ABILITY',
        name: '后端服务开发',
        text: '具备后端服务开发能力',
        importance: 'MUST',
        level: 'PROFICIENT',
        verdict: 'MATCH',
        note: '订单服务重构的主程',
      },
      {
        kind: 'ABILITY',
        name: '需求分析与拆解',
        text: '具备需求分析与拆解能力，能对接业务方',
        importance: 'MUST',
        level: 'INTERMEDIATE',
        verdict: 'GAP',
        note: '个人资产中未提及相关经历',
      },
      {
        kind: 'EXP',
        name: '数据开发经验',
        text: '有数据仓库或 ETL 开发经验',
        importance: 'MUST',
        verdict: 'GAP',
        note: '个人资产中未提及数仓与 ETL 经历',
      },
      {
        kind: 'EXP',
        name: 'Python 开发经验',
        text: '有 Python 开发经验',
        importance: 'MUST',
        verdict: 'MATCH',
        note: '累计 Python 开发 38 个月',
      },
    ],
  },
]

/** 分类：前两个沿用库里已有的，后两个是这次要建的 */
const CATEGORIES = ['AI Agent 开发', '自动化测试', '后端开发', '数据工程']

/* ------------------------------------------------------------------ 播种步骤 */

type Counts = { created: number; skipped: number }
const summary = new Map<string, Counts>()
function tally(step: string, created: number, skipped: number) {
  summary.set(step, { created, skipped })
}

const jobKey = (job: { companyName: string; title: string }) => `${job.companyName}|${job.title}`

async function ensureCategories(): Promise<Map<string, string>> {
  const existing = await get<{ id: string; name: string }[]>('/api/categories')
  const byName = new Map(existing.map((category) => [category.name, category.id]))
  let created = 0

  for (const name of CATEGORIES) {
    if (byName.has(name)) continue
    const category = await post<{ id: string; name: string }>('/api/categories', { name })
    byName.set(category.name, category.id)
    created += 1
  }

  tally('岗位分类', created, CATEGORIES.length - created)
  return byName
}

async function ensureSkills() {
  const existing = await get<{ name: string }[]>('/api/skills')
  const names = new Set(existing.map((skill) => skill.name))
  let created = 0

  for (const skill of SKILLS) {
    if (names.has(skill.name)) continue
    await post('/api/skills', { name: skill.name, level: skill.level, acquiredAt: skill.acquiredAt })
    created += 1
  }

  tally('知识项', created, SKILLS.length - created)
}

async function ensureAbilities() {
  const overview = await get<{ dimensions: { key: string; name: string }[] }>('/api/abilities')
  const byName = new Map(overview.dimensions.map((dimension) => [dimension.name, dimension.key]))
  let created = 0

  for (const ability of ABILITIES) {
    if (byName.has(ability.name)) continue
    const next = await post<{ dimensions: { key: string; name: string }[] }>('/api/abilities/dimensions', {
      name: ability.name,
    })
    const dimension = next.dimensions.find((item) => item.name === ability.name)
    if (dimension === undefined) throw new Error(`能力条目创建后未找到：${ability.name}`)
    byName.set(dimension.name, dimension.key)
    created += 1
  }

  // 自评按「维度键 + 等级 + 说明」写入。**不能靠「abilities 里有没有这个键」判断是否已自评**：
  // 接口返回的是有效自评（每个维度都有一条，没写过的按「一般」），那个判断恒为真。
  // PUT 本身就是 upsert，直接写一遍即可。
  let rated = 0
  for (const ability of ABILITIES) {
    const key = byName.get(ability.name)
    if (key === undefined) throw new Error(`能力维度未找到：${ability.name}`)
    await put('/api/abilities', { dimensionKey: key, level: ability.level, note: ability.note ?? null })
    rated += 1
  }

  tally('能力维度', created, ABILITIES.length - created)
  console.log(`        写入自评 ${rated} 条（每个维度都有等级，没有「未自评」这一档）`)
}

async function ensureExperiences() {
  const existing = await get<{ project: string }[]>('/api/experiences')
  const projects = new Set(existing.map((experience) => experience.project))
  let created = 0

  for (const experience of EXPERIENCES) {
    if (projects.has(experience.project)) continue
    await post('/api/experiences', experience)
    created += 1
  }

  tally('项目经验', created, EXPERIENCES.length - created)
}

/** 岗位入库：走的就是前端「确认入库」那一个接口 */
async function ensureJobs(categories: Map<string, string>): Promise<Map<string, string>> {
  const board = await get<{ items: { job: { id: string; companyName: string; title: string } }[] }>(
    '/api/jobs/board',
  )
  const idByKey = new Map(board.items.map((item) => [jobKey(item.job), item.job.id]))
  let created = 0

  for (const seed of JOBS) {
    const key = jobKey(seed)
    if (idByKey.has(key)) continue

    const categoryId = categories.get(seed.category)
    if (categoryId === undefined) throw new Error(`岗位分类不存在：${seed.category}`)

    const result = await post<{ action: string; job: { id: string } }>('/api/jobs', {
      categoryId,
      companyName: seed.companyName,
      title: seed.title,
      salaryText: seed.salaryText,
      salaryMin: seed.salaryMin ?? null,
      salaryMax: seed.salaryMax ?? null,
      salaryMonths: seed.salaryMonths ?? null,
      locationCity: seed.city,
      locationDistrict: seed.district ?? null,
      industry: null,
      businessType: seed.businessType,
      originalUrl: seed.url ?? null,
      // v6 起不再提取职责与加分项（字段保留仅为兼容旧数据），职责混进要求里会污染缺口统计
      responsibilities: [],
      requirements: seed.items.map((item) => item.text),
      bonusPoints: [],
      customFields: {},
      requirementItems: seed.items.map((item) => ({
        kind: item.kind,
        name: item.name,
        requirementText: item.text,
        importance: item.importance,
        source: 'REQUIREMENT',
        // 经验类没有等级可比（个人侧只有项目与时长），与解析路径同一口径
        requiredLevel: item.kind === 'EXP' ? null : (item.level ?? null),
        verdict: item.verdict ?? null,
        userNote: item.note ?? null,
      })),
    })

    if (result.action !== 'created') throw new Error(`岗位未按预期新建：${key}`)
    idByKey.set(key, result.job.id)
    created += 1
  }

  tally('岗位', created, JOBS.length - created)
  return idByKey
}

/** 投递状态推进：与前端列表里那个状态选择器走同一个 PATCH */
async function applyStatuses(idByKey: Map<string, string>) {
  const board = await get<{ items: { job: { id: string; companyName: string; title: string; status: string } }[] }>(
    '/api/jobs/board',
  )
  const statusById = new Map(board.items.map((item) => [item.job.id, item.job.status]))

  let changed = 0
  let skipped = 0
  for (const seed of JOBS) {
    if (seed.status === 'NOT_APPLIED') {
      skipped += 1
      continue
    }
    const id = idByKey.get(jobKey(seed))
    if (id === undefined) throw new Error(`推进状态时找不到岗位：${jobKey(seed)}`)
    if (statusById.get(id) === seed.status) {
      skipped += 1
      continue
    }
    await patch(`/api/jobs/${encodeURIComponent(id)}`, { status: seed.status })
    changed += 1
  }

  tally('投递状态推进', changed, skipped)
}

/* ----------------------------------------------- 录入时间回填（唯一绕过接口的写操作） */

/**
 * 「已录入 N 天」由 job_post.created_at 现算（web/components/JobCard.tsx 的 daysAgo），
 * 而入库接口把它写死成「此刻」——公开接口造不出「25 天前录入」的数据。
 * 演示数据要能看到三档配色（≤10 天翠绿 / ≤20 天黄 / 更久玫瑰）与看板的
 * 「近 10 天新增 / 超过 20 天未处理」两个指标，只能直接改库。
 *
 * 这是全脚本唯一不经接口的一步：created_at 不参与任何匹配计算，
 * 只影响天数标签、那两个看板指标与「已录入天数」排序。
 */
function backdateJobs() {
  // 服务地址被指向别处时，本地这个库多半不是它的库，贸然写入会改错数据
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(BASE)) {
    console.log(`\n跳过录入时间回填：服务地址 ${BASE} 不指向本机，不确定它对应哪个数据目录`)
    return
  }

  const dataDir = process.env.JOBANALYZER_DATA_DIR ?? path.join(process.cwd(), 'data')
  const dbFile = path.join(dataDir, 'jobanalyzer.db')
  if (!existsSync(dbFile)) {
    console.log(`\n跳过录入时间回填：找不到数据库文件 ${dbFile}（可用 JOBANALYZER_DATA_DIR 指定）`)
    return
  }

  const db = new Database(dbFile)
  try {
    db.pragma('busy_timeout = 5000')
    const update = db.prepare('UPDATE job_post SET created_at = ? WHERE company_name = ? AND title = ?')
    const now = Date.now()
    let matched = 0

    db.transaction(() => {
      for (const seed of JOBS) {
        matched += update.run(now - seed.ageDays * 24 * 60 * 60 * 1000, seed.companyName, seed.title).changes
      }
    })()

    tally('录入时间回填', matched, JOBS.length - matched)
  } finally {
    db.close()
  }
}

/* ------------------------------------------------------------------ 结果核对 */

/** 档位口径与 shared/domain/tiers.ts 一致，这里只用于播种后的自查报告 */
const TIERS: { key: JobSeed['tier']; label: string; min: number }[] = [
  { key: 'perfect', label: '满分匹配 (100)', min: 100 },
  { key: 'excellent', label: '极高匹配 (90-99)', min: 90 },
  { key: 'good', label: '良好匹配 (80-89)', min: 80 },
  { key: 'medium', label: '中等匹配 (70-79)', min: 70 },
  { key: 'low', label: '偏低匹配 (60-69)', min: 60 },
  { key: 'poor', label: '待提升 (<60)', min: 0 },
]

function tierOf(score: number | null): JobSeed['tier'] {
  if (score === null) return 'unevaluated'
  return TIERS.find((tier) => score >= tier.min)?.key ?? 'poor'
}

/** 与 web/components/JobCard.tsx 的 daysAgo 同一口径，仅用于核对「已录入天数」的三档分布 */
function daysAgo(iso: string): number {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
  return days >= 0 ? days : 0
}

/** 天数三档：与 web/lib/palette.ts 的 stalenessTone 一致 */
function ageBucket(days: number): string {
  if (days <= 10) return '≤10 天'
  if (days <= 20) return '11-20 天'
  return '>20 天'
}

async function report(): Promise<boolean> {
  const board = await get<{
    items: {
      job: {
        id: string
        companyName: string
        title: string
        status: string
        locationCity: string | null
        createdAt: string
      }
      match: { composite: number | null }
      categoryName: string
    }[]
    total: number
  }>('/api/jobs/board')

  const cities = new Map<string, number>()
  const categories = new Map<string, number>()
  const tiers = new Map<string, number>()
  const statuses = new Map<string, number>()
  const ages = new Map<string, number>()
  const actualByKey = new Map<string, number | null>()

  for (const item of board.items) {
    const city = item.job.locationCity?.trim() || '未标注'
    cities.set(city, (cities.get(city) ?? 0) + 1)
    categories.set(item.categoryName, (categories.get(item.categoryName) ?? 0) + 1)
    statuses.set(item.job.status, (statuses.get(item.job.status) ?? 0) + 1)
    const bucket = ageBucket(daysAgo(item.job.createdAt))
    ages.set(bucket, (ages.get(bucket) ?? 0) + 1)
    const tier = tierOf(item.match.composite)
    tiers.set(tier, (tiers.get(tier) ?? 0) + 1)
    actualByKey.set(jobKey(item.job), item.match.composite)
  }

  const dashboard = await get<{ kpis: { newIn10Days: number; staleOver20Days: number } }>('/api/dashboard')

  const line = (label: string, entries: Map<string, number>) =>
    console.log(`  ${label}：${[...entries.entries()].map(([key, count]) => `${key} ${count}`).join(' · ')}`)

  console.log(`\n岗位总数：${board.total}`)
  line('投递状态', statuses)
  line('岗位分类', categories)
  line('城市', cities)
  line('匹配档位', tiers)
  line('录入天数', ages)
  console.log(
    `  看板指标：近 10 天新增 ${dashboard.kpis.newIn10Days} · 超过 20 天未处理 ${dashboard.kpis.staleOver20Days}（仅统计已关闭以外的岗位）`,
  )

  // 播种时给每个岗位写了目标档位，这里逐条对照实际算出来的分——落错档要看得见
  const mismatched = JOBS.filter((seed) => {
    const actual = actualByKey.get(jobKey(seed))
    if (actual === undefined) return true
    return tierOf(actual) !== seed.tier
  })

  const checks: [string, boolean][] = [
    ['岗位分类 ≥ 3 种', categories.size >= 3],
    ['城市 ≥ 3 种', cities.size >= 3],
    [
      '6 种投递状态全覆盖',
      ['NOT_APPLIED', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED', 'CLOSED'].every(
        (status) => (statuses.get(status) ?? 0) > 0,
      ),
    ],
    ['6 个匹配档位 + 无法评估全覆盖', tiers.size === TIERS.length + 1],
    ['每个分类至少 3 个岗位', [...categories.values()].every((count) => count >= 3)],
    ['每个岗位的匹配档位与预期一致', mismatched.length === 0],
    ['录入天数三个档位都有岗位', ages.size === 3],
    [
      '看板「近 10 天新增 / 超过 20 天未处理」都有值',
      dashboard.kpis.newIn10Days > 0 && dashboard.kpis.staleOver20Days > 0,
    ],
  ]

  console.log('')
  for (const [label, ok] of checks) console.log(`  ${ok ? '✓' : '✗'} ${label}`)

  if (mismatched.length > 0) {
    for (const seed of mismatched) {
      const actual = actualByKey.get(jobKey(seed)) ?? null
      console.log(
        `      · ${seed.companyName} · ${seed.title}：预期 ${seed.tier}，实际 ${actual ?? '不可评估'}（${tierOf(actual)}）`,
      )
    }
  }

  return checks.every(([, ok]) => ok)
}

/* ---------------------------------------------------------------- 入口 */

async function main() {
  console.log(`目标服务：${BASE}\n`)

  const health = await get<{ ok: boolean }>('/api/health').catch(() => null)
  if (health === null || health.ok !== true) {
    throw new Error('本地服务不可用，请先启动（npm run dev 或 npm run dev:server）')
  }

  const categories = await ensureCategories()
  await ensureSkills()
  await ensureAbilities()
  await ensureExperiences()
  const idByKey = await ensureJobs(categories)
  await applyStatuses(idByKey)
  backdateJobs()

  console.log('\n播种结果：')
  for (const [step, counts] of summary) {
    console.log(`  ${step}：变更 ${counts.created}，未涉及 ${counts.skipped}`)
  }

  const ok = await report()
  console.log(
    ok
      ? '\n覆盖度核对通过。数据都由公开接口写入，可在界面里正常编辑、推进状态与删除。'
      : '\n覆盖度核对未通过，请检查上方 ✗ 项。',
  )
  if (!ok) process.exitCode = 1
}

main().catch((cause: unknown) => {
  if (cause instanceof ApiError) {
    console.error(`\n接口返回错误（HTTP ${cause.status} / ${cause.code}）：${cause.message}`)
  } else {
    console.error('\n播种失败：', cause)
  }
  process.exitCode = 1
})
