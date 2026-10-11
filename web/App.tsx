import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Briefcase,
  ChartPie,
  FlaskConical,
  HardDrive,
  ShieldHalf,
  SlidersHorizontal,
  UserCog,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { IS_DEMO } from '@/lib/bootstrap'
import { DashboardPage } from '@/views/DashboardPage'
import { JobsPage } from '@/views/JobsPage'
import { ProfilePage } from '@/views/ProfilePage'
import { SettingsPage } from '@/views/SettingsPage'
import { ICON_SIZE } from '@/lib/icons'

type ViewId = 'dashboard' | 'jobs' | 'profile' | 'settings'

type NavItem = { id: ViewId; label: string; icon: LucideIcon }

/**
 * 导航四项，与原型一致（prototype/assets/js/layout.js 的 NAV_ITEMS）：
 * 综合看板 / 岗位信息 / 个人信息 / 系统设置。
 * 图标按原型选的 lucide 同形替代：饼图 / 公文包 / 人+齿轮 / 推子。
 */
const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: '综合看板', icon: ChartPie },
  { id: 'jobs', label: '岗位信息', icon: Briefcase },
  { id: 'profile', label: '个人信息', icon: UserCog },
  { id: 'settings', label: '系统设置', icon: SlidersHorizontal },
]

/** 用 URL hash 记住当前页：刷新后还在原来那一屏，也方便直接把某一页发给别人 */
function viewFromHash(): ViewId {
  const hash = window.location.hash.replace('#', '')
  return NAV_ITEMS.some((item) => item.id === hash) ? (hash as ViewId) : 'dashboard'
}

export function App() {
  const [view, setView] = useState<ViewId>(viewFromHash)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const syncFromHash = () => setView(viewFromHash())
    window.addEventListener('hashchange', syncFromHash)
    return () => window.removeEventListener('hashchange', syncFromHash)
  }, [])

  /**
   * 换页时把滚动位置归零。
   *
   * 滚动容器是整站共用的 <main>，换页只是换里面的孩子，位置会原样留着 ——
   * 上一页滚到一半，下一页就从中段开始显示。必须是 layout effect：赶在浏览器
   * 绘制前改完，否则新页面会先按旧位置画一帧再跳回顶部，那一下比不归零还显眼。
   */
  useLayoutEffect(() => {
    mainRef.current?.scrollTo(0, 0)
  }, [view])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      {/* 演示模式说明条（静态演示站专用，本机运行时整条不出现）。
          放在整站最顶上而不是页内：它说的是"你正在看的这一份是什么"，
          与当前在哪一页无关；同时也避开了页头的吸顶区，不打扰任何版式。 */}
      {IS_DEMO && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-warn-line bg-warn-soft px-5 py-2 text-center text-xs leading-relaxed text-warn-ink">
          <FlaskConical size={ICON_SIZE.inline} className="shrink-0" aria-hidden />
          <span>
            演示模式：数据是构造的示例，模型回复由预置内容顶替，刷新页面即恢复初始状态。
            完整版在你自己的机器上运行，数据与密钥都不出本机。
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 侧栏白底、内容落灰底，两者之间只留一条竖线。
            宽度 18rem 是跟品牌区一起定下来的：应用名 20px、简介 14px 时，
            「技能与能力导向求职助手」正好一行放得下（11 个字 = 154px） */}
        <aside className="flex w-72 shrink-0 flex-col justify-between border-r border-line bg-surface p-5">
          <div>
            {/* 品牌区：方块用主色实底，不用渐变 —— 渐变是给横幅的，小方块上只会糊成一块 */}
            <div className="mb-8 flex items-center gap-3 px-2">
              <span className="bg-accent shadow-logo grid size-11 shrink-0 place-items-center rounded-control">
                {/* 实心闪电：lucide 默认只描边，填色才是原型那个「一整块白」的闪电 */}
                <Zap size={ICON_SIZE.brand} className="fill-current text-white" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-xl leading-tight font-bold tracking-tight text-ink">JobAnalyzer</span>
                <span className="text-sm font-medium text-ink-faint">技能与能力导向求职助手</span>
              </span>
            </div>

            <nav className="space-y-1.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                const active = view === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setView(item.id)
                      window.location.hash = item.id
                    }}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-3 rounded-control px-3.5 py-2.5 text-left text-base transition-colors outline-none',
                      'focus-visible:ring-2 focus-visible:ring-accent/40',
                      // 选中态是一块淡紫底，不是实心主色块：侧栏只是导航，
                      // 实心块会把视觉重量从内容区抢走
                      active
                        ? 'bg-accent-soft font-semibold text-accent-ink'
                        : 'font-medium text-ink-muted hover:bg-surface-muted hover:text-ink',
                    )}
                  >
                    <Icon
                      size={ICON_SIZE.nav}
                      className={cn('shrink-0', active ? 'text-accent-ink' : 'text-ink-faint')}
                      aria-hidden
                    />
                    <span className="leading-tight">{item.label}</span>
                  </button>
                )
              })}
            </nav>
          </div>

          {/* 这块只讲一件事：数据在本机。左「存在哪」右「安不安全」，一行说完。
              字号跟着上面的导航走（14px），右侧标签再退一档 —— 卡片里那点差别
              靠字重和颜色就够了，不必缩到 11px 去 */}
          <div className="flex items-center justify-between rounded-card border border-line bg-surface-muted p-3.5 text-sm">
            <span className="flex items-center gap-1.5 font-semibold text-ink">
              <HardDrive size={ICON_SIZE.control} className="shrink-0 text-accent" aria-hidden />
              纯本地存储
            </span>
            <span className="flex items-center gap-1 text-xs font-semibold text-ok-ink">
              <ShieldHalf size={ICON_SIZE.inline} aria-hidden />
              隐私安全
            </span>
          </div>
        </aside>

        <main ref={mainRef} className="scroll-area flex-1 overflow-y-auto bg-canvas">
          {view === 'dashboard' && <DashboardPage />}
          {view === 'jobs' && <JobsPage />}
          {view === 'profile' && <ProfilePage />}
          {view === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}
