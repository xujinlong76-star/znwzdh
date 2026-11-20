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

  it('/me 概览使用紧凑氛围页头 + 顶部快捷主题切换，且全部功能入口优先于成长面板展示', () => {
    const view = read('src/app/me/me-view.tsx')
    expect(view).toContain('<CenterPageHeader\n        compact')
    expect(view).toContain('<ThemeQuickToggle />')

    const anonBlock = view.slice(view.indexOf("state === 'anonymous'"), view.indexOf("state === 'error'"))
    expect(anonBlock.indexOf('<EntryGroups')).toBeGreaterThan(-1)
    expect(anonBlock.indexOf('<GrowthPanelLazy />')).toBeGreaterThan(anonBlock.indexOf('<EntryGroups'))

    const readyBlock = view.slice(view.indexOf("state === 'ready'"))
    expect(readyBlock.indexOf('<EntryGroups')).toBeGreaterThan(-1)
    expect(readyBlock.indexOf('<GrowthPanelLazy />')).toBeGreaterThan(readyBlock.indexOf('<EntryGroups'))
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

  it('成长中心采用 4 标签页收纳、3 列 33 徽章零孤儿卡、筛选置顶与紧致 w-fit 16 周热力图', () => {
    const panel = read('src/components/user-center/growth-panel.tsx')
    expect(panel).toContain('role="tablist"')
    expect(panel).toContain("activeTab === 'tasks'")
    expect(panel).toContain("activeTab === 'season'")
    expect(panel).toContain("activeTab === 'badges'")
    expect(panel).toContain("activeTab === 'guide'")
    expect(panel).toContain('grid-cols-2 gap-2.5 sm:grid-cols-3')
    expect(panel).toContain('筛选徽章状态')

    const heatmap = read('src/components/growth/growth-heatmap.tsx')
    expect(heatmap).toContain('grid w-fit grid-flow-col grid-rows-7 gap-1')
  })
})
