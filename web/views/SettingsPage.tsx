import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Archive,
  ArchiveRestore,
  Cloud,
  Download,
  KeyRound,
  Pencil,
  Plus,
  Server,
  Star,
  Trash2,
  Upload,
  Wifi,
} from 'lucide-react'
import type { BackupFile, RestoreResult } from '@shared/schemas/progress'
import type {
  ModelParams,
  ProbeOutcome,
  ProviderPreset,
  PublicProvider,
  PublicSettings,
  SettingsField,
  SettingsSource,
  SettingsTestResult,
} from '@shared/schemas/settings'
import { IS_DEMO } from '@/lib/bootstrap'
import { Feedback, type FeedbackMessage } from '@/components/Feedback'
import { HeroDivider, HeroGroup, HeroPanel } from '@/components/HeroPanel'
import { PageHeader } from '@/components/PageHeader'
import { PageBody, PageContainer, PageSticky } from '@/components/PageShell'
import { SectionHeader } from '@/components/SectionHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Select } from '@/components/ui/input'
import { ConfirmDialog, Modal } from '@/components/ui/modal'
import { toErrorMessage } from '@/lib/errors'
import { formatBytes, formatRelativeTime } from '@/lib/format'
import { toneClass } from '@/lib/palette'
import { cn } from '@/lib/utils'
import { api, downloadBackup, downloadExport, restoreBackup, restoreFromUpload } from '@/services/api'
import { ICON_SIZE } from '@/lib/icons'

/**
 * 系统设置（F-7）：多厂商 LLM 接入 + 全局推理参数。
 *
 * 密钥只走单向：界面永远显示掩码，提交新密钥后服务端只回掩码。
 * 输入框留空表示「保持原密钥」，不是「清除」——清除要显式点按钮。
 */

type ProviderDraft = {
  id?: string
  presetId: string
  name: string
  protocol: string
  baseUrl: string
  model: string
  models: string
  /**
   * 本次要提交的**新**密钥；空串表示保持原密钥。
   * 已存密钥的掩码单独放在 `apiKeyMasked`，两者绝不混用——
   * 掩码要是混进这个字段，就可能被当成密钥提交上去。
   */
  apiKey: string
  /** 已存密钥的掩码，仅用于展示；null 表示还没存过密钥 */
  apiKeyMasked: string | null
  enabled: boolean
  supportsVision: boolean
}

const EMPTY_PROVIDER: ProviderDraft = {
  presetId: 'custom',
  name: '',
  protocol: 'openai-compatible',
  baseUrl: '',
  model: '',
  models: '',
  apiKey: '',
  apiKeyMasked: null,
  enabled: true,
  supportsVision: false,
}

