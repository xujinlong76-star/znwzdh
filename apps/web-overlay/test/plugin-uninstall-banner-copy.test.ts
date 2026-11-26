/**
 * U-407：已安装页卸载成功横幅必须按实际清理结果说话。
 *
 * 以前不管什么类型都写「关联站点与分类已同步清理」：主题 / 搜索包 /
 * 工作台预设 / 组合包根本不清理站点与分类，横幅却照报清理。
 * 与安装弹窗的卸载文案（plugin-install-modal.tsx）同口径，按
 * uninstallPlugin 回执的 sitesRemoved / categoriesRemoved 组合：
 * - sites > 0 → 已清理关联站点（N 个站点已移至回收站）[，并同步删除 M 个网址分类]
 * - 仅 categories > 0 → 未移除站点，已同步删除 M 个网址分类
 * - 网址包但无可清 → 没有需要移除的关联站点
 * - 非网址包（removeSites=false、无清理）→ 只写「已成功卸载插件「X」」，不写清理句
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')

describe('U-407 已安装页卸载横幅：按回执分类型写清理结果', () => {
  const page = read('app/marketplace/installed/page.tsx')

  it('不再无条件写「关联站点与分类已同步清理」', () => {
    expect(page).not.toContain('关联站点与分类已同步清理')
  })

  it('卸载链路取回执并按 sitesRemoved / categoriesRemoved 组合文案', () => {
    expect(page).toContain('const res = await uninstallPlugin(item.slug, undefined, removeSites)')
    expect(page).toContain('res.sitesRemoved')
    expect(page).toContain('res.categoriesRemoved')
    // 与安装弹窗同口径的清理句式
    expect(page).toContain('已清理关联站点（${removedSites} 个站点已移至回收站）')
    expect(page).toContain('并同步删除 ${removedCategories} 个网址分类')
    expect(page).toContain('未移除站点，已同步删除 ${removedCategories} 个网址分类')
    expect(page).toContain('没有需要移除的关联站点')
  })

  it('无清理时横幅只有「已成功卸载插件「X」」，不带清理句', () => {
    // cleanup 为空时不拼接「，+ 清理句」：空分支必须存在且只剩裸成功句
    expect(page).toContain('`已成功卸载插件「${item.name}」`')
    const banner = page.slice(page.indexOf('const cleanup ='))
    expect(banner).toContain('cleanup ? `已成功卸载插件「${item.name}」，${cleanup}`')
  })

  it('安装弹窗侧的卸载文案口径未变（回执字段仍是同一对）', () => {
    const modal = read('components/plugins/plugin-install-modal.tsx')
    expect(modal).toContain('res.sitesRemoved')
    expect(modal).toContain('res.categoriesRemoved')
    expect(modal).toContain('已清理关联站点（${removedSites} 个站点已移至回收站）')
  })
})
