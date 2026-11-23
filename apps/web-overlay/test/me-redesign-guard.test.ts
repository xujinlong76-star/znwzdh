import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay') && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录')
  return hit
}
const read = (rel: string) => readFileSync(join(overlayRoot(), rel), 'utf8')

describe('用户中心（/me）重新设计守卫', () => {
  it('顶部导航采用高不透明吸顶防透字，且移动端滚动蒙版收口在内层防止按钮被铃铛分割线裁切', () => {
    const layout = read('src/app/me/layout.tsx')
    expect(layout).toContain('bg-background/95 backdrop-blur-md')
    expect(layout).toContain('border-b border-border/50')

    const nav = read('src/components/user-center/user-center-nav.tsx')
    expect(nav).toContain('bg-card/95')
    expect(nav).toContain('pr-4 sm:gap-1 sm:pr-0')
  })

  it('/me 概览使用紧凑氛围页头 + 顶部快捷主题切换，且全部功能入口优先于成长速览横幅展示', () => {
    const view = read('src/app/me/me-view.tsx')
    expect(view).toContain('<CenterPageHeader\n        compact')
    expect(view).toContain('<ThemeQuickToggle />')

    // 2026-11-21 结构重构：成长系统迁至 /me/growth 独立 Tab，概览底部不再堆砌
    // 成长面板，改为一张「今日成长速览」横幅卡（GrowthBanner）。入口组仍在横幅之前。
    const anonBlock = view.slice(view.indexOf("state === 'anonymous'"), view.indexOf("state === 'error'"))
    expect(anonBlock.indexOf('<EntryGroups')).toBeGreaterThan(-1)
    expect(anonBlock).not.toContain('<GrowthPanelLazy />')
    expect(anonBlock.indexOf('<GrowthBanner')).toBeGreaterThan(anonBlock.indexOf('<EntryGroups'))

    const readyBlock = view.slice(view.indexOf("state === 'ready'"))
    expect(readyBlock.indexOf('<EntryGroups')).toBeGreaterThan(-1)
    expect(readyBlock).not.toContain('<GrowthPanelLazy />')
    expect(readyBlock.indexOf('<GrowthBanner')).toBeGreaterThan(readyBlock.indexOf('<EntryGroups'))
  })

  it('匿名身份卡采用实线 Bento 样式并融合本机资产速览，不重复打印两遍匿名 ID', () => {
    const card = read('src/components/user-center/dashboard/account-card.tsx')
    expect(card).not.toContain('border-dashed')
    expect(card).toContain('WATCHLIST_STORAGE_KEY')
    expect(card).toContain('本机收藏')
    expect(card).toContain('追剧清单')
    expect(card).toContain('离线占用')
  })

  it('全部入口采用 2×2 平衡象限卡片组，消除 4-3-3-3 尾部留白', () => {
    const entries = read('src/components/user-center/dashboard/entry-groups.tsx')
    expect(entries).toContain('grid gap-3 md:grid-cols-2')
  })

  it('成长中心采用独立 4 标签分段控制器、3 列 33 徽章零孤儿卡、筛选置顶与自适应 4/16 周热力图', () => {
    const panel = read('src/components/user-center/growth-panel.tsx')
    expect(panel).toContain('role="tablist"')
    expect(panel).toContain('data-growth-segmented-control="true"')
    expect(panel).toContain('data-next-milestone-card="true"')
    expect(panel).toContain("activeTab === 'tasks'")
    expect(panel).toContain("activeTab === 'season'")
    expect(panel).toContain("activeTab === 'badges'")
    expect(panel).toContain("activeTab === 'guide'")
    expect(panel).toContain('grid-cols-2 gap-2.5 sm:grid-cols-3')
    expect(panel).toContain('筛选徽章状态')

    const heatmap = read('src/components/growth/growth-heatmap.tsx')
    // 2026-11-21 移动端横滚：16 周格子需保可点尺寸，窄屏不再 w-full 压缩
    expect(heatmap).toContain('grid-flow-col grid-rows-7 gap-1')
    expect(heatmap).toContain('max-sm:min-w-[340px]')
    expect(heatmap).toContain('近 4 周活跃日历')
    expect(heatmap).toContain('展开近 16 周')
  })

  it('U-372：/me 成长横幅 Lv/XP 旁挂「本机」角标，成长只存本机不冒充云端同步', () => {
    const view = read('src/app/me/me-view.tsx')
    const banner = view.slice(view.indexOf('function GrowthBanner()'))
    // 角标紧贴 Lv/XP 文案之后，同一行内
    const lvAt = banner.indexOf('Lv.{lp.level}')
    expect(lvAt).toBeGreaterThan(-1)
    const badgeAt = banner.indexOf('本机', lvAt)
    expect(badgeAt).toBeGreaterThan(lvAt)
    // 角标在 Lv/XP 文案与「连续 N 天」之间，同一行内
    expect(banner.slice(lvAt, badgeAt)).not.toContain('连续')
    expect(banner).toContain('成长档案只保存在这台设备的浏览器里')
    // 成长页深处的披露与横幅同一口径
    const panel = read('src/components/user-center/growth-panel.tsx')
    expect(panel).toContain('成长档案只存在这台设备的浏览器里，不回传服务器')
  })
})
