/* ==========================================================================
   theme.js —— 唯一的设计令牌来源（色板 + 语义配色）
   供 tailwind.config.js（品牌色）、ui.js（徽章/图表）、各页面模块共用。
   改配色只改这里；不要在页面里再写死语义色值。
   ========================================================================== */

window.JA = window.JA || {};

JA.theme = {
  /* ---------------------------------------------------------------- 品牌色 */
  /* 与 tailwind.config.js 中的 brand 色阶一致（brand-600 为品牌主色） */
  colors: {
    brand: {
      50: '#F4F5F9',
      100: '#E6E8F2',
      200: '#CDD1E4',
      300: '#A7ADCF',
      400: '#7E85B6',
      500: '#5C629E',
      600: '#484E88',
      700: '#3A3F70',
      800: '#2E3258',
      900: '#232643',
      950: '#17192C'
    }
  },

  /* 综合匹配度权重：技能 50% + 能力 30% + 经验 20% */
  matchWeights: { skill: 0.5, ability: 0.3, exp: 0.2 },

  /* ------------------------------------------------------- 岗位投递状态 */
  /* hex 用于环形图，dot 用于图例圆点，badge 用于徽章/状态下拉 */
  jobStatus: {
    '未投递': {
      hex: '#94A3B8',
      dot: 'bg-slate-400',
      badge: 'bg-slate-100 text-slate-600 border-slate-200'
    },
    '已投递待回应': {
      hex: '#EAB308',
      dot: 'bg-yellow-500',
      badge: 'bg-yellow-50 text-yellow-700 border-yellow-300'
    },
    '面试中': {
      hex: '#06B6D4',
      dot: 'bg-cyan-500',
      badge: 'bg-cyan-50 text-cyan-600 border-cyan-200'
    },
    '已发Offer': {
      hex: '#10B981',
      dot: 'bg-emerald-500',
      badge: 'bg-emerald-50 text-emerald-600 border-emerald-200'
    },
    '已被拒绝': {
      hex: '#F43F5E',
      dot: 'bg-rose-500',
      badge: 'bg-rose-50 text-rose-600 border-rose-200'
    }
  },
  /* 状态下拉的选项顺序（岗位页筛选条与卡片下拉共用） */
  jobStatusOrder: ['未投递', '已投递待回应', '面试中', '已发Offer', '已被拒绝'],

  /* ------------------------------------------------------- 综合匹配度分层 */
  /* 四档：≥90 极高 / ≥80 良好 / ≥70 中等 / <70 待提升
     岗位卡片分数着色与看板分层统计共用，避免两页配色不一致 */
  matchTiers: [
    {
      key: 'excellent',
      min: 90,
      label: '极高匹配',
      range: '90% - 100%',
      short: '90-100%',
      hex: '#F59E0B',
      text: 'text-amber-500 font-extrabold',
      chip: 'bg-amber-50 text-amber-700 border-amber-200',
      bar: 'bg-amber-500',
      cardClass: 'bg-amber-50/50 border-amber-200/70',
      titleClass: 'text-amber-800',
      countClass: 'bg-amber-100 text-amber-800',
      valueClass: 'text-amber-600',
      ratioClass: 'text-amber-700/80',
      noteClass: 'text-amber-900/70 border-amber-200/50',
      strongClass: 'text-amber-900'
    },
    {
      key: 'good',
      min: 80,
      label: '良好匹配',
      range: '80% - 89%',
      short: '80-89%',
      hex: '#10B981',
      text: 'text-emerald-500 font-bold',
      chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      bar: 'bg-emerald-500',
      cardClass: 'bg-emerald-50/50 border-emerald-200/70',
      titleClass: 'text-emerald-800',
      countClass: 'bg-emerald-100 text-emerald-800',
      valueClass: 'text-emerald-600',
      ratioClass: 'text-emerald-700/80',
      noteClass: 'text-emerald-900/70 border-emerald-200/50',
      strongClass: 'text-emerald-900'
    },
    {
      key: 'medium',
      min: 70,
      label: '中等匹配',
      range: '70% - 79%',
      short: '70-79%',
      hex: '#06B6D4',
      text: 'text-cyan-500 font-bold',
      chip: 'bg-cyan-50 text-cyan-700 border-cyan-200',
      bar: 'bg-cyan-500',
      cardClass: 'bg-cyan-50/50 border-cyan-200/70',
      titleClass: 'text-cyan-800',
      countClass: 'bg-cyan-100 text-cyan-800',
      valueClass: 'text-cyan-600',
      ratioClass: 'text-cyan-700/80',
      noteClass: 'text-cyan-900/70 border-cyan-200/50',
      strongClass: 'text-cyan-900'
    },
    {
      key: 'low',
      min: 0,
      label: '待提升',
      range: '< 70%',
      short: '<70%',
      hex: '#F43F5E',
      text: 'text-rose-500 font-semibold',
      chip: 'bg-rose-50 text-rose-700 border-rose-200',
      bar: 'bg-rose-500',
      cardClass: 'bg-rose-50/50 border-rose-200/70',
      titleClass: 'text-rose-800',
      countClass: 'bg-rose-100 text-rose-800',
      valueClass: 'text-rose-600',
      ratioClass: 'text-rose-700/80',
      noteClass: 'text-rose-900/70 border-rose-200/50',
      strongClass: 'text-rose-900'
    }
  ],

  /* ----------------------------------------------- 岗位录入天数（新鲜度） */
  staleness: [
    { maxDays: 10, badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    { maxDays: 20, badge: 'bg-yellow-50 text-yellow-700 border-yellow-300' },
    { maxDays: Infinity, badge: 'bg-rose-50 text-rose-700 border-rose-200' }
  ],

  /* ----------------------------------------------------------- 技能熟练度 */
  skillLevel: {
    '精通': { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 font-bold' },
    '熟练': { badge: 'bg-cyan-50 text-cyan-700 border-cyan-200 font-semibold' },
    '一般': { badge: 'bg-violet-50 text-violet-700 border-violet-200 font-medium' },
    '入门': { badge: 'bg-slate-100 text-slate-600 border-slate-200 font-medium' }
  },
  skillLevelOrder: ['精通', '熟练', '一般', '入门'],

  /* ------------------------------------------------- 岗位要求 vs 个人情况 */
  matchVerdict: {
    match: { label: '完全匹配', icon: 'fa-circle-check', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    partial: { label: '基本满足', icon: 'fa-circle-exclamation', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
    gap: { label: '需提升', icon: 'fa-triangle-exclamation', badge: 'bg-rose-50 text-rose-700 border-rose-200' }
  },

  /* ------------------------------------------------------- 待提升项优先级 */
  /* 看板的待提升分组列与岗位页的成长路线共用同一套配色 */
  gapPriority: {
    high: {
      label: '高优先级',
      emoji: '🔴',
      hex: '#F43F5E',
      dot: 'bg-rose-500',
      badge: 'bg-rose-50 text-rose-700 border-rose-200',
      groupCard: 'border-rose-200/80',
      groupHead: 'bg-rose-50/80 border-rose-100 hover:bg-rose-100/60',
      groupTitle: 'text-rose-950',
      groupCount: 'text-rose-700 bg-rose-100/80',
      groupArrow: 'text-rose-400',
      mention: 'text-rose-600 bg-rose-50 border-rose-200'
    },
    medium: {
      label: '中优先级',
      emoji: '🟠',
      hex: '#F59E0B',
      dot: 'bg-amber-500',
      badge: 'bg-amber-50 text-amber-700 border-amber-200',
      groupCard: 'border-amber-200/80',
      groupHead: 'bg-amber-50/80 border-amber-100 hover:bg-amber-100/60',
      groupTitle: 'text-amber-950',
      groupCount: 'text-amber-700 bg-amber-100/80',
      groupArrow: 'text-amber-400',
      mention: 'text-amber-600 bg-amber-50 border-amber-200'
    },
    low: {
      label: '低优先级',
      emoji: '🟢',
      hex: '#10B981',
      dot: 'bg-emerald-500',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      groupCard: 'border-emerald-200/80',
      groupHead: 'bg-emerald-50/80 border-emerald-100 hover:bg-emerald-100/60',
      groupTitle: 'text-emerald-950',
      groupCount: 'text-emerald-700 bg-emerald-100/80',
      groupArrow: 'text-emerald-400',
      mention: 'text-emerald-600 bg-emerald-50 border-emerald-200'
    },
    normal: {
      label: '常规拓展',
      emoji: '⚪',
      hex: '#8B5CF6',
      dot: 'bg-violet-500',
      badge: 'bg-violet-50 text-violet-700 border-violet-200',
      mention: 'text-violet-600 bg-violet-50 border-violet-200'
    }
  },

  /* 待提升项的类型标签（技能 / 能力） */
  gapKind: {
    skill: { label: '技能', badge: 'bg-violet-100 text-violet-700' },
    ability: { label: '能力', badge: 'bg-cyan-100 text-cyan-700' }
  },

  /* ------------------------------------------------------------ 图表配色 */
  /* 纯类别维度（岗位分类、城市等）按顺序循环取色，与语义状态色区分开 */
  categorical: [
    { hex: '#06B6D4', dot: 'bg-cyan-500' },
    { hex: '#10B981', dot: 'bg-emerald-500' },
    { hex: '#F59E0B', dot: 'bg-amber-500' },
    { hex: '#8B5CF6', dot: 'bg-violet-500' },
    { hex: '#F43F5E', dot: 'bg-rose-500' },
    { hex: '#3B82F6', dot: 'bg-blue-500' }
  ],
  radar: {
    market: { hex: '#06B6D4', fill: 'rgba(6, 182, 212, 0.25)', legend: 'bg-cyan-500/30 border-cyan-600', dot: 'fill-cyan-500' },
    user: { hex: '#10B981', fill: 'rgba(16, 185, 129, 0.25)', legend: 'bg-emerald-500/30 border-emerald-600', dot: 'fill-emerald-500' }
  },
  chartGrid: '#CBD5E1'
};
