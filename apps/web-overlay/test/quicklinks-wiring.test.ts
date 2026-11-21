/**
 * Quicklinks 接线守卫：三处缺一不可（首页内联搜索 / 全局 ⌘K / search-bar）。
 *
 * 仓库的 vitest 是 node 环境、没有 jsdom / @testing-library，组件挂载测不了；
 * 这里按仓库既有做法（diy-import-honesty / favorites-sync 的源码守卫）锁
 * 「接线确实存在且顺序正确」，纯函数行为由 quicklinks.test.ts 覆盖。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

describe('Quicklinks 接线：三处缺一不可', () => {
  it('search-palette：回车时 quicklink 检查排在 parseOmniCommand 之前', () => {
    const src = overlaySource('src/components/search-palette.tsx')
    const quicklinkAt = src.indexOf("if (quicklinkMatch.kind === 'hit') {")
    const omniAt = src.indexOf('const omni = parseOmniCommand(query)', quicklinkAt)
    expect(quicklinkAt).toBeGreaterThan(-1)
    expect(omniAt).toBeGreaterThan(quicklinkAt)
    expect(src).toContain('quicklinkIds: matchedPaletteQuicklinks.map((q) => q.key)')
    expect(src).toContain('data-nav-item="quicklink"')
    expect(src).toContain('!{quicklinkMatch.entry.quickPrefix}')
  })

  it('search-palette：命令命中时同一 siteId 不进收藏分组（去重）', () => {
    const src = overlaySource('src/components/search-palette.tsx')
    expect(src).toContain("...(quicklinkMatch.kind === 'hit' ? [quicklinkMatch.entry.siteId] : [])")
  })

  it('search-palette 空面板：quicklink 收藏行尾有前缀 chip + 直达 hint', () => {
    const src = overlaySource('src/components/search-palette.tsx')
    expect(src).toContain('quicklinkBySiteId.get(fav.siteId)')
    expect(src).toContain('直达搜索')
  })

  it('spotlight-modal：quicklink 行占导航位 0，站点/视频/插件整体后移', () => {
    const src = overlaySource('src/components/search/spotlight-modal.tsx')
    expect(src).toContain("const quicklinkOffset = quicklinkActive && quicklinkMatch.kind === 'hit' && quicklinkMatch.url ? 1 : 0")
    // 2026-11-20 搜索修复：导航计数口径改为展示列表 displayHits（重排后，
    // 失效站点已剔除、弱语义填充不再占位）；quicklink 仍占导航位 0，其余整体后移
    expect(src).toContain('return quicklinkOffset + displayHits.length + videoHits.length')
    expect(src).toContain('const index = selectedIndex - quicklinkOffset')
    expect(src).toContain('idx + quicklinkOffset === selectedIndex')
    expect(src).toContain('id={optionIdOf(0)}')
    expect(src).toContain("id=\"spotlight-quicklink-listbox\"")
  })

  it('search-bar：matchSearchShortcut 用 quicklink 合并后的引擎列表', () => {
    const src = overlaySource('src/components/search-bar.tsx')
    expect(src).toContain('toSearchEngines(quicklinkEntries, getAllSearchEngines())')
    expect(src).toContain('matchSearchShortcut(searchQuery, mergedEngines)')
    expect(src).toContain('matchQuicklinkCommand(searchQuery, quicklinkEntries)')
  })

  it('search-bar B1：前缀命中但代入失败时不回落到合并引擎，回车 toast、不走正常搜索', () => {
    const src = overlaySource('src/components/search-bar.tsx')
    // displayShortcut 只在 quicklinkMatch 的 kind 不是 hit 时才回落到 matchedShortcut：
    // '!gh' + 501 字符时 kind 为 hit、url 为 null → displayShortcut 为 null，
    // matchSearchShortcut 对同一模板的无上限代入再也够不着回车 / 横幅。
    expect(src).toContain("quicklinkMatch.kind === 'hit'\n      ? quicklinkBanner")
    expect(src).not.toContain('quicklinkBanner ??')
    expect(src).toContain("const quicklinkBlocked = quicklinkMatch.kind === 'hit' && quicklinkMatch.url == null")
    // 拦截态：回车先判 quicklinkBlocked，toast 后 return，且排在 displayShortcut 分支之前
    //（裸 `gh` + 501 字符时 displayShortcut 本就是 null，没有这一支回车会静默落回正常搜索）
    const blockedAt = src.indexOf("if (e.key === 'Enter' && quicklinkBlocked)")
    const directAt = src.indexOf("if (e.key === 'Enter' && displayShortcut?.directUrl)")
    expect(blockedAt).toBeGreaterThan(-1)
    expect(directAt).toBeGreaterThan(blockedAt)
    expect(src).toContain("title: '快捷链接打不开'")
    expect(src).toContain("description: '参数超过 500 字符或模板不安全，已拦截。'")
    expect(src).toContain("variant: 'destructive'")
    // 横幅点击同样先判拦截态（拦截态下横幅本就不渲染，这里是纵深防御）
    expect(src).toContain('if (quicklinkBlocked) {')
    // toast 与 search-palette 同体系（useToast），不用 sonner 另起一套
    expect(src).toContain("import { useToast } from '@/components/ui/use-toast'")
  })

  it('favorites 页：模板录入走 validateQuicklink + updateMeta，JSON 保真文案在场', () => {
    const src = overlaySource('src/app/favorites/page.tsx')
    expect(src).toContain('validateQuicklink({ prefix: quickPrefixDraft, templateUrl: quickTemplateDraft })')
    expect(src).toContain(
      'favorites.updateMeta(siteId, { quickPrefix: checked.prefix, templateUrl: checked.templateUrl })',
    )
    expect(src).toContain('JSON 是唯一保真格式')
    expect(src).toContain('!{ql.quickPrefix}')
  })

  it('favorites 页：孤 templateUrl（无 quickPrefix）也能清除', () => {
    const src = overlaySource('src/app/favorites/page.tsx')
    // 清除按钮只在有前缀时渲染，孤 templateUrl 会清不掉；条件必须同时看两个字段
    expect(src).toContain('(f.quickPrefix || f.templateUrl) && (')
  })

  it('三处打开都记账：recordOfflineVisit + reportClick（带参数）+ recordOpened', () => {
    const cases: Array<[string, string]> = [
      ['src/components/search-palette.tsx', 'reportClick(item.entry.siteId, identity, { query: item.arg })'],
      [
        'src/components/search/spotlight-modal.tsx',
        'reportClick(entry.siteId, identity, { query: quicklinkMatch.arg })',
      ],
      [
        'src/components/search-bar.tsx',
        'reportClick(quicklinkBanner.entry.siteId, identity, { query: quicklinkBanner.arg })',
      ],
    ]
    for (const [rel, clickLine] of cases) {
      const src = overlaySource(rel)
      expect(src).toContain('recordOfflineVisit({')
      expect(src).toContain(clickLine)
      expect(src).toContain('favorites.recordOpened(')
    }
  })
})
