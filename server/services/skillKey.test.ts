import { describe, expect, it } from 'vitest'
import { normalizeSkillKey } from './skillKey'

/**
 * 归一化是匹配度与缺失技能统计的共同地基（原则 ⑤）。
 * 这里覆盖 03-architecture.md §4.1 要求的全部归一化场景。
 */
describe('normalizeSkillKey', () => {
  it('忽略大小写', () => {
    expect(normalizeSkillKey('Python')).toBe('python')
    expect(normalizeSkillKey('pYtHoN')).toBe('python')
    expect(normalizeSkillKey('python')).toBe('python')
  })

  it('去除首尾与连续空白', () => {
    expect(normalizeSkillKey('  Spring   Boot  ')).toBe('spring boot')
    expect(normalizeSkillKey('Spring\tBoot')).toBe('spring boot')
    expect(normalizeSkillKey('Spring\nBoot')).toBe('spring boot')
  })

  it('全角转半角（NFKC）', () => {
    expect(normalizeSkillKey('Ｐｙｔｈｏｎ')).toBe('python')
    expect(normalizeSkillKey('Ｃ＋＋')).toBe('c++')
    expect(normalizeSkillKey('Ｓｐｒｉｎｇ　Ｂｏｏｔ')).toBe('spring boot')
  })

  it('保护 c++ / c# / node.js 这类含特殊字符的技能名', () => {
    expect(normalizeSkillKey('C++')).toBe('c++')
    expect(normalizeSkillKey('C#')).toBe('c#')
    expect(normalizeSkillKey('Node.js')).toBe('node.js')
  })

  it('把斜杠、括号、连字符等视为分隔符', () => {
    expect(normalizeSkillKey('机器学习/深度学习')).toBe('机器学习 深度学习')
    expect(normalizeSkillKey('Vue(3)')).toBe('vue 3')
    expect(normalizeSkillKey('spring-boot')).toBe('spring boot')
    expect(normalizeSkillKey('React & Redux')).toBe('react redux')
  })

  it('保留中文技能名', () => {
    expect(normalizeSkillKey('分布式系统')).toBe('分布式系统')
    expect(normalizeSkillKey('  微服务架构  ')).toBe('微服务架构')
  })

  it('不同写法归一化到同一个键（这是匹配正确性的前提）', () => {
    const variants = ['Kubernetes', 'kubernetes', ' KUBERNETES ', 'Ｋｕｂｅｒｎｅｔｅｓ']
    const keys = new Set(variants.map(normalizeSkillKey))
    expect(keys.size).toBe(1)
    expect([...keys][0]).toBe('kubernetes')
  })

  it('不含任何有效字符时返回空字符串，交由调用方显式报错', () => {
    expect(normalizeSkillKey('')).toBe('')
    expect(normalizeSkillKey('   ')).toBe('')
    expect(normalizeSkillKey('!!!')).toBe('')
    expect(normalizeSkillKey('—')).toBe('')
  })

  it('不会把不同技能错误地合并', () => {
    expect(normalizeSkillKey('Java')).not.toBe(normalizeSkillKey('JavaScript'))
    expect(normalizeSkillKey('Node.js')).not.toBe(normalizeSkillKey('Nodejs'))
  })
})
