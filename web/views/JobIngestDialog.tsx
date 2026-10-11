import { useEffect, useRef, useState } from 'react'
import { FolderPlus, ImagePlus, WandSparkles, X } from 'lucide-react'
import {
  describeMissingFields,
  MAX_IMAGE_BYTES,
  MAX_JOB_IMAGES,
  MAX_TOTAL_IMAGE_BYTES,
  missingRequiredJobFields,
  SUPPORTED_IMAGE_TYPES,
  type JobDraft,
} from '@shared/schemas/job'
import { DraftCard } from '@/components/DraftCard'
import { Feedback, type FeedbackMessage } from '@/components/Feedback'
import { Button } from '@/components/ui/button'
import { Select, Textarea } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { toErrorMessage } from '@/lib/errors'
import { api } from '@/services/api'
import { ICON_SIZE } from '@/lib/icons'

/**
 * 岗位录入（F-2.2 / F-2.4）。
 *
 * **一次只录一个岗位**：粘贴的整段原文与全部截图都属于这一个岗位，合成一次提取请求。
 * 长 JD 常要两三屏才截得全，逐张解析会把同一个岗位拆成互不相干的几条。
 *
 * 提取结果先进待确认列表，用户核对后才入库——不允许静默保存。
 */

/**
 * 剪贴板来的图片没有像样的文件名（浏览器一律给 image.png），
 * 给个认得出的名字，用户才知道列表里哪张是哪张。
 */
function namePastedImage(file: File, index: number): File {
  if (file.name !== '' && file.name !== 'image.png') return file
  const extension = file.type.split('/')[1] ?? 'png'
  return new File([file], `粘贴的截图-${index}.${extension}`, { type: file.type })
}

