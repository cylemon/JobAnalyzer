/* ==========================================================================
   dashboard.page.js —— 综合看板
   KPI 概览 / 三个环形图 / 匹配度分层统计 / 待提升项分列折叠
   ========================================================================== */

window.JA = window.JA || {};

(function (JA) {
  'use strict';

  var data = JA.data.dashboard;
  var theme = JA.theme;

  /* ------------------------------------------------------------------ KPI */
  function kpiHtml(kpi, index) {
    var padding = index === 0 ? 'sm:pr-6' : (index === 3 ? 'sm:pl-6 pt-4 sm:pt-0' : 'sm:px-6 pt-4 sm:pt-0');

    var notes = kpi.notes.map(function (note, noteIndex) {
      return (noteIndex > 0 ? '<span class="text-white/30">|</span>' : '') +
        '<span class="' + note.class + ' flex items-center gap-1"><i class="' + note.icon + '"></i> ' + JA.escape(note.text) + '</span>';
    }).join('');

    return `
      <div class="${padding} flex flex-col justify-between">
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-semibold text-white tracking-wide">${JA.escape(kpi.label)}</span>
          <div class="w-8 h-8 rounded-lg bg-white/10 ${kpi.iconClass} flex items-center justify-center text-sm">
            <i class="fa-solid ${kpi.icon}"></i>
          </div>
        </div>
        <div>
          <div class="flex items-baseline gap-1.5">
            <span class="${kpi.valueClass} hero-metric-value tracking-tight">${JA.escape(kpi.value)}</span>
            ${kpi.unit ? '<span class="text-xs text-slate-200 font-medium">' + JA.escape(kpi.unit) + '</span>' : ''}
          </div>
          <div class="flex items-center gap-2 mt-1.5 text-[11px] font-medium">${notes}</div>
        </div>
      </div>
    `;
  }

  function renderKpis() {
    JA.$('#kpiRow').innerHTML = data.kpis.map(kpiHtml).join('');
  }

  /* ------------------------------------------------------------- 环形图 */
  /* 三张环形图结构完全一致，用同一份模板渲染 */
  var DONUT_CARDS = [
    {
      key: 'status',
      title: '岗位投递状态分布',
      desc: '各类流程推进阶段的岗位占比',
      icon: 'fa-bars-progress',
      palette: 'status',
      items: data.statusDonut,
      centerLabel: data.statusDonutCenterLabel
    },
    {
      key: 'category',
      title: '岗位类型分布',
      desc: '目标技术方向分布与聚集度',
      icon: 'fa-layer-group',
      palette: 'categorical',
      items: data.categoryDonut,
      centerLabel: data.categoryDonutCenterLabel
    },
    {
      key: 'city',
      title: '城市地区分布',
      desc: '工作意向地域分布覆盖',
      icon: 'fa-location-dot',
      palette: 'categorical',
      items: data.cityDonut,
      centerLabel: data.cityDonutCenterLabel
    }
  ];

  function donutColor(card, item, index) {
    if (card.palette === 'status') {
      return (theme.jobStatus[item.label] || {}).hex || theme.chartGrid;
    }
    return theme.categorical[index % theme.categorical.length].hex;
  }

  /* 通用 SVG 环形图：数据项形如 { label, count, hex } */
  function renderDonut(svgId, legendId, centerTotalId, centerLabelId, centerLabel, items) {
    var total = items.reduce(function (sum, item) { return sum + item.count; }, 0);

    JA.$('#' + centerTotalId).textContent = total;
    JA.$('#' + centerLabelId).textContent = centerLabel;

    var center = 60;
    var radius = 47.5;
    var circumference = 2 * Math.PI * radius;
    var offset = 0;

    var segments = '';
    var legend = '';

    items.forEach(function (item) {
      var percent = total > 0 ? item.count / total : 0;
      var strokeLength = percent * circumference;
      var gapLength = circumference - strokeLength;
      var dashOffset = offset;
      offset += strokeLength;

      segments += `
        <circle class="donut-segment" cx="${center}" cy="${center}" r="${radius}"
                fill="transparent" stroke="${item.hex}" stroke-width="17"
                stroke-dasharray="${strokeLength} ${gapLength}" stroke-dashoffset="-${dashOffset}">
          <title>${JA.escape(item.label)}: ${item.count}个 (${(percent * 100).toFixed(1)}%)</title>
        </circle>
      `;

      legend += `
        <div class="flex items-center justify-between text-slate-600 hover:text-slate-900 transition-colors">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full inline-block shrink-0" style="background-color: ${item.hex}"></span>
            <span class="font-medium">${JA.escape(item.label)}</span>
          </div>
          <div class="flex items-center gap-2 font-semibold">
            <span>${item.count} 岗</span>
            <span class="text-[10px] text-slate-400 font-normal w-10 text-right">${(percent * 100).toFixed(0)}%</span>
          </div>
        </div>
      `;
    });

    JA.$('#' + svgId).innerHTML = segments;
    JA.$('#' + legendId).innerHTML = legend;
  }

  function renderDonutCards() {
    JA.$('#donutRow').innerHTML = DONUT_CARDS.map(function (card) {
      return `
        <div class="card p-5 flex flex-col justify-between">
          <div class="flex items-center justify-between mb-2">
            <div>
              <h3 class="font-bold text-sm text-slate-900">${card.title}</h3>
              <p class="text-[11px] text-slate-400 mt-0.5">${card.desc}</p>
            </div>
            <div class="w-7 h-7 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 text-xs">
              <i class="fa-solid ${card.icon}"></i>
            </div>
          </div>

          <div class="flex items-center justify-center my-1 relative">
            <svg id="donut-${card.key}" width="205" height="205" viewBox="0 0 120 120" class="transform -rotate-90"></svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span id="donut-${card.key}-total" class="donut-center-value"></span>
              <span id="donut-${card.key}-label" class="donut-center-label"></span>
            </div>
          </div>

          <div id="donut-${card.key}-legend" class="mt-2 pt-3 border-t border-slate-100 space-y-1.5 text-xs"></div>
        </div>
      `;
    }).join('');

    /* 状态分布使用语义状态色，分类 / 城市使用循环类别色板 */
    DONUT_CARDS.forEach(function (card) {
      var items = card.items.map(function (item, index) {
        return { label: item.label, count: item.count, hex: donutColor(card, item, index) };
      });

      renderDonut('donut-' + card.key, 'donut-' + card.key + '-legend',
        'donut-' + card.key + '-total', 'donut-' + card.key + '-label', card.centerLabel, items);
    });
  }

  /* --------------------------------------------------------- 匹配度分层 */
  function renderMatchTiers() {
    var stats = data.matchTierStats;
    var total = stats.reduce(function (sum, item) { return sum + item.count; }, 0);

    var tiers = stats.map(function (stat) {
      return {
        stat: stat,
        tier: theme.matchTiers.filter(function (item) { return item.key === stat.tier; })[0] || theme.matchTiers[3],
        percent: total > 0 ? (stat.count / total) * 100 : 0
      };
    });

    /* 图例 */
    JA.$('#matchTierLegend').innerHTML = tiers.map(function (item) {
      return '<span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full ' + item.tier.bar + '"></span> ' +
        item.tier.short + ' (' + item.tier.label + ')</span>';
    }).join('');

    /* 堆叠进度条 */
    JA.$('#matchTierBar').innerHTML = tiers.map(function (item, index) {
      var corners = index === 0 ? ' rounded-l-full' : (index === tiers.length - 1 ? ' rounded-r-full' : '');
      return '<span class="' + item.tier.bar + corners + '" style="width: ' + item.percent.toFixed(1) + '%" title="' +
        item.tier.short + ': ' + item.stat.count + ' 个岗位"></span>';
    }).join('');

    /* 分层明细卡 */
    JA.$('#matchTierCards').innerHTML = tiers.map(function (item) {
      return `
        <div class="p-4 rounded-2xl border space-y-2 ${item.tier.cardClass}">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold ${item.tier.titleClass}">${item.tier.range} ${item.tier.label}</span>
            <span class="px-2 py-0.5 text-[11px] font-extrabold rounded-full ${item.tier.countClass}">${item.stat.count} 岗位</span>
          </div>
          <div class="flex items-baseline gap-1">
            <span class="text-xl font-bold ${item.tier.valueClass}">${item.percent.toFixed(1)}%</span>
            <span class="text-xs ${item.tier.ratioClass} font-medium">占比</span>
          </div>
          <p class="text-[11px] leading-relaxed border-t pt-2 ${item.tier.noteClass}">
            典型代表：<strong class="font-semibold ${item.tier.strongClass}">${JA.escape(item.stat.companies)}</strong>
          </p>
        </div>
      `;
    }).join('');
  }

  /* --------------------------------------------------------- 待提升项分列 */
  var GROUP_ORDER = ['high', 'medium', 'low'];

  function gapItemHtml(item, priorityKey) {
    var priority = theme.gapPriority[priorityKey];
    var kind = theme.gapKind[item.kind];
    return `
      <div class="priority-item priority-item-card space-y-2" data-type="${item.kind}">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <span class="px-1.5 py-0.5 ${kind.badge} text-[10px] font-bold rounded">${kind.label}</span>
            ${JA.escape(item.title)}
          </span>
          <span class="badge shrink-0 ${priority.mention}">${item.mentionCount} 岗位提及</span>
        </div>
        <p class="text-[11px] text-slate-600 leading-relaxed">${JA.escape(item.desc)}</p>
        <div class="text-[10px] text-slate-400 bg-white p-2 rounded-lg border border-slate-100">💡 建议：${JA.escape(item.tip)}</div>
      </div>
    `;
  }

  function renderGapColumns() {
    JA.$('#gapColumns').innerHTML = GROUP_ORDER.map(function (level) {
      var priority = theme.gapPriority[level];
      var items = data.gaps[level];

      return `
        <div class="card priority-group ${priority.groupCard}">
          <div class="priority-group-head ${priority.groupHead}" data-action="dash:toggle-group" data-group="${level}">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full ${priority.dot}"></span>
              <h4 class="font-bold text-sm ${priority.groupTitle}">${priority.label}</h4>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-extrabold px-2 py-0.5 rounded-md ${priority.groupCount}">${items.length} 项</span>
              <i class="fa-solid fa-chevron-down text-xs transition-transform duration-200 ${priority.groupArrow}" data-arrow="${level}"></i>
            </div>
          </div>

          <div class="p-4 space-y-3.5 flex-1 hidden" data-container="${level}">
            ${items.map(function (item) { return gapItemHtml(item, level); }).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  /* 类型筛选 tab（数量由数据算出，不写死） */
  function renderGapTabs() {
    var all = GROUP_ORDER.reduce(function (sum, level) { return sum + data.gaps[level].length; }, 0);
    var counts = { all: all, skill: 0, ability: 0 };

    GROUP_ORDER.forEach(function (level) {
      data.gaps[level].forEach(function (item) { counts[item.kind] += 1; });
    });

    var tabClass = function (active) {
      return active
        ? 'px-3 py-1 rounded-lg bg-white shadow-sm font-semibold text-slate-800 transition-all'
        : 'px-3 py-1 rounded-lg text-slate-500 hover:text-slate-800 transition-all';
    };

    JA.$('#gapTabs').innerHTML = [
      { key: 'all', label: '全部项' },
      { key: 'skill', label: '仅看技能' },
      { key: 'ability', label: '仅看能力' }
    ].map(function (tab, index) {
      return '<button type="button" class="' + tabClass(index === 0) + '" data-action="dash:filter-gaps" data-filter="' + tab.key + '">' +
        tab.label + ' (' + counts[tab.key] + ')</button>';
    }).join('');
  }

  /* -------------------------------------------------------------- 动作层 */
  JA.actions['dash:refresh'] = function () {
    renderAll();
    JA.toast('综合看板数据已成功同步');
  };

  JA.actions['dash:toggle-group'] = function (el) {
    var group = el.dataset.group;
    var container = JA.$('[data-container="' + group + '"]');
    var arrow = JA.$('[data-arrow="' + group + '"]');
    if (!container) return;

    var collapsed = container.classList.toggle('hidden');
    if (arrow) arrow.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(180deg)';
  };

  JA.actions['dash:filter-gaps'] = function (el) {
    var filter = el.dataset.filter;

    /* tab 高亮 */
    JA.$$('#gapTabs button').forEach(function (button) {
      button.className = button === el
        ? 'px-3 py-1 rounded-lg bg-white shadow-sm font-semibold text-slate-800 transition-all'
        : 'px-3 py-1 rounded-lg text-slate-500 hover:text-slate-800 transition-all';
    });

    /* 条目按类型显示 / 隐藏 */
    JA.$$('.priority-item').forEach(function (item) {
      item.style.display = (filter === 'all' || item.dataset.type === filter) ? '' : 'none';
    });
  };

  /* -------------------------------------------------------------- 初始化 */
  function renderAll() {
    renderKpis();
    renderDonutCards();
    renderMatchTiers();
    renderGapColumns();
    renderGapTabs();
  }

  document.addEventListener('DOMContentLoaded', renderAll);
})(window.JA);
