import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 本地收藏夹接线守卫（P2：匿名用户也能分组）。
 *
 * 真实缺陷（改动前）：收藏夹只有云端一份，`/favorites` 的文件夹面板在
 * `cloudIdentity` 为空时整块不渲染——匿名用户能收藏、能导出，却不能分组，
 * 而页面一直说着"无需登录"。能力与承诺不对等。
 *
 * 这里锁四件结构性事实：
 *  1. 本地收藏夹用**独立的新键**（既有 `navhub.favorites.v1` 结构不可改）；
 *  2. 渲染层只认 `visibleFolders`（登录=云端 / 匿名=本地同一套 UI）；
 *  3. 建/改/删三条路径都有本地分支；
 *  4. 登录同步成功后会把本地夹子按名称合并上云，且重映射走 updateMeta（不清脏标记）。
 */
const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

/** T14 起夹管理逻辑在 hook：页面 + hook 联合文本 */
function favoritesPageWithManager(): string {
  return overlaySource('src/app/favorites/page.tsx') + ' ' + overlaySource('src/hooks/use-favorites-folder-manager.ts')
}

describe('本地收藏夹（P2）', () => {
  it('纯函数模块存在且被测试覆盖', () => {
    expect(existsSync(resolve(HERE, '..', 'src/lib/favorites-folders.ts')) ||
      existsSync(resolve(HERE, '..', '..', 'web-overlay/src/lib/favorites-folders.ts'))).toBe(true)
  })

  it('使用独立的新存储键，不动既有收藏键', () => {
    const page = overlaySource('src/app/favorites/page.tsx')
    expect(page).toContain("navhub.favorites.folders.v1")
    // 既有键一律不得改写（改了等于丢老用户收藏）
    expect(page).not.toContain("navhub.favorites.v1'")
    expect(page).toContain('readLocalFolders')
    expect(page).toContain('writeLocalFolders')
  })

  it('渲染层只认 visibleFolders：登录云端 / 匿名本地同一套 UI', () => {
    const page = overlaySource('src/app/favorites/page.tsx')
    expect(page).toMatch(/const visibleFolders = useMemo/)
    expect(page).toMatch(/cloudIdentity \? folders : localFolders/)
    // 两处渲染（收藏夹胶囊 + 卡片下拉）都必须走 visibleFolders
    expect(page.match(/visibleFolders\.map\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(page).not.toMatch(/\{folders\.map\(/)
  })

  it('建 / 改 / 删三条路径都有本地分支', () => {
    const page = favoritesPageWithManager()
    expect(page).toMatch(/addLocalFolder\(localFolders/)
    expect(page).toMatch(/renameLocalFolder\(prev, folderId, name\)/)
    expect(page).toMatch(/removeLocalFolder\(prev, folderId\)/)
  })

  it('登录同步成功后把本地夹子按名称合并上云', () => {
    const page = favoritesPageWithManager()
    expect(page).toContain('planFolderUpload')
    expect(page).toContain('migrateLocalFolders')
    // 必须在同步成功且拿到云端夹子之后才迁移
    expect(page).toMatch(/result\.ok && result\.cloudFolders && result\.nextItems/)
    // 重映射走 updateMeta（逐条置脏）；用 replaceAll 会清掉待推送的收藏变更
    expect(page).toMatch(/favorites\.updateMeta\(item\.siteId, \{ folderId: mapped \}\)/)
  })

  it('匿名态不再谎称"需要登录才能建收藏夹"', () => {
    const page = overlaySource('src/app/favorites/page.tsx')
    // 旧文案（能力与承诺不对等）必须消失；新文案的渲染结果由
    // e2e/user-center.spec.ts 的本地收藏夹用例断言，源码里不重复锁字面量。
    expect(page).not.toContain('登录后可创建收藏夹、写备注')
    expect(page).toContain('本地收藏夹仅存本机')
  })
})
