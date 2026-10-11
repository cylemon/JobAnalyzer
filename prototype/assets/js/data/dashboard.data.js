/* ==========================================================================
   dashboard.data.js —— 综合看板的 mock 演示数据
   注意：原型阶段看板使用独立的一份演示数据（数字比岗位页种子数据更饱满），
        但状态名、分类名、匹配度分层、配色全部与岗位页共用 theme.js 的语义定义。
   ========================================================================== */

window.JA = window.JA || {};
JA.data = JA.data || {};

JA.data.dashboard = {
  /* 顶部四个指标卡 */
  kpis: [
    {
      label: '总关注岗位',
      icon: 'fa-briefcase',
      iconClass: 'text-amber-300',
      value: '18',
      unit: '项',
      valueClass: 'text-amber-400',
      notes: [
        { icon: 'fa-solid fa-arrow-up-right', text: '近10天新增 +3', class: 'text-amber-300/90' },
        { icon: 'fa-regular fa-clock', text: '超过20天 5', class: 'text-amber-200/80' }
      ]
    },
    {
      label: '平均综合匹配度',
      icon: 'fa-bullseye',
      iconClass: 'text-sky-300',
      value: '82.4%',
      unit: '',
      valueClass: 'text-sky-400',
      notes: [{ icon: 'fa-solid fa-chart-line', text: '处于良好匹配区间', class: 'text-sky-300/90' }]
    },
    {
      label: 'Offer / 总投递',
      icon: 'fa-award',
      iconClass: 'text-emerald-300',
      value: '7.7%',
      unit: '',
      valueClass: 'text-emerald-400',
      notes: [{ icon: 'fa-solid fa-circle-check', text: '1 个 Offer / 13 个已投递', class: 'text-emerald-300/90' }]
    },
    {
      label: '待提升项总量',
      icon: 'fa-gauge-high',
      iconClass: 'text-amber-300',
      value: '9',
      unit: '项',
      valueClass: 'text-amber-400',
      notes: [{ icon: 'fa-solid fa-triangle-exclamation', text: '包含 3 项高优先级短板', class: 'text-rose-300/90' }]
    }
  ],

  /* 环形图 1：投递状态分布（颜色取自 theme.jobStatus） */
  statusDonut: [
    { label: '未投递', count: 5 },
    { label: '已投递待回应', count: 4 },
    { label: '面试中', count: 5 },
    { label: '已发Offer', count: 1 },
    { label: '已被拒绝', count: 3 }
  ],
  statusDonutCenterLabel: '岗位总数',

  /* 环形图 2：岗位类型分布（颜色取自 theme.categorical 循环色板） */
  categoryDonut: [
    { label: '大模型应用开发', count: 9 },
    { label: '后端架构师', count: 5 },
    { label: '数据工程师', count: 4 }
  ],
  categoryDonutCenterLabel: '涵盖类型',

  /* 环形图 3：城市分布 */
  cityDonut: [
    { label: '北京', count: 8 },
    { label: '上海', count: 6 },
    { label: '深圳', count: 4 }
  ],
  cityDonutCenterLabel: '覆盖城市',

  /* 匹配度分层统计（分层区间与配色取自 theme.matchTiers） */
  matchTierStats: [
    { tier: 'excellent', count: 5, companies: 'MiniMax, 阿里云, 字节跳动' },
    { tier: 'good', count: 7, companies: '智谱 AI, 百度, 商汤科技' },
    { tier: 'medium', count: 4, companies: '美团, 微软中国, 理想汽车' },
    { tier: 'low', count: 2, companies: '腾讯 AI Lab, 深度求索' }
  ],

  /* 待学习技能与待提升能力（按优先级分三列） */
  gaps: {
    high: [
      {
        kind: 'skill',
        title: 'C++ / CUDA 底层算子加速',
        mentionCount: 6,
        desc: '了解 GPU 显存分配机制，掌握 TensorRT / vLLM 推理加速框架开发与算子调优。',
        tip: '学习 CUDA Programming 指南，通过 TensorRT 算子优化实战提升。'
      },
      {
        kind: 'ability',
        title: '大模型首字延迟 (TTFT) 调优',
        mentionCount: 8,
        desc: '深入长文本 Chunk 动态切片与 SSE/WebSocket 实时流式响应编排能力。',
        tip: '重构现有 RAG 系统，加入异步 Prefetch 与 Prompt 缓存压测。'
      },
      {
        kind: 'skill',
        title: 'PyTorch 底层分布式并行训练',
        mentionCount: 3,
        desc: '理解 Megatron-LM 张量并行与 Pipeline 混合并行策略。',
        tip: '阅读 DeepSpeed 与 Megatron 开源源码，掌握多卡通信调优。'
      }
    ],
    medium: [
      {
        kind: 'skill',
        title: 'Flink / Spark 实时流计算',
        mentionCount: 5,
        desc: '掌握 Flink State 状态管理与 Exact-Once 语义保障，解决数据倾斜问题。',
        tip: '搭建 Flink 实时日志清洗与 LLM Token 实时统计 Demo。'
      },
      {
        kind: 'ability',
        title: '千万级流量削峰与分布式锁',
        mentionCount: 7,
        desc: '设计高可用 Redis 多级缓存与 Token Rate Limiter 限流中台组件。',
        tip: '补充高并发 API 网关中的令牌桶与漏桶算法实战。'
      },
      {
        kind: 'skill',
        title: 'ClickHouse 海量分析型数据库',
        mentionCount: 4,
        desc: '掌握 ClickHouse 向量存储与 MergeTree 引擎列式索引优化。',
        tip: '对比 Milvus、PGVector 与 ClickHouse 在大模型日志检索中的性能。'
      }
    ],
    low: [
      {
        kind: 'ability',
        title: '云原生 K8s Operator 自动化运维',
        mentionCount: 4,
        desc: '理解 GPU 集群多租户隔离与云原生弹性 Pod 扩缩容机制。',
        tip: '掌握 Kubeflow 或 KubeRay 基础 Operator 部署配置。'
      },
      {
        kind: 'skill',
        title: 'Go 语言微服务高性能扩展',
        mentionCount: 5,
        desc: '巩固 Go 协程池与 Gin/gRPC 微服务接口开发规范。',
        tip: '将现有 Python 部分高性能路由重操为 Go 扩展。'
      },
      {
        kind: 'ability',
        title: 'Multi-Agent Graph 状态流编排',
        mentionCount: 12,
        desc: '已具备良好基础，持续跟进 LangGraph / AutoGen 动态图路由演进。',
        tip: '保持优势，探索多 Agent 自动纠错与人机协同 Hook 逻辑。'
      }
    ]
  }
};
