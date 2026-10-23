import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 第二批用户中心的静态守卫：页面存在、可访问性地标、关键接口接线。
 * 这里刻意检查源码字符串而不是渲染：路由依赖 NextAuth 会话与中枢，
 * 渲染测试需要整套运行时；这些断言保证的是「功能没有被后续改动删掉」。
 *
 * P1-1 分层：本文件只做**存在性与接线**守卫（文件/路由/API 路径/导航入口）。
 * 页面渲染出来的状态与文案交给 `e2e/user-center.spec.ts`，不在源码里重复断言
 * 同一句文案，也不把实现写成哪一行（如 STAT_ITEMS 的精确字面量）。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录')
  return hit
}
const ROOT = overlayRoot()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('用户中心第二批页面', () => {
  it('统一子导航覆盖全部管理分区并挂在相关页面', () => {
    const nav = read('src/components/user-center/user-center-nav.tsx')
    for (const href of ["'/me'", "'/me/account'", "'/favorites'", "'/me/history'", "'/me/plugins'", "'/preferences'", "'/me/settings'", "'/me/data'"]) {
      expect(nav).toContain(href)
    }
    expect(nav).toContain('aria-current')
    expect(read('src/app/me/layout.tsx')).toContain('<UserCenterNav />')
    expect(read('src/app/favorites/page.tsx')).toContain('<UserCenterNav />')
    expect(read('src/app/preferences/page.tsx')).toContain('<UserCenterNav />')
  })

  it('BFF 同时覆盖 /api/me 本身与子路径（可选 catch-all）', () => {
    const rel = 'src/app/api/me/[[...path]]/route.ts'
    expect(existsSync(join(ROOT, rel)), 'BFF 必须是可选 catch-all，否则 GET /api/me 会 404').toBe(true)
    const src = read(rel)
    expect(src).toContain("path[0] === 'sync'")
    expect(src).toContain('const suffix = path.length > 0')
    expect(src).toContain("HUB_BASE + '/api/me' + suffix")
  })

  it('搜索历史页有地标、分页与删除接线', () => {
    const src = read('src/app/me/history/page.tsx')
    expect(src).toContain('id="main-content"')
    expect(src).toContain('fetchSearchHistoryPage')
    expect(src).toContain('deleteSearchHistoryItem')
    expect(src).toContain('clearCloudSearchHistory')
    expect(src).toContain('加载更多')
  })

  it('数据页有导出与二次确认删除', () => {
    const src = read('src/app/me/data/page.tsx')
    expect(src).toContain('id="main-content"')
    expect(src).toContain("'/api/me/export'")
    expect(src).toContain("confirm: 'DELETE'")
    expect(src).toContain("fetch('/api/me'")
    // 删除动作必须受输入框解锁，不能一个按钮直接删
    expect(src).toContain("confirmText.trim().toUpperCase() !== 'DELETE'")
  })

  it('用户中心子页保持 noindex', () => {
    const layout = read('src/app/me/layout.tsx')
    expect(layout).toContain('robots: { index: false')
  })

  it('概览页接个性化开关与信号清理，设置/资料/自检分别落在独立页面', () => {
    // 本批把 /me 拆成「仪表盘 + /me/settings + /me/account」：
    // 断言原意不变，只是按职责去对应文件里找接线。
    const overview = ['src/app/me/page.tsx', 'src/app/me/me-view.tsx'].map(read).join('\n')
    const dashboard = read('src/components/user-center/dashboard/stats-grid.tsx')
    const account = read('src/app/me/account/account-view.tsx')
    const settingsHook = read('src/hooks/use-me-settings.ts')

    expect(overview).toContain('/api/me/settings')
    expect(overview).toContain('verifySettingsConsistency')
    expect(overview).toContain('clearProfileSignals')
    expect(account).toContain('/api/me/profile')
    expect(account).toContain('/api/me/diagnostics')
    expect(account).toContain('runClientStorageDiagnostics')
    expect(settingsHook).toContain('/api/me/settings')
    expect(settingsHook).toContain('verifySettingsConsistency')
    expect(dashboard).toContain("'/me/history'")
    expect(dashboard).toContain("'/me/data'")
    expect(dashboard).not.toContain("href: '/favorites'\\n                      <Search")
  })

  it('偏好页接入身份变更监听且搜索历史入口指向 /me/history', () => {
    const src = read('src/app/preferences/page.tsx')
    expect(src).toContain('href="/me/history"')
    expect(src).not.toContain('href="/favorites">\n                      <Search')
    expect(src).toContain('navhub_identity_merged')
  })

  it('收藏页接入文件夹和备注管理', () => {
    const src = read('src/app/favorites/page.tsx')
    expect(src).toContain('createFavoriteFolder')
    expect(src).toContain('updateFavoriteFolder')
    expect(src).toContain('updateFavoriteMeta')
    expect(src).toContain('收藏夹')
    expect(src).toContain('未分组')
  })
})

describe('金库版本前置条件（客户端）', () => {
  it('saveCloudVault 支持 expectedVersion 并识别 409', () => {
    const src = read('src/lib/navhub-api.ts')
    expect(src).toContain('expectedVersion?: number')
    expect(src).toContain('res.status === 409')
    expect(src).toContain('conflict: true')
  })

  it('首页 DIY 同步会先取云端版本并在冲突时提示', () => {
    const io = read('src/lib/modular/home-diy-io.ts')
    expect(io).toContain('expectedVersion')
    expect(io).toContain('云端金库已被其它设备更新')
    const dialog = read('src/components/home-diy-backup-dialog.tsx')
    expect(dialog).toContain('checkCloudVaultStatus()')
    expect(dialog).toContain('res.conflict')
  })
})