export function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null)
  const [busy, setBusy] = useState(false)

  const [providerDraft, setProviderDraft] = useState<ProviderDraft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PublicProvider | null>(null)
  const [testTarget, setTestTarget] = useState<PublicProvider | null>(null)

  /* 数据资产：备份列表与备份目录。null = 还没读到 */
  const [backups, setBackups] = useState<BackupFile[] | null>(null)
  const [backupDir, setBackupDir] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  /** 数据资产上的操作互斥：同时只跑一件，按钮各自显示进度 */
  const [assetAction, setAssetAction] = useState<'backup' | 'export' | 'download' | 'restore' | null>(
    null,
  )
  /** 等待二次确认的恢复：列表里的某一份，或用户刚选的本机文件 */
  const [pendingRestore, setPendingRestore] = useState<BackupFile | null>(null)
  const [pendingUpload, setPendingUpload] = useState<File[] | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getSettings()
      .then((next) => {
        if (!cancelled) setSettings(next)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(toErrorMessage(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 备份列表单独取。它读的是文件系统，失败原因与「配置读不到」无关，
   * 不该把整页拖成错误态——坏在哪一块就在哪一块说明。
   */
  useEffect(() => {
    let cancelled = false
    api
      .listBackups()
      .then((next) => {
        if (cancelled) return
        setBackups(next.backups)
        setBackupDir(next.dir)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setBackupError(toErrorMessage(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const enabledProviders = useMemo(
    () => (settings?.providers ?? []).filter((provider) => provider.enabled),
    [settings],
  )

  /** 文件里存着的生效厂商——编辑器读写的就是它 */
  const activeProvider = settings?.providers.find((provider) => provider.isActive) ?? null
  /** 实际生效的值（可能被环境变量 / .env 覆盖）——横幅显示的是它 */
  const resolved = settings?.resolved ?? null

  /**
   * 哪些字段由环境变量 / .env 提供。
   * 这些字段在界面上改了不起作用，必须明说而不是让用户白改一遍。
   */
  const envOverridden = useMemo(() => {
    const sources = (resolved?.sources ?? {}) as Partial<Record<SettingsField, SettingsSource>>
    const entries = Object.entries(sources) as [SettingsField, SettingsSource][]
    return entries
      .filter(
        (entry): entry is [SettingsField, 'env' | 'dotenv'] =>
          entry[1] === 'env' || entry[1] === 'dotenv',
      )
      .map(([field, source]) => ({ field, source }))
  }, [resolved])

  /** 当前厂商的模型清单。模型跟着厂商走——下拉里只有这一家的模型，不会串台。 */
  const modelChoices = activeProvider?.models ?? []

  /** 向量缓存统计（「数据资产」区块用） */
  const embeddingStats = settings?.embedding.cachedEmbeddings ?? { total: 0, byModel: {} }
  /**
   * 按模型分行。换嵌入模型时旧向量不会被清掉（见 db/schema.ts 的 skillEmbedding），
   * 所以要能看出这批缓存是谁算的——那正是「换模型要重算多少」的答案。
   */
  const embeddingModelText = Object.entries(embeddingStats.byModel)
    .map(([model, count]) => `${model} ${count} 条`)
    .join('、')

  /**
   * 最近一次备份的时刻。不把接口给的顺序当契约，自己取最大值。
   * 保留策略只留一份之后，「共 N 份」恒等于 1、没有信息量了，
   * 「多久以前」才是用户看这一栏想知道的事。
   */
  const latestBackupAt = (backups ?? []).reduce<string | null>(
    (latest, item) => (latest === null || item.createdAt > latest ? item.createdAt : latest),
    null,
  )

  /** 参数编辑草稿：跟着当前模型走，服务端一给新值就重置 */
  const [paramsDraft, setParamsDraft] = useState<ModelParams | null>(null)
  const activeParams = settings?.activeParams ?? null
  useEffect(() => {
    setParamsDraft(activeParams)
  }, [activeParams])

  /* ------------------------------------------------------------- 空状态兜底 */

  /**
   * 页头吸顶区：加载态与正式态**共用这一份**。
   *
   * 加载态原来连页头一起换掉，切页时标题先消失、再重建 —— 那就是切换瞬间的「跳」。
   * 两个分支从此只有正文不同，页顶永远不动。
   */
  const header = (
    <PageSticky>
      <PageHeader title="系统设置" />
    </PageSticky>
  )

  if (loading) {
    return (
      <PageContainer>
        {header}
        <PageBody>
          <p className="text-sm text-ink-muted">正在读取模型配置…</p>
        </PageBody>
      </PageContainer>
    )
  }

  /**
   * 写操作的统一收尾。
   *
   * successText 只在**结果看不出来**的场合才给：改厂商、切模型、删厂商这些，
   * 成功后卡片/页头当场就是新的，不需要再飘一句「已…」；而「保存推理参数」
   * 是把表单原样写回去，界面上什么都不会变，不给提示用户就分不清存没存上。
   * 失败一律要报。
   */
  async function run(action: () => Promise<PublicSettings>, successText?: string) {
    setBusy(true)
    try {
      setSettings(await action())
      if (successText !== undefined) setFeedback({ tone: 'success', text: successText })
      return true
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmitProvider(event: FormEvent) {
    event.preventDefault()
    if (!providerDraft || !settings) return

    const ok = await run(
      () =>
        api.saveProvider({
          ...(providerDraft.id ? { id: providerDraft.id } : {}),
          presetId: providerDraft.presetId,
          name: providerDraft.name.trim(),
          protocol: providerDraft.protocol,
          baseUrl: providerDraft.baseUrl.trim(),
          model: providerDraft.model.trim(),
          models: providerDraft.models
            .split(/[,，\n]/)
            .map((model) => model.trim())
            .filter((model) => model !== ''),
          // 留空 = 保持原密钥（新增时视为不填）
          ...(providerDraft.apiKey.trim() === '' ? {} : { apiKey: providerDraft.apiKey.trim() }),
          enabled: providerDraft.enabled,
          supportsVision: providerDraft.supportsVision,
        }),
    )
    if (ok) setProviderDraft(null)
  }

  /**
   * 厂商写的入参只认模型名。参数由「模型推理参数」一栏单独维护，
   * 从这里回写会把那一栏里调好的值覆盖成默认值。
   */
  function providerToInput(provider: PublicProvider) {
    return {
      id: provider.id,
      presetId: provider.presetId,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      models: provider.models.map((item) => item.name),
      enabled: provider.enabled,
      supportsVision: provider.supportsVision,
    }
  }

  /** 切换当前模型。模型只属于当前厂商，所以不需要再切厂商。 */
  async function handleSelectModel(model: string) {
    if (!activeProvider || model === activeProvider.model) return
    await run(() => api.saveProvider({ ...providerToInput(activeProvider), model }))
  }

  async function handleSaveParams(event: FormEvent) {
    event.preventDefault()
    if (!activeProvider || !paramsDraft || activeProvider.model === '') return
    await run(
      () =>
        api.saveModelParams({
          providerId: activeProvider.id,
          model: activeProvider.model,
          params: paramsDraft,
        }),
      `「${activeProvider.model}」的推理参数已保存`,
    )
  }

  function patchParams(patch: Partial<ModelParams>) {
    setParamsDraft((current) => (current === null ? current : { ...current, ...patch }))
  }

  /**
   * 立即备份。
   *
   * 成功**不弹提示**：新备份下一刻就出现在下面的列表里，结果当场可见（提示约定第 1 条）。
   * 但「没备份成」必须说——空库时服务端会返回 created: false 加一句原因，
   * 那件事在界面上看不出来，不报就成了「点了没反应」。
   */
  async function handleRunBackup() {
    setAssetAction('backup')
    try {
      const result = await api.runBackup()
      if (!result.created) setFeedback({ tone: 'info', text: `没有创建备份：${result.reason}` })
      const next = await api.listBackups()
      setBackups(next.backups)
      setBackupDir(next.dir)
      setBackupError(null)
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setAssetAction(null)
    }
  }

  /** 导出 JSON。文件落进下载目录就是结果，不需要再说一句；失败则必须报 */
  async function handleExport() {
    setAssetAction('export')
    try {
      await downloadExport()
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setAssetAction(null)
    }
  }

  /** 下载某一份备份（.db）。用途是「卸掉工具之前把数据带走」 */
  async function handleDownloadBackup(fileName: string) {
    setAssetAction('download')
    try {
      await downloadBackup(fileName)
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setAssetAction(null)
    }
  }

  /**
   * 恢复的统一收口（列表里的备份与本机文件都走这里）：成功后**整页重载**。
   *
   * 为什么不逐块刷新：库和配置是整体换掉的，这一刻页面上任何一处数据——岗位列表、
   * 看板、个人信息、厂商卡片——都可能已经过期。逐块刷新要枚举全部数据源，漏一个
   * 就是「看着是新的、其实是旧的」。重载之后看到的才是真的。
   * 也正因为结果当场可见，成功不弹提示（提示约定第 1 条）；失败才报，且留在原地。
   */
  async function runRestore(action: () => Promise<RestoreResult>) {
    setAssetAction('restore')
    try {
      await action()
      window.location.reload()
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
      setAssetAction(null)
    }
  }

  return (
    <PageContainer>
      {header}

      <PageBody>
        {loadError != null && (
          <div className="rounded-control bg-bad-soft px-3.5 py-2.5 text-sm text-bad-ink">
            读取配置失败：{loadError}
          </div>
        )}

        <Feedback message={feedback} className="mb-0" />

        {settings && (
          <>
            {/* 概览横幅 */}
            <HeroPanel>
              <HeroGroup
                title="大模型引擎适配概览"
                stats={[
                  {
                    value: enabledProviders.length,
                    unit: `/ ${settings.providers.length} 家`,
                    label: '已启用服务商',
                    tone: 'amber',
                  },
                  {
                    value: enabledProviders.reduce(
                      (sum, provider) => sum + provider.models.length,
                      0,
                    ),
                    unit: '个',
                    label: '可调用大模型总数',
                    tone: 'cyan',
                  },
                ]}
              />
              <HeroDivider />
              <HeroGroup
                title="当前厂商与模型"
                stats={[
                  // 厂商与模型并排：厂商在前（它就是模型的归属），两栏之间由 HeroStat 自带的
                  // 右边线分开 —— 与左边「大模型引擎适配概览」用的是同一种分隔，不是另画一条。
                  // 下方小字直接写「厂商」「模型」：这两栏的值都是名字，不标一眼分不出哪个是哪个
                  {
                    // 显示**实际生效**的值：文件里存的可能被环境变量覆盖，
                    // 而用户想在这块横幅上看到的正是"这次会用到什么"
                    value: resolved?.providerName || '还没有当前厂商',
                    label: '厂商',
                    tone: 'cyan',
                  },
                  {
                    value: resolved?.model || '未配置',
                    label: '模型',
                    tone: 'emerald',
                  },
                ]}
              />
            </HeroPanel>

            {/* 模型推理参数：跟着当前厂商的当前模型走 */}
            <section className="space-y-4">
              <SectionHeader
                title="模型推理参数"
                action={
                  <Button
                    size="sm"
                    type="submit"
                    form="model-params-form"
                    disabled={busy || activeProvider === null || paramsDraft === null}
                  >
                    保存参数
                  </Button>
                }
              />

              <Card>
                <CardBody className="pt-5">
                  {activeProvider === null ? (
                    <p className="text-sm text-ink-muted">
                      还没有当前厂商。先在下面添加一家模型服务商并把它设为当前，这里就会出现可调参数的模型。
                    </p>
                  ) : (
                    <form
                      id="model-params-form"
                      className="grid gap-5 lg:grid-cols-2"
                      onSubmit={(e) => void handleSaveParams(e)}
                    >
                      <label className="block space-y-1.5">
                        <span className="text-sm font-semibold text-ink">当前模型</span>
                        <Select
                          value={activeProvider?.model ?? ''}
                          disabled={activeProvider === null || modelChoices.length === 0}
                          onChange={(e) => void handleSelectModel(e.target.value)}
                        >
                          {modelChoices.length === 0 && (
                            <option value="">该厂商还没有模型</option>
                          )}
                          {modelChoices.map((item) => (
                            <option key={item.name} value={item.name}>
                              {item.name}
                            </option>
                          ))}
                        </Select>
                        <span className="block text-2xs text-ink-muted">
                          {activeProvider === null
                            ? '还没有当前厂商'
                            : `只列出「${activeProvider.name}」的模型；换厂商请到下面的厂商列表里点「设为当前」`}
                        </span>
                      </label>

                      {/* 跨整行：模型被环境变量盖掉时，这里是用户最容易困惑的地方 */}
                      <EnvOverrideNotice
                        overridden={envOverridden.filter(
                          (item) => item.field === 'model' || item.field === 'baseUrl',
                        )}
                        envVarNames={settings.envVarNames}
                        className="lg:col-span-2"
                      />

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-ink">
                            随机性 / 采样温度（Temperature）
                          </span>
                          <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent-ink tabular-nums">
                            {paramsDraft?.temperature ?? '—'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 pt-2">
                          <span className="shrink-0 text-xs font-medium text-ink-muted">精确</span>
                          <input
                            type="range"
                            min={0}
                            max={2}
                            step={0.1}
                            value={paramsDraft?.temperature ?? 0}
                            disabled={paramsDraft === null}
                            onChange={(e) => patchParams({ temperature: Number(e.target.value) })}
                            className="h-2 w-full cursor-pointer rounded-lg bg-surface-sunken accent-accent"
                          />
                          <span className="shrink-0 text-xs font-medium text-ink-muted">发散</span>
                        </div>
                      </div>

                      {/*
                      这里曾经有「单次生成最大 Token」：实测它只会被配小、然后把长 JD 的解析整次截断，
                      已改为内置常量（server/config/settings.ts 的 MAX_OUTPUT_TOKENS），不再让用户配。
                      同理去掉了「请求超时」（按调用路径定死为 llm/openaiCompat.ts 里的常量）与
                      「响应流式输出」（流式是成长路线唯一的输出方式，不存在选择）。
                    */}
                    </form>
                  )}
                </CardBody>
              </Card>
            </section>

            {/* 厂商列表 */}
            <section className="space-y-4">
              <SectionHeader
                title="LLM 模型厂商与接口配置"
                action={
                  <Button size="sm" onClick={() => setProviderDraft({ ...EMPTY_PROVIDER })}>
                    <Plus size={ICON_SIZE.control} />
                    新增 LLM 厂商
                  </Button>
                }
              />

              {settings.providers.length === 0 ? (
                <EmptyState
                  icon={KeyRound}
                  title="还没有配置任何模型厂商"
                  hint="至少配置一家。没有模型，岗位无法解析成要求条目，匹配度也就无从算起。"
                  action={
                    <Button size="sm" onClick={() => setProviderDraft({ ...EMPTY_PROVIDER })}>
                      <Plus size={ICON_SIZE.control} />
                      新增 LLM 厂商
                    </Button>
                  }
                />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {settings.providers.map((provider) => (
                    <ProviderCard
                      key={provider.id}
                      provider={provider}
                      busy={busy}
                      envOverridden={provider.isActive ? envOverridden : []}
                      envVarNames={settings.envVarNames}
                      onTest={() => setTestTarget(provider)}
                      onActivate={() =>
                        void run(() => api.activateProvider(provider.id))
                      }
                      onEdit={() =>
                        setProviderDraft({
                          id: provider.id,
                          presetId: provider.presetId,
                          name: provider.name,
                          protocol: provider.protocol,
                          baseUrl: provider.baseUrl,
                          model: provider.model,
                          models: provider.models.map((item) => item.name).join(', '),
                          apiKey: '',
                          apiKeyMasked: provider.apiKeyMasked,
                          enabled: provider.enabled,
                          supportsVision: provider.supportsVision,
                        })
                      }
                      onDelete={() => setPendingDelete(provider)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* 数据资产（F-6.3）：导出 + 备份 + 向量缓存。
                演示模式下只留导出：备份与恢复都要读写本机文件，静态站没有磁盘可写。 */}
            <section className="space-y-4">
              <SectionHeader
                title="数据资产"
                meta={
                  IS_DEMO
                    ? '演示模式'
                    : backups === null
                      ? undefined
                      : latestBackupAt === null
                        ? '还没有备份'
                        : `最近备份：${formatRelativeTime(latestBackupAt)}`
                }
                action={
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={assetAction !== null}
                      onClick={() => void handleExport()}
                    >
                      <Download size={ICON_SIZE.control} />
                      {assetAction === 'export' ? '导出中…' : '导出全部数据'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={assetAction !== null}
                      hidden={IS_DEMO}
                      onClick={() => uploadInputRef.current?.click()}
                    >
                      <Upload size={ICON_SIZE.control} />
                      从文件恢复
                    </Button>
                    <Button
                      size="sm"
                      disabled={assetAction !== null}
                      hidden={IS_DEMO}
                      onClick={() => void handleRunBackup()}
                    >
                      <Archive size={ICON_SIZE.control} />
                      {assetAction === 'backup' ? '备份中…' : '立即备份'}
                    </Button>
                  </>
                }
              />

              <Card>
                <CardBody className="space-y-3 pt-5">
                  {backupError != null ? (
                    <p className="rounded-control bg-bad-soft px-3.5 py-2.5 text-sm text-bad-ink">
                      读取备份列表失败：{backupError}
                    </p>
                  ) : IS_DEMO ? (
                    <p className="text-xs leading-relaxed text-ink-muted">
                      演示模式没有磁盘可写：备份与恢复要读写本机文件，只在本机完整版里提供。
                      「导出全部数据」不受影响——它读的是当前这份库，导出的 JSON 一样是完整的。
                    </p>
                  ) : backups === null ? (
                    <p className="text-xs text-ink-muted">正在读取备份列表…</p>
                  ) : backups.length === 0 ? (
                    <p className="text-xs leading-relaxed text-ink-muted">
                      还没有备份文件。点右上角「立即备份」现在存一份；数据库每次升级前也会自动留一份。
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {backups.map((backup) => (
                        <li
                          key={backup.file}
                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-control border border-line bg-surface-muted px-3 py-2"
                        >
                          <span className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="font-mono text-xs break-all text-ink">
                              {backup.file}
                            </span>
                            {/* 没有配置的备份只能恢复数据，厂商与密钥要另配——先让用户看得出来 */}
                            {!backup.hasConfig && <Badge tone="neutral">不含厂商配置</Badge>}
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-xs text-ink-muted tabular-nums">
                            <span>{formatBytes(backup.sizeBytes)}</span>
                            <span className="mr-1">
                              {new Date(backup.createdAt).toLocaleString('zh-CN')}
                            </span>
                            <Button
                              variant="ghost"
                              size="iconSm"
                              aria-label={`下载 ${backup.file}`}
                              disabled={assetAction !== null}
                              onClick={() => void handleDownloadBackup(backup.file)}
                            >
                              <Download size={ICON_SIZE.control} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="iconSm"
                              aria-label={`用 ${backup.file} 恢复`}
                              disabled={assetAction !== null}
                              onClick={() => setPendingRestore(backup)}
                            >
                              <ArchiveRestore size={ICON_SIZE.control} />
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {backupDir !== null && !IS_DEMO && (
                    <p className="font-mono text-2xs break-all text-ink-faint">目录：{backupDir}</p>
                  )}

                  <p className="text-xs leading-relaxed text-ink-muted">
                    向量缓存：
                    {embeddingStats.total === 0 ? '暂无' : `${embeddingStats.total} 条`}
                    {embeddingModelText !== '' && ` · ${embeddingModelText}`}
                    。备份是整库快照，旁边同时存着一份厂商配置（含 API Key），
                    所以它既能回滚，也能在卸掉工具、重装之后原样带回来；
                    导出的 JSON 不含向量与 AI 缓存——它们都能本地重算。
                  </p>
                </CardBody>
              </Card>
            </section>
          </>
        )}
      </PageBody>

      {/* ------------------------------------------------------------- 弹窗 */}

      {providerDraft && settings && (
        <Modal
          size="lg"
          title={providerDraft.id ? '编辑 LLM 厂商配置' : '新增 LLM 厂商配置'}
          onClose={() => setProviderDraft(null)}
          footer={
            <>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => setProviderDraft(null)}
              >
                取消
              </Button>
              <Button size="sm" type="submit" form="provider-form" disabled={busy}>
                {busy ? '保存中…' : '保存配置'}
              </Button>
            </>
          }
        >
          <form
            id="provider-form"
            className="space-y-4"
            onSubmit={(e) => void handleSubmitProvider(e)}
          >
            <div className="space-y-1.5">
              <span className="text-sm font-semibold text-ink">快速填充预设厂商模板</span>
              <div className="flex flex-wrap gap-2">
                {settings.presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setProviderDraft(applyPreset(providerDraft, preset))}
                    className="cursor-pointer rounded-lg bg-surface-muted px-3 py-1 text-xs font-semibold text-ink-muted transition-colors hover:bg-accent-soft hover:text-accent-ink"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-ink">厂商名称</span>
                <Input
                  required
                  value={providerDraft.name}
                  placeholder="例如：DeepSeek 官方"
                  onChange={(e) => setProviderDraft({ ...providerDraft, name: e.target.value })}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-ink">接口协议 Adapter</span>
                <Select
                  value={providerDraft.protocol}
                  onChange={(e) => setProviderDraft({ ...providerDraft, protocol: e.target.value })}
                >
                  <option value="openai-compatible">OpenAI 兼容协议</option>
                </Select>
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink">API Base URL</span>
              <Input
                required
                value={providerDraft.baseUrl}
                placeholder="https://api.deepseek.com/v1"
                onChange={(e) => setProviderDraft({ ...providerDraft, baseUrl: e.target.value })}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink">API Key</span>
              <ApiKeyInput
                masked={providerDraft.apiKeyMasked}
                value={providerDraft.apiKey}
                onChange={(value) => setProviderDraft({ ...providerDraft, apiKey: value })}
              />
              <p className="text-xs text-ink-muted">
                本地 Ollama 无需密钥。密钥只写入本机配置文件，设置之后只以掩码显示，没有查看原文的入口；
                不更换就直接保存，原密钥保持不变。
              </p>
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink">支持的模型列表（逗号分隔）</span>
              <Input
                value={providerDraft.models}
                placeholder="deepseek-chat, deepseek-reasoner"
                onChange={(e) => setProviderDraft({ ...providerDraft, models: e.target.value })}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink">默认使用模型</span>
              <Input
                required
                value={providerDraft.model}
                placeholder="deepseek-chat"
                onChange={(e) => setProviderDraft({ ...providerDraft, model: e.target.value })}
              />
            </label>

            <div className="flex flex-wrap items-center gap-6">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={providerDraft.enabled}
                  onChange={(e) =>
                    setProviderDraft({ ...providerDraft, enabled: e.target.checked })
                  }
                  className="size-4 accent-accent"
                />
                启用该厂商
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  checked={providerDraft.supportsVision}
                  onChange={(e) =>
                    setProviderDraft({ ...providerDraft, supportsVision: e.target.checked })
                  }
                  className="size-4 accent-accent"
                />
                该厂商模型支持图像输入
              </label>
            </div>
          </form>
        </Modal>
      )}

      {testTarget && (
        <TestConnectionModal
          provider={testTarget}
          onClose={() => setTestTarget(null)}
          onResult={(message) => setFeedback(message)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="确定删除该 LLM 厂商配置？"
          message={`「${pendingDelete.name}」的接口地址、密钥与模型列表都会被清除。此操作无法撤销。`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const target = pendingDelete
            setPendingDelete(null)
            void run(() => api.deleteProvider(target.id))
          }}
        />
      )}

      {/* 无样式，只是「从文件恢复」按钮要点的那个文件选择框 */}
      <input
        ref={uploadInputRef}
        type="file"
        accept=".db,.json"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          // 清掉 value：否则连续两次选中同一个文件不会再触发 change
          event.target.value = ''
          if (files.length > 0) setPendingUpload(files)
        }}
      />

      {pendingRestore && (
        <ConfirmDialog
          title="用这份备份替换当前数据？"
          confirmText="替换当前数据"
          message={
            <>
              当前的知识、能力、项目经验、岗位与厂商配置，都会被「{pendingRestore.file}
              」那一刻的版本替换掉。
              {!pendingRestore.hasConfig &&
                '这份备份旁边没有配置文件，厂商配置会保持现状、不被改动。'}
              恢复前会自动把当前数据另存一份备份，选错了还能换回来。
            </>
          }
          onCancel={() => setPendingRestore(null)}
          onConfirm={() => {
            const target = pendingRestore
            setPendingRestore(null)
            void runRestore(() => restoreBackup(target.file))
          }}
        />
      )}

      {pendingUpload && (
        <ConfirmDialog
          title="用选中的文件替换当前数据？"
          confirmText="替换当前数据"
          message={
            <>
              将用 {pendingUpload.map((file) => file.name).join('、')} 替换当前的知识、能力、
              项目经验、岗位与厂商配置。
              {pendingUpload.every((file) => !file.name.toLowerCase().endsWith('.json')) &&
                '这次没有一起选上配置文件，厂商配置会保持现状、不被改动。'}
              恢复前会自动把当前数据另存一份备份，选错了还能换回来。
            </>
          }
          onCancel={() => setPendingUpload(null)}
          onConfirm={() => {
            const files = pendingUpload
            setPendingUpload(null)
            void runRestore(() => restoreFromUpload(files))
          }}
        />
      )}
    </PageContainer>
  )
}

/* ------------------------------------------------------------------ 局部组件 */

/** 字段的界面文案（与环境变量提示里用的一致） */
const FIELD_LABEL: Record<SettingsField, string> = {
  providerId: '厂商',
  baseUrl: '接口地址',
  model: '模型',
  apiKey: '密钥',
  supportsVision: '图像能力',
}

/**
 * 「这几项由环境变量提供」的提示。
 *
 * 环境变量 / .env 的优先级高于配置文件，所以这些字段在界面上改了不会生效——
 * 那就必须说清楚，而不是让用户改完发现没反应（原则 ①「失败必须显性」）。
 */
function EnvOverrideNotice({
  overridden,
  envVarNames,
  className,
}: {
  overridden: { field: SettingsField; source: 'env' | 'dotenv' }[]
  envVarNames: Record<string, string>
  className?: string
}) {
  if (overridden.length === 0) return null

  const items = overridden.map(({ field, source }) => {
    const name = envVarNames[field] ?? ''
    return source === 'dotenv' ? `${FIELD_LABEL[field]}（.env）` : `${FIELD_LABEL[field]}（${name}）`
  })

  return (
    <p
      className={cn(
        'rounded-control bg-warn-soft px-3 py-2 text-2xs leading-relaxed text-warn-ink',
        className,
      )}
    >
      {items.join('、')}
      由环境变量提供，实际运行以它为准；在界面上改这几项不会影响运行。
    </p>
  )
}

function ProviderCard({
  provider,
  busy,
  envOverridden,
  envVarNames,
  onTest,
  onActivate,
  onEdit,
  onDelete,
}: {
  provider: PublicProvider
  busy: boolean
  /** 生效厂商上被环境变量盖掉的字段；非生效厂商传空数组 */
  envOverridden: { field: SettingsField; source: 'env' | 'dotenv' }[]
  envVarNames: Record<string, string>
  onTest: () => void
  onActivate: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const Icon = provider.presetId === 'ollama' ? Server : Cloud
  return (
    <Card className={`relative flex flex-col gap-4 p-5 ${provider.isActive ? 'border-accent-line' : ''}`}>
      {provider.isActive && (
        <span className="absolute top-0 right-0 rounded-bl-xl bg-accent px-3 py-1 text-3xs font-bold text-white">
          <Star size={ICON_SIZE.inline} className={`mr-1 inline ${toneClass('amber', 'onDark')}`} aria-hidden />
          当前厂商
        </span>
      )}

      <div className="flex items-start gap-3 pr-16">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-control ${provider.enabled ? 'bg-accent-soft text-accent-ink' : 'bg-surface-muted text-ink-faint'
            }`}
        >
          <Icon size={ICON_SIZE.nav} aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-ink">{provider.name}</h3>
          <span className="text-xs font-medium text-ink-muted">{provider.protocol}</span>
        </div>
      </div>

      <div className="space-y-2 rounded-control border border-line bg-surface-muted p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0 text-ink-muted">Endpoint</span>
          <span className="truncate font-mono text-ink" title={provider.baseUrl}>
            {provider.baseUrl || '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0 text-ink-muted">API Key</span>
          <span className="truncate font-mono text-ink">
            {provider.apiKeyMasked ?? '无需 API Key'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0 text-ink-muted">当前模型</span>
          <span className="truncate font-mono font-bold text-accent-ink">{provider.model}</span>
        </div>
      </div>

      {/* 上面这几项是**文件里存着的值**；被环境变量盖掉时必须说明，否则用户会以为改了没用 */}
      <EnvOverrideNotice overridden={envOverridden} envVarNames={envVarNames} />

      {provider.models.length > 0 && (
        <div>
          <span className="mb-1 block text-2xs font-semibold text-ink-muted">支持的模型</span>
          <div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto">
            {provider.models.map((item) => (
              <span
                key={item.name}
                className="rounded bg-surface-muted px-2 py-0.5 font-mono text-2xs text-ink"
              >
                {item.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex items-center gap-1">
          <Button variant="soft" size="sm" disabled={busy} onClick={onTest}>
            <Wifi size={ICON_SIZE.control} />
            测试连通性
          </Button>
          {!provider.isActive && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onActivate}>
              设为当前
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!provider.enabled && <Badge tone="neutral">已停用</Badge>}
          <Button variant="ghost" size="iconSm" aria-label={`编辑 ${provider.name}`} onClick={onEdit}>
            <Pencil size={ICON_SIZE.control} />
          </Button>
          <Button
            variant="destructive"
            size="iconSm"
            aria-label={`删除 ${provider.name}`}
            onClick={onDelete}
          >
            <Trash2 size={ICON_SIZE.control} />
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** 密钥输入：默认密文 + 显隐切换 */
/**
 * API Key 输入。
 *
 * **没有任何"显示密钥"的入口**——没有眼睛按钮，浏览器的密码查看按钮也一并关掉
 * （Edge 会自带给密码框加一个），新输入的字符一律以密码框遮蔽。
 * 已存密钥只以掩码形式出现，而且掩码就是输入框的**内容**，所以选中复制拿到的也只是掩码。
 *
 * 掩码与待提交的新密钥是两个字段，绝不混用：掩码要是混进 `value`，就有被当成密钥提交的风险。
 */
function ApiKeyInput({
  masked,
  value,
  onChange,
}: {
  /** 已存密钥的掩码；null = 还没存过 */
  masked: string | null
  /** 本次要提交的新密钥；空串 = 保持原密钥 */
  value: string
  onChange: (next: string) => void
}) {
  const [replacing, setReplacing] = useState(false)
  const hasStored = masked !== null

  // 已有密钥且没点「更换」：只展示掩码，不可编辑
  if (hasStored && !replacing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={masked}
          aria-label="API Key（掩码，不可查看原文）"
          className="cursor-default bg-surface-muted font-mono text-ink-muted"
          onFocus={(event) => event.target.select()}
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => setReplacing(true)}>
          更换
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="password"
        autoFocus={hasStored}
        // 别让浏览器/密码管理器把 API Key 当成账号密码存下来
        autoComplete="new-password"
        value={value}
        placeholder={hasStored ? '粘贴新的 API Key（输入后不回显）' : 'sk-…'}
        onChange={(event) => onChange(event.target.value)}
      />
      {hasStored && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setReplacing(false)
            onChange('')
          }}
        >
          取消
        </Button>
      )}
    </div>
  )
}

/**
 * 连通性测试。
 * 不做假的"日志滚动"——真实结果就是两条探测：文本能否回应、图像能否识别。
 */
function TestConnectionModal({
  provider,
  onClose,
  onResult,
}: {
  provider: PublicProvider
  onClose: () => void
  onResult: (message: FeedbackMessage) => void
}) {
  const [result, setResult] = useState<SettingsTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .testSettings({ probeVision: true, providerId: provider.id })
      .then((next) => {
        if (!cancelled) setResult(next)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(toErrorMessage(cause))
      })
    return () => {
      cancelled = true
    }
  }, [provider.id])

  useEffect(() => {
    if (result?.text.ok) {
      onResult({ tone: 'success', text: `「${provider.name}」连通性测试通过` })
    }
    // 只在拿到结果的那一刻提示一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  return (
    <Modal
      title="API 连通性测试"
      description={`正在测试「${provider.name}」· ${provider.baseUrl}`}
      onClose={onClose}
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          关闭窗口
        </Button>
      }
    >
      {error != null && (
        <div className="rounded-control bg-bad-soft px-3.5 py-2.5 text-sm text-bad-ink">{error}</div>
      )}
      {result === null && error === null && (
        <p className="text-sm text-ink-muted">正在握手…（会真实发起一次极小的请求）</p>
      )}
      {result && (
        <div className="space-y-3">
          <ProbeRow title="文本连通性" outcome={result.text} />
          {result.vision && <ProbeRow title="图像输入能力" outcome={result.vision} />}
          {!result.vision && result.text.ok && (
            <p className="text-xs text-ink-muted">
              文本可用；本次未探测图像能力（连接正常后才会做这项探测）。
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

function ProbeRow({ title, outcome }: { title: string; outcome: ProbeOutcome }) {
  // 有响应但没答对：链路是通的，所以不判失败（红），只陈述（amber）——两者是不同的结论
  const answerMismatch = outcome.ok && outcome.answerCorrect === false
  return (
    <div
      className={`rounded-control border px-3.5 py-3 text-sm ${!outcome.ok
          ? 'border-bad-line bg-bad-soft text-bad-ink'
          : answerMismatch
            ? 'border-warn-line bg-warn-soft text-warn-ink'
            : 'border-ok-line bg-ok-soft text-ok-ink'
        }`}
    >
      <div className="font-semibold">
        {title}：{outcome.ok ? '通过' : '失败'}
        {outcome.latencyMs !== null && (
          <span className="ml-2 font-normal opacity-80 tabular-nums">{outcome.latencyMs}ms</span>
        )}
      </div>
      <p className="mt-1 text-xs leading-relaxed">
        {outcome.ok ? (outcome.reply ?? '（模型返回了空内容）') : (outcome.errorMessage ?? '未知错误')}
      </p>
      {answerMismatch && (
        <p className="mt-1 text-xs leading-relaxed">
          模型有响应，但答案与预期不符——可能没真正读到图片内容，请换带视觉能力的模型再试。
        </p>
      )}
      {outcome.ok && outcome.answerCorrect === true && (
        <p className="mt-1 text-xs leading-relaxed opacity-80">已核对：模型答出了预期内容。</p>
      )}
      {outcome.errorDetail != null && (
        <p className="mt-1 font-mono text-2xs break-all opacity-70">{outcome.errorDetail}</p>
      )}
    </div>
  )
}

/** 预设模板填充：只覆盖地址、默认模型与模型清单，不动用户已填的名称与密钥 */
function applyPreset(draft: ProviderDraft, preset: ProviderPreset): ProviderDraft {
  return {
    ...draft,
    presetId: preset.id,
    name: draft.name.trim() === '' ? preset.label : draft.name,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    model: preset.defaultModel,
    models: preset.suggestedModels.join(', '),
    supportsVision: preset.recommendsVision,
  }
}
