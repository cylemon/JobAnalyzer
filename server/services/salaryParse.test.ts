import { describe, expect, it } from 'vitest'
import { parseSalaryText } from './salaryParse'

/**
 * 本地薪资换算：口径必须与 Prompt 第 1 条一致（k=千元、万=万元、年薪除以 12）。
 * 这里读的是模型抄回来的薪资原文，读不准不如不读——所以「读不出来」的用例和「读得出来」同等重要。
 */

describe('parseSalaryText', () => {
  it('8-12K：单位只写在第二个数后面时，两个数按同一个单位换算', () => {
    expect(parseSalaryText('8-12K')).toEqual({ min: 8000, max: 12000, months: null, raw: '8-12K' })
  })

  it('25k-35k·16薪：区间与薪数一并读出', () => {
    expect(parseSalaryText('25k-35k·16薪')).toEqual({
      min: 25000,
      max: 35000,
      months: 16,
      raw: '25k-35k·16薪',
    })
  })

  it('没有单位的纯数字按元处理', () => {
    expect(parseSalaryText('8000-12000')).toEqual({ min: 8000, max: 12000, months: null, raw: '8000-12000' })
  })

  it('年薪按 12 个月折算', () => {
    expect(parseSalaryText('年薪 24-36万')).toEqual({ min: 20000, max: 30000, months: null, raw: '24-36万' })
  })

  it('单个数值（必须带单位）上下限相同', () => {
    expect(parseSalaryText('15K')).toEqual({ min: 15000, max: 15000, months: null, raw: '15K' })
  })

  it('上下限颠倒时按从小到大返回', () => {
    expect(parseSalaryText('35k-25k')).toMatchObject({ min: 25000, max: 35000 })
  })

  it('读不出月薪的写法一律返回 null，不猜', () => {
    expect(parseSalaryText('面议')).toBeNull()
    // 没有单位、又不足千的数字：可能是「8-12」，也可能是别的编号
    expect(parseSalaryText('8-12')).toBeNull()
    expect(parseSalaryText('300 元/天')).toBeNull()
  })

  it('超出合理范围的薪数不采纳', () => {
    // 「月薪 30 薪」这类明显不对的写法宁可当作没读到
    expect(parseSalaryText('15K·30薪')).toMatchObject({ months: null })
  })

  it('一段文本里有多个数字区间时，带单位的那个才是薪资', () => {
    // 「2025-2026」也是区间，但它没有单位，不能当薪资
    expect(parseSalaryText('2025-2026届校招 8-12K')).toEqual({
      min: 8000,
      max: 12000,
      months: null,
      raw: '8-12K',
    })
  })

  it('薪数写在区间之外时，原文里补上，方便回填薪资原文', () => {
    expect(parseSalaryText('薪资 8-12K，一年 13 薪')).toMatchObject({ raw: '8-12K·13薪' })
  })

  it('跟「元」的区间算带单位', () => {
    expect(parseSalaryText('8000-12000元')).toEqual({
      min: 8000,
      max: 12000,
      months: null,
      raw: '8000-12000',
    })
  })
})
