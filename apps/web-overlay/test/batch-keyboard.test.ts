/**
 * 批量键盘（Batch 3 第 11 项）：纯决策函数 + 源码守卫。
 *
 * 锁住的契约（见 lib/batch-keyboard.ts 文件头；11b 起首页 Delete 可用，旧裁决 a 已失效）：
 *   1. 模式外只认裸 M（进入模式），其余一律放行；
 *   2. 模式内 Esc 两段式（有选中先清空，无选中再退出），M 再按一次退出；
 *   3. 模式内 Ctrl+A 全选、Space/Enter 切焦点卡、P/E/Shift+E/F/L 各接已有批量能力；
 *   4. Delete/Backspace：收藏页与首页都批量删除（11b：首页经全局撤销栈，8 秒可撤销）；
 *   5. 守卫按序短路：组字 / 输入态 / 弹窗 / 菜单 / 编排态 / 拖拽手柄聚焦下全部放行；
 *   6. Ctrl+Z / ⌘K / / / Ctrl+J / D/B/T/? / Alt+1/2/3 / Ctrl+E / 数字键永不认领；
 *   7. 接线守卫：hook 只挂首页与收藏页；number-dial 与全局撤销的决策函数、
 *      batch-operations.ts 引擎一律未被改动。
 */
import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  resolveBatchKeyboardAction,
  type BatchKeyboardAction,
  type BatchKeyboardContext,
  type BatchKeyboardEventLike,
  type BatchKeyboardGuards,
} from '@/lib/batch-keyboard'
import {
  executeBatchKeyboardAction,
  type BatchKeyboardCallbacks,
} from '@/hooks/use-batch-keyboard'
import { isAnyDialogOpen, isAnyMenuOpen } from '@/lib/keyboard-guards'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

function guards(overrides: Partial<BatchKeyboardGuards> = {}): BatchKeyboardGuards {
  return {
    composing: false,
    typing: false,
    dialogOpen: false,
    menuOpen: false,
    editingLayout: false,
    dragHandleFocused: false,
    ...overrides,
  }
}

function ctx(
  surface: 'home' | 'favorites',
  overrides: Partial<BatchKeyboardContext> = {},
): BatchKeyboardContext {
  return { surface, inBatchMode: false, ...overrides }
}

function ev(
  key: string,
  overrides: Partial<BatchKeyboardEventLike> = {},
): BatchKeyboardEventLike {
  return { key, ...overrides }
}

function decide(
  e: BatchKeyboardEventLike,
  guardOverrides: Partial<BatchKeyboardGuards> = {},
  context: BatchKeyboardContext,
): BatchKeyboardAction | null {
  return resolveBatchKeyboardAction(e, guards(guardOverrides), context)
}

describe('模式外：只认裸 M，其余一律放行', () => {
  it('裸 m / 大写 M（Shift/大写锁定）进入模式，两面都认', () => {
    expect(decide(ev('m'), {}, ctx('home'))).toEqual({ kind: 'toggle-mode' })
    expect(decide(ev('M', { shiftKey: true }), {}, ctx('home'))).toEqual({ kind: 'toggle-mode' })
    expect(decide(ev('m'), {}, ctx('favorites'))).toEqual({ kind: 'toggle-mode' })
  })

  it('带修饰键的 M 不是模式入口', () => {
    expect(decide(ev('m', { ctrlKey: true }), {}, ctx('home'))).toBeNull()
    expect(decide(ev('m', { metaKey: true }), {}, ctx('home'))).toBeNull()
    expect(decide(ev('m', { altKey: true }), {}, ctx('home'))).toBeNull()
  })

  it('模式外 Esc / E / Ctrl+A / Space / Delete 全部放行', () => {
    const out = ctx('home')
    expect(decide(ev('Escape'), {}, out)).toBeNull()
    expect(decide(ev('e'), {}, out)).toBeNull()
    expect(decide(ev('a', { ctrlKey: true }), {}, out)).toBeNull()
    expect(decide(ev(' ', { code: 'Space' }), {}, { ...out, focusedSiteId: 's1' })).toBeNull()
    expect(decide(ev('Delete'), {}, { ...out, hasSelection: true })).toBeNull()
  })
})

