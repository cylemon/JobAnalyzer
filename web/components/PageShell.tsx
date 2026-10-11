import type { ReactNode } from 'react'

/**
 * 页面骨架（对应原型的 .page-sticky / .page-body）。
 *
 * 四个页面共用同一套结构：吸顶的页头区（标题 + 副标题 + 右上角操作 + 页面主横幅），
 * 下面是可滚动的内容区。位置相同的信息必须格式一致——标题字号、内边距、
 * 分区间距全部收敛到这里，各页面只提供内容。
 *
 * 滚动容器是 App 里的 <main>，吸顶因此相对它生效；
 * 中间任何一层都不能出现 overflow，否则 sticky 会失效。
 */
export function PageSticky({ children }: { children: ReactNode }) {
  return <div className="sticky top-0 z-20 bg-canvas px-7 pt-7 pb-4">{children}</div>
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="space-y-6 px-7 pb-8">{children}</div>
}

/**
 * 页面宽度的**唯一**决定处：四个页面共用，谁都不许自己加宽度上限。
 *
 * 原来这里有个 `mx-auto max-w-7xl`，岗位页又用 full 属性绕开它 ——
 * 同一件事两个开关，结果就是「岗位页铺满、其余三页收在 1280」这种
 * 互相对不上的版式。宽度是整站的公共尺寸，只能在公共层写一次。
 */
export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="w-full">{children}</div>
}
