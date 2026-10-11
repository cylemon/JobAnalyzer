import { useState } from 'react'
import type { JobCategoryWithStats } from '@shared/schemas/job'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { toErrorMessage } from '@/lib/errors'

/**
 * 移动岗位到其它分类（F-5.7）。
 *
 * 分类是录入时手选的，选错是常态；这里就是那条「改回来」的路，批量与单个共用
 * （单个 = 只选了一个岗位）。确认后由调用方真正发起请求并在成功后关闭，
 * 失败信息留在弹窗里——关掉弹窗再在页面上飘一行红字，用户会不知道该改什么。
 */

/** 描述里最多列几个岗位名，其余折叠成「等 N 个」——列满一屏反而看不清是哪些 */
const NAME_LIMIT = 3

export type MoveJobsRequest = {
  ids: string[]
  labels: string[]
  /** 这批岗位当前所在的分类（去重后）。只有一个时，该选项在弹窗里禁用 */
  currentCategoryIds: string[]
}

export function MoveJobsDialog({
  request,
  categories,
  onClose,
  onConfirm,
}: {
  request: MoveJobsRequest
  categories: JobCategoryWithStats[]
  onClose: () => void
  onConfirm: (categoryId: string) => Promise<void>
}) {
  const [categoryId, setCategoryId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const count = request.labels.length
  // 全都已经在同一个分类里时，把它从选项里去掉：移到自己身上是一次空操作
  const sameCategory = request.currentCategoryIds.length === 1 ? request.currentCategoryIds[0] : null
  const options = categories.filter((category) => category.id !== sameCategory)
  const target = categories.find((category) => category.id === categoryId)

  const shown = request.labels.slice(0, NAME_LIMIT).join('」「')
  const rest = count - Math.min(count, NAME_LIMIT)

  async function handleSubmit() {
    if (categoryId === '' || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(categoryId)
    } catch (cause) {
      setError(toErrorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={count === 1 ? '移动岗位到其它分类' : `移动 ${count} 个岗位到其它分类`}
      description={`将「${shown}」${rest > 0 ? `等 ${count} 个岗位` : ''}移动到：`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            type="button"
            disabled={categoryId === '' || submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? '移动中…' : '确认移动'}
          </Button>
        </>
      }
    >
      {error != null && (
        <div className="rounded-control bg-bad-soft px-3.5 py-2.5 text-sm leading-relaxed text-bad-ink">
          {error}
        </div>
      )}

      {options.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {categories.length === 0
            ? '还没有岗位分类，请先在岗位录入里新建一个分类。'
            : '没有其它分类可以移动，请先在岗位录入里新建一个分类。'}
        </p>
      ) : (
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold text-ink">目标分类</span>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">请选择目标分类</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}（{category.jobCount} 个岗位）
              </option>
            ))}
          </Select>
        </label>
      )}

      {target !== undefined && (
        <p className="text-xs leading-relaxed text-ink-muted">
          移动只改变岗位的归属，要求条目与匹配度原样保留；「{target.name}」现有{' '}
          {target.jobCount} 个岗位。
        </p>
      )}
    </Modal>
  )
}
