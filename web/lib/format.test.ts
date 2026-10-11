import { describe, expect, it } from 'vitest'
import { formatBytes, formatRelativeTime } from './format'

/**
 * 相对时间的边界是这类函数唯一会出错的地方（差一秒就换一档），所以按档位钉住。
 * 时间基准固定注入，不读真实时钟。
 */

const NOW = Date.parse('2026-10-10T12:00:00.000Z')

describe('formatRelativeTime', () => {
  it('一分钟内是「刚刚」', () => {
    expect(formatRelativeTime('2026-10-10T12:00:00.000Z', NOW)).toBe('刚刚')
    expect(formatRelativeTime('2026-10-10T11:59:30.000Z', NOW)).toBe('刚刚')
  })

  it('分钟档：满 1 分钟起，到 60 分钟为止', () => {
    expect(formatRelativeTime('2026-10-10T11:59:00.000Z', NOW)).toBe('1 分钟前')
    expect(formatRelativeTime('2026-10-10T11:01:00.000Z', NOW)).toBe('59 分钟前')
  })

  it('小时档：满 60 分钟起，到 24 小时为止', () => {
    expect(formatRelativeTime('2026-10-10T11:00:00.000Z', NOW)).toBe('1 小时前')
    expect(formatRelativeTime('2026-10-09T13:00:00.000Z', NOW)).toBe('23 小时前')
    // 备份的典型情形：早上开机时留的，下午来看
    expect(formatRelativeTime('2026-10-10T10:00:00.000Z', NOW)).toBe('2 小时前')
  })

  it('天档：满 24 小时起，到 30 天为止', () => {
    expect(formatRelativeTime('2026-10-09T12:00:00.000Z', NOW)).toBe('1 天前')
    expect(formatRelativeTime('2026-09-11T12:00:00.000Z', NOW)).toBe('29 天前')
  })

  it('超过 30 天退回绝对日期——那时「34 天前」不如日期有用', () => {
    const long = formatRelativeTime('2026-09-06T12:00:00.000Z', NOW)
    expect(long).not.toContain('天前')
    expect(long).toMatch(/2026/)
  })
})

describe('formatBytes', () => {
  it('一 MB 以下给 KB，整数、不带小数', () => {
    expect(formatBytes(188416)).toBe('184 KB')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(0)).toBe('0 KB')
  })

  it('一 MB 及以上给 MB，保留一位小数', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(5 * 1024 * 1024 + 512 * 1024)).toBe('5.5 MB')
  })
})