describe('模式内 Esc：两段式，M 再按一次退出', () => {
  it('有选中 → 清空选中（留在模式内）；无选中 → 退出模式', () => {
    const inMode = ctx('favorites', { inBatchMode: true, hasSelection: true })
    expect(decide(ev('Escape'), {}, inMode)).toEqual({ kind: 'clear-selection' })
    expect(decide(ev('Escape'), {}, { ...inMode, hasSelection: false })).toEqual({
      kind: 'exit-mode',
    })
    expect(decide(ev('Escape'), {}, ctx('home', { inBatchMode: true }))).toEqual({
      kind: 'exit-mode',
    })
  })

  it('模式内再按 M 退出（toggle-mode）', () => {
    expect(decide(ev('m'), {}, ctx('home', { inBatchMode: true }))).toEqual({
      kind: 'toggle-mode',
    })
    expect(decide(ev('m'), {}, ctx('favorites', { inBatchMode: true }))).toEqual({
      kind: 'toggle-mode',
    })
  })

  it('带修饰键的 Esc 不归批量管', () => {
    expect(
      decide(ev('Escape', { ctrlKey: true }), {}, ctx('home', { inBatchMode: true })),
    ).toBeNull()
  })
})

describe('模式内：全选与焦点卡切换', () => {
  it('Ctrl+A / Cmd+A 全选可见；Ctrl+Shift+A 不是全选', () => {
    const inMode = ctx('home', { inBatchMode: true })
    expect(decide(ev('a', { ctrlKey: true }), {}, inMode)).toEqual({
      kind: 'select-all-visible',
    })
    expect(decide(ev('a', { metaKey: true }), {}, inMode)).toEqual({
      kind: 'select-all-visible',
    })
    expect(decide(ev('A', { ctrlKey: true, shiftKey: true }), {}, inMode)).toBeNull()
    expect(decide(ev('a', { altKey: true }), {}, inMode)).toBeNull()
  })

  it('Space / Enter 有焦点卡 → 切换该卡；无焦点卡 → 放行', () => {
    const inMode = ctx('home', { inBatchMode: true, focusedSiteId: 's1' })
    expect(decide(ev(' ', { code: 'Space' }), {}, inMode)).toEqual({
      kind: 'toggle-focused',
      siteId: 's1',
    })
    expect(decide(ev('Enter'), {}, inMode)).toEqual({ kind: 'toggle-focused', siteId: 's1' })
    const noFocus = ctx('home', { inBatchMode: true })
    expect(decide(ev(' ', { code: 'Space' }), {}, noFocus)).toBeNull()
    expect(decide(ev('Enter'), {}, noFocus)).toBeNull()
  })
})

describe('模式内 Delete：首页与收藏页都批量删除', () => {
  it('首页 Delete / Backspace 有选中 → batch-remove；无选中 → 放行（11b：撤销已补）', () => {
    const inMode = ctx('home', { inBatchMode: true, hasSelection: true })
    expect(decide(ev('Delete'), {}, inMode)).toEqual({ kind: 'batch-remove' })
    expect(decide(ev('Backspace'), {}, inMode)).toEqual({ kind: 'batch-remove' })
    // 无选中不吞键：放行，不落到单卡隐藏 handlePruneSite
    expect(decide(ev('Delete'), {}, { ...inMode, hasSelection: false })).toBeNull()
    expect(decide(ev('Backspace'), {}, { ...inMode, hasSelection: false })).toBeNull()
  })

  it('收藏页 Delete / Backspace 有选中 → batch-remove；无选中 → 放行', () => {
    const inMode = ctx('favorites', { inBatchMode: true, hasSelection: true })
    expect(decide(ev('Delete'), {}, inMode)).toEqual({ kind: 'batch-remove' })
    expect(decide(ev('Backspace'), {}, inMode)).toEqual({ kind: 'batch-remove' })
    expect(decide(ev('Delete'), {}, { ...inMode, hasSelection: false })).toBeNull()
  })
})

