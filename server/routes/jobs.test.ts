import { describe, expect, it } from 'vitest'
import { readJobForm } from './jobs'

/**
 * 多张截图必须**一张不少**地送到模型。
 *
 * 这里钉的是一个踩过的坑：Hono 的 `c.req.parseBody()` 对同名字段只保留最后一个值，
 * 于是「上传 2 张截图」实际只送了最后 1 张，长 JD 被静默截成半份——
 * 表现成「薪资解析不到」「要求条目 0 条」，看起来像模型不行。
 */
function formWith(files: number, text?: string): FormData {
  const form = new FormData()
  form.set('categoryId', 'category-1')
  if (text !== undefined) form.set('text', text)
  for (let index = 0; index < files; index += 1) {
    form.append(
      'images',
      new File([new Uint8Array(index + 1)], `${index + 1}.png`, { type: 'image/png' }),
    )
  }
  return form
}

describe('readJobForm', () => {
  it('两张截图会原样读出两张，不会被并成一个', () => {
    const parsed = readJobForm(formWith(2))
    expect(parsed.images.map((file) => file.name)).toEqual(['1.png', '2.png'])
  })

  it('文本与分类照常读出', () => {
    const parsed = readJobForm(formWith(0, '岗位原文'))
    expect(parsed.categoryId).toBe('category-1')
    expect(parsed.text).toBe('岗位原文')
    expect(parsed.images).toEqual([])
  })

  it('截图与文本可以同时存在', () => {
    const parsed = readJobForm(formWith(3, '同一岗位的补充说明'))
    expect(parsed.images).toHaveLength(3)
    expect(parsed.text).toBe('同一岗位的补充说明')
  })
})
