/* ==========================================================================
   jobs.data.js —— 岗位信息页的 mock 种子数据
   原型阶段为内存态（刷新即还原），仅系统设置页做本地持久化。
   ========================================================================== */

window.JA = window.JA || {};
JA.data = JA.data || {};

/* 岗位分类：筛选下拉与录入弹窗下拉共用（新增分类时会被追加） */
JA.data.jobCategories = [
  { key: 'agent', name: '大模型应用开发' },
  { key: 'backend', name: '后端架构师' },
  { key: 'data', name: '数据工程师' }
];

/* 岗位记录：matchSkill / matchAbility / matchExp 为三维匹配度，
   综合匹配度由 JA.compositeScore() 按 theme.matchWeights 加权算出 */
JA.data.jobs = [
  {
    id: 1,
    title: '高级 AI Agent 研发工程师',
    salary: '35k - 50k · 16薪',
    salaryMin: 35,
    salaryMax: 50,
    company: '智谱 AI 创新实验室',
    category: 'agent',
    city: '北京',
    district: '海淀区',
    businessType: 'C端大模型 Agent 智能体链',
    status: '面试中',
    createdAt: '2026-10-02',
    url: 'https://example.com/job/1',
    matchSkill: 85,
    matchAbility: 90,
    matchExp: 80,
    skills: [
      { name: 'Python / FastAPI 微服务', req: '熟练掌握高并发异步框架，拥有线上服务压测调优经验', user: '掌握，具备 2 年 FastAPI 高并发项目实际开发经验', status: 'match' },
      { name: 'LangChain / LlamaIndex 编排', req: '深入理解 Agent 多工具调用与 RAG 向量检索逻辑', user: '精通，曾独立搭建企业级 RAG 知识库检索系统', status: 'match' },
      { name: 'C++ / CUDA 底层算子加速', req: '掌握 GPU 内存优化及 TensorRT/vLLM 推理加速', user: '仅了解基础 C++ 语法，无 CUDA 算子开发实践', status: 'gap' }
    ],
    abilities: [
      { name: '复杂 AI Agent 架构设计能力', req: '能够针对多步骤复杂任务设计分发与容错编排机制', user: '完全具备，成功设计过 Multi-Agent 多智能体协作引擎', status: 'match' },
      { name: '大模型低延迟响应调优', req: '熟练处理长文本 Chunk 流式输出与首字延迟 (TTFT) 优化', user: '基本符合，熟悉 SSE 协议与流式推送', status: 'partial' }
    ],
    experiences: [
      { name: '大模型应用落地经验', req: '具备 2 年以上生产环境大模型 Agent 研发经验', user: '符合（2.0 年商业化 AI 项目经验）', status: 'match' },
      { name: '千万级用户高并发交付', req: '拥有日活 100w+ 产品的后端稳定运维履历', user: '尚缺，之前项目日活在 10w+ 量级', status: 'gap' }
    ]
  },
  {
    id: 2,
    title: 'LLM 架构应用工程师',
    salary: '40k - 65k · 15薪',
    salaryMin: 40,
    salaryMax: 65,
    company: 'MiniMax 稀宇科技',
    category: 'agent',
    city: '上海',
    district: '徐汇区',
    businessType: '通用大模型基础应用平台',
    status: '未投递',
    createdAt: '2026-10-04',
    url: 'https://example.com/job/2',
    matchSkill: 100,
    matchAbility: 100,
    matchExp: 100,
    skills: [
      { name: 'Python / Go 微服务架构', req: '精通 Python 高性能开发，熟悉 Go 语言扩展', user: '精通 Python & FastAPI，熟练编写 Go 语言微服务', status: 'match' },
      { name: 'Prompt & RAG 深度调优', req: '精通 Prompt 工程与高准确率向量切片分块', user: '精通，具备丰富的向量检索评估调优经验', status: 'match' }
    ],
    abilities: [
      { name: '大模型中间件抽象能力', req: '能抽象统一的 Model API 网关与 Rate Limit 模块', user: '完全具备，曾主导统一 LLM 路由网关设计', status: 'match' }
    ],
    experiences: [
      { name: '大模型系统开发年限', req: '具备 2 年以上相关研发经验', user: '完全符合（2 年工作经验）', status: 'match' }
    ]
  },
  {
    id: 3,
    title: '大模型应用后端开发',
    salary: '28k - 42k · 15薪',
    salaryMin: 28,
    salaryMax: 42,
    company: '百度 AI 体系',
    category: 'agent',
    city: '北京',
    district: '海淀区',
    businessType: '智能搜索与生成式 API 中台',
    status: '已投递待回应',
    createdAt: '2026-09-28',
    url: 'https://example.com/job/3',
    matchSkill: 78,
    matchAbility: 82,
    matchExp: 75,
    skills: [
      { name: 'Python / Django / FastAPI', req: '精通 Web 开发框架与 ORM 性能调优', user: '掌握 FastAPI，熟练应对数据库索引调优', status: 'match' },
      { name: 'ElasticSearch / ClickHouse', req: '熟练掌握海量数据实时搜索与分析', user: '熟悉 ES 基本检索，ClickHouse 处于入门阶段', status: 'partial' }
    ],
    abilities: [
      { name: '高可用高并发架构设计', req: '具备高并发流量削峰与分布式锁控制能力', user: '基本具备，有 Redis 分布式锁落地实践', status: 'match' }
    ],
    experiences: [
      { name: '互联网中台研发经验', req: '3 年以上后端开发经验', user: '拥有 2 年经验，略微欠缺 1 年', status: 'partial' }
    ]
  },
  {
    id: 4,
    title: '云原生 K8s 部署专家',
    salary: '45k - 70k · 16薪',
    salaryMin: 45,
    salaryMax: 70,
    company: '阿里云基础架构',
    category: 'backend',
    city: '北京',
    district: '朝阳区',
    businessType: '云原生高并发基础设施',
    status: '面试中',
    createdAt: '2026-10-01',
    url: 'https://example.com/job/4',
    matchSkill: 92,
    matchAbility: 95,
    matchExp: 90,
    skills: [
      { name: 'Docker & Kubernetes', req: '精通 K8s Operator 编写与 CNI 网络插件', user: '精通容器化部署与集群日常运维调优', status: 'match' }
    ],
    abilities: [
      { name: '云原生架构解耦能力', req: '具备大规模云原生服务拆分与治理能力', user: '精通微服务治理', status: 'match' }
    ],
    experiences: [
      { name: '云计算平台开发经验', req: '3 年以上底层基础设施经验', user: '2.5 年经验，基本吻合', status: 'match' }
    ]
  },
  {
    id: 5,
    title: '分布式实时计算工程师',
    salary: '30k - 50k · 15薪',
    salaryMin: 30,
    salaryMax: 50,
    company: '美团大数据平台',
    category: 'data',
    city: '上海',
    district: '杨浦区',
    businessType: '实时外卖履约计算引擎',
    status: '已发Offer',
    createdAt: '2026-09-20',
    url: 'https://example.com/job/5',
    matchSkill: 68,
    matchAbility: 65,
    matchExp: 62,
    skills: [
      { name: 'Flink / Spark 实时流处理', req: '精通 Flink State 调优与 Exact-Once 语义保障', user: '熟悉 Spark 批处理，Flink 流计算经验较少', status: 'gap' }
    ],
    abilities: [
      { name: '海量实时数据吞吐设计', req: '解决数据倾斜与背压 (Backpressure) 问题', user: '有一定调优思路，缺乏大型真实场景实战', status: 'partial' }
    ],
    experiences: [
      { name: '大型实时数仓经验', req: '2 年以上 Flink 线上项目实战经验', user: '主要以离线数仓与后端存储为主', status: 'gap' }
    ]
  },
  {
    id: 6,
    title: '大模型前沿算法研究员',
    salary: '50k - 80k · 16薪',
    salaryMin: 50,
    salaryMax: 80,
    company: '腾讯 AI Lab',
    category: 'agent',
    city: '深圳',
    district: '南山区',
    businessType: '多模态基座模型演进',
    status: '已被拒绝',
    createdAt: '2026-09-15',
    url: 'https://example.com/job/6',
    matchSkill: 58,
    matchAbility: 55,
    matchExp: 50,
    skills: [
      { name: 'PyTorch 底层模型预训练', req: '精通 Megatron-LM 分布式并行训练算法', user: '以模型应用开发为主，不具备百亿参数预训练能力', status: 'gap' }
    ],
    abilities: [
      { name: '前沿论文复现能力', req: '能够在顶级会议论文发表或快速复现前沿 Model', user: '偏工程应用落地方向', status: 'gap' }
    ],
    experiences: [
      { name: '顶会发表/AI博士背景', req: '计算机/AI 博士或硕士顶会发表经历', user: '本科/硕士工程背景，缺少论文成果', status: 'gap' }
    ]
  }
];

