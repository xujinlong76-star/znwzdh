import { describe, expect, it } from 'vitest'
import {
  favoritesToVaultItems,
  vaultExportFilename,
  vaultItemsToFavorites,
  type VaultMappableFavorite,
} from '../src/lib/favorites-vault'

/**
 * 收藏 ↔ E2EE 金库的纯转换（P1）。
 *
 * 重点锁两件曾内联在页面里、没有任何测试的映射：
 *  1. 导出：`note → category`、`icon → tags[0]`；
 *  2. 导入：缺 `url` 的条目必须被丢弃（渲染不出来），缺 `createdAt` 必须补确定值。
 */
const NOW = 1_700_000_000_000

const sample: VaultMappableFavorite[] = [
  {
    siteId: 'site-1',
    title: '示例站',
    href: 'https://example.com',
    icon: 'https://example.com/icon.png',
    description: '描述',
    note: '我的备注',
    createdAt: NOW,
  },
  { siteId: 'site-2', title: '无备注站', href: 'https://bare.example.com', createdAt: NOW - 1000 },
]

describe('收藏 → 金库条目', () => {
  it('备注映射到 category，图标映射到 tags[0]', () => {
    const items = favoritesToVaultItems(sample)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'site-1',
      title: '示例站',
      url: 'https://example.com',
      description: '描述',
      category: '我的备注',
      tags: ['https://example.com/icon.png'],
      createdAt: NOW,
    })
  })

  it('没有备注/图标时不留空字段', () => {
    const items = favoritesToVaultItems(sample)
    expect(items[1].category).toBeUndefined()
    expect(items[1].tags).toEqual([])
  })
})

describe('金库条目 → 收藏', () => {
  it('按天生成导出文件名', () => {
    expect(vaultExportFilename(NOW)).toBe('navhub-vault-2023-11-14.navhub.vault')
  })

  it('category 还原为 note，tags[0] 还原为 icon', () => {
    const restored = vaultItemsToFavorites(favoritesToVaultItems(sample), NOW)
    expect(restored[0]).toMatchObject({
      siteId: 'site-1',
      title: '示例站',
      href: 'https://example.com',
      note: '我的备注',
      icon: 'https://example.com/icon.png',
      createdAt: NOW,
    })
    // 导出再导入必须是恒等变换（除了 description/缺省字段）
    expect(restored[1]).toMatchObject({ siteId: 'site-2', href: 'https://bare.example.com' })
  })

  it('缺 url 的条目被丢弃：渲染不出来，不留残行', () => {
    const broken = [
      { id: 'ok', title: '好条目', url: 'https://ok.example.com' },
      { id: 'bad', title: '没有地址' },
      { id: '', title: '没有 id', url: 'https://x.example.com' },
      { title: '什么都没有' },
    ] as Parameters<typeof vaultItemsToFavorites>[0]
    const restored = vaultItemsToFavorites(broken, NOW)
    expect(restored).toHaveLength(1)
    expect(restored[0].siteId).toBe('ok')
  })

  it('缺 createdAt 时补传入的 now，保证排序稳定', () => {
    const restored = vaultItemsToFavorites([{ id: 'a', title: 'A', url: 'https://a.example.com' }], NOW)
    expect(restored[0].createdAt).toBe(NOW)
  })

  it('title 缺省时退回 siteId，不渲染空白卡片', () => {
    const restored = vaultItemsToFavorites([{ id: 'fallback', url: 'https://f.example.com' }], NOW)
    expect(restored[0].title).toBe('fallback')
  })
})