describe('模式内裸字母键：各面只接自己已有的批量能力', () => {
  it('首页：P 固定、E 复制 MD、Shift+E 下载 MD、F 聚焦收录；L 不存在', () => {
    const inMode = ctx('home', { inBatchMode: true })
    expect(decide(ev('p'), {}, inMode)).toEqual({ kind: 'pin' })
    expect(decide(ev('e'), {}, inMode)).toEqual({ kind: 'export-md' })
    expect(decide(ev('E', { shiftKey: true }), {}, inMode)).toEqual({ kind: 'download-md' })
    expect(decide(ev('f'), {}, inMode)).toEqual({ kind: 'focus-move-target' })
    expect(decide(ev('l'), {}, inMode)).toBeNull()
  })

  it('收藏页：E 导出 MD、Shift+E 导出 HTML、F 聚焦移夹、L 打包；P 不存在', () => {
    const inMode = ctx('favorites', { inBatchMode: true })
    expect(decide(ev('e'), {}, inMode)).toEqual({ kind: 'export-md' })
    expect(decide(ev('E', { shiftKey: true }), {}, inMode)).toEqual({ kind: 'export-html' })
    expect(decide(ev('f'), {}, inMode)).toEqual({ kind: 'focus-move-target' })
    expect(decide(ev('l'), {}, inMode)).toEqual({ kind: 'link-pack' })
    expect(decide(ev('p'), {}, inMode)).toBeNull()
  })
})

describe('守卫：组字 / 输入态 / 弹窗 / 菜单 / 编排态 / 拖拽手柄下全部放行', () => {
  const guardCases: Array<[string, Partial<BatchKeyboardGuards>]> = [
    ['组字中', { composing: true }],
    ['输入态', { typing: true }],
    ['弹窗打开', { dialogOpen: true }],
    ['菜单打开', { menuOpen: true }],
    ['DIY 编排态', { editingLayout: true }],
    ['拖拽手柄聚焦', { dragHandleFocused: true }],
  ]
  const keys: BatchKeyboardEventLike[] = [
    ev('m'),
    ev('Escape'),
    ev('a', { ctrlKey: true }),
    ev('Delete'),
    ev('e'),
  ]
  it.each(guardCases)('%s：M / Esc / Ctrl+A / Delete / E 全部返回 null', (_label, g) => {
    for (const surface of ['home', 'favorites'] as const) {
      const context = ctx(surface, { inBatchMode: true, hasSelection: true, focusedSiteId: 's1' })
      for (const key of keys) {
        expect(decide(key, g, context)).toBeNull()
      }
      // 模式外 M 同样被守卫拦住（输入框里按 M 是打字，不是进模式）
      expect(decide(ev('m'), g, ctx(surface))).toBeNull()
    }
  })
})

describe('永不认领：全局键与他人地盘上的键', () => {
  const neverKeys: BatchKeyboardEventLike[] = [
    ev('z', { ctrlKey: true }),
    ev('z', { metaKey: true }),
    ev('Z', { ctrlKey: true, shiftKey: true }),
    ev('y', { ctrlKey: true }),
    ev('k', { metaKey: true }),
    ev('k', { ctrlKey: true }),
    ev('/'),
    ev('j', { ctrlKey: true }),
    ev('d'),
    ev('b'),
    ev('t'),
    ev('?'),
    ev('1', { altKey: true }),
    ev('2', { altKey: true }),
    ev('3', { altKey: true }),
    ev('e', { ctrlKey: true }),
    ev('e', { metaKey: true }),
    ev('1'),
    ev('5'),
    ev('9'),
    ev('!', { shiftKey: true }),
    ev('0'),
  ]
  it('模式内与模式外都不认领、不吞键', () => {
    for (const surface of ['home', 'favorites'] as const) {
      for (const inBatchMode of [false, true]) {
        const context = ctx(surface, { inBatchMode, hasSelection: true, focusedSiteId: 's1' })
        for (const key of neverKeys) {
          expect(decide(key, {}, context)).toBeNull()
        }
      }
    }
  })
})