export function JobIngestDialog({
  categories,
  onClose,
  onSaved,
  onNeedCategoryManager,
}: {
  categories: { id: string; name: string }[]
  onClose: () => void
  onSaved: () => void
  onNeedCategoryManager: () => void
}) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  /**
   * 分类是异步到的，也可能是在叠着的分类管理里刚建出来的。
   * 选中的那个一旦不在列表里就落到第一个——否则下拉看着有值、state 还是空串，按钮永远点不动。
   */
  useEffect(() => {
    if (!categories.some((category) => category.id === categoryId)) {
      setCategoryId(categories[0]?.id ?? '')
    }
  }, [categories, categoryId])

  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [draft, setDraft] = useState<JobDraft | null>(null)
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canExtract = categoryId !== '' && (text.trim() !== '' || files.length > 0)

  /** 张数与体积在选图时就拦下来——传完再报错，用户已经等了一轮上传 */
  function addFiles(incoming: File[]) {
    if (incoming.length === 0) return

    const next = [...files, ...incoming]
    if (next.length > MAX_JOB_IMAGES) {
      setFeedback({
        tone: 'error',
        text: `一个岗位最多 ${MAX_JOB_IMAGES} 张截图，再选就超了（当前会变成 ${next.length} 张）`,
      })
      return
    }

    // 粘贴绕过了文件选择框的 accept，截图工具给的可能是 BMP/TIFF，先拦一道
    const badType = next.find(
      (file) => !SUPPORTED_IMAGE_TYPES.includes(file.type as (typeof SUPPORTED_IMAGE_TYPES)[number]),
    )
    if (badType !== undefined) {
      setFeedback({
        tone: 'error',
        text: `截图格式不支持：${badType.type || '未知'}，请用 PNG / JPEG / WebP / GIF`,
      })
      return
    }

    const totalBytes = next.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      setFeedback({
        tone: 'error',
        text: `截图总大小超过 ${MAX_TOTAL_IMAGE_BYTES / 1024 / 1024}MB，请压缩或减少张数`,
      })
      return
    }

    setFeedback(null)
    setFiles(next)
  }

  /**
   * 直接粘贴截图：截图工具（Win+Shift+S 等）只把图放进剪贴板，用户不必先存盘再选文件。
   *
   * 挂在 document 上而不是拖拽区上——刚截完图时焦点落在哪都有可能，要求先点中区域太苛刻。
   * 但只在剪贴板里确实有图片时才拦：粘文本要留给输入框的默认行为。
   * 依赖里有 files，是因为 addFiles 读的是当前列表，少了它会把张数与总量算错。
   */
  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      // 待确认阶段没有上传区，粘进来只会得到看不见的多余文件
      if (draft !== null) return

      const pasted = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .flatMap((item, index) => {
          const file = item.getAsFile()
          return file === null ? [] : [namePastedImage(file, index + 1)]
        })

      if (pasted.length === 0) return
      // 同一份剪贴板里的文本不该跟着落进输入框
      event.preventDefault()
      addFiles(pasted)
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [draft, files])

  async function handleExtract() {
    setBusy(true)
    setFeedback(null)
    // 重新解析时先清掉上一份草稿：屏幕上绝不能留下更早一次的结果
    // （失败时也保持清空状态，只显示错误——旧的草稿比没有草稿更危险）
    setDraft(null)

    try {
      const result = await api.extractJob({
        categoryId,
        ...(text.trim() === '' ? {} : { text }),
        ...(files.length === 0 ? {} : { images: files }),
      })
      setDraft(result)
    } catch (cause) {
      // 原文与截图都留在原处：用户改一改就能直接重试，不用重新粘贴
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  async function handleSave(duplicateAction?: 'overwrite') {
    if (draft === null) return

    /**
     * 必填项守卫：DraftCard 已经把按钮禁掉了，这里再拦一道。
     * 按钮的 onSave 是一根可以直接调的钩子，条件写在按钮上就只保得住那个按钮。
     */
    const missing = missingRequiredJobFields(draft)
    if (missing.length > 0) {
      setFeedback({ tone: 'error', text: `还差必填项：${describeMissingFields(missing)}` })
      return
    }

    setBusy(true)
    try {
      await api.saveJob({
        categoryId,
        companyName: draft.companyName,
        title: draft.title,
        salaryText: draft.salaryText,
        salaryMin: draft.salaryMin,
        salaryMax: draft.salaryMax,
        salaryMonths: draft.salaryMonths,
        locationCity: draft.locationCity,
        locationDistrict: draft.locationDistrict,
        industry: draft.industry,
        businessType: draft.businessType,
        originalUrl: draft.originalUrl,
        responsibilities: draft.responsibilities,
        requirements: draft.requirements,
        bonusPoints: draft.bonusPoints,
        customFields: draft.customFields,
        requirementItems: draft.requirementItems,
        ...(duplicateAction === undefined ? {} : { duplicateAction }),
      })
      // 只通知「存好了」：录入成功会立刻在列表里看到，再弹一条成功提示是多余的
      onSaved()
      onClose()
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      size="lg"
      title="岗位录入"
      onClose={onClose}
      // 顶部已有 X、Esc 与点遮罩三种关法，底部再放一个「关闭」是重复的
      footer={
        draft === null ? (
          <Button size="sm" disabled={busy || !canExtract} onClick={() => void handleExtract()}>
            <WandSparkles size={ICON_SIZE.control} />
            {busy ? '解析中…' : '解析并预览'}
          </Button>
        ) : undefined
      }
    >
      <Feedback message={feedback} />

      {draft === null ? (
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">目标岗位分类</span>
              <Button size="sm" className="h-7 px-2.5 text-xs" onClick={onNeedCategoryManager}>
                <FolderPlus size={ICON_SIZE.inline} />
                管理 / 新增分类
              </Button>
            </div>
            {categories.length === 0 ? (
              <p className="rounded-control bg-warn-soft px-3.5 py-2.5 text-xs text-warn-ink">
                还没有岗位分类。先建一个（例如「大模型应用开发」），岗位必须归属于某个分类。
              </p>
            ) : (
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-semibold text-ink">粘贴岗位信息文本</span>
            <Textarea
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="粘贴岗位原文，同一岗位的多段内容之间可用空行分隔。"
            />
          </label>

          <div className="space-y-1.5">
            <span className="text-sm font-semibold text-ink">上传岗位信息截图</span>
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                addFiles(Array.from(e.dataTransfer.files))
              }}
              className="cursor-pointer rounded-card border-2 border-dashed border-line-strong bg-surface-muted/60 px-4 py-6 text-center transition-colors hover:border-accent-line hover:bg-accent-soft/40"
            >
              <ImagePlus size={ICON_SIZE.display} className="mx-auto text-ink-faint" aria-hidden />
              <p className="mt-2 text-xs font-medium text-ink">
                点击或拖拽上传截图，也可以直接按 Ctrl+V 粘贴（同一岗位可多张）
              </p>
              <p className="mt-0.5 text-2xs text-ink-muted">
                支持 PNG / JPEG / WebP / GIF，单张不超过 {MAX_IMAGE_BYTES / 1024 / 1024}MB、最多{' '}
                {MAX_JOB_IMAGES} 张；解析截图需要模型支持图像输入
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />

            {files.length > 0 && (
              <ul className="flex flex-wrap gap-2 pt-1">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-2 rounded-control border border-line bg-surface px-2.5 py-1 text-2xs"
                  >
                    <span className="max-w-40 truncate text-ink-muted">{file.name}</span>
                    <button
                      type="button"
                      aria-label={`移除 ${file.name}`}
                      className="cursor-pointer text-ink-faint hover:text-bad-ink"
                      onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    >
                      <X size={ICON_SIZE.inline} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <DraftCard
          draft={draft}
          busy={busy}
          onChange={setDraft}
          onSave={() => void handleSave()}
          onOverwrite={() => void handleSave('overwrite')}
          onDiscard={() => {
            setDraft(null)
            setFeedback(null)
          }}
        />
      )}
    </Modal>
  )
}
