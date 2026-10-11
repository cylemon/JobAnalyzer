import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Award, BriefcaseBusiness, Link2, Pencil, Plus, Trash2, Wrench } from 'lucide-react'
import type { AbilityDimension, AbilityOverview } from '@shared/schemas/ability'
import {
  DEFAULT_PROFICIENCY_LEVEL,
  PROFICIENCY_LABEL,
  PROFICIENCY_LEVELS,
  type ProficiencyLevel,
} from '@shared/schemas/common'
import type { Experience } from '@shared/schemas/experience'
import type { Skill } from '@shared/schemas/skill'
import { AliasManagerDialog } from '@/components/AliasManagerDialog'
import { Feedback, type FeedbackMessage } from '@/components/Feedback'
import {
  HeroDivider,
  HeroGroup,
  HeroPanel,
  type HeroStatItem,
  type HeroTone,
} from '@/components/HeroPanel'
import { PageHeader } from '@/components/PageHeader'
import { PageBody, PageContainer, PageSticky } from '@/components/PageShell'
import { SectionHeader } from '@/components/SectionHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Select, Textarea } from '@/components/ui/input'
import { ConfirmDialog, Modal } from '@/components/ui/modal'
import { toErrorMessage } from '@/lib/errors'
import { api } from '@/services/api'
import { ICON_SIZE } from '@/lib/icons'

/**
 * 个人信息（F-1）：专业知识 / 技能与能力 / 项目经验三块资产。
 *
 * 这三块是匹配度的「用户侧」输入，也是唯一能做到「改完立刻看到全盘变化」的地方：
 * 专业知识的结论由本地判定，新增一项知识后所有岗位的知识匹配度毫秒级刷新（零 Token）；
 * 能力与经验的判词来自模型，改完由服务端自动重评（去抖窗口见 services/reevaluation.ts）。
 *
 * **本页不显示任何「检测到改动 / 正在重新评估」**：这里的数据是用户手输的，
 * 那种提示挂在这一页只会让人以为这一页自己的内容还没存好。改动引发的那轮重评
 * 由展示评估结果的页面（岗位信息 / 综合看板 / 分类综合分析）各报各的。
 */

type SkillDraft = { name: string; level: ProficiencyLevel }
type ExperienceDraft = { project: string; durationMonths: string }
type DimensionDraft = { name: string }

/**
 * 熟练度**没有「未标注 / 未自评」这一档**（口径见 shared/schemas/common.ts 的
 * DEFAULT_PROFICIENCY_LEVEL）：新知识项默认「一般」、老数据里没标的也按「一般」显示；
 * 能力侧同理，维度建了就有这一项，没自评的按「一般」。
 * 系统不替用户填的是「精通 / 熟练」，不是「有没有这一项」。
 */
const DEFAULT_LEVEL = DEFAULT_PROFICIENCY_LEVEL

const EMPTY_SKILL: SkillDraft = { name: '', level: DEFAULT_LEVEL }
const EMPTY_EXPERIENCE: ExperienceDraft = { project: '', durationMonths: '' }
const EMPTY_DIMENSION: DimensionDraft = { name: '' }

/**
 * 本页删除按钮的写法：默认与「修改」同一个灰，悬停才亮成玫红并给出底。
 * destructiveQuiet 自带的灰是 ink-faint，比旁边的铅笔还淡一档——一排图标按钮
 * 静止时必须是同一种灰，否则「删除」看上去像不可用。所以这里把灰压到 ink-muted。
 */
const DELETE_BUTTON = 'text-ink-muted'

type PendingDelete =
  | { kind: 'skill'; id: string; label: string }
  | { kind: 'experience'; id: string; label: string }
  | { kind: 'dimension'; id: string; label: string }

