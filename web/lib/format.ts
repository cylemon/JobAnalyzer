import type { JobPost } from '@shared/schemas/job'

/**
 * 薪资展示。原文优先——招聘信息里「30-50k·15薪」这种写法本身就带信息，
 * 拆成数字再拼回去反而会丢掉「·15薪」这类细节。
 * 只有在没有原文时才用结构化的 min/max 兜底。
 *
 * **没有薪资信息时返回 null，而不是「薪资未提供」**：岗位允许多项留空，
 * 缺什么就不显示什么，连占位文字也不占版面（F-2.4）。
 */
export function formatSalary(job: JobPost): string | null {
  const parts: string[] = []
  if (job.salaryText) {
    parts.push(job.salaryText)
  } else if (job.salaryMin !== null && job.salaryMax !== null) {
    parts.push(`${Math.round(job.salaryMin / 1000)}k-${Math.round(job.salaryMax / 1000)}k`)
  }
  if (job.salaryMonths !== null && !job.salaryText?.includes('薪')) {
    parts.push(`${job.salaryMonths} 薪`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/** 地点：城市 + 区/县，两级之间用空格隔开（与录入时的填写口径一致），都缺则为 null */
export function formatLocation(job: JobPost): string | null {
  const parts = [job.locationCity?.trim(), job.locationDistrict?.trim()].filter(
    (part): part is string => part !== undefined && part !== '',
  )
  return parts.length > 0 ? parts.join(' ') : null
}

/**
 * 指代一个岗位时用的名字：优先职位描述，其次是公司名。
 * 两者都空时给一句占位文字——按钮、删除确认里不能出现「「」已删除」这种空指代。
 */
export function jobDisplayName(job: Pick<JobPost, 'title' | 'companyName'>): string {
  if (job.title.trim() !== '') return job.title
  if (job.companyName.trim() !== '') return job.companyName
  return '未填写职位描述的岗位'
}

/**
 * 文件大小。备份库是几百 KB 量级，所以一律给 KB、不给字节——
 * 「196608 字节」这种写法在这里只是噪音，且 MB 会把几份之间的差异抹平。
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/**
 * 相对时间：「2 小时前」。
 *
 * 只用于「多久以前」本身就是信息的场合（最近备份、快照时刻）——
 * 需要知道具体是哪一天时仍要显示绝对时间，相对时间看不出这个。
 * 超过一个月就退回日期：那时「34 天前」已经不如「2026-09-06」有用。
 *
 * `now` 可注入，边界（59 分钟 / 23 小时 / 29 天）才好测。
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`

  return new Date(iso).toLocaleDateString('zh-CN')
}