describe('executeBatchKeyboardAction：分发到宿主回调', () => {
  function callbacks(): BatchKeyboardCallbacks & Record<string, ReturnType<typeof vi.fn>> {
    return {
      onToggleMode: vi.fn(),
      onClearSelection: vi.fn(),
      onExitMode: vi.fn(),
      onToggleFocused: vi.fn(),
      onSelectAllVisible: vi.fn(),
      onPin: vi.fn(),
      onExportMarkdown: vi.fn(),
      onExportHtml: vi.fn(),
      onDownloadMarkdown: vi.fn(),
      onFocusMoveTarget: vi.fn(),
      onLinkPack: vi.fn(),
      onBatchRemove: vi.fn(),
    }
  }

  it('每个动作只调自己对应的回调', () => {
    const cb = callbacks()
    executeBatchKeyboardAction({ kind: 'toggle-mode' }, cb)
    executeBatchKeyboardAction({ kind: 'clear-selection' }, cb)
    executeBatchKeyboardAction({ kind: 'exit-mode' }, cb)
    executeBatchKeyboardAction({ kind: 'toggle-focused', siteId: 's9' }, cb)
    executeBatchKeyboardAction({ kind: 'select-all-visible' }, cb)
    executeBatchKeyboardAction({ kind: 'pin' }, cb)
    executeBatchKeyboardAction({ kind: 'export-md' }, cb)
    executeBatchKeyboardAction({ kind: 'export-html' }, cb)
    executeBatchKeyboardAction({ kind: 'download-md' }, cb)
    executeBatchKeyboardAction({ kind: 'focus-move-target' }, cb)
    executeBatchKeyboardAction({ kind: 'link-pack' }, cb)
    executeBatchKeyboardAction({ kind: 'batch-remove' }, cb)
    expect(cb.onToggleMode).toHaveBeenCalledTimes(1)
    expect(cb.onClearSelection).toHaveBeenCalledTimes(1)
    expect(cb.onExitMode).toHaveBeenCalledTimes(1)
    expect(cb.onToggleFocused).toHaveBeenCalledTimes(1)
    expect(cb.onToggleFocused).toHaveBeenCalledWith('s9')
    expect(cb.onSelectAllVisible).toHaveBeenCalledTimes(1)
    expect(cb.onPin).toHaveBeenCalledTimes(1)
    expect(cb.onExportMarkdown).toHaveBeenCalledTimes(1)
    expect(cb.onExportHtml).toHaveBeenCalledTimes(1)
    expect(cb.onDownloadMarkdown).toHaveBeenCalledTimes(1)
    expect(cb.onFocusMoveTarget).toHaveBeenCalledTimes(1)
    expect(cb.onLinkPack).toHaveBeenCalledTimes(1)
    expect(cb.onBatchRemove).toHaveBeenCalledTimes(1)
  })

  it('ignore 不调任何回调；缺失的可选回调不抛错', () => {
    const cb = callbacks()
    executeBatchKeyboardAction({ kind: 'ignore' }, cb)
    for (const fn of Object.values(cb)) expect(fn).not.toHaveBeenCalled()
    const minimal: BatchKeyboardCallbacks = {
      onToggleMode: vi.fn(),
      onClearSelection: vi.fn(),
      onExitMode: vi.fn(),
      onToggleFocused: vi.fn(),
      onSelectAllVisible: vi.fn(),
    }
    expect(() => executeBatchKeyboardAction({ kind: 'pin' }, minimal)).not.toThrow()
    expect(() => executeBatchKeyboardAction({ kind: 'export-html' }, minimal)).not.toThrow()
    expect(() => executeBatchKeyboardAction({ kind: 'batch-remove' }, minimal)).not.toThrow()
  })
})