/* 「综合分析」弹窗内容：原型阶段各岗位分类共用同一套示例数据，
   真实接入后可按分类给出各自的维度与路线 */
JA.data.categoryAnalysis = {
  dimensions: [
    { label: '大模型/RAG应用', reqFreq: '12/15 岗', marketVal: 90, userVal: 88 },
    { label: 'Python后端架构', reqFreq: '15/15 岗', marketVal: 85, userVal: 85 },
    { label: 'C++/CUDA底调', reqFreq: '6/15 岗', marketVal: 60, userVal: 30 },
    { label: '高并发高可用调优', reqFreq: '10/15 岗', marketVal: 80, userVal: 75 },
    { label: '云原生/K8s运维', reqFreq: '8/15 岗', marketVal: 70, userVal: 65 },
    { label: '行业项目落地年限', reqFreq: '14/15 岗', marketVal: 85, userVal: 80 }
  ],
  skillRoadmap: [
    {
      title: '1. C++/CUDA 底层推理算子加速',
      priority: 'high',
      desc: '当前在算子优化方向存在明显短板，建议补充 TensorRT / vLLM 部署调优与 GPU 显存分配机制。'
    },
    {
      title: '2. Flink / Spark 实时流处理机制',
      priority: 'medium',
      desc: '部分大模型 API 中台岗位关注流式长连接背压，可学习基于 Flink 的状态管理与实时日志处理。'
    },
    {
      title: '3. LangChain / LlamaIndex 深度重构',
      priority: 'low',
      desc: '您在 RAG 与多智能体编排上具有优势，可持续跟进 Multi-Agent Graph 框架迭代。'
    }
  ],
  abilityRoadmap: [
    {
      title: '阶段一：大模型首字延迟 (TTFT) 与流式架构',
      priority: 'high',
      desc: '重点提升 Token 流式分发、SSE/WebSocket 传输以及长文本 Chunk 动态分块的综合工程落地能力。'
    },
    {
      title: '阶段二：千万级高并发流量削峰与容错',
      priority: 'medium',
      desc: '强化分布式锁、Redis 多级缓存与 Rate Limiter 速率限制中台设计，补齐超高并发场景经验。'
    },
    {
      title: '阶段三：云原生 K8s Operator 自动化运维',
      priority: 'normal',
      desc: '了解 GPU 集群多租户隔离与云原生弹性扩缩容机制，提升大规模基础设施治理水平。'
    }
  ]
};
