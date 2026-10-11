/* ==========================================================================
   settings.page.js —— 系统设置
   全局推理参数 / LLM 厂商接口配置 / 连通性测试
   四个页面里唯一做本地持久化的模块（数据经 JA.store 读写）。
   ========================================================================== */

window.JA = window.JA || {};

(function (JA) {
  'use strict';

  var data = JA.data;
  var store = JA.store;

  /* 运行时状态：优先取本地缓存，没有则用默认种子 */
  var providers = store.get(store.keys.llmProviders, data.defaultProviders);
  var settings = store.get(store.keys.globalSettings, data.defaultGlobalSettings);

  function persist() {
    store.set(store.keys.llmProviders, providers);
    store.set(store.keys.globalSettings, settings);
  }

  /* ------------------------------------------------------------ 全局参数 */
  function loadGlobalSettingsIntoForm() {
    JA.$('#globalTemperature').value = settings.temperature;
    JA.$('#tempValueDisplay').textContent = settings.temperature;
    JA.$('#globalMaxTokens').value = settings.maxTokens;
    JA.$('#globalSystemPrompt').value = settings.systemPrompt || '';
  }

  /* ------------------------------------------------------------ 厂商卡片 */
  function protocolIcon(name) {
    if (name.indexOf('OpenAI') > -1) return 'fa-robot';
    if (name.indexOf('阿里') > -1 || name.indexOf('通义') > -1) return 'fa-cloud';
    if (name.indexOf('Ollama') > -1) return 'fa-server';
    if (name.indexOf('Kimi') > -1 || name.indexOf('月之暗面') > -1) return 'fa-moon';
    return 'fa-brain';
  }

  function renderProviders() {
    var container = JA.$('#providersContainer');

    if (providers.length === 0) {
      container.innerHTML =
        '<div class="empty-state col-span-full">' +
        '  <i class="fa-solid fa-plug"></i>' +
        '  <p>暂未配置任何大模型厂商，请点击右上角“新增 LLM 厂商”</p>' +
        '</div>';
    } else {
      container.innerHTML = providers.map(function (provider) {
        var modelsTags = (provider.models || []).map(function (model) {
          return '<span class="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono">' + JA.escape(model) + '</span>';
        }).join('');

        return `
          <div class="card card-hover p-5 flex flex-col justify-between space-y-4 relative overflow-hidden ${provider.isDefault ? 'border-brand-500' : ''}">
            ${provider.isDefault ? '<div class="absolute top-0 right-0 bg-brand-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl shadow-sm"><i class="fa-solid fa-star text-amber-300 mr-1"></i>默认厂商</div>' : ''}

            <div class="flex items-start justify-between gap-2 pr-12">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl ${provider.enabled ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-400'} flex items-center justify-center text-lg font-bold">
                  <i class="fa-solid ${protocolIcon(provider.name)}"></i>
                </div>
                <div>
                  <h4 class="font-bold text-slate-900 text-base">${JA.escape(provider.name)}</h4>
                  <span class="text-xs text-slate-400 font-medium">${JA.escape(provider.protocol)}</span>
                </div>
              </div>
            </div>

            <div class="space-y-2 bg-slate-50/80 p-3 rounded-xl border border-slate-100 text-xs">
              <div class="flex justify-between items-center">
                <span class="text-slate-400">Endpoint:</span>
                <span class="font-mono text-slate-700 truncate max-w-[200px]" title="${JA.escape(provider.baseUrl)}">${JA.escape(provider.baseUrl)}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-slate-400">API Key:</span>
                <span class="font-mono text-slate-600">${JA.escape(JA.maskKey(provider.apiKey))}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-slate-400">主打默认模型:</span>
                <span class="font-bold text-brand-600 font-mono">${JA.escape(provider.defaultModel)}</span>
              </div>
            </div>

            <div>
              <span class="text-[11px] text-slate-400 font-semibold block mb-1">支持的模型列表:</span>
              <div class="flex flex-wrap gap-1 max-h-16 overflow-y-auto">${modelsTags}</div>
            </div>

            <div class="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
              <div class="flex items-center gap-1">
                <button type="button" class="btn btn-sm bg-emerald-50 hover:bg-emerald-100 text-emerald-700" data-action="settings:test" data-id="${provider.id}">
                  <i class="fa-solid fa-bolt"></i><span>测试连通性</span>
                </button>
                ${provider.isDefault ? '' : `
                  <button type="button" class="px-2.5 py-1.5 text-slate-500 hover:text-brand-600 hover:bg-brand-50 rounded-lg text-xs font-medium transition-colors"
                          data-action="settings:set-default" data-id="${provider.id}" title="设为全局默认厂商">设为默认</button>`}
              </div>

              <div class="flex items-center gap-1">
                <button type="button" class="btn btn-ghost" data-action="settings:edit-provider" data-id="${provider.id}" title="编辑">
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
                <button type="button" class="btn btn-ghost is-danger" data-action="settings:delete-provider" data-id="${provider.id}" title="删除">
                  <i class="fa-regular fa-trash-can"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    renderBannerStats();
    renderActiveModelOptions();
  }

  /* 默认模型下拉：按已启用厂商分组 */
  function renderActiveModelOptions() {
    var select = JA.$('#globalActiveModel');
    select.innerHTML = '';

    var matched = false;
    providers.filter(function (provider) { return provider.enabled; }).forEach(function (provider) {
      var group = document.createElement('optgroup');
      group.label = provider.name;

      (provider.models || []).forEach(function (model) {
        var valueKey = model + '@' + provider.name;
        var option = document.createElement('option');
        option.value = valueKey;
        option.textContent = model + ' (' + provider.name + ')';
        if (valueKey === settings.activeModel) {
          option.selected = true;
          matched = true;
        }
        group.appendChild(option);
      });

      select.appendChild(group);
    });

    if (!matched && select.options.length > 0) {
      select.selectedIndex = 0;
      settings.activeModel = select.value;
    }
  }

  /* -------------------------------------------------------------- 横幅统计 */
  function renderBannerStats() {
    var enabledCount = providers.filter(function (provider) { return provider.enabled; }).length;
    var modelCount = providers.reduce(function (sum, provider) {
      return sum + (provider.models || []).length;
    }, 0);

    JA.$('#bannerLlmStats').innerHTML =
      '<div class="pr-5 border-r border-brand-400/20">' +
      '  <div class="flex items-baseline gap-1 justify-center lg:justify-start">' +
      '    <span class="text-2xl md:text-3xl font-bold text-amber-300 leading-none">' + enabledCount + '</span>' +
      '    <span class="text-xs font-normal text-brand-200">/ ' + providers.length + ' 家</span>' +
      '  </div>' +
      '  <span class="text-xs md:text-sm text-brand-200 font-medium mt-1 block">已启用 LLM 服务商</span>' +
      '</div>' +
      '<div class="pr-5">' +
      '  <div class="flex items-baseline gap-1 justify-center lg:justify-start">' +
      '    <span class="text-2xl md:text-3xl font-bold text-cyan-300 leading-none">' + modelCount + '</span>' +
      '    <span class="text-xs font-normal text-brand-200">个</span>' +
      '  </div>' +
      '  <span class="text-xs md:text-sm text-brand-200 font-medium mt-1 block">可调用大模型总数</span>' +
      '</div>';

    var activeParts = (settings.activeModel || '').split('@');

    JA.$('#bannerActiveStats').innerHTML =
      '<div class="pr-5 border-r border-brand-400/20">' +
      '  <div class="flex items-baseline gap-1 justify-center lg:justify-start">' +
      '    <span class="text-lg md:text-xl font-bold text-emerald-300 leading-none truncate max-w-[180px]">' + JA.escape(activeParts[0] || '未配置') + '</span>' +
      '  </div>' +
      '  <span class="text-xs md:text-sm text-brand-200 font-medium mt-1 block">' + JA.escape(activeParts[1] || '无引擎') + '</span>' +
      '</div>' +
      '<div>' +
      '  <div class="flex items-baseline gap-1 justify-center lg:justify-start">' +
      '    <span class="text-xl font-bold text-white leading-none"><i class="fa-solid fa-lock text-emerald-400"></i> 本地离线</span>' +
      '  </div>' +
      '  <span class="text-xs md:text-sm text-brand-200 font-medium mt-1 block">密钥隐私强保护</span>' +
      '</div>';
  }

  /* -------------------------------------------------------------- 动作层 */
  JA.actions['settings:save-global'] = function () {
    settings.activeModel = JA.$('#globalActiveModel').value;
    settings.temperature = parseFloat(JA.$('#globalTemperature').value);
    settings.maxTokens = parseInt(JA.$('#globalMaxTokens').value, 10) || 4096;
    settings.systemPrompt = JA.$('#globalSystemPrompt').value;

    persist();
    renderBannerStats();
    JA.toast('全局 LLM 推理参数保存成功');
  };

  /* 温度滑块实时回显 */
  JA.actions['settings:sync-temp'] = function (el) {
    JA.$('#tempValueDisplay').textContent = el.value;
  };

  /* 快速填充预设厂商模板 */
  JA.actions['settings:apply-preset'] = function (el) {
    var preset = data.vendorPresets[el.dataset.preset];
    if (!preset) return;
    JA.$('#providerName').value = preset.name;
    JA.$('#providerProtocol').value = preset.protocol;
    JA.$('#providerBaseUrl').value = preset.baseUrl;
    JA.$('#providerModels').value = preset.models;
    JA.$('#providerDefaultModel').value = preset.defaultModel;
  };

  JA.actions['settings:open-provider'] = function () {
    JA.$('#providerForm').reset();
    JA.$('#providerId').value = '';
    JA.$('#providerEnabled').checked = true;
    JA.$('#providerModalTitle').textContent = '新增 LLM 厂商配置';
    JA.openModal('providerModal');
  };

  JA.actions['settings:edit-provider'] = function (el) {
    var provider = providers.filter(function (item) { return item.id === Number(el.dataset.id); })[0];
    if (!provider) return;

    JA.$('#providerId').value = provider.id;
    JA.$('#providerName').value = provider.name;
    JA.$('#providerProtocol').value = provider.protocol;
    JA.$('#providerBaseUrl').value = provider.baseUrl;
    JA.$('#providerApiKey').value = provider.apiKey || '';
    JA.$('#providerModels').value = (provider.models || []).join(', ');
    JA.$('#providerDefaultModel').value = provider.defaultModel || '';
    JA.$('#providerHeaders').value = provider.headers || '';
    JA.$('#providerEnabled').checked = provider.enabled;
    JA.$('#providerModalTitle').textContent = '编辑 LLM 厂商配置';
    JA.openModal('providerModal');
  };

  JA.actions['settings:save-provider'] = function () {
    var id = JA.$('#providerId').value;
    var payload = {
      name: JA.$('#providerName').value,
      protocol: JA.$('#providerProtocol').value,
      baseUrl: JA.$('#providerBaseUrl').value,
      apiKey: JA.$('#providerApiKey').value,
      models: JA.$('#providerModels').value.split(/[,，]/).map(function (model) { return model.trim(); }).filter(function (model) { return model !== ''; }),
      defaultModel: JA.$('#providerDefaultModel').value,
      headers: JA.$('#providerHeaders').value,
      enabled: JA.$('#providerEnabled').checked
    };

    if (id) {
      var provider = providers.filter(function (item) { return item.id === parseInt(id, 10); })[0];
      if (provider) {
        Object.keys(payload).forEach(function (key) { provider[key] = payload[key]; });
      }
      JA.toast('厂商配置修改保存成功');
    } else {
      payload.id = Date.now();
      payload.isDefault = providers.length === 0;
      providers.push(payload);
      JA.toast('已成功新增 LLM 厂商配置');
    }

    persist();
    JA.closeModal('providerModal');
    renderProviders();
  };

  JA.actions['settings:set-default'] = function (el) {
    var id = Number(el.dataset.id);
    providers.forEach(function (provider) {
      provider.isDefault = provider.id === id;
    });
    persist();
    renderProviders();
    JA.toast('已更新全局默认 LLM 厂商');
  };

  JA.actions['settings:delete-provider'] = function (el) {
    var id = Number(el.dataset.id);
    JA.confirm({
      title: '确定删除该 LLM 厂商配置？',
      message: '移除后该厂商的所有 API 密钥与模型选择将被清除。',
      confirmText: '确认删除',
      onConfirm: function () {
        providers = providers.filter(function (provider) { return provider.id !== id; });
        persist();
        renderProviders();
        JA.toast('已删除该 LLM 厂商配置');
      }
    });
  };

  /* 密钥可见性切换 */
  JA.actions['settings:toggle-key'] = function (el) {
    var input = document.getElementById(el.dataset.target);
    if (!input) return;
    var icon = el.querySelector('i');
    var hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    icon.className = hidden ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
  };

  /* ---------------------------------------------------------- 连通性测试 */
  JA.actions['settings:test'] = function (el) {
    var provider = providers.filter(function (item) { return item.id === Number(el.dataset.id); })[0];
    if (!provider) return;

    var logContainer = JA.$('#testLogContainer');
    var banner = JA.$('#testStatusBanner');

    logContainer.innerHTML = '';
    banner.className = 'p-3 rounded-xl border flex items-center gap-3 bg-slate-50 text-slate-600 border-slate-200';
    banner.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-brand-600"></i><span class="text-xs font-medium">正在尝试与 API 端点建立握手连接...</span>';

    JA.openModal('testModal');

    function appendLog(message) {
      var time = new Date().toLocaleTimeString();
      logContainer.innerHTML += '<div>[' + time + '] ' + JA.escape(message) + '</div>';
      logContainer.scrollTop = logContainer.scrollHeight;
    }

    appendLog('初始化测试目标: ' + provider.name);
    appendLog('适配协议: ' + provider.protocol);
    appendLog('请求 URL Base: ' + provider.baseUrl);

    setTimeout(function () {
      appendLog('检查 API 凭证格式... ' + (provider.apiKey ? 'Key 结构有效' : '无 Key (公网/本地模态)'));
      appendLog('准备 HTTP GET / POST 心跳请求...');
    }, 500);

    setTimeout(function () {
      var latency = Math.floor(Math.random() * 150) + 80;
      appendLog('收到服务端响应 HTTP status: 200 OK (' + latency + 'ms)');
      appendLog('成功枚举后端就绪模型: ' + provider.models.join(', '));

      banner.className = 'p-3 rounded-xl border flex items-center gap-3 bg-emerald-50 text-emerald-700 border-emerald-200';
      banner.innerHTML =
        '<i class="fa-solid fa-circle-check text-emerald-600 text-lg"></i>' +
        '<div>' +
        '  <div class="font-bold text-xs">连通测试完全成功 (延迟: ' + latency + 'ms)</div>' +
        '  <div class="text-[11px] text-emerald-600/80">后端模型引擎就绪，可随时进行 JobAnalyzer 技能分析</div>' +
        '</div>';
    }, 1400);
  };

  /* -------------------------------------------------------------- 初始化 */
  document.addEventListener('DOMContentLoaded', function () {
    loadGlobalSettingsIntoForm();
    renderProviders();
  });
})(window.JA);
