import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Link2, Plus, Trash2 } from 'lucide-react'
import type { AliasList } from '@shared/schemas/analysis'
import { Feedback, type FeedbackMessage } from '@/components/Feedback'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { api } from '@/services/api'
import { toErrorMessage } from '@/lib/errors'
import { ICON_SIZE } from '@/lib/icons'

/**
 * 知识别名管理（03-architecture.md §4.1）。
 *
 * 解决的是同一项知识在库里出现多种写法：你录的是 K8s，岗位写的是 Kubernetes，
 * 归一化后是两个键，匹配时就会被判成「缺失」——那是一条假缺口。
 *
 * **建立别名会立即改写已有数据**（岗位要求条目改键、个人知识项去重合并），
 * 所以这句话必须写在界面上，不能只写在代码注释里。
 * 反过来，**解除别名不会把已经合并的数据拆回去**——那是不可逆的，删除确认里要说清楚。
 *
 * 语义相似度（自动找出疑似重复）不在这个弹窗里：它要额外配一家带 embeddings 的厂商、
 * 且会花 Token，属于暂缓项（02-requirements.md §5 第 5 条）。本弹窗全程零 Token。
 */
export function AliasManagerDialog({
  skillNames,
  onClose,
  onChanged,
}: {
  /** 用户已有的知识项名，作为目标项的候选（填错名字会映射到一个不存在的键） */
  skillNames: string[]
  onClose: () => void
  /** 别名会改写个人知识项（去重合并），所以调用方要重新取数 */
  onChanged: () => void
}) {
  const [data, setData] = useState<AliasList | null>(null)
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null)
  const [newAlias, setNewAlias] = useState('')
  const [newTarget, setNewTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .listAliases()
      .then((next) => {
        if (!cancelled) setData(next)
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
    setData(await api.listAliases())
    onChanged()
  }

  async function applyAlias(alias: string, target: string) {
    setBusy(true)
    try {
      const result = await api.createAlias({ alias, skillKey: target })
      await reload()
      setNewAlias('')
      setNewTarget('')

      /*
       * 这里**保留**成功提示，且措辞讲的是影响而不是「已保存」：
       * 新建别名本身在下面的列表里看得见，但它顺手改写掉的岗位数据在任何界面上都看不到
       * （原则 ⑦ 变更必须可见）。所以这句话本身就是要给用户的信息，不是多余的确认。
       */
      const effects = [
        result.updatedJobSkills > 0 ? `改写了 ${result.updatedJobSkills} 条岗位要求` : null,
        result.mergedPersonalSkills > 0 ? `合并了 ${result.mergedPersonalSkills} 条重复知识` : null,
        result.note,
      ].filter((part): part is string => part !== null && part !== '')

      setFeedback({
        tone: 'success',
        text:
          `已把「${result.alias.aliasKey}」指向「${result.alias.skillKey}」` +
          (effects.length > 0 ? `，${effects.join('，')}` : '，暂时没有需要改写的已有数据'),
      })
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    const alias = newAlias.trim()
    const target = newTarget.trim()
    if (alias === '' || target === '') return
    await applyAlias(alias, target)
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteAlias(id)
      await reload()
      setPendingDeleteId(null)
      // 不弹成功提示：那一行当场从列表里消失了。
      // 上一条「已把 X 指向 Y」要一并收掉——那条别名刚刚没了，留着它自相矛盾。
      setFeedback(null)
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    }
  }

  const aliases = data?.aliases ?? []
  const appliedKeys = new Set(aliases.map((item) => item.aliasKey))
  const availablePresets = (data?.presets ?? []).filter((preset) => !appliedKeys.has(preset.aliasKey))

  return (
    <Modal
      title="知识别名"
      description="同一项知识出现多种写法时（K8s / Kubernetes），建立别名把它们认成同一个，避免被判成「缺失」。建立别名会立即改写已有岗位数据，让全库只保留一种写法。"
      onClose={onClose}
    >
      <div className="space-y-5">
        <form onSubmit={(event) => void handleCreate(event)} className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={newAlias}
              onChange={(event) => setNewAlias(event.target.value)}
              placeholder="别名写法，如 k8s"
              maxLength={64}
              aria-label="别名写法"
            />
            <ArrowRight size={ICON_SIZE.control} className="shrink-0 text-ink-faint" aria-hidden />
            <Input
              value={newTarget}
              onChange={(event) => setNewTarget(event.target.value)}
              placeholder="指向哪一项，如 Kubernetes"
              maxLength={64}
              list="alias-skill-names"
              aria-label="目标知识项"
            />
          </div>
          {/* 候选来自用户已有的知识项：填错名字会映射到一个不存在的键，那是静默的坑 */}
          <datalist id="alias-skill-names">
            {skillNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>

          <div className="flex items-center justify-between gap-3">
            <span className="text-2xs leading-relaxed text-ink-muted">
              目标项可以从已有知识里选；填还没录入的写法也可以，以后录进来就自动归到一起。
            </span>
            <Button
              type="submit"
              size="sm"
              disabled={busy || newAlias.trim() === '' || newTarget.trim() === ''}
            >
              <Link2 size={ICON_SIZE.control} />
              建立别名
            </Button>
          </div>
        </form>

        <Feedback message={feedback} className="mb-0" />

        {loading ? (
          <p className="text-sm text-ink-muted">正在读取别名…</p>
        ) : aliases.length === 0 ? (
          <p className="rounded-control border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-muted">
            还没有别名。遇到同一项知识的两种写法时，在上面的表单里把它们连起来。
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-control border border-line">
            {aliases.map((alias) => (
              <li key={alias.id} className="px-3.5 py-2.5">
                {pendingDeleteId === alias.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs leading-relaxed text-bad-ink">
                      解除「{alias.aliasKey} → {alias.skillKey}」？已经合并进数据里的写法不会拆回原样。
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void handleDelete(alias.id)}
                      >
                        确认解除
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(null)}>
                        取消
                      </Button>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-muted">
                      {alias.aliasKey}
                    </span>
                    <ArrowRight size={ICON_SIZE.inline} className="shrink-0 text-ink-faint" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink">
                      {alias.skillKey}
                    </span>
                    <Button
                      size="iconSm"
                      variant="ghost"
                      aria-label={`解除 ${alias.aliasKey} 到 ${alias.skillKey} 的映射`}
                      onClick={() => setPendingDeleteId(alias.id)}
                    >
                      <Trash2 size={ICON_SIZE.control} />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {availablePresets.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-semibold text-ink">常见写法（点一下即可建立）</span>
            <div className="flex flex-wrap gap-1.5">
              {availablePresets.map((preset) => (
                <button
                  key={preset.aliasKey}
                  type="button"
                  disabled={busy}
                  onClick={() => void applyAlias(preset.aliasKey, preset.skillKey)}
                  className="cursor-pointer rounded-lg bg-surface-muted px-2.5 py-1 text-xs font-semibold text-ink-muted transition-colors hover:bg-accent-soft hover:text-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={ICON_SIZE.inline} className="mr-0.5 inline" aria-hidden />
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