describe('isAnyDialogOpen / isAnyMenuOpen：display:none 的关闭态节点不算打开', () => {
  // node 单测环境没有真 DOM：用替身 doc 喂 querySelectorAll + getComputedStyle。
  type FakeEl = { parentElement: FakeEl | null; __display: string }
  const fakeEl = (display: string, parent: FakeEl | null = null): FakeEl => ({
    parentElement: parent,
    __display: display,
  })
  const fakeDoc = (els: FakeEl[], hasView = true): unknown => ({
    querySelectorAll: () => els,
    defaultView: hasView
      ? { getComputedStyle: (el: FakeEl) => ({ display: el.__display }) }
      : null,
  })
  const asDoc = (d: unknown): Document => d as unknown as Document

  it('显示中的 dialog/menu 算打开', () => {
    expect(isAnyDialogOpen(asDoc(fakeDoc([fakeEl('block')])))).toBe(true)
    expect(isAnyMenuOpen(asDoc(fakeDoc([fakeEl('block')])))).toBe(true)
  })

  it('display:none 自身 / 祖先 display:none 都不算打开（小猫猫挂件关闭态面板）', () => {
    expect(isAnyDialogOpen(asDoc(fakeDoc([fakeEl('none')])))).toBe(false)
    expect(isAnyMenuOpen(asDoc(fakeDoc([fakeEl('none')])))).toBe(false)
    expect(
      isAnyDialogOpen(asDoc(fakeDoc([fakeEl('block', fakeEl('none'))]))),
    ).toBe(false)
    // 一关一开 → 开的那一个算数
    expect(
      isAnyDialogOpen(asDoc(fakeDoc([fakeEl('none'), fakeEl('block')]))),
    ).toBe(true)
  })

  it('无 defaultView 时退回「存在即打开」，不静默失效', () => {
    expect(isAnyDialogOpen(asDoc(fakeDoc([fakeEl('none')], false)))).toBe(true)
    expect(isAnyMenuOpen(asDoc(fakeDoc([fakeEl('none')], false)))).toBe(true)
  })

  it('没有节点 / 没有 doc 时返回 false', () => {
    expect(isAnyDialogOpen(asDoc(fakeDoc([])))).toBe(false)
    expect(isAnyMenuOpen(asDoc(fakeDoc([])))).toBe(false)
    expect(isAnyDialogOpen(undefined)).toBe(false)
    expect(isAnyMenuOpen(undefined)).toBe(false)
  })
})

