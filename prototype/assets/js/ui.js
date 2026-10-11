/* ==========================================================================
   ui.js —— 公共 UI 能力
   1) DOM / 转义等小工具
   2) data-action / data-change / data-input / data-submit 事件委托（页面里不写 onclick）
   3) 弹窗开关 + 通用确认弹窗（单份模板，替代各页重复的删除确认框）
   4) Toast
   5) 徽章与格式化（配色全部来自 theme.js）
   ========================================================================== */

window.JA = window.JA || {};

(function (JA) {
  'use strict';

  /* ------------------------------------------------------------- DOM 工具 */
  JA.$ = function (selector, root) {
    return (root || document).querySelector(selector);
  };

  JA.$$ = function (selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  };

  /* 所有来自数据的文本在拼进 innerHTML 之前都要过这里 */
  JA.escape = function (value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /* --------------------------------------------------------- 事件委托分发 */
  /* 各页面模块通过 JA.actions['job:open-detail'] = function (el) {…} 注册；
     HTML 上写 data-action="job:open-detail" data-id="3" */
  JA.actions = {};

  function invoke(el, event, key) {
    var name = el.dataset[key];
    var handler = name && JA.actions[name];
    if (handler) handler(el, event);
  }

  document.addEventListener('click', function (event) {
    // 链接保持原生行为（卡片标题里的“跳转原网页”等）
    if (event.target.closest && event.target.closest('a[href]')) return;
    var el = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!el) return;
    event.preventDefault();
    invoke(el, event, 'action');
  });

  document.addEventListener('change', function (event) {
    var el = event.target.closest ? event.target.closest('[data-change]') : null;
    if (el) invoke(el, event, 'change');
  });

  document.addEventListener('input', function (event) {
    var el = event.target.closest ? event.target.closest('[data-input]') : null;
    if (el) invoke(el, event, 'input');
  });

  document.addEventListener('submit', function (event) {
    var el = event.target.closest ? event.target.closest('[data-submit]') : null;
    if (!el) return;
    event.preventDefault();
    invoke(el, event, 'submit');
  });

  /* --------------------------------------------------------------- 弹窗 */
  function resolve(target) {
    return typeof target === 'string' ? document.getElementById(target) : target;
  }

  JA.openModal = function (target) {
    var el = resolve(target);
    if (el) el.classList.add('is-open');
  };

  JA.closeModal = function (target) {
    var el = resolve(target);
    if (el) el.classList.remove('is-open');
  };

  /* 点击遮罩关闭 */
  document.addEventListener('click', function (event) {
    if (event.target.classList && event.target.classList.contains('modal')) {
      JA.closeModal(event.target);
    }
  });

  /* Esc 关闭最上层弹窗 */
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    JA.$$('.modal.is-open').forEach(function (el) {
      JA.closeModal(el);
    });
  });

  JA.actions['ui:close-modal'] = function (el) {
    JA.closeModal(el.dataset.target);
  };

  /* --------------------------------------------------- 通用确认弹窗（单份） */
  var confirmCallback = null;

  function ensureConfirmModal() {
    var modal = document.getElementById('uiConfirmModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'uiConfirmModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-panel modal-md">
        <div class="modal-body">
          <div class="flex items-start gap-3">
            <div class="modal-warn"><i class="fa-solid fa-triangle-exclamation"></i></div>
            <div>
              <h4 class="text-base font-bold text-slate-900" data-ui="confirm-title"></h4>
              <p class="modal-desc" data-ui="confirm-message"></p>
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary btn-sm" data-action="ui:confirm-cancel" data-ui="confirm-cancel">取消</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="ui:confirm-ok" data-ui="confirm-ok">确认删除</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  /* JA.confirm({ title, message, confirmText, danger, onConfirm }) */
  JA.confirm = function (options) {
    var opts = options || {};
    var modal = ensureConfirmModal();
    var okButton = JA.$('[data-ui="confirm-ok"]', modal);

    JA.$('[data-ui="confirm-title"]', modal).textContent = opts.title || '确定要执行该操作吗？';
    JA.$('[data-ui="confirm-message"]', modal).textContent = opts.message || '此操作无法撤销。';
    okButton.textContent = opts.confirmText || '确认';
    okButton.className = 'btn btn-sm ' + (opts.danger === false ? 'btn-primary' : 'btn-danger');

    confirmCallback = opts.onConfirm || null;
    JA.openModal(modal);
  };

  JA.actions['ui:confirm-ok'] = function () {
    var callback = confirmCallback;
    confirmCallback = null;
    JA.closeModal('uiConfirmModal');
    if (callback) callback();
  };

  JA.actions['ui:confirm-cancel'] = function () {
    confirmCallback = null;
    JA.closeModal('uiConfirmModal');
  };

  /* --------------------------------------------------------------- Toast */
  var toastTimer = null;

  JA.toast = function (text) {
    var toast = document.getElementById('toastMessage');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toastMessage';
      toast.className = 'toast is-hidden';
      toast.innerHTML = '<i class="fa-solid fa-circle-check"></i><span id="toastText"></span>';

      var host = document.getElementById('pageActions');
      if (host) {
        host.appendChild(toast);
      } else {
        toast.style.position = 'fixed';
        toast.style.top = '1rem';
        toast.style.right = '1rem';
        toast.style.zIndex = '60';
        document.body.appendChild(toast);
      }
    }

    document.getElementById('toastText').textContent = text;
    toast.classList.remove('is-hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.add('is-hidden');
    }, 2500);
  };

  /* --------------------------------------------------- 徽章 / 数值格式化 */
  JA.matchTier = function (score) {
    var tiers = JA.theme.matchTiers;
    for (var i = 0; i < tiers.length; i++) {
      if (score >= tiers[i].min) return tiers[i];
    }
    return tiers[tiers.length - 1];
  };

  JA.scoreText = function (score) {
    return JA.matchTier(score).text;
  };

  JA.scoreChip = function (score) {
    return JA.matchTier(score).chip;
  };

  /* 综合匹配度 = 技能 × 0.5 + 能力 × 0.3 + 经验 × 0.2 */
  JA.compositeScore = function (job) {
    var weights = JA.theme.matchWeights;
    return Math.round(
      (job.matchSkill || 0) * weights.skill +
      (job.matchAbility || 0) * weights.ability +
      (job.matchExp || 0) * weights.exp
    );
  };

  JA.badge = function (text, classes, icon) {
    return '<span class="badge ' + classes + '">' +
      (icon ? '<i class="fa-solid ' + icon + '"></i> ' : '') +
      JA.escape(text) + '</span>';
  };

  JA.statusBadge = function (status) {
    var token = JA.theme.jobStatus[status];
    return JA.badge(status, token ? token.badge : 'bg-slate-100 text-slate-600 border-slate-200');
  };

  JA.levelBadge = function (level) {
    var token = JA.theme.skillLevel[level] || JA.theme.skillLevel['入门'];
    return JA.badge(level, token.badge);
  };

  /* 岗位要求对比结论：完全匹配 / 基本满足 / 需提升 */
  JA.verdictBadge = function (verdict) {
    var token = JA.theme.matchVerdict[verdict] || JA.theme.matchVerdict.gap;
    return '<span class="badge ' + token.badge + ' shrink-0"><i class="fa-solid ' +
      token.icon + '"></i> ' + token.label + '</span>';
  };

  /* 已录入天数 */
  JA.daysAgo = function (dateString) {
    if (!dateString) return 0;
    var created = new Date(dateString);
    var today = new Date();
    created.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    var diffDays = Math.floor((today.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 ? diffDays : 0;
  };

  JA.stalenessClass = function (days) {
    var scales = JA.theme.staleness;
    for (var i = 0; i < scales.length; i++) {
      if (days <= scales[i].maxDays) return scales[i].badge;
    }
    return scales[scales.length - 1].badge;
  };

  /* 年限显示：整数不带小数位，非整数保留一位 */
  JA.formatYears = function (years) {
    var value = parseFloat(years) || 0;
    return value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
  };

  /* API Key 掩码展示 */
  JA.maskKey = function (apiKey) {
    return apiKey ? apiKey.substring(0, 5) + '••••••••' + apiKey.slice(-4) : '无需 API Key (无凭证)';
  };

  /* 下拉框宽度自适应选项文字（岗位卡片状态选择器用） */
  JA.adjustSelectWidth = function (selectEl) {
    if (!selectEl) return;
    var computed = window.getComputedStyle(selectEl);
    var measurer = document.createElement('span');
    measurer.style.visibility = 'hidden';
    measurer.style.position = 'absolute';
    measurer.style.whiteSpace = 'pre';
    measurer.style.fontSize = computed.fontSize;
    measurer.style.fontWeight = computed.fontWeight;
    measurer.style.fontFamily = computed.fontFamily;
    measurer.innerText = selectEl.options[selectEl.selectedIndex] ? selectEl.options[selectEl.selectedIndex].text : '';
    document.body.appendChild(measurer);
    var width = measurer.getBoundingClientRect().width;
    document.body.removeChild(measurer);
    selectEl.style.width = (width + 38) + 'px';
  };
})(window.JA);
