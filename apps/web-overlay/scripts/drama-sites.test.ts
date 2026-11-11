/**
 * A10：首页短剧影院收集口径单测。
 * 推荐位（海报墙/热播榜）必须剔除巡检确认失效（broken）与已停用（enabled=false）的站；
 * 正常站（含未巡检、无 status 字段的旧快照）保留，顺序与去重不变。
 */
import { describe, expect, it } from 'vitest'
import { collectDramaSites } from '../src/lib/drama-sites'

const NAV = [
  {
    id: 'duanju',
    title: '短剧',
    items: [
      { id: 'a', title: '甲平台', href: 'https://a.example.com', status: 'active' },
      { id: 'b', title: '乙平台', href: 'https://b.example.com', status: 'broken' },
    ],
    subCategories: [
      {
        items: [
          { id: 'c', title: '丙平台', href: 'https://c.example.com' },
          { id: 'd', title: '丁平台', href: 'https://d.example.com', enabled: false, status: 'active' },
          { id: 'a', title: '甲平台', href: 'https://a.example.com', status: 'active' },
          { id: 'e', title: '戊平台', href: 'https://e.example.com', status: 'broken' },
        ],
      },
    ],
  },
  { id: 'other', title: '其他', items: [{ id: 'z', title: '无关站', href: 'https://z.example.com' }] },
]

describe('collectDramaSites', () => {
  it('剔除 broken 与 enabled=false，保留 active 与无 status 的旧快照站', () => {
    const sites = collectDramaSites(NAV)
    expect(sites.map((s) => s.id)).toEqual(['a', 'c'])
  })

  it('按标题也能找到短剧分类；找不到时返回空数组', () => {
    expect(collectDramaSites([{ title: '短剧', items: [{ id: 'x', title: 'X', href: 'https://x.example.com' }] }]).map((s) => s.id)).toEqual(['x'])
    expect(collectDramaSites([{ id: 'news', title: '资讯', items: [] }])).toEqual([])
    expect(collectDramaSites(null)).toEqual([])
    expect(collectDramaSites(undefined)).toEqual([])
  })
})