describe('源码守卫：只挂首页与收藏页，别处不动', () => {
  it('hook 只在首页与收藏页挂载（不在视频页、不在快捷键指南对话框内）', () => {
    const home = overlaySource('src/components/navigation-content.tsx')
    const fav = overlaySource('src/app/favorites/page.tsx')
    expect(home).toContain("useBatchKeyboard({")
    expect(home).toContain("surface: 'home'")
    expect(fav).toContain('useBatchKeyboard({')
    expect(fav).toContain("surface: 'favorites'")
    const dialog = overlaySource('src/components/keyboard-shortcuts-dialog.tsx')
    expect(dialog).not.toContain('useBatchKeyboard')
    expect(dialog).not.toContain('batch-keyboard')
    // 视频页只挂自己的播放器键盘，不挂批量键盘
    const video = overlaySource('src/hooks/useVideoPlayerState.ts')
    expect(video).not.toContain('useBatchKeyboard')
    expect(video).not.toContain('batch-keyboard')
  })

  it('number-dial 与全局撤销的决策函数未被改动，batch-operations 引擎未被改动', () => {
    const dial = overlaySource('src/lib/number-dial.ts')
    expect(dial).toContain('export function resolveNumberDialAction')
    expect(dial).not.toContain('batch-keyboard')
    const undo = overlaySource('src/hooks/use-global-undo.ts')
    expect(undo).toContain('export function decideGlobalUndoKey')
    expect(undo).not.toContain('batch-keyboard')
    const engine = overlaySource('src/lib/batch-operations.ts')
    for (const fn of [
      'batchSetPinnedSitesInCategory',
      'batchMoveSitesBetweenCustomCategories',
      'batchDeleteSitesFromCustomCategories',
      'batchExportSitesToMarkdown',
      'batchExportSitesToOneTab',
    ]) {
      expect(engine).toContain(`export function ${fn}`)
    }
    expect(engine).not.toContain('batch-keyboard')
  })

  it('菜单守卫进了共享守卫库（不再只活在 home-diy-toolbar 自己的 Esc 处理里），且 display:none 的关闭态 dialog 不算打开', () => {
    const guardsSrc = overlaySource('src/lib/keyboard-guards.ts')
    expect(guardsSrc).toContain('export function isAnyMenuOpen')
    expect(guardsSrc).toContain('[role="menu"]:not([aria-hidden="true"])')
    expect(guardsSrc).toContain("display === 'none'")
    const hook = overlaySource('src/hooks/use-batch-keyboard.ts')
    expect(hook).toContain('isAnyMenuOpen()')
    expect(hook).toContain('stopImmediatePropagation()')
  })

  it('首页卡片：多选态 Space/Enter 切选中、Delete 走批量移除（11b 带撤销，不再吞掉 toast）', () => {
    const card = overlaySource('src/components/navigation-card.tsx')
    expect(card).toContain('resolveBatchKeyboardAction')
    expect(card).toContain('selectable &&')
    expect(card).toContain("(e.key === ' ' || e.code === 'Space' || e.key === 'Enter' || e.key === 'Delete' || e.key === 'Backspace')")
    expect(card).toContain("action?.kind === 'toggle-focused'")
    // 11b：Delete/Backspace 在多选态已是批量移除（带撤销），卡片级不再吞掉、不再 toast；
    // 非 toggle-focused 的 kind 一律直接 return，不拦冒泡，window 层执行批量移除。
    expect(card).toContain('batch-remove')
    expect(card).not.toContain("action?.kind === 'ignore'")
    expect(card).not.toContain('多选模式下键盘移除暂不支持')
    expect(card).toContain('选择站点：${item.title}，按空格切换选中')
  })

  it('收藏页：剪枝、卡片 onKeyDown、移夹 Enter 确认、syncNote 可读、提示行与标题齐全', () => {
    const fav = overlaySource('src/app/favorites/page.tsx')
    expect(fav).toContain('pruneSelected([...prev], visibleIds)')
    expect(fav).toContain('handleFavoriteCardKeyDown')
    // 卡片级只接 Space/Enter/Delete/Backspace：Esc 归 window 层，
    // 否则卡片级 stopPropagation 会吞掉 Esc、window 层永远收不到（2026-11-14 E2E 实测）。
    expect(fav).toContain('Esc 不归卡片管')
    expect(fav).toContain('data-favorite-site-id={f.siteId}')
    expect(fav).toContain("onKeyDown={\n                    batchMode ? (e) => handleFavoriteCardKeyDown(e, f.siteId) : undefined\n                  }")
    // 移夹 select：Enter=确认移动（不是原生打开下拉）
    expect(fav).toContain("if (e.key === 'Enter') {")
    expect(fav).toContain('void handleBatchMoveFolder()')
    // syncNote 播报区常驻挂载（不是条件渲染），读屏器才不会漏报；
    // 视觉提示框只负责样式，不再兼播报（避免双播报）
    expect(fav).toContain('<div role="status" aria-live="polite" className="sr-only">{syncNote ?? \'\'}</div>')
    // 批量删除/移动后焦点有确定落点（设计 §3.3 / §7 风险 8）：落到批量栏首个按钮
    expect(fav).toContain('ref={batchBarRef}')
    const focusCalls = fav.match(/focusBatchBar\(\)/g) ?? []
    expect(focusCalls.length).toBe(2)
    // 常驻提示行与按钮标题（提示行 <p> 不带 aria-label：无 role 的 <p> 上读屏忽略它）
    expect(fav).not.toContain('aria-label="批量管理键盘快捷键"')
    expect(fav).toContain('M</kbd> 退出')
    expect(fav).toContain('title="批量管理（快捷键 M）"')
    expect(fav).toContain('title="全选当前已渲染的收藏（快捷键 Ctrl+A）"')
    expect(fav).toContain('title="批量删除选中项（快捷键 Delete，可按 Ctrl+Z 撤销）"')
  })

  it('帮助与发现：指南加「批量整理」分组，工具栏多选按钮补快捷键，坞收录按钮可聚焦', () => {
    const dialog = overlaySource('src/components/keyboard-shortcuts-dialog.tsx')
    expect(dialog).toContain('批量整理（仅多选模式）')
    const toolbar = overlaySource('src/components/navigation-toolbar.tsx')
    expect(toolbar).toContain('（快捷键 M）')
    const dock = overlaySource('src/components/batch-operation-dock.tsx')
    expect(dock).toContain('data-batch-move-target')
  })

  it('两处 stale 注释已修正（坞「从未被挂载」的说法过期）', () => {
    expect(overlaySource('src/lib/selection.ts')).not.toContain('从未被挂载')
    expect(overlaySource('src/components/navigation-content.tsx')).not.toContain('从未被挂载')
  })
})

