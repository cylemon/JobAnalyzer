/* ==========================================================================
   store.js —— 本地缓存读写封装（localStorage）
   原型阶段只有「系统设置」页做持久化，其余页面为内存态；
   统一从这里读写，key 不再散落在各页面里。
   ========================================================================== */

window.JA = window.JA || {};

(function (JA) {
  'use strict';

  var PREFIX = 'jobanalyzer_';

  JA.store = {
    keys: {
      llmProviders: PREFIX + 'llm_providers',
      globalSettings: PREFIX + 'global_settings'
    },

    /* 读取失败（无缓存 / JSON 损坏 / 浏览器禁用本地存储）时返回 fallback */
    get: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (error) {
        console.warn('[JA] 读取本地缓存失败：' + key, error);
        return fallback;
      }
    },

    set: function (key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        console.warn('[JA] 写入本地缓存失败：' + key, error);
      }
    },

    clear: function (key) {
      try {
        window.localStorage.removeItem(key);
      } catch (error) {
        console.warn('[JA] 清除本地缓存失败：' + key, error);
      }
    }
  };
})(window.JA);
