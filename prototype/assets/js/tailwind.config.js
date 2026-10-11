/* ==========================================================================
   tailwind.config.js —— Tailwind Play CDN 配置（四个页面共用一份）
   依赖 theme.js，必须在 CDN 脚本与 theme.js 之后加载。
   ========================================================================== */

tailwind.config = {
  theme: {
    extend: {
      colors: {
        brand: JA.theme.colors.brand
      }
    }
  }
};