describe('11b 回归守卫（§6.6）：分发零改动 + 单提交 + 首页 Delete 已接撤销', () => {
  it('batch-operations.ts 引擎未被改动：不认识撤销栈与批量键盘', () => {
    const engine = overlaySource('src/lib/batch-operations.ts')
    expect(engine).not.toContain('batch-keyboard')
    expect(engine).not.toContain('undo-stack')
    expect(engine).not.toContain('pushGlobalUndo')
    expect(engine).not.toContain('home.batch')
    expect(engine).not.toContain('commitHomeDiyConfig')
    expect(engine).not.toContain('buildHomeBatch')
  })

  it('use-global-undo.ts 的 decideGlobalUndoKey 未被改动：diy → canvas → mask → favorites 的优先级原样，分发零改动', () => {
    const undo = overlaySource('src/hooks/use-global-undo.ts')
    expect(undo).toContain('export function decideGlobalUndoKey')
    const diy = undo.indexOf("if (state.diyCanUndo) return 'undo-diy'")
    const canvas = undo.indexOf("if (state.canvasCanUndo) return 'undo-canvas'")
    const mask = undo.indexOf("if (state.maskHasTrash) return 'undo-mask'")
    const fav = undo.indexOf("if (state.favoritesHasUndo) return 'undo-favorites'")
    expect(diy).toBeGreaterThan(-1)
    expect(canvas).toBeGreaterThan(diy)
    expect(mask).toBeGreaterThan(canvas)
    expect(fav).toBeGreaterThan(mask)
    // 新 kind 零改动可达：分发函数不认识任何批量符号
    expect(undo).not.toContain('batch-keyboard')
    expect(undo).not.toContain('batch-remove')
    expect(undo).not.toContain('home.batch')
    expect(undo).not.toContain('buildHomeBatch')
  })

  it('resolveBatchKeyboardAction 的首页 Delete 分支返回 batch-remove（不再是 ignore）', () => {
    // 运行时裁决（与上面「模式内 Delete」用例同款断言，这里是 §6.6 的锁）
    const inMode = ctx('home', { inBatchMode: true, hasSelection: true })
    expect(decide(ev('Delete'), {}, inMode)).toEqual({ kind: 'batch-remove' })
    expect(decide(ev('Backspace'), {}, inMode)).toEqual({ kind: 'batch-remove' })
    expect(decide(ev('Delete'), {}, { ...inMode, hasSelection: false })).toBeNull()
    // 源码级：Delete 分支就是这行，不再有 ignore 分支兜底
    const src = overlaySource('src/lib/batch-keyboard.ts')
    expect(src).toContain("return ctx.hasSelection ? { kind: 'batch-remove' } : null")
    expect(src).toContain("(key === 'Delete' || key === 'Backspace')")
  })

  it('批量路径是单提交：逐站提交的循环不再出现在 navigation-content.tsx 的批量处理器里', () => {
    // 依赖接线（文件 6 navigation-content.tsx）完成：接线前本用例是红的，
    // 接线后应变绿。不要为让它变绿去改 navigation-content.tsx。
    const nav = overlaySource('src/components/navigation-content.tsx')
    // 三个批量入口都调批量版（一次提交）+ 各推一条全局撤销条目
    expect(nav).toContain('addSitesToCustomCategory(')
    expect(nav).toContain('removeSitesFromCustomCategories(')
    expect(nav).toContain('buildHomeBatchAddUndoEntry(')
    expect(nav).toContain('buildHomeBatchRemoveUndoEntry(')
    expect(nav).toContain('buildHomeBatchPinUndoEntry(')
    expect(nav).toContain('pushGlobalUndo(')
    // Delete 接线：useBatchKeyboard 回调里有 onBatchRemove
    expect(nav).toContain('onBatchRemove')
    // 旧的逐站提交形状已消失（单站版函数本身保留，别处仍在用，只是不再
    // 出现在批量处理器里——这里锁的是批量处理器里的旧调用形状）
    expect(nav).not.toContain('addSiteToCustomCategory(categoryId, {')
    expect(nav).not.toContain('removeSiteFromCustomCategory(cat.id, site.id)')
    // pin 仍逐站调新版 pin（单站签名使然），「一批」体现在只推一条撤销
    // 条目上：buildHomeBatchPinUndoEntry 在文件里只出现一次调用点
    const pinBuilderCalls = nav.match(/buildHomeBatchPinUndoEntry\(/g) ?? []
    expect(pinBuilderCalls.length).toBe(1)
  })
})
