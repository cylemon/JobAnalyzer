/* ==========================================================================
   layout.js —— 公共布局
   侧边栏（品牌区 + 导航 + 本地缓存卡片）在四个页面里完全一致，这里单点渲染。
   页面只需写：<aside id="sidebar" data-nav="jobs" class="sidebar"></aside>
   data-nav 取值：dashboard / jobs / profile / settings
   ========================================================================== */

window.JA = window.JA || {};

(function (JA) {
  'use strict';

  /* 导航唯一顺序来源，改文案/加页面只改这里 */
  var NAV_ITEMS = [
    { key: 'dashboard', label: '综合看板', icon: 'fa-chart-pie', href: 'dashboard.html' },
    { key: 'jobs', label: '岗位信息', icon: 'fa-briefcase', href: 'jobs.html' },
    { key: 'profile', label: '个人信息', icon: 'fa-user-gear', href: 'profile.html' },
    { key: 'settings', label: '系统设置', icon: 'fa-sliders', href: 'settings.html' }
  ];

  JA.renderSidebar = function () {
    var sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    var active = sidebar.dataset.nav || '';

    var navHtml = NAV_ITEMS.map(function (item) {
      return '<a href="' + item.href + '" class="nav-item' + (item.key === active ? ' is-active' : '') + '">' +
        '<i class="fa-solid ' + item.icon + '"></i><span>' + item.label + '</span>' +
        '</a>';
    }).join('');

    sidebar.innerHTML = `
      <div>
        <div class="sidebar-brand">
          <div class="sidebar-logo"><i class="fa-solid fa-bolt"></i></div>
          <div>
            <h1 class="font-bold text-slate-900 text-base leading-tight">JobAnalyzer</h1>
            <p class="text-xs text-slate-400 font-medium">技能与能力导向求职助手</p>
          </div>
        </div>

        <nav class="space-y-1.5">${navHtml}</nav>
      </div>

      <div class="storage-card">
        <div class="flex items-center justify-between text-xs text-slate-500 mb-2 font-medium">
          <span>本地缓存保护</span>
          <span class="text-emerald-600 font-semibold flex items-center gap-1">
            <i class="fa-solid fa-shield-halved"></i> 隐私安全
          </span>
        </div>
        <div class="storage-bar"><span style="width: 25%"></span></div>
        <p class="text-[11px] text-slate-400">数据全量存储于本地浏览器</p>
      </div>
    `;
  };

  document.addEventListener('DOMContentLoaded', JA.renderSidebar);
})(window.JA);
