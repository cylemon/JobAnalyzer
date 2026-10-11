import { useEffect, useState, type FormEvent } from 'react'
import { Check, FolderPlus, Pencil, Trash2, X } from 'lucide-react'
import type { JobCategoryWithStats } from '@shared/schemas/job'
import { Feedback, type FeedbackMessage } from '@/components/Feedback'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { api } from '@/services/api'
import { toErrorMessage } from '@/lib/errors'
import { ICON_SIZE } from '@/lib/icons'

/**
 * 分类管理。
 *
 * 从原先的左侧栏搬进弹窗：分类在岗位模块里主要扮演**筛选条件**，
 * 常驻一列导航会占掉列表三分之一的宽度，而「建 / 改名 / 删」是低频操作。
 */
export function CategoryManagerDialog({
  elevated = false,
  onClose,
  onChanged,
}: {
  /** 从岗位录入弹窗里叫起来时为 true：叠在它上面，别把用户粘好的 JD 弄丢 */
  elevated?: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [categories, setCategories] = useState<JobCategoryWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .listCategories()
      .then((rows) => {
        if (!cancelled) setCategories(rows)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setFeedback({ tone: 'error', text: toErrorMessage(cause) })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function reload() {
    setCategories(await api.listCategories())
    onChanged()
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      await api.createCategory({ name })
      await reload()
      setNewName('')
      // 建完分类不弹提示：它当场就出现在下面的列表里了
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  async function handleRename(id: string) {
    const name = editName.trim()
    if (!name) return
    try {
      await api.updateCategory(id, { name })
      await reload()
      setEditingId(null)
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteCategory(id)
      await reload()
      setPendingDeleteId(null)
      // 分类从列表里消失了，而且它连同几个岗位一起删，点删除时的那句确认已经说清楚了
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    }
  }

  return (
    <Modal
      title="管理分类"
      description="分类是岗位归集与短板统计的分组单位。删除分类会连同它下面的岗位一起删掉。"
      elevated={elevated}
      onClose={onClose}
    >
      <div className="space-y-4">
          <form onSubmit={handleCreate} className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新分类名称，如「大模型应用开发」"
              maxLength={50}
              aria-label="新分类名称"
            />
            <Button type="submit" disabled={busy || newName.trim() === ''}>
              <FolderPlus size={ICON_SIZE.control} />
              创建
            </Button>
          </form>

          <Feedback message={feedback} className="mb-0" />

          {loading ? (
            <p className="text-sm text-ink-muted">正在读取分类…</p>
          ) : categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">还没有分类，先建一个。</p>
          ) : (
            <ul className="divide-y divide-line rounded-control border border-line">
              {categories.map((category) => (
                <li key={category.id} className="px-3.5 py-2.5">
                  {editingId === category.id ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        autoFocus
                        className="h-8"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={50}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRename(category.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                      />
                      <Button
                        size="iconSm"
                        variant="ghost"
                        aria-label="保存名称"
                        onClick={() => void handleRename(category.id)}
                      >
                        <Check size={ICON_SIZE.control} />
                      </Button>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        aria-label="取消"
                        onClick={() => setEditingId(null)}
                      >
                        <X size={ICON_SIZE.control} />
                      </Button>
                    </div>
                  ) : pendingDeleteId === category.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-bad-ink">
                        删除「{category.name}」并移除其下 {category.jobCount} 个岗位？
                      </span>
                      <span className="ml-auto flex gap-1.5">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleDelete(category.id)}
                        >
                          确认删除
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(null)}>
                          取消
                        </Button>
                      </span>
                    </div>
                  ) : (
                    <div className="group flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {category.name}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                        {category.jobCount} 个岗位
                      </span>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        aria-label={`重命名 ${category.name}`}
                        onClick={() => {
                          setEditingId(category.id)
                          setEditName(category.name)
                          setPendingDeleteId(null)
                        }}
                      >
                        <Pencil size={ICON_SIZE.control} />
                      </Button>
                      <Button
                        size="iconSm"
                        variant="ghost"
                        aria-label={`删除 ${category.name}`}
                        onClick={() => {
                          setPendingDeleteId(category.id)
                          setEditingId(null)
                        }}
                      >
                        <Trash2 size={ICON_SIZE.control} />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>
    </Modal>
  )
}
