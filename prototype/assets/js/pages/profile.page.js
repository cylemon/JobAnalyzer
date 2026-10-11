/* ==========================================================================
   profile.page.js —— 个人信息管理
   技能矩阵 / 工作履历 / 顶部横幅汇总 / 技能与履历的增删改
   ========================================================================== */

window.JA = window.JA || {};

(function (JA) {
  'use strict';

  var data = JA.data;
  var theme = JA.theme;

  /* -------------------------------------------------------------- 技能矩阵 */
  function renderSkills() {
    var container = JA.$('#skillsContainer');

    if (data.skills.length === 0) {
      container.innerHTML =
        '<div class="empty-state col-span-full">' +
        '  <i class="fa-solid fa-code"></i>' +
        '  <p>暂无技能项，请点击上方“添加技能项”</p>' +
        '</div>';
      updateBannerStats();
      return;
    }

    container.innerHTML = data.skills.map(function (skill) {
      var levelStyle = (theme.skillLevel[skill.level] || theme.skillLevel['入门']).badge;
      return `
        <div class="card card-hover p-5 flex flex-col justify-between space-y-3.5">
          <div class="flex items-center justify-between gap-2">
            <h4 class="font-bold text-slate-900 text-base truncate" title="${JA.escape(skill.name)}">${JA.escape(skill.name)}</h4>
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" class="btn btn-ghost" data-action="profile:edit-skill" data-id="${skill.id}" title="编辑">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button type="button" class="btn btn-ghost is-danger" data-action="profile:delete-skill" data-id="${skill.id}" title="删除">
                <i class="fa-regular fa-trash-can"></i>
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between pt-1">
            <span class="text-xs text-slate-400 font-medium">熟练度</span>
            <span class="badge ${levelStyle}">${JA.escape(skill.level)}</span>
          </div>
        </div>
      `;
    }).join('');

    updateBannerStats();
  }

  /* -------------------------------------------------------------- 工作履历 */
  function renderExperiences() {
    var container = JA.$('#experienceContainer');

    if (data.experiences.length === 0) {
      container.innerHTML =
        '<div class="empty-state">' +
        '  <i class="fa-solid fa-briefcase"></i>' +
        '  <p>暂无工作履历记录，点击右上角添加</p>' +
        '</div>';
      updateBannerStats();
      return;
    }

    container.innerHTML = data.experiences.map(function (exp) {
      var highlights = exp.highlights.map(function (text) {
        return '<li class="flex items-start gap-2.5"><i class="fa-solid fa-circle-dot text-[9px] text-brand-500 mt-1.5 shrink-0"></i><span class="text-slate-700 leading-relaxed">' + JA.escape(text) + '</span></li>';
      }).join('');

      var tags = exp.techStack.map(function (tag) {
        return '<span class="tag">' + JA.escape(tag) + '</span>';
      }).join('');

      return `
        <div class="card card-hover p-5 space-y-3.5">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <div class="flex items-center gap-2.5 flex-wrap">
                <h4 class="font-bold text-slate-900 text-lg">${JA.escape(exp.role)}</h4>
                <span class="tag font-semibold">${JA.formatYears(exp.years)} 年经验</span>
                <span class="tag bg-brand-50 text-brand-600 border border-brand-100 font-semibold">${JA.escape(exp.type || '通用')}</span>
              </div>
              <p class="text-sm text-slate-500 font-semibold mt-1.5 flex items-center gap-2">
                <i class="fa-solid fa-building text-slate-400"></i> ${JA.escape(exp.company)}
              </p>
            </div>

            <div class="flex items-center gap-3">
              <span class="text-sm text-slate-400 font-medium">${JA.escape(exp.period)}</span>
              <div class="flex items-center gap-1 border-l border-slate-200 pl-3">
                <button type="button" class="btn btn-ghost" data-action="profile:edit-exp" data-id="${exp.id}" title="编辑履历">
                  <i class="fa-solid fa-pen-to-square text-sm"></i>
                </button>
                <button type="button" class="btn btn-ghost is-danger" data-action="profile:delete-exp" data-id="${exp.id}" title="删除履历">
                  <i class="fa-regular fa-trash-can text-sm"></i>
                </button>
              </div>
            </div>
          </div>

          <div class="space-y-2">
            <span class="text-sm font-bold text-slate-800 block">核心工作成果与能力体现:</span>
            <ul class="text-sm space-y-2">${highlights}</ul>
          </div>

          <div class="pt-2 flex flex-wrap items-center gap-2">
            <span class="text-xs text-slate-400 font-semibold mr-1">关键能力标签:</span>
            ${tags}
          </div>
        </div>
      `;
    }).join('');

    updateBannerStats();
  }

  /* ------------------------------------------------------------ 横幅汇总 */
  /* 技能按领域计数、履历按岗位类型累加年限，两处结构一致共用一份模板 */
  function statItem(value, unit, label, valueClass) {
    return `
      <div class="pr-5 border-r border-brand-400/20 last:border-0 last:pr-0">
        <div class="flex items-baseline gap-1 justify-center lg:justify-start">
          <span class="text-2xl md:text-3xl font-bold ${valueClass} leading-none">${value}</span>
          <span class="text-xs font-normal text-brand-200">${unit}</span>
        </div>
        <span class="text-xs md:text-sm text-brand-200 font-medium mt-1 block">${JA.escape(label)}</span>
      </div>
    `;
  }

  function updateBannerStats() {
    /* 1. 技能领域分布 */
    var domainCounts = {};
    data.skills.forEach(function (skill) {
      var domain = skill.domain || '其他技能';
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    });

    JA.$('#bannerSkillStats').innerHTML = Object.keys(domainCounts).length === 0
      ? '<span class="text-sm text-brand-200/70">暂无技能项</span>'
      : Object.keys(domainCounts).map(function (domain) {
          return statItem(domainCounts[domain], '项', domain, 'text-amber-300');
        }).join('');

    /* 2. 岗位经验年限概况 */
    var typeYears = {};
    data.experiences.forEach(function (exp) {
      var type = exp.type || '综合履历';
      typeYears[type] = (typeYears[type] || 0) + (parseFloat(exp.years) || 0);
    });

    JA.$('#bannerExpStats').innerHTML = Object.keys(typeYears).length === 0
      ? '<span class="text-sm text-brand-200/70">暂无工作履历</span>'
      : Object.keys(typeYears).map(function (type) {
          return statItem(JA.formatYears(typeYears[type]), '年', type, 'text-cyan-300');
        }).join('');
  }

  /* ------------------------------------------------------------- 技能表单 */
  function openSkillModal() {
    JA.$('#skillForm').reset();
    JA.$('#skillId').value = '';
    JA.$('#skillModalTitle').textContent = '添加技能项';
    JA.openModal('skillModal');
  }

  function editSkill(id) {
    var skill = data.skills.filter(function (item) { return item.id === id; })[0];
    if (!skill) return;

    JA.$('#skillId').value = skill.id;
    JA.$('#skillName').value = skill.name;
    JA.$('#skillDomain').value = skill.domain || '编程与后端技能';
    JA.$('#skillLevel').value = skill.level;
    JA.$('#skillModalTitle').textContent = '编辑技能项';
    JA.openModal('skillModal');
  }

  /* ------------------------------------------------------------- 履历表单 */
  function openExperienceModal() {
    JA.$('#expForm').reset();
    JA.$('#expId').value = '';
    JA.$('#expModalTitle').textContent = '添加工作履历';
    JA.openModal('experienceModal');
  }

  function editExperience(id) {
    var exp = data.experiences.filter(function (item) { return item.id === id; })[0];
    if (!exp) return;

    JA.$('#expId').value = exp.id;
    JA.$('#expCompany').value = exp.company;
    JA.$('#expRole').value = exp.role;
    JA.$('#expType').value = exp.type || '';
    JA.$('#expPeriod').value = exp.period;
    JA.$('#expYears').value = exp.years;
    JA.$('#expHighlights').value = exp.highlights.join('\n');
    JA.$('#expTechStack').value = exp.techStack.join(', ');
    JA.$('#expModalTitle').textContent = '编辑工作履历';
    JA.openModal('experienceModal');
  }

  /* -------------------------------------------------------------- 动作层 */
  JA.actions['profile:open-skill'] = openSkillModal;
  JA.actions['profile:edit-skill'] = function (el) { editSkill(Number(el.dataset.id)); };
  JA.actions['profile:open-exp'] = openExperienceModal;
  JA.actions['profile:edit-exp'] = function (el) { editExperience(Number(el.dataset.id)); };

  JA.actions['profile:save-skill'] = function () {
    var id = JA.$('#skillId').value;
    var payload = {
      name: JA.$('#skillName').value,
      domain: JA.$('#skillDomain').value,
      level: JA.$('#skillLevel').value
    };

    if (id) {
      var skill = data.skills.filter(function (item) { return item.id === parseInt(id, 10); })[0];
      if (skill) {
        skill.name = payload.name;
        skill.domain = payload.domain;
        skill.level = payload.level;
      }
      JA.toast('技能修改保存成功');
    } else {
      data.skills.push({ id: Date.now(), name: payload.name, domain: payload.domain, level: payload.level });
      JA.toast('已成功新增技能项');
    }

    JA.closeModal('skillModal');
    renderSkills();
  };

  JA.actions['profile:save-exp'] = function () {
    var id = JA.$('#expId').value;
    var payload = {
      company: JA.$('#expCompany').value,
      role: JA.$('#expRole').value,
      type: JA.$('#expType').value,
      period: JA.$('#expPeriod').value,
      years: parseFloat(JA.$('#expYears').value) || 0,
      highlights: JA.$('#expHighlights').value.split('\n').filter(function (line) { return line.trim() !== ''; }),
      techStack: JA.$('#expTechStack').value.split(/[,，]/).map(function (tag) { return tag.trim(); }).filter(function (tag) { return tag !== ''; })
    };

    if (id) {
      var exp = data.experiences.filter(function (item) { return item.id === parseInt(id, 10); })[0];
      if (exp) {
        Object.keys(payload).forEach(function (key) { exp[key] = payload[key]; });
      }
      JA.toast('工作履历更新成功');
    } else {
      payload.id = Date.now();
      data.experiences.push(payload);
      JA.toast('已新增工作履历记录');
    }

    JA.closeModal('experienceModal');
    renderExperiences();
  };

  JA.actions['profile:delete-skill'] = function (el) {
    var id = Number(el.dataset.id);
    JA.confirm({
      title: '确定要删除该技能项吗？',
      message: '此操作无法撤销，数据将从本地存储中移除。',
      confirmText: '确认删除',
      onConfirm: function () {
        data.skills = data.skills.filter(function (item) { return item.id !== id; });
        renderSkills();
        JA.toast('已移除该技能项');
      }
    });
  };

  JA.actions['profile:delete-exp'] = function (el) {
    var id = Number(el.dataset.id);
    JA.confirm({
      title: '确定要删除该履历记录吗？',
      message: '此操作无法撤销，数据将从本地存储中移除。',
      confirmText: '确认删除',
      onConfirm: function () {
        data.experiences = data.experiences.filter(function (item) { return item.id !== id; });
        renderExperiences();
        JA.toast('已移除该履历记录');
      }
    });
  };

  /* -------------------------------------------------------------- 初始化 */
  document.addEventListener('DOMContentLoaded', function () {
    renderSkills();
    renderExperiences();
  });
})(window.JA);
