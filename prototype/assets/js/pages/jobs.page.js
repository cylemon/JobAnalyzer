/* ==========================================================================
   jobs.page.js —— 岗位信息管理
   筛选 / 排序 / 卡片流 / 深度分析抽屉 / 综合分析弹窗 / 录入与新增分类 / 删除
   ========================================================================== */

window.JA = window.JA || {};

(function (JA) {
  'use strict';

  var data = JA.data;
  var theme = JA.theme;

  /* 页面状态 */
  var sortOrder = 'desc';

  /* ------------------------------------------------------------------ 选项 */
  /* 深色筛选条里的 option 需要自己带底色，浅色表单里的不需要 */
  function categoryOptions(dark) {
    return data.jobCategories.map(function (category) {
      return '<option value="' + category.key + '"' + (dark ? ' class="bg-slate-900 text-slate-100"' : '') + '>' +
        JA.escape(category.name) + '</option>';
    }).join('');
  }

  function statusOptions(dark, selected) {
    return theme.jobStatusOrder.map(function (status) {
      return '<option value="' + status + '"' + (dark ? ' class="bg-slate-900 text-slate-100"' : '') +
        (status === selected ? ' selected' : '') + '>' + status + '</option>';
    }).join('');
  }

  function renderSelectOptions() {
    JA.$('#categorySelect').innerHTML = '<option value="all" class="bg-slate-900 text-slate-100">所有岗位分类</option>' + categoryOptions(true);
    JA.$('#modalCategorySelect').innerHTML = categoryOptions(false);
    JA.$('#citySelect').innerHTML = '<option value="all" class="bg-slate-900 text-slate-100">所有城市</option>' +
      ['北京', '上海', '深圳'].map(function (city) {
        return '<option value="' + city + '" class="bg-slate-900 text-slate-100">' + city + '</option>';
      }).join('');
    JA.$('#statusSelect').innerHTML = '<option value="all" class="bg-slate-900 text-slate-100">所有状态</option>' + statusOptions(true);
  }

  /* -------------------------------------------------------------- 筛选排序 */
  function applyFilters() {
    var keyword = (JA.$('#searchInput').value || '').trim().toLowerCase();
    var category = JA.$('#categorySelect').value;
    var city = JA.$('#citySelect').value;
    var status = JA.$('#statusSelect').value;
    var sortRule = JA.$('#sortSelect').value;

    /* 选中具体分类时才出现“综合分析”入口 */
    JA.$('#categoryAnalysisBtn').classList.toggle('hidden', category === 'all');

    var filtered = data.jobs.filter(function (job) {
      var hitKeyword = !keyword ||
        job.title.toLowerCase().indexOf(keyword) > -1 ||
        job.company.toLowerCase().indexOf(keyword) > -1 ||
        (job.businessType && job.businessType.toLowerCase().indexOf(keyword) > -1) ||
        job.city.toLowerCase().indexOf(keyword) > -1 ||
        job.district.toLowerCase().indexOf(keyword) > -1;

      return hitKeyword &&
        (category === 'all' || job.category === category) &&
        (city === 'all' || job.city === city) &&
        (status === 'all' || job.status === status);
    });

    var direction = sortOrder === 'desc' ? -1 : 1;
    if (sortRule === 'composite') {
      filtered.sort(function (a, b) {
        return (JA.compositeScore(a) - JA.compositeScore(b)) * direction;
      });
    } else if (sortRule === 'createdAt') {
      filtered.sort(function (a, b) {
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * direction;
      });
    } else if (sortRule === 'minSalary') {
      filtered.sort(function (a, b) {
        return (a.salaryMin - b.salaryMin) * direction;
      });
    }

    renderJobList(filtered);
  }

  /* ------------------------------------------------------------ 岗位卡片流 */
  function renderJobList(jobs) {
    var container = JA.$('#jobListContainer');

    if (jobs.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        '  <i class="fa-solid fa-folder-open"></i>' +
        '  <p>暂无符合条件的岗位信息</p>' +
        '</div>';
      return;
    }

    container.innerHTML = jobs.map(function (job) {
      var composite = JA.compositeScore(job);
      var days = JA.daysAgo(job.createdAt);
      var statusStyle = (theme.jobStatus[job.status] || theme.jobStatus['未投递']).badge;

      return `
        <div class="card card-hover p-5 relative flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div class="space-y-3 flex-1">

            <!-- 标题 + 薪资 + 录入天数 + 投递状态 -->
            <div class="flex flex-wrap items-center gap-2.5">
              <h3 class="card-title-link" data-action="job:open-detail" data-id="${job.id}">
                ${JA.escape(job.title)}
                <a href="${JA.escape(job.url)}" target="_blank" rel="noopener noreferrer" class="text-slate-300 hover:text-slate-500 text-xs" title="跳转原 Job 网页">
                  <i class="fa-solid fa-arrow-up-right-from-square"></i>
                </a>
              </h3>

              <span class="text-amber-600 font-bold text-xs bg-amber-50 px-2.5 py-0.5 rounded-lg border border-amber-200/80">
                ${JA.escape(job.salary)}
              </span>

              <span class="badge ${JA.stalenessClass(days)}">已录入 ${days} 天</span>

              <div class="relative inline-block">
                <select class="status-select-auto ${statusStyle} border text-[11px] font-semibold pl-2.5 pr-6 py-0.5 rounded-full cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-brand-400 transition-all"
                        data-change="job:update-status" data-id="${job.id}">
                  ${statusOptions(false, job.status)}
                </select>
                <i class="fa-solid fa-chevron-down absolute right-2 top-1/2 -translate-y-1/2 text-[9px] pointer-events-none opacity-60"></i>
              </div>
            </div>

            <!-- 公司 + 地区 + 业务方向 -->
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 font-medium">
              <span class="text-slate-800 font-semibold flex items-center gap-1.5">
                <i class="fa-solid fa-building text-slate-400"></i> ${JA.escape(job.company)}
              </span>
              <span class="flex items-center gap-1">
                <i class="fa-solid fa-location-dot text-slate-400"></i> ${JA.escape(job.city)} · ${JA.escape(job.district)}
              </span>
              ${job.businessType ? `
                <span class="flex items-center gap-1 text-brand-600/90 font-medium bg-brand-50/70 px-2 py-0.5 rounded-md border border-brand-100/60">
                  <i class="fa-solid fa-layer-group text-[10px] text-brand-400"></i> ${JA.escape(job.businessType)}
                </span>` : ''}
            </div>

            <!-- 三维匹配度 -->
            <div class="pt-2 border-t border-slate-100/80 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
              <div class="flex items-center gap-1.5">
                <span class="text-slate-400 font-medium">技能匹配度:</span>
                <span class="${JA.scoreText(job.matchSkill)}">${job.matchSkill}%</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-slate-400 font-medium">能力匹配度:</span>
                <span class="${JA.scoreText(job.matchAbility)}">${job.matchAbility}%</span>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-slate-400 font-medium">经验匹配度:</span>
                <span class="${JA.scoreText(job.matchExp)}">${job.matchExp}%</span>
              </div>
            </div>

          </div>

          <!-- 综合匹配度 + 操作 -->
          <div class="flex items-center justify-between md:justify-end gap-5 border-t md:border-t-0 border-slate-100 pt-3 md:pt-0 shrink-0">
            <div class="text-right flex flex-col items-end">
              <div class="flex items-center justify-end gap-1">
                <span class="text-2xl ${JA.scoreText(composite)} tracking-tight">${composite}</span>
                <span class="text-xs font-bold text-slate-400">%</span>
              </div>
              <span class="text-[11px] font-medium text-slate-400 mt-0.5">综合匹配度</span>
            </div>

            <div class="flex items-center gap-2">
              <button type="button" class="btn btn-soft" data-action="job:open-detail" data-id="${job.id}">
                <span>深度分析</span>
                <i class="fa-solid fa-chevron-right text-[10px]"></i>
              </button>
              <button type="button" class="btn btn-ghost is-danger" data-action="job:confirm-delete" data-id="${job.id}" title="删除该岗位">
                <i class="fa-regular fa-trash-can text-sm"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    JA.$$('.status-select-auto').forEach(JA.adjustSelectWidth);
  }

  /* ------------------------------------------------------------ 深度分析抽屉 */
  /* 技能 / 能力 / 经验三段结构完全一致，共用一份渲染 */
  function renderVerdictSection(containerId, items) {
    JA.$(containerId).innerHTML = (items || []).map(function (item) {
      return `
        <div class="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2 text-xs">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-slate-900">${JA.escape(item.name)}</span>
            ${JA.verdictBadge(item.status)}
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 border-t border-slate-200/50">
            <div><span class="text-slate-400">岗位要求:</span> <span class="text-slate-700 font-medium">${JA.escape(item.req)}</span></div>
            <div><span class="text-slate-400">用户情况:</span> <span class="text-slate-800 font-semibold">${JA.escape(item.user)}</span></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function openDetailDrawer(jobId) {
    var job = data.jobs.filter(function (item) { return item.id === jobId; })[0];
    if (!job) return;

    renderVerdictSection('#analysisSkillList', job.skills);
    renderVerdictSection('#analysisAbilityList', job.abilities);
    renderVerdictSection('#analysisExpList', job.experiences);

    JA.openModal('detailDrawer');
  }

  /* ------------------------------------------------------------ 综合分析弹窗 */
  function renderRadarChart() {
    var dimensions = data.categoryAnalysis.dimensions;
    var size = 320;
    var center = size / 2;
    var radius = 105;
    var total = dimensions.length;

    function point(index, value) {
      var angle = (Math.PI * 2 / total) * index - Math.PI / 2;
      var distance = (value / 100) * radius;
      return {
        x: center + distance * Math.cos(angle),
        y: center + distance * Math.sin(angle)
      };
    }

    function polygon(values) {
      return dimensions.map(function (_, index) {
        var pt = point(index, values[index]);
        return pt.x + ',' + pt.y;
      }).join(' ');
    }

    var grid = [0.25, 0.5, 0.75, 1].map(function (level) {
      return '<polygon points="' + polygon(dimensions.map(function () { return level * 100; })) +
        '" fill="none" stroke="' + theme.chartGrid + '" stroke-width="1" stroke-dasharray="' +
        (level === 1 ? 'none' : '3 3') + '"/>';
    }).join('');

    var axes = dimensions.map(function (_, index) {
      var pt = point(index, 100);
      return '<line x1="' + center + '" y1="' + center + '" x2="' + pt.x + '" y2="' + pt.y +
        '" stroke="' + theme.chartGrid + '" stroke-width="1"/>';
    }).join('');

    var dots = dimensions.map(function (dimension, index) {
      var market = point(index, dimension.marketVal);
      var user = point(index, dimension.userVal);
      return '<circle cx="' + market.x + '" cy="' + market.y + '" r="3.5" class="' + theme.radar.market.dot + '"/>' +
        '<circle cx="' + user.x + '" cy="' + user.y + '" r="3.5" class="' + theme.radar.user.dot + '"/>';
    }).join('');

    var labels = dimensions.map(function (dimension, index) {
      var angle = (Math.PI * 2 / total) * index - Math.PI / 2;
      var labelRadius = radius + 32;
      var x = center + labelRadius * Math.cos(angle);
      var y = center + labelRadius * Math.sin(angle);
      var anchor = 'middle';
      if (Math.cos(angle) > 0.3) anchor = 'start';
      if (Math.cos(angle) < -0.3) anchor = 'end';

      return '<text x="' + x + '" y="' + (y - 6) + '" text-anchor="' + anchor + '" class="fill-slate-800 text-[11px] font-bold">' + JA.escape(dimension.label) + '</text>' +
        '<text x="' + x + '" y="' + (y + 8) + '" text-anchor="' + anchor + '" class="fill-slate-400 text-[10px] font-medium">要求频次: ' + JA.escape(dimension.reqFreq) + '</text>';
    }).join('');

    JA.$('#radarChartContainer').innerHTML = `
      <svg width="${size}" height="${size}" class="overflow-visible">
        ${grid}
        ${axes}
        <polygon points="${polygon(dimensions.map(function (d) { return d.marketVal; }))}" fill="${theme.radar.market.fill}" stroke="${theme.radar.market.hex}" stroke-width="2.5"/>
        <polygon points="${polygon(dimensions.map(function (d) { return d.userVal; }))}" fill="${theme.radar.user.fill}" stroke="${theme.radar.user.hex}" stroke-width="2.5"/>
        ${dots}
        ${labels}
      </svg>
    `;
  }

  function renderRoadmap(containerId, items) {
    JA.$(containerId).innerHTML = items.map(function (item) {
      var priority = theme.gapPriority[item.priority] || theme.gapPriority.normal;
      return `
        <div class="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-slate-900">${JA.escape(item.title)}</span>
            <span class="badge ${priority.badge} shrink-0">${priority.emoji} ${priority.label}</span>
          </div>
          <p class="text-[11px] text-slate-600 leading-relaxed">${JA.escape(item.desc)}</p>
        </div>
      `;
    }).join('');
  }

  function openCategoryAnalysis() {
    var categoryKey = JA.$('#categorySelect').value;
    if (categoryKey === 'all') return;

    var category = data.jobCategories.filter(function (item) { return item.key === categoryKey; })[0];
    JA.$('#categoryAnalysisTitle').textContent = (category ? category.name : '所选岗位') + ' - 综合分析';

    renderRadarChart();
    renderRoadmap('#skillRoadmapContainer', data.categoryAnalysis.skillRoadmap);
    renderRoadmap('#abilityRoadmapContainer', data.categoryAnalysis.abilityRoadmap);

    JA.openModal('categoryAnalysisModal');
  }

  /* ---------------------------------------------------------------- 动作层 */
  JA.actions['job:apply-filter'] = applyFilters;

  JA.actions['job:toggle-sort-order'] = function () {
    sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    JA.$('#sortOrderIcon').className = sortOrder === 'desc'
      ? 'fa-solid fa-arrow-down-wide-short text-xs md:text-sm'
      : 'fa-solid fa-arrow-up-wide-short text-xs md:text-sm';
    JA.$('#sortOrderText').textContent = sortOrder === 'desc' ? '降序' : '升序';
    applyFilters();
  };

  JA.actions['job:update-status'] = function (el) {
    var job = data.jobs.filter(function (item) { return item.id === Number(el.dataset.id); })[0];
    if (!job) return;
    job.status = el.value;
    applyFilters();
    JA.toast('岗位状态已切换为【' + job.status + '】');
  };

  JA.actions['job:open-detail'] = function (el) {
    openDetailDrawer(Number(el.dataset.id));
  };

  JA.actions['job:open-analysis'] = openCategoryAnalysis;

  JA.actions['job:confirm-delete'] = function (el) {
    var jobId = Number(el.dataset.id);
    JA.confirm({
      title: '确定要删除该岗位吗？',
      message: '此操作无法撤销，岗位信息将从本地缓存移除。',
      confirmText: '确认删除',
      onConfirm: function () {
        data.jobs = data.jobs.filter(function (item) { return item.id !== jobId; });
        applyFilters();
        JA.toast('已从系统中删除该岗位');
      }
    });
  };

  /* 岗位录入 */
  JA.actions['job:open-ingestion'] = function () {
    JA.openModal('ingestionModal');
  };

  JA.actions['job:submit-ingestion'] = function () {
    JA.closeModal('ingestionModal');
    JA.toast('解析成功！已新增 1 条岗位');
  };

  /* 新增岗位分类（二级弹窗） */
  JA.actions['job:open-add-category'] = function () {
    JA.openModal('addCategoryModal');
  };

  JA.actions['job:submit-category'] = function () {
    var input = JA.$('#newCategoryInput');
    var name = input.value.trim();
    if (!name) {
      window.alert('请输入类别名称');
      return;
    }

    var key = 'cat_' + Date.now();
    data.jobCategories.push({ key: key, name: name });

    /* 只追加选项，筛选条当前的选择保持不变 */
    JA.$('#categorySelect').insertAdjacentHTML('beforeend',
      '<option value="' + key + '" class="bg-slate-900 text-slate-100">' + JA.escape(name) + '</option>');
    JA.$('#modalCategorySelect').insertAdjacentHTML('beforeend',
      '<option value="' + key + '">' + JA.escape(name) + '</option>');
    JA.$('#modalCategorySelect').value = key;

    input.value = '';
    JA.closeModal('addCategoryModal');
    JA.toast('已成功添加新类别【' + name + '】');
  };

  /* -------------------------------------------------------------- 初始化 */
  document.addEventListener('DOMContentLoaded', function () {
    renderSelectOptions();
    applyFilters();
  });
})(window.JA);
