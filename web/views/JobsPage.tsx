import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  BriefcaseBusiness,
  FolderInput,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import type { JobCategoryWithStats } from '@shared/schemas/job'
import { JOB_STATUS_LABEL, JOB_STATUS_ORDER } from '@shared/schemas/job'
import type { JobBoard, JobBoardOrder, JobBoardSort } from '@shared/schemas/jobBoard'
import { CategoryManagerDialog } from '@/components/CategoryManagerDialog'
import { EvaluationStatus } from '@/components/EvaluationStatus'
import { Feedback, type FeedbackMessage } from '@/components/Feedback'
import { JobCard } from '@/components/JobCard'
import { MoveJobsDialog, type MoveJobsRequest } from '@/components/MoveJobsDialog'
import { PageHeader } from '@/components/PageHeader'
import { PageBody, PageContainer, PageSticky } from '@/components/PageShell'
import { SectionHeader } from '@/components/SectionHeader'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Select } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/modal'
import { toErrorMessage } from '@/lib/errors'
import { jobDisplayName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CategoryAnalysisModal } from '@/views/CategoryAnalysisModal'
import { JobDetailDrawer } from '@/views/JobDetailDrawer'
import { JobIngestDialog } from '@/views/JobIngestDialog'
import { api } from '@/services/api'
import { useReevaluationRevision } from '@/services/reevaluationStore'
import { ICON_SIZE } from '@/lib/icons'

/**
 * 岗位模块（F-5）：列表 + 筛选 + 录入 + 深度分析 + 多选批量操作。
 *
 * 筛选与排序都发给服务端算——前端只渲染结果与 facets，
 * 否则「哪些岗位算有效」「怎么排序」会出现第二套口径，和看板对不上。
 *
 * 「岗位列表」是一个与个人信息页「专业知识」同构的分区：标题 + 计数在左、主操作在右，
 * 下面才是内容（空态框或岗位卡片）。多选与批量操作也只作用于当前列表里看得见的岗位。
 */

const SORT_OPTIONS: { value: JobBoardSort; label: string }[] = [
  { value: 'composite', label: '综合匹配度' },
  { value: 'createdAt', label: '已录入天数' },
  { value: 'minSalary', label: '最低薪资' },
]

/** 确认框里最多列几个岗位名，其余折叠成「等 N 个」 */
const NAME_LIMIT = 3

/**
 * 筛选条里的控件（原型的 .filter-control）：底色比横幅本身还深一档。
 * 不用白色半透明去提亮——那是「浮起来」，而输入框/下拉在整站都是**凹槽**，
 * 提亮会让它们看起来贴在横幅上面。
 *
 * 这些下拉的 `<option>` 必须**显式**写 `bg-surface`：浮层会沿用 select 自己的深色底，
 * 只给文字色（text-ink）的话，展开后是深字压深底，不悬停到那一项就一个字都看不见。
 */
const FILTER_CONTROL =
  'border-on-hero-line bg-accent-deeper/70 text-white placeholder:text-on-hero-faint hover:bg-accent-deeper/90 focus:border-on-hero-focus focus:bg-accent-deeper focus:ring-on-hero-focus'