export function ProfilePage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [experiences, setExperiences] = useState<Experience[]>([])
  const [abilities, setAbilities] = useState<AbilityOverview>({ dimensions: [], abilities: [] })

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null)
  const [busy, setBusy] = useState(false)

  const [skillDraft, setSkillDraft] = useState<SkillDraft | null>(null)
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null)
  const [experienceDraft, setExperienceDraft] = useState<ExperienceDraft | null>(null)
  const [editingExperienceId, setEditingExperienceId] = useState<string | null>(null)
  const [dimensionDraft, setDimensionDraft] = useState<DimensionDraft | null>(null)
  const [editingDimensionKey, setEditingDimensionKey] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [aliasManagerOpen, setAliasManagerOpen] = useState(false)

  const reload = useCallback(async () => {
    const [skillRows, experienceRows, overview] = await Promise.all([
      api.listSkills(),
      api.listExperiences(),
      api.getAbilities(),
    ])
    setSkills(skillRows)
    setExperiences(experienceRows)
    setAbilities(overview)
  }, [])

  useEffect(() => {
    let cancelled = false
    reload()
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(toErrorMessage(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reload])

  /* ------------------------------------------------------------ 顶部横幅汇总 */

  // 老数据里没标等级的按「一般」计：分布里不能再冒出「未标注」这一档
  const skillStats = useMemo(
    () => proficiencyStats(skills.map((skill) => skill.level ?? DEFAULT_LEVEL), 'amber'),
    [skills],
  )

  // 服务端返回的就是有效自评：每个维度都有一条（没自评的按「一般」），
  // 所以这里不需要再补一档「未自评」——它与知识侧是同一个口径
  const abilityStats = useMemo(
    () => proficiencyStats(abilities.abilities.map((ability) => ability.level), 'emerald'),
    [abilities],
  )

  const experienceStats = useMemo((): HeroStatItem[] => {
    if (experiences.length === 0) return []
    const totalMonths = experiences.reduce((sum, item) => sum + item.durationMonths, 0)
    return [
      { value: experiences.length, unit: '个', label: '项目', tone: 'cyan' },
      { value: totalMonths, unit: '个月', label: '累计持续时长', tone: 'cyan' },
    ]
  }, [experiences])

  const abilityByKey = useMemo(
    () => new Map(abilities.abilities.map((ability) => [ability.dimensionKey, ability])),
    [abilities],
  )

  /* ------------------------------------------------------------------ 知识 */

  function openSkillModal(skill?: Skill) {
    setEditingSkillId(skill?.id ?? null)
    setSkillDraft(skill ? { name: skill.name, level: skill.level ?? DEFAULT_LEVEL } : EMPTY_SKILL)
  }

  /**
   * 卡片上就地改熟练度：点哪一档就是哪一档，不必开弹窗。
   * 不弹成功提示——被点的那一档当场亮起来，横幅的分布数字也跟着动，再飘一句是重复播报。
   */
  async function setSkillLevel(skill: Skill, level: ProficiencyLevel) {
    setBusy(true)
    try {
      await api.updateSkill(skill.id, { level })
      await reload()
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmitSkill(event: FormEvent) {
    event.preventDefault()
    if (!skillDraft) return

    setBusy(true)
    try {
      const payload = {
        name: skillDraft.name,
        level: skillDraft.level,
      }
      if (editingSkillId) await api.updateSkill(editingSkillId, payload)
      else await api.createSkill(payload)

      // 保存完不弹提示：知识项当场出现在列表里（名字、熟练度都是刚填的那份），
      // 岗位那边重算出来的分数在岗位页上直接可见
      await reload()
      setSkillDraft(null)
      setEditingSkillId(null)
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  /* ---------------------------------------------------------------- 项目经验 */

  function openExperienceModal(experience?: Experience) {
    setEditingExperienceId(experience?.id ?? null)
    setExperienceDraft(
      experience
        ? {
          project: experience.project,
          durationMonths: String(experience.durationMonths),
        }
        : EMPTY_EXPERIENCE,
    )
  }

  async function handleSubmitExperience(event: FormEvent) {
    event.preventDefault()
    if (!experienceDraft) return

    setBusy(true)
    try {
      const payload = {
        project: experienceDraft.project.trim(),
        durationMonths: Number.parseInt(experienceDraft.durationMonths, 10) || 0,
      }
      if (editingExperienceId) {
        await api.updateExperience(editingExperienceId, payload)
      } else {
        await api.createExperience(payload)
      }

      await reload()
      setExperienceDraft(null)
      setEditingExperienceId(null)
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  /* ------------------------------------------------------------------ 能力 */

  async function setAbilityLevel(dimensionKey: string, level: ProficiencyLevel) {
    setBusy(true)
    try {
      const overview = await api.saveAbility({
        dimensionKey,
        level,
        note: abilityByKey.get(dimensionKey)?.note ?? null,
      })
      setAbilities(overview)
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  /** 打开能力弹窗：新增（不带 dimension）与改名（带 dimension）共用同一个表单 */
  function openDimensionModal(dimension?: AbilityDimension) {
    setEditingDimensionKey(dimension?.key ?? null)
    setDimensionDraft(dimension ? { name: dimension.name } : EMPTY_DIMENSION)
  }

  async function handleSubmitDimension(event: FormEvent) {
    event.preventDefault()
    if (!dimensionDraft) return

    setBusy(true)
    try {
      const name = dimensionDraft.name.trim()
      setAbilities(
        editingDimensionKey === null
          ? await api.createAbilityDimension({ name })
          : await api.updateAbilityDimension(editingDimensionKey, { name }),
      )
      setDimensionDraft(null)
      setEditingDimensionKey(null)
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  /* ------------------------------------------------------------------ 删除 */

  async function handleConfirmDelete() {
    if (!pendingDelete) return
    setBusy(true)
    try {
      // 删除成功不弹提示：被删的那一行连同它的计数当场就从列表里没了
      if (pendingDelete.kind === 'skill') {
        await api.deleteSkill(pendingDelete.id)
      } else if (pendingDelete.kind === 'experience') {
        await api.deleteExperience(pendingDelete.id)
      } else {
        setAbilities(await api.deleteAbilityDimension(pendingDelete.id))
      }
      await reload()
      setPendingDelete(null)
    } catch (cause) {
      setFeedback({ tone: 'error', text: toErrorMessage(cause) })
    } finally {
      setBusy(false)
    }
  }

  /**
   * 页头吸顶区：加载态与正式态**共用这一份**。
   *
   * 加载态原来连页头一起换掉，切页时标题先消失、再重建 —— 那就是切换瞬间的「跳」。
   * 两个分支从此只有正文不同，页顶永远不动。
   */
  const header = (
    <PageSticky>
      <PageHeader title="个人信息管理" />
    </PageSticky>
  )

  if (loading) {
    return (
      <PageContainer>
        {header}
        <PageBody>
          <p className="text-sm text-ink-muted">正在读取个人资产…</p>
        </PageBody>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      {header}

      <PageBody>
        {loadError != null && (
          <div className="rounded-control bg-bad-soft px-3.5 py-2.5 text-sm text-bad-ink">
            读取个人资产失败：{loadError}
          </div>
        )}

        <Feedback message={feedback} className="mb-0" />

        {/* 概览横幅：三栏与页面三大块一一对应（专业知识 / 技能与能力 / 项目经验） */}
        <HeroPanel>
          <HeroGroup
            title="知识熟练度分布"
            empty="暂无知识项"
            size="large"
            stats={skillStats}
          />
          <HeroDivider />
          <HeroGroup
            title="能力熟练度分布"
            empty="暂无能力维度"
            size="large"
            stats={abilityStats}
          />
          <HeroDivider />
          <HeroGroup
            title="项目经验时长概况"
            empty="暂无项目经验"
            size="large"
            stats={experienceStats}
          />
        </HeroPanel>

        {/* 专业知识 */}
        <section className="space-y-4">
          <SectionHeader
            title="专业知识"
            action={
              <>
                <Button variant="secondary" size="sm" onClick={() => setAliasManagerOpen(true)}>
                  <Link2 size={ICON_SIZE.control} />
                  知识别名
                </Button>
                <Button size="sm" onClick={() => openSkillModal()}>
                  <Plus size={ICON_SIZE.control} />
                  新增知识项
                </Button>
              </>
            }
          />

          {skills.length === 0 ? (
            <EmptyState icon={Wrench} title="还没有知识项" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {skills.map((skill) => (
                <Card key={skill.id} className="flex flex-col justify-between gap-4 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-base font-bold text-ink" title={skill.name}>
                      {skill.name}
                    </h3>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={`编辑知识项 ${skill.name}`}
                        onClick={() => openSkillModal(skill)}
                      >
                        <Pencil size={ICON_SIZE.control} />
                      </Button>
                      <Button
                        variant="destructiveQuiet"
                        size="iconSm"
                        className={DELETE_BUTTON}
                        aria-label={`删除知识项 ${skill.name}`}
                        onClick={() =>
                          setPendingDelete({ kind: 'skill', id: skill.id, label: skill.name })
                        }
                      >
                        <Trash2 size={ICON_SIZE.control} />
                      </Button>
                    </div>
                  </div>

                  {/* 熟练度就地可改：卡片上直接点，不用先进弹窗 */}
                  <ProficiencyPicker
                    level={skill.level ?? DEFAULT_LEVEL}
                    busy={busy}
                    ariaLabel={`设置知识项 ${skill.name} 的熟练度`}
                    onSelect={(level) => void setSkillLevel(skill, level)}
                  />
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* 技能与能力 */}
        <section className="space-y-4">
          <SectionHeader
            title="技能与能力"
            action={
              <Button size="sm" onClick={() => openDimensionModal()}>
                <Plus size={ICON_SIZE.control} />
                新增能力维度
              </Button>
            }
          />

          {abilities.dimensions.length === 0 ? (
            <EmptyState icon={Award} title="还没有能力维度" />
          ) : (
            <Card>
              <CardBody className="pt-5">
                <div className="grid gap-2 lg:grid-cols-2">
                  {abilities.dimensions.map((dimension) => (
                    <AbilityRow
                      key={dimension.key}
                      dimension={dimension}
                      // 没有自评行时按「一般」显示：服务端就是这么返回的，这里只是兜底
                      level={abilityByKey.get(dimension.key)?.level ?? DEFAULT_LEVEL}
                      busy={busy}
                      onSetLevel={setAbilityLevel}
                      onEdit={() => openDimensionModal(dimension)}
                      onDelete={() =>
                        setPendingDelete({
                          kind: 'dimension',
                          id: dimension.key,
                          label: dimension.name,
                        })
                      }
                    />
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </section>

        {/* 项目经验 */}
        <section className="space-y-4">
          <SectionHeader
            title="项目经验"
            action={
              <Button size="sm" onClick={() => openExperienceModal()}>
                <Plus size={ICON_SIZE.control} />
                新增项目经验
              </Button>
            }
          />

          {experiences.length === 0 ? (
            <EmptyState icon={BriefcaseBusiness} title="还没有项目经验" />
          ) : (
            <div className="space-y-4">
              {experiences.map((experience) => (
                <Card key={experience.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2.5">
                      <Badge tone="neutral" dot>
                        持续 {experience.durationMonths} 个月
                      </Badge>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-muted">
                        {experience.project}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1 border-l border-line pl-3">
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={`编辑项目经验 ${projectLabel(experience.project)}`}
                        onClick={() => openExperienceModal(experience)}
                      >
                        <Pencil size={ICON_SIZE.control} />
                      </Button>
                      <Button
                        variant="destructiveQuiet"
                        size="iconSm"
                        className={DELETE_BUTTON}
                        aria-label={`删除项目经验 ${projectLabel(experience.project)}`}
                        onClick={() =>
                          setPendingDelete({
                            kind: 'experience',
                            id: experience.id,
                            label: projectLabel(experience.project),
                          })
                        }
                      >
                        <Trash2 size={ICON_SIZE.control} />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </PageBody>

      {/* ------------------------------------------------------------- 弹窗 */}

      {skillDraft && (
        <Modal
          title={editingSkillId ? '编辑知识项' : '添加知识项'}
          onClose={() => setSkillDraft(null)}
          footer={
            <>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => setSkillDraft(null)}
              >
                取消
              </Button>
              <Button size="sm" type="submit" form="skill-form" disabled={busy}>
                {busy ? '保存中…' : '保存知识项'}
              </Button>
            </>
          }
        >
          <form id="skill-form" className="space-y-4" onSubmit={(e) => void handleSubmitSkill(e)}>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink">知识名称</span>
              <Input
                required
                value={skillDraft.name}
                placeholder="例如：Python / FastAPI / Kubernetes"
                onChange={(e) => setSkillDraft({ ...skillDraft, name: e.target.value })}
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink">熟练度</span>
              <Select
                value={skillDraft.level}
                onChange={(e) =>
                  setSkillDraft({ ...skillDraft, level: e.target.value as ProficiencyLevel })
                }
              >
                {PROFICIENCY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {PROFICIENCY_LABEL[level]}
                  </option>
                ))}
              </Select>
            </label>
          </form>
        </Modal>
      )}

      {experienceDraft && (
        <Modal
          size="lg"
          title={editingExperienceId ? '编辑项目经验' : '添加项目经验'}
          onClose={() => setExperienceDraft(null)}
          footer={
            <>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => setExperienceDraft(null)}
              >
                取消
              </Button>
              <Button size="sm" type="submit" form="experience-form" disabled={busy}>
                {busy ? '保存中…' : '保存项目经验'}
              </Button>
            </>
          }
        >
          <form
            id="experience-form"
            className="space-y-4"
            onSubmit={(e) => void handleSubmitExperience(e)}
          >
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink">项目经验</span>
              <Textarea
                required
                rows={5}
                value={experienceDraft.project}
                placeholder={
                  '做了什么、拿到了什么结果\n例如：主导 RAG 知识库系统搭建，检索准确率提升 35%'
                }
                onChange={(e) =>
                  setExperienceDraft({ ...experienceDraft, project: e.target.value })
                }
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink">项目持续时长（月）</span>
              <Input
                required
                type="number"
                step="1"
                min="0"
                value={experienceDraft.durationMonths}
                placeholder="例如：8"
                onChange={(e) =>
                  setExperienceDraft({ ...experienceDraft, durationMonths: e.target.value })
                }
              />
            </label>
          </form>
        </Modal>
      )}

      {dimensionDraft && (
        <Modal
          title={editingDimensionKey === null ? '新增能力维度' : '编辑能力'}
          onClose={() => {
            setDimensionDraft(null)
            setEditingDimensionKey(null)
          }}
          footer={
            <>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => {
                  setDimensionDraft(null)
                  setEditingDimensionKey(null)
                }}
              >
                取消
              </Button>
              <Button size="sm" type="submit" form="dimension-form" disabled={busy}>
                {busy ? '保存中…' : editingDimensionKey === null ? '新增维度' : '保存名称'}
              </Button>
            </>
          }
        >
          <form
            id="dimension-form"
            className="space-y-4"
            onSubmit={(e) => void handleSubmitDimension(e)}
          >
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink">能力名称</span>
              <Input
                required
                value={dimensionDraft.name}
                placeholder="例如：机械结构设计"
                onChange={(e) => setDimensionDraft({ ...dimensionDraft, name: e.target.value })}
              />
            </label>
            {/* 改名的影响要当面说清：岗位侧的条目、自评都按「键」对齐，而键不跟着名字改 */}
            {editingDimensionKey !== null && (
              <p className="text-xs leading-relaxed text-ink-muted">
                只改显示的名称。岗位上已提取的同类条目与这里的自评都保持不变——不会因为改个名字就断掉对应关系。
              </p>
            )}
          </form>
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={`确定要删除${pendingDelete.kind === 'dimension' ? '该能力维度' : '该记录'}吗？`}
          message={
            pendingDelete.kind === 'dimension'
              ? `「${pendingDelete.label}」将从能力清单移除，自评一并删除。岗位上已有的该能力条目会保留，日后新增同名维度即可对回它们。此操作无法撤销。`
              : `「${pendingDelete.label}」将被删除，相关岗位的匹配度会立即重算。此操作无法撤销。`
          }
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}

      {aliasManagerOpen && (
        <AliasManagerDialog
          skillNames={skills.map((skill) => skill.name)}
          onClose={() => setAliasManagerOpen(false)}
          onChanged={() => void reload()}
        />
      )}
    </PageContainer>
  )
}

/* ------------------------------------------------------------------ 局部组件 */

/** 一行能力：名称 + 三档自评 + 修改 / 删除 */
function AbilityRow({
  dimension,
  level,
  busy,
  onSetLevel,
  onEdit,
  onDelete,
}: {
  dimension: AbilityDimension
  level: ProficiencyLevel
  busy: boolean
  onSetLevel: (dimensionKey: string, level: ProficiencyLevel) => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-line bg-surface-muted px-3 py-2">
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink">
        <Award size={ICON_SIZE.control} className="shrink-0 text-ink-faint" aria-hidden />
        <span className="truncate" title={dimension.name}>
          {dimension.name}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-1">
        <ProficiencyPicker
          level={level}
          busy={busy}
          ariaLabel={`设置「${dimension.name}」的自评等级`}
          onSelect={(option) => onSetLevel(dimension.key, option)}
        />
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={`编辑能力 ${dimension.name}`}
          onClick={onEdit}
        >
          <Pencil size={ICON_SIZE.control} />
        </Button>
        <Button
          variant="destructiveQuiet"
          size="iconSm"
          className={DELETE_BUTTON}
          aria-label={`删除维度 ${dimension.name}`}
          onClick={onDelete}
        >
          <Trash2 size={ICON_SIZE.control} />
        </Button>
      </span>
    </div>
  )
}

/**
 * 三档熟练度：一行三个牌子，当前那一档亮起。知识卡片与能力行共用同一份——
 * 同一类元素（可点的等级）在两处必须长得一样、点法也一样，所以没有第二份实现。
 *
 * 三档之外**没有第四档「未标注 / 未自评」**，也就没有「再点一次取消」这回事：
 * 点当前那一档什么也不会发生。
 */
function ProficiencyPicker({
  level,
  busy,
  ariaLabel,
  onSelect,
}: {
  level: ProficiencyLevel
  busy: boolean
  ariaLabel: string
  onSelect: (level: ProficiencyLevel) => void
}) {
  return (
    <span className="flex shrink-0 items-center gap-1" role="group" aria-label={ariaLabel}>
      {PROFICIENCY_LEVELS.map((option) => {
        const active = option === level
        return (
          <button
            key={option}
            type="button"
            disabled={busy}
            aria-pressed={active}
            onClick={() => {
              if (!active) onSelect(option)
            }}
            className={
              active
                ? 'cursor-pointer rounded-lg border border-accent-line bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-ink'
                : 'cursor-pointer rounded-lg border border-transparent px-2 py-0.5 text-xs text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-50'
            }
          >
            {PROFICIENCY_LABEL[option]}
          </button>
        )
      })}
    </span>
  )
}

/**
 * 熟练度分布：只列出实际出现过的档位，顺序固定为 精通 → 熟练 → 一般。
 * 三档之外没有「未标注 / 未自评」——知识侧与能力侧都默认「一般」，
 * 各自的老数据也并进「一般」，所以这里不需要再补一档。
 */
function proficiencyStats(levels: readonly ProficiencyLevel[], tone: HeroTone): HeroStatItem[] {
  const counts = new Map<ProficiencyLevel, number>()
  for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1)

  return PROFICIENCY_LEVELS.filter((level) => counts.has(level)).map((level) => ({
    value: counts.get(level) as number,
    unit: '项',
    label: PROFICIENCY_LABEL[level],
    tone,
  }))
}

/** 项目经验的短标签：取首行，过长截断——用于删除确认与操作反馈 */
function projectLabel(project: string): string {
  const firstLine = project.split('\n')[0]?.trim() ?? ''
  return firstLine.length > 24 ? `${firstLine.slice(0, 24)}…` : firstLine
}
