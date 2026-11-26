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
 *  1. 导出（v2，U-413）：`note → category`、`icon → icon`、`tags → tags`、
 *     `folderName → folderName`，逐条写 `formatVersion: 2`；
 *  2. 导入：缺 `url` 的条目必须被丢弃（渲染不出来），缺 `createdAt` 必须补确定值；
 *     v1 旧文件（无 formatVersion）仍按旧口径读：`tags[0]` 是图标、没有文件夹与真实标签。
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
  it('备注映射到 category，图标进 icon 字段、真实标签进 tags（U-413 v2，不再借用 tags[0]）', () => {
    const items = favoritesToVaultItems(sample)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'site-1',
      title: '示例站',
      url: 'https://example.com',
      description: '描述',
      category: '我的备注',
      icon: 'https://example.com/icon.png',
      tags: [],
      formatVersion: 2,
      createdAt: NOW,
    })
    // 图标不再出现在 tags 里：v1 的「tags[0] 是图标」是标签全丢的根因
    expect(items[0]!.tags).not.toContain('https://example.com/icon.png')
  })

  it('没有备注/图标时不留空字段', () => {
    const items = favoritesToVaultItems(sample)
    expect(items[1].category).toBeUndefined()
    expect(items[1].tags).toEqual([])
  })

  it('快捷链接两字段随金库走：导出带上，解密还原回来', () => {
    const withQuicklink: VaultMappableFavorite[] = [
      {
        siteId: 'gh',
        title: 'GitHub',
        href: 'https://github.com',
        quickPrefix: 'gh',
        templateUrl: 'https://github.com/search?q={q}',
        createdAt: NOW,
      },
    ]
    const exported = favoritesToVaultItems(withQuicklink)
    expect(exported[0]).toMatchObject({
      quickPrefix: 'gh',
      templateUrl: 'https://github.com/search?q={q}',
    })
    const restored = vaultItemsToFavorites(exported, NOW)
    expect(restored[0]).toMatchObject({
      siteId: 'gh',
      quickPrefix: 'gh',
      templateUrl: 'https://github.com/search?q={q}',
    })
  })

  it('没有快捷链接时两字段保持 undefined，不凭空造模板', () => {
    const exported = favoritesToVaultItems(sample)
    expect(exported[0]!.quickPrefix).toBeUndefined()
    expect(exported[0]!.templateUrl).toBeUndefined()
    expect(vaultItemsToFavorites(exported, NOW)[0]!.quickPrefix).toBeUndefined()
  })
})

