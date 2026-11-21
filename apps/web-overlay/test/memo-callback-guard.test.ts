/**
 * P0-2 回归守卫：`memo` 防线不被内联回调击穿。
 *
 * 背景：NavigationCard 与 NavigationCategorySection 是 memo，但三处内联回调
 * （section 的 onMoveCard、use-site-selection 的四个函数、navigation-content
 * 传给工具栏的 8 个 onX）每轮新建函数身份，浅比较恒失败，memo 等于不存在。
 * 一次折叠/筛选会重渲染全部已挂载卡片。本文件把修复后的契约钉住：
 * 回调必须经 useCallback / memo 化（或放进 useMemo 的组对象），且三个
 * 组件必须包 memo；若有人改回内联写法，本测试即失败。
 *
 * 注意：这是源码级守卫（仓库 vitest 是 node 环境、无 jsdom，做不了
 * React Profiler 实测；Profiler 验收须在浏览器里复核：折叠一个分类 /
 * 切换一个 Tab 后，仅该分类子树渲染，其余已挂载卡片 0 次重渲染）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** overlay 与 apps/web 两份布局下都指向包根（与 drag-system-guard 同款） */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

function read(rel: string): string {
  return readFileSync(resolve(ROOT, 'src', rel), 'utf-8')
}

describe('P0-2 memo 回调守卫', () => {
  it('use-site-selection：四个回调均为 useCallback（非普通函数）', () => {
    const src = read('lib/modular/use-site-selection.ts')
    for (const name of ['clearSelection', 'toggleSelectMode', 'toggleSelectOne', 'selectAllVisible']) {
      expect(src).toContain(`const ${name} = useCallback(`)
    }
    // 不得残留普通函数定义
    expect(src).not.toMatch(/const (clearSelection|toggleSelectMode|toggleSelectOne|selectAllVisible) = \(/)
  })

  it('navigation-category-section：卡片不再收内联 onMoveCard 闭包', () => {
    const src = read('components/navigation-category-section.tsx')
    expect(src).not.toContain('onMoveCard={(direction)')
    expect(src).toContain('handleMoveCardDirect')
    // 子组回调放进 subGroups memo（身份只随组数据变）
    expect(src).toContain('onMoveCard: (cardId: string, direction: CardMoveDirection)')
    // 子组不再在调用点写内联 onTogglePin / onPeek
    expect(src).not.toContain('onTogglePin: (siteId) => togglePinSiteInCategory(subCategory.id, siteId)')
    expect(src).not.toContain('onPeek: (peekItem) => setPeekItem(peekItem, subCategory.id)')
  })

  it('navigation-card：onMoveCard 带 cardId（调用方传稳定回调）', () => {
    const src = read('components/navigation-card.tsx')
    expect(src).toContain('onMoveCard?: (cardId: string, direction: CardMoveDirection) => void')
    expect(src).toContain('onMoveCard?.(item.id, direction)')
  })

  it('navigation-content：工具栏 7 回调 + Sidebar onClose 均为稳定引用', () => {
    const src = read('components/navigation-content.tsx')
    for (const name of [
      'handleToggleSidebar',
      'handleOpenTools',
      'handleOpenShortcuts',
      'handleOpenTodayCenter',
      'handleOpenWidgetBox',
      'handleOpenAppearanceGuide',
      'handleOpenAiFinder',
      'handleCloseSidebar',
    ]) {
      expect(src).toContain(`const ${name} = useCallback(`)
    }
    expect(src).not.toContain('onToggleSidebar={() =>')
    expect(src).not.toContain('onOpenTools={() =>')
    expect(src).not.toContain('onOpenShortcuts={() =>')
    expect(src).not.toContain('onOpenTodayCenter={() =>')
    expect(src).not.toContain('onOpenWidgetBox={() =>')
    expect(src).not.toContain('onOpenAiFinder={() =>')
    expect(src).not.toContain('onClose={() => setIsSidebarOpen(false)}')
    // Sidebar 的 navigationData 对象须 memo 化，不得每轮新建字面量
    expect(src).toContain('sidebarNavigationData')
    expect(src).not.toContain('navigationData={{ navigationItems: sortedCategories')
  })

  it('工具栏 / 侧边栏 / 速拨坞均包 memo', () => {
    expect(read('components/navigation-toolbar.tsx')).toContain(
      'export const NavigationToolbar = memo(function NavigationToolbar({'
    )
    expect(read('components/sidebar.tsx')).toContain(
      'export const Sidebar = memo(function Sidebar('
    )
    expect(read('components/home-quick-dock.tsx')).toContain(
      'export const HomeQuickDock = memo(function HomeQuickDock({'
    )
  })
})
