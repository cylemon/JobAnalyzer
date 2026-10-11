import { describe, expect, it } from 'vitest'
import { JobSaveInputSchema, missingRequiredJobFields, OriginalUrlSchema } from './job'

/**
 * 入库契约：**公司、地区、薪资必填**，职位描述、业务领域与岗位原链接仍可留空（F-2.4）。
 *
 * 必填与否由 `missingRequiredJobFields` 一处判定——待确认表单据此标必填、禁用「确认入库」，
 * 服务端在同一次判定上兜底。测试钉住这个口子的形状：三项缺一不可、区/县不是必须的、
 * 薪资「原文或数值有其一」即可，顺手也钉住「留空不等于不限长」。
 * 岗位原链接是**选填**：不填不拦入库，但真填了仍得是个 http(s) 地址。
 */

function input(overrides: Record<string, unknown> = {}) {
  return {
    categoryId: 'category-1',
    companyName: '矩瞳科技',
    title: '',
    salaryText: '8-12K',
    locationCity: '南京',
    originalUrl: 'https://jobs.example.com/1',
    responsibilities: [],
    requirements: [],
    bonusPoints: [],
    requirementItems: [],
    ...overrides,
  }
}

describe('JobSaveInputSchema 的必填项', () => {
  it('三项齐了就能入库，职位描述与业务领域留空无妨', () => {
    const parsed = JobSaveInputSchema.safeParse(input())
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.title).toBe('')
  })

  it('公司只有空白字符时被拒绝，报错点名是哪一项', () => {
    const parsed = JobSaveInputSchema.safeParse(input({ companyName: '   ' }))
    expect(parsed.success).toBe(false)
    expect(!parsed.success && JSON.stringify(parsed.error.issues)).toContain('公司')
  })

  it('地区至少要给到城市；区/县仍可留空', () => {
    expect(JobSaveInputSchema.safeParse(input({ locationCity: null })).success).toBe(false)
    expect(JobSaveInputSchema.safeParse(input({ locationCity: '  ' })).success).toBe(false)
    expect(
      JobSaveInputSchema.safeParse(input({ locationCity: '南京', locationDistrict: null })).success,
    ).toBe(true)
  })

  it('薪资原文与数值有其一就算填了', () => {
    expect(
      JobSaveInputSchema.safeParse(input({ salaryText: null, salaryMin: 8000, salaryMax: 12000 }))
        .success,
    ).toBe(true)
    expect(
      JobSaveInputSchema.safeParse(input({ salaryText: null, salaryMin: 8000, salaryMax: null }))
        .success,
    ).toBe(true)
    expect(
      JobSaveInputSchema.safeParse(input({ salaryText: '   ', salaryMin: null, salaryMax: null }))
        .success,
    ).toBe(false)
  })

  it('岗位原链接选填：不填也能入库，留空归一成 null', () => {
    const empty = JobSaveInputSchema.safeParse(input({ originalUrl: null }))
    expect(empty.success).toBe(true)
    expect(empty.success && empty.data.originalUrl).toBeNull()

    const blank = JobSaveInputSchema.safeParse(input({ originalUrl: '   ' }))
    expect(blank.success).toBe(true)
    expect(blank.success && blank.data.originalUrl).toBeNull()
  })

  it('岗位原链接一旦填了，仍得是 http(s) 地址，报错点它的名', () => {
    for (const url of ['ftp://example.com/1', 'javascript:alert(1)', 'example.com/1']) {
      const parsed = JobSaveInputSchema.safeParse(input({ originalUrl: url }))
      expect(parsed.success).toBe(false)
      expect(!parsed.success && JSON.stringify(parsed.error.issues)).toContain('岗位原链接')
    }
  })

  it('留空后仍会被裁剪成空串，不会带进空白字符', () => {
    const parsed = JobSaveInputSchema.safeParse(input({ title: '   ' }))
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.title).toBe('')
  })

  it('分类仍然必填——岗位必须归属某个分类', () => {
    expect(JobSaveInputSchema.safeParse(input({ categoryId: '' })).success).toBe(false)
  })

  it('字段长度上限照旧生效', () => {
    expect(JobSaveInputSchema.safeParse(input({ companyName: 'x'.repeat(101) })).success).toBe(false)
    expect(JobSaveInputSchema.safeParse(input({ title: 'x'.repeat(101) })).success).toBe(false)
  })
})

describe('missingRequiredJobFields', () => {
  it('齐全时返回空数组', () => {
    expect(
      missingRequiredJobFields({
        companyName: '矩瞳科技',
        locationCity: '南京',
        salaryText: '8-12K',
      }),
    ).toEqual([])
  })

  it('缺什么报什么，顺序固定', () => {
    expect(
      missingRequiredJobFields({
        companyName: '  ',
        locationCity: null,
        salaryText: null,
        salaryMin: null,
        salaryMax: null,
      }),
    ).toEqual(['companyName', 'locationCity', 'salaryText'])
  })

  it('薪资只给了数值时不算缺', () => {
    expect(
      missingRequiredJobFields({
        companyName: '矩瞳科技',
        locationCity: '南京',
        salaryText: null,
        salaryMax: 12000,
      }),
    ).toEqual([])
  })

})

/**
 * 岗位原链接是**手填**字段（模型提取不到），也是唯一会被塞进 `<a href>` 的用户输入。
 *
 * 入库与修改两条路径都选填（不填即 null），但协议两条路径都要卡死——
 * 少这一关，`javascript:` 之类的手填地址会原样进 `<a href>`，点一下就是一次脚本执行。
 */
describe('OriginalUrlSchema', () => {
  it('没填就是 null，不留空串；两头空白会被裁掉', () => {
    const blank = OriginalUrlSchema.safeParse('   ')
    expect(blank.success && blank.data).toBeNull()

    const padded = OriginalUrlSchema.safeParse('  https://jobs.example.com/1  ')
    expect(padded.success && padded.data).toBe('https://jobs.example.com/1')
  })

  it('只接受 http / https，其它协议一律拒绝', () => {
    expect(OriginalUrlSchema.safeParse('http://example.com/a').success).toBe(true)
    expect(OriginalUrlSchema.safeParse('javascript:alert(1)').success).toBe(false)
    expect(OriginalUrlSchema.safeParse('ftp://example.com/a').success).toBe(false)
    expect(OriginalUrlSchema.safeParse('example.com/a').success).toBe(false)
  })

  it('超长地址被拒绝', () => {
    expect(OriginalUrlSchema.safeParse(`https://example.com/${'a'.repeat(2000)}`).success).toBe(false)
  })
})