describe('金库条目 → 收藏', () => {
  it('按天生成导出文件名', () => {
    expect(vaultExportFilename(NOW)).toBe('navhub-vault-2023-11-14.navhub.vault')
  })

  it('category 还原为 note，icon 字段还原为 icon（v2 往返恒等）', () => {
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

  it('B-1：恢复一份本地已有的金库不再报 error——全是已存在时说“均已存在，无需恢复”', () => {
    // imported=0、updated=0、alreadyExisted=3：一条都没新并入，但本就无需恢复
    const notice = formatVaultRestoreNotice({ decryptedCount: 3, convertibleCount: 3, restoredCount: 0, alreadyExisted: 3 })
    expect(notice.tone).toBe('info')
    expect(notice.tone).not.toBe('error')
    expect(notice.text).toContain('3 条均已存在')
    expect(notice.text).toContain('无需恢复')
    expect(notice.text).not.toContain('没有可恢复的收藏')
    expect(notice.text).not.toContain('格式不完整')
  })

  it('B-1：更新已存条目也算已恢复——restoredCount 含 updated，已存在单独点名', () => {
    // 3 条可转换：2 条更新并入（restoredCount=2，已是 imported+updated），1 条已存在
    const notice = formatVaultRestoreNotice({ decryptedCount: 3, convertibleCount: 3, restoredCount: 2, alreadyExisted: 1 })
    expect(notice.tone).toBe('info')
    expect(notice.text).toContain('已恢复 2 条私密收藏')
    expect(notice.text).toContain('1 条已存在')
    expect(notice.text).toContain('无需恢复')
    expect(notice.text).not.toContain('格式不完整')
  })

  it('B-1：已存在与真失败分开点名——已存在不算“格式不完整”', () => {
    // 5 条可转换：2 条并入，2 条已存在，1 条真格式不完整
    const notice = formatVaultRestoreNotice({ decryptedCount: 5, convertibleCount: 5, restoredCount: 2, alreadyExisted: 2 })
    expect(notice.tone).toBe('info')
    expect(notice.text).toContain('已恢复 2 条私密收藏')
    expect(notice.text).toContain('2 条已存在')
    expect(notice.text).toContain('1 条格式不完整')
  })
})

describe('U-413 金库 v2：文件夹与真实标签往返', () => {
  const v2Sample: VaultMappableFavorite[] = [
    {
      siteId: 'site-1',
      title: '示例站',
      href: 'https://example.com',
      icon: 'https://example.com/icon.png',
      description: '描述',
      note: '我的备注',
      tags: ['工作', '常用'],
      folderName: '工作夹',
      createdAt: NOW,
    },
  ]

  it('v2 导出：文件夹进 folderName，真实标签进 tags，图标进 icon（不再借用 tags[0]）', () => {
    const items = favoritesToVaultItems(v2Sample)
    expect(items[0]).toMatchObject({
      folderName: '工作夹',
      tags: ['工作', '常用'],
      icon: 'https://example.com/icon.png',
      category: '我的备注',
    })
  })

  it('v2 导出再导入：文件夹、标签、图标、备注全部回来', () => {
    const restored = vaultItemsToFavorites(favoritesToVaultItems(v2Sample), NOW)
    expect(restored[0]).toMatchObject({
      siteId: 'site-1',
      folderName: '工作夹',
      tags: ['工作', '常用'],
      icon: 'https://example.com/icon.png',
      note: '我的备注',
    })
  })

  it('v1 旧文件仍能导入：tags[0] 仍当图标、category 仍当备注，无文件夹、无真实标签', () => {
    const v1 = [{ id: 'old', title: '旧站', url: 'https://old.example.com', category: '旧备注', tags: ['https://old.example.com/icon.png'], createdAt: NOW }]
    const restored = vaultItemsToFavorites(v1, NOW)
    expect(restored[0]).toMatchObject({
      siteId: 'old',
      note: '旧备注',
      icon: 'https://old.example.com/icon.png',
    })
    expect(restored[0]!.folderName).toBeUndefined()
    expect(restored[0]!.tags).toBeUndefined()
  })
})

describe('源码守卫：金库还原与导入不许再报「假完整」', () => {
  it('页面报 importResult.imported，不再拿解密条数当成功条数', () => {
    const src = overlaySource('src/app/favorites/page.tsx')
    expect(src).toContain('formatVaultRestoreNotice({')
    // B-1：实际并入 = 新增 + 更新（与 local-data-manager 同口径），已存在单独传参
    expect(src).toContain('restoredCount: importResult.imported + importResult.updated')
    expect(src).toContain('alreadyExisted: importResult.alreadyExisted')
    expect(src).not.toContain('已恢复 ${decryptedItems.length} 条')
  })

  it('importJson 申报被过滤的残行，普通导入也照实展示', () => {
    const hook = overlaySource('src/hooks/useFavorites.ts')
    expect(hook).toContain('const skippedInvalid = incoming.length - accepted.length')
    // 第 2 批第 11 项：imported 必须是实际新增数，不许再拿 valid.length 冒充
    expect(hook).toContain('return { ok: true, imported, updated, alreadyExisted, addedSiteIds, skippedInvalid: skippedInvalid + extraSkippedInvalid }')
    expect(hook).not.toContain('imported: valid.length')
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
