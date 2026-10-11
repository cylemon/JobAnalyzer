/* ==========================================================================
   profile.data.js —— 个人信息页的 mock 种子数据
   技能熟练度配色见 theme.skillLevel，此处只存业务数据。
   ========================================================================== */

window.JA = window.JA || {};
JA.data = JA.data || {};

/* 技能储备（领域域用于顶部横幅的技能分布汇总） */
JA.data.skills = [
  { id: 1, name: 'Python / FastAPI', domain: '编程与后端技能', level: '精通' },
  { id: 2, name: 'LangChain & LlamaIndex', domain: 'AI与大模型技能', level: '精通' },
  { id: 3, name: 'RAG 向量检索 & Multi-Agent', domain: 'AI与大模型技能', level: '精通' },
  { id: 4, name: 'Docker & Kubernetes', domain: '编程与后端技能', level: '熟练' },
  { id: 5, name: 'PostgreSQL & Redis', domain: '数据与存储技能', level: '熟练' },
  { id: 6, name: 'ClickHouse 实时分析', domain: '数据与存储技能', level: '一般' },
  { id: 7, name: 'Go 语言微服务', domain: '编程与后端技能', level: '一般' },
  { id: 8, name: 'Prompt 工程与调优', domain: 'AI与大模型技能', level: '熟练' }
];

/* 工作履历（type 用于顶部横幅的年限汇总） */
JA.data.experiences = [
  {
    id: 1,
    company: '某知名 AI 科技创新企业',
    role: '大模型应用研发工程师',
    type: '大模型与AI研发',
    period: '2024.01 - 至今',
    years: 2.0,
    highlights: [
      '主导基于 LangChain 的企业级 RAG 知识库系统搭建，向量检索准确率提升 35%',
      '设计 Agent 多智能体协作工作流，支撑高并发场景下的长文本处理与推理',
      '重构后端 API 微服务架构，降低系统平均请求延迟约 40%'
    ],
    techStack: ['Python', 'LangChain', 'FastAPI', 'VectorDB', 'Docker']
  },
  {
    id: 2,
    company: '某基础云软件有限公司',
    role: '后端架构/软件工程师',
    type: '后端与架构开发',
    period: '2021.07 - 2023.12',
    years: 2.5,
    highlights: [
      '负责云原生高并发中间件的研发与部署维护，保障 99.99% 系统可用性',
      '参与分布式缓存与 Redis 数据库性能优化，完成读写分离方案落地',
      '编写自动化 CI/CD 流水线脚本，显著提升产品迭代部署效率'
    ],
    techStack: ['Go', 'Python', 'Kubernetes', 'Redis', 'PostgreSQL']
  }
];