export function JobsPage() {
  const [board, setBoard] = useState<JobBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null)
  const [busy, setBusy] = useState(false)
  // 岗位录入要的是**全部分类**，不能拿 board.facets.categories 顶替：
  // facets 为了让筛选条保持干净，会把「岗位数为 0」的选项滤掉，
  // 而恰恰是最需要录入的时候（分类刚建好、一个岗位都还没有）它必然为 0。
  const [categories, setCategories] = useState<JobCategoryWithStats[]>([])

  // 筛选条件
  const [keyword, setKeyword] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [city, setCity] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<JobBoardSort>('composite')
  const [order, setOrder] = useState<JobBoardOrder>('desc')

  // 多选。存的是「当前列表里被勾中的岗位 id」——换筛选条件后看不见的会被清掉，
  // 否则批量删除会波及屏幕上根本没显示的记录。
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const selectAllRef = useRef<HTMLInputElement>(null)

  // 弹窗
  const [ingestOpen, setIngestOpen] = useState(false)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [detailJobId, setDetailJobId] = useState<string | null>(null)
  const [analysisCategoryId, setAnalysisCategoryId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false)
  const [moveRequest, setMoveRequest] = useState<MoveJobsRequest | null>(null)

  const query = useMemo(
    () => ({
      ...(keyword.trim() !== '' ? { q: keyword.trim() } : {}),
      ...(categoryId !== '' ? { categoryId } : {}),
      ...(city !== '' ? { city } : {}),
      ...(status !== '' ? { status } : {}),
      sort,
      order,
    }),
    [keyword, categoryId, city, status, sort, order],
  )

  const load = useCallback(async () => {
    setBoard(await api.getJobBoard(query))
  }, [query])

  const loadCategories = useCallback(async () => {
    setCategories(await api.listCategories())
  }, [])

  useEffect(() => {
    void loadCategories().catch((cause: unknown) =>
      setFeedback({ tone: 'error', text: toErrorMessage(cause) }),
    )
  }, [loadCategories])

  useEffect(() => {
    let cancelled = false
    // 关键词输入时不必每个字符都打一次请求
    const timer = setTimeout(() => {
      load()
        .catch((cause: unknown) => {
          if (!cancelled) setFeedback({ tone: 'error', text: toErrorMessage(cause) })
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, keyword === '' ? 0 : 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [load, keyword])

  /**
   * 自评 / 履历一变、自动重评估跑完一轮 → 修订号变化 → 重取列表。
   *
   * 不这样做的话，卡片上的分数与「待重新评估」徽章会一直停在打开这一页时的样子：
   * 判定明明已经重跑过了，界面还在说它旧。0 表示本次进程还没发生过变更，
   * 页面挂载时本来就拉过一次，不必再拉。
   */
  const revision = useReevaluationRevision()
  useEffect(() => {
    if (revision === 0) return
    void load().catch((cause: unknown) =>
      setFeedback({ tone: 'error', text: toErrorMessage(cause) }),
    )
  }, [revision, load])

  const items = useMemo(() => board?.items ?? [], [board])

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.job.id)),
    [items, selectedIds],
  )

  /** 列表一变就把已选中的 id 收敛到还看得见的那些：筛掉或删掉的岗位不能留在选择里 */
  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current
      const visible = new Set(items.map((item) => item.job.id))
      const next = new Set([...current].filter((id) => visible.has(id)))
      return next.size === current.size ? current : next
    })
  }, [items])

  const allSelected = items.length > 0 && selectedItems.length === items.length
  // 选了一半时「全选」框要显示成半选，否则看不出还差几条
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedItems.length > 0 && !allSelected
    }
  }, [selectedItems.length, allSelected])

  /**
   * 写操作的统一收尾：改完重拉列表，失败把原因显示在列表上方。
   *
   * **没有成功提示**：这里的写操作（改状态、删除、批量删除）结果当场就在列表里
   * ——那一行变了或没了、计数也跟着变。再飘一条「已…」只是重复播报。
   * 失败必须报：岗位还在原地，用户得知道这次没生效。
   */
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      await load()
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(items.map((item) => item.job.id)))
  }

  /** 打开移动弹窗：单个岗位（卡片上的按钮）与批量走的是同一个弹窗 */
  function openMove(ids: readonly string[]) {
    const targets = items.filter((item) => ids.includes(item.job.id))
    if (targets.length === 0) return
    setMoveRequest({
      ids: [...ids],
      labels: targets.map((item) => jobDisplayName(item.job)),
      currentCategoryIds: [...new Set(targets.map((item) => item.categoryId))],
    })
  }

  /**
   * 移动由弹窗自己发起（见 MoveJobsDialog）：失败了要把原因留在弹窗里，
   * 因此这里不吞异常，成功才关闭。
   */
  async function handleMove(categoryId: string) {
    if (!moveRequest) return
    const ids = moveRequest.ids
    await api.moveJobs(ids, categoryId)
    setMoveRequest(null)
    // 移动成功不弹提示：卡片上的「岗位分类」字段当场就换成了新分类
    void load().catch((cause: unknown) =>
      setFeedback({ tone: 'error', text: toErrorMessage(cause) }),
    )
  }

  const activeCategoryName = board?.facets.categories.find((item) => item.id === categoryId)?.name
  const selectedLabels = selectedItems.map((item) => jobDisplayName(item.job))

  return (
    <PageContainer>
      <PageSticky>
        <PageHeader title="岗位信息管理" />

        {/* 筛选条 */}
        <div className="bg-hero relative mt-4 overflow-hidden rounded-card p-4 shadow-hero">
          <span
            className="pointer-events-none absolute -top-10 -left-10 size-44 rounded-full bg-on-hero-fill blur-3xl"
            aria-hidden
          />
          <div className="relative z-10 flex flex-wrap items-center gap-3">
            <div className="relative w-64">
              <Search
                size={ICON_SIZE.control}
                className="absolute top-1/2 left-3 -translate-y-1/2 text-on-hero-faint"
                aria-hidden
              />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索公司、职位、业务或城市…"
                className={cn('pl-9', FILTER_CONTROL)}
              />
            </div>

            <Select
              aria-label="按分类筛选"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={cn('w-40', FILTER_CONTROL)}
            >
              <option value="" className="bg-surface text-ink">
                所有岗位分类
              </option>
              {(board?.facets.categories ?? []).map((option) => (
                <option key={option.id} value={option.id} className="bg-surface text-ink">
                  {option.name}（{option.count}）
                </option>
              ))}
            </Select>

            <Select
              aria-label="按城市筛选"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={cn('w-32', FILTER_CONTROL)}
            >
              <option value="" className="bg-surface text-ink">
                所有城市
              </option>
              {(board?.facets.cities ?? []).map((option) => (
                <option key={option.city} value={option.city} className="bg-surface text-ink">
                  {option.city}（{option.count}）
                </option>
              ))}
            </Select>

            <Select
              aria-label="按状态筛选"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={cn('w-32', FILTER_CONTROL)}
            >
              <option value="" className="bg-surface text-ink">
                所有状态
              </option>
              {JOB_STATUS_ORDER.map((option) => (
                <option key={option} value={option} className="bg-surface text-ink">
                  {JOB_STATUS_LABEL[option]}
                </option>
              ))}
            </Select>

            {categoryId !== '' && (
              <Button
                variant="soft"
                size="sm"
                className="border-on-hero-line bg-on-hero-fill text-white hover:bg-on-hero-fill-hover"
                onClick={() => setAnalysisCategoryId(categoryId)}
              >
                综合分析 · {activeCategoryName}
              </Button>
            )}

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-medium text-on-hero-muted">排序规则</span>
              <Select
                aria-label="排序规则"
                value={sort}
                onChange={(e) => setSort(e.target.value as JobBoardSort)}
                className={cn('w-32', FILTER_CONTROL)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="bg-surface text-ink">
                    {option.label}
                  </option>
                ))}
              </Select>
              <Button
                variant="soft"
                size="sm"
                // 与同排的下拉同高：一排控件里只它矮 4px，看上去像没对齐
                className={cn('h-9', FILTER_CONTROL)}
                aria-label={order === 'desc' ? '切换为升序' : '切换为降序'}
                onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}
              >
                {order === 'desc' ? <ArrowDownWideNarrow size={ICON_SIZE.control} /> : <ArrowUpNarrowWide size={ICON_SIZE.control} />}
                {order === 'desc' ? '降序' : '升序'}
              </Button>
            </div>
          </div>
        </div>
      </PageSticky>

      <PageBody>
        <Feedback message={feedback} className="mb-0" />

        {/* 资产一改，下面这些卡片上的能力/经验判词就不再可信 ——
            自动流程已经在处理了，这一行负责把「正在处理」说清楚 */}
        <EvaluationStatus />

        <section className="space-y-4">
          <SectionHeader
            title="岗位列表"
            meta={
              board !== null && (
                <>
                  共 {board.total} 个岗位
                  {board.matched !== board.total && `，当前筛选命中 ${board.matched} 个`}
                  {board.averageComposite !== null &&
                    ` · 筛选结果平均综合匹配度 ${board.averageComposite}%`}
                </>
              )
            }
            action={
              <Button size="sm" onClick={() => setIngestOpen(true)}>
                <Plus size={ICON_SIZE.control} />
                岗位录入
              </Button>
            }
          />

          {/* 多选工具条：只在有岗位可勾选时出现。不套卡片框——它是一行操作，
              框起来会和下面的岗位卡片抢层次，也把「岗位列表」和内容拉显得更远 */}
          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="size-4 cursor-pointer accent-accent"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="全选当前列表中的岗位"
                />
                全选
              </label>

              {selectedItems.length > 0 && (
                <>
                  <span className="text-xs font-medium text-ink-muted">
                    已选 {selectedItems.length} 个岗位
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button
                      variant="soft"
                      size="sm"
                      disabled={busy}
                      onClick={() => openMove([...selectedIds])}
                    >
                      <FolderInput size={ICON_SIZE.control} />
                      移动到分类
                    </Button>
                    <Button
                      variant="softDanger"
                      size="sm"
                      disabled={busy}
                      onClick={() => setPendingBatchDelete(true)}
                    >
                      <Trash2 size={ICON_SIZE.control} />
                      删除所选
                    </Button>
                    <Button
                      variant="softNeutral"
                      size="sm"
                      disabled={busy}
                      onClick={() => setSelectedIds(new Set())}
                    >
                      取消选择
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {loading && board === null && <p className="text-sm text-ink-muted">正在读取岗位…</p>}

          {board !== null && items.length === 0 && (
            <EmptyState
              icon={BriefcaseBusiness}
              title={board.total === 0 ? '还没有录入任何岗位' : '没有符合条件的岗位'}
              hint={board.total === 0 ? undefined : '试试放宽筛选条件，或把关键词清空。'}
            />
          )}

          <div className="space-y-4">
            {items.map((item) => (
              <JobCard
                key={item.job.id}
                item={item}
                busy={busy}
                selected={selectedIds.has(item.job.id)}
                onToggleSelect={() => toggleSelect(item.job.id)}
                onOpen={() => setDetailJobId(item.job.id)}
                // 改状态不弹成功提示：胶囊上的字当场就变了，再飘一条「已标记为…」
                // 是重复播报。失败仍由 Feedback 显示在列表上方。
                onStatusChange={(next) =>
                  void run(() => api.updateJob(item.job.id, { status: next }))
                }
                onMove={() => openMove([item.job.id])}
                onDelete={() => setPendingDelete({ id: item.job.id, title: jobDisplayName(item.job) })}
              />
            ))}
          </div>
        </section>
      </PageBody>

      {/* ------------------------------------------------------------- 弹窗 */}

      {ingestOpen && (
        <JobIngestDialog
          categories={categories}
          onClose={() => setIngestOpen(false)}
          // 录入成功不弹提示：新岗位立刻出现在下面的列表里，再飘一条「已录入」是重复播报。
          // 失败仍由录入弹窗自己显示（它要留在原地让用户改），所以这里什么都不用做。
          onSaved={() => {
            void load()
          }}
          // 录入弹窗**不关**：里面可能已经粘好一大段 JD，关掉就白粘了。
          // 分类管理叠在它上面，建完分类关掉就回到原处，选择框自己跟上。
          onNeedCategoryManager={() => setCategoryManagerOpen(true)}
        />
      )}

      {categoryManagerOpen && (
        <CategoryManagerDialog
          elevated={ingestOpen}
          onClose={() => setCategoryManagerOpen(false)}
          onChanged={() => {
            void load()
            void loadCategories()
          }}
        />
      )}

      {detailJobId !== null && (
        <JobDetailDrawer
          jobId={detailJobId}
          onClose={() => setDetailJobId(null)}
          onChanged={() => {
            void load()
          }}
        />
      )}

      {analysisCategoryId !== null && (
        <CategoryAnalysisModal
          categoryId={analysisCategoryId}
          onClose={() => setAnalysisCategoryId(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="确定要删除该岗位吗？"
          message={`「${pendingDelete.title}」及其全部要求条目会被删除，相关统计会立即重算。此操作无法撤销。`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const target = pendingDelete
            setPendingDelete(null)
            // 删除成功不弹提示：那一行当场就从列表里没了，再飘一条「已删除…」是重复播报。
            // 失败仍由 Feedback 显示在列表上方（这条岗位还在，得让用户知道没删掉）
            void run(() => api.deleteJob(target.id))
          }}
        />
      )}

      {pendingBatchDelete && (
        <ConfirmDialog
          title={`确定要删除选中的 ${selectedItems.length} 个岗位吗？`}
          message={`${summarizeNames(selectedLabels)}及其全部要求条目会被删除，相关统计会立即重算。此操作无法撤销。`}
          onCancel={() => setPendingBatchDelete(false)}
          onConfirm={() => {
            const ids = [...selectedIds]
            setPendingBatchDelete(false)
            setSelectedIds(new Set())
            // 同上：删掉的那几行连同计数一起当场消失，不需要再飘一条成功提示
            void run(() => api.deleteJobs(ids))
          }}
        />
      )}

      {moveRequest !== null && (
        <MoveJobsDialog
          request={moveRequest}
          categories={categories}
          onClose={() => setMoveRequest(null)}
          onConfirm={handleMove}
        />
      )}
    </PageContainer>
  )
}

/** 「A」「B」「C」——确认框里必须能认出动的是哪几条，又不能长到撑破弹窗 */
function summarizeNames(labels: readonly string[]): string {
  const quoted = labels
    .slice(0, NAME_LIMIT)
    .map((label) => `「${label}」`)
    .join('')
  return labels.length > NAME_LIMIT ? `${quoted} 等 ${labels.length} 个岗位` : quoted
}
