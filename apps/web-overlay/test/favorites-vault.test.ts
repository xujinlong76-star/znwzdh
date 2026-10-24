import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  favoritesToVaultItems,
  formatVaultRestoreNotice,
  vaultExportFilename,
  vaultItemsToFavorites,
  type VaultMappableFavorite,
} from '../src/lib/favorites-vault'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

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

describe('金库还原的结案陈词', () => {
  it('全部还原才允许绿色成功，且报实际并入条数', () => {
    const notice = formatVaultRestoreNotice({ decryptedCount: 3, convertibleCount: 3, restoredCount: 3 })
    expect(notice.tone).toBe('success')
    expect(notice.text).toContain('已恢复 3 条私密收藏')
    expect(notice.text).not.toContain('未能恢复')
  })

  it('转换阶段丢条目：点名叫缺站点标识或链接，降级为 info', () => {
    const notice = formatVaultRestoreNotice({ decryptedCount: 4, convertibleCount: 3, restoredCount: 3 })
    expect(notice.tone).toBe('info')
    expect(notice.text).toContain('已恢复 3 条私密收藏')
    expect(notice.text).toContain('1 条缺少站点标识或链接')
  })

  it('合并阶段被过滤的条目单独点名，不混进「缺链接」', () => {
    const notice = formatVaultRestoreNotice({ decryptedCount: 3, convertibleCount: 3, restoredCount: 2 })
    expect(notice.tone).toBe('info')
    expect(notice.text).toContain('1 条格式不完整')
    expect(notice.text).not.toContain('缺少站点标识或链接')
  })

  it('一条都没并入时是 error，不是绿色成功', () => {
    const notice = formatVaultRestoreNotice({ decryptedCount: 2, convertibleCount: 0, restoredCount: 0 })
    expect(notice.tone).toBe('error')
    expect(notice.text).toContain('没有可恢复的收藏')
    expect(notice.text).toContain('2 条缺少站点标识或链接')
  })

  it('空金库如实说「没有收藏条目」，不报 0 条成功', () => {
    const notice = formatVaultRestoreNotice({ decryptedCount: 0, convertibleCount: 0, restoredCount: 0 })
    expect(notice.tone).toBe('info')
    expect(notice.text).toContain('没有收藏条目')
  })
})

describe('源码守卫：金库还原与导入不许再报「假完整」', () => {
  it('页面报 importResult.imported，不再拿解密条数当成功条数', () => {
    const src = overlaySource('src/app/favorites/page.tsx')
    expect(src).toContain('formatVaultRestoreNotice({')
    expect(src).toContain('restoredCount: importResult.imported')
    expect(src).not.toContain('已恢复 ${decryptedItems.length} 条')
  })

  it('importJson 申报被过滤的残行，普通导入也照实展示', () => {
    const hook = overlaySource('src/hooks/useFavorites.ts')
    expect(hook).toContain('const skippedInvalid = incoming.length - accepted.length')
    expect(hook).toContain('return { ok: true, imported: valid.length, skippedInvalid }')
    const src = overlaySource('src/app/favorites/page.tsx')
    expect(src).toContain('result.skippedInvalid > 0')
  })

  it('/me/data 不再把过滤说成「与现有收藏重复」', () => {
    const src = overlaySource('src/app/me/data/page.tsx')
    expect(src).not.toContain('与现有收藏重复，自动跳过')
    // 备份导入走后端合并：缺站点的条数必须单独点名，重复数只能由总数减去缺站点得出
    expect(src).toContain('favoritesSkippedMissingSite')
    expect(src).toContain('favoritesSkipped - importResult.favoritesSkippedMissingSite')
  })
})
