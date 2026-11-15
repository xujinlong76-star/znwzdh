/**
 * 全局 Ctrl+Z 分发（hooks/use-global-undo）。
 *
 * 决策是纯函数 decideGlobalUndoKey，直接断言；监听收敛（旧三处删除、
 * Providers 只挂一次）用源码守卫钉死。
 *
 * 优先级（一次按键只做一件事）：
 *  修饰键 → IME → 输入框 → 对话框 → 认领 → DIY 编排态 → 画布 →
 *  feature-mask → 收藏栈；Ctrl+Shift+Z / Ctrl+Y 只重做 DIY/画布。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decideGlobalUndoKey, type GlobalUndoKeyState } from '@/hooks/use-global-undo'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function base(overrides: Partial<GlobalUndoKeyState> = {}): GlobalUndoKeyState {
  return {
    composing: false,
    typing: false,
    dialogOpen: false,
    diyClaimed: false,
    diyCanUndo: false,
    canvasCanUndo: false,
    maskHasTrash: false,
    favoritesHasUndo: false,
    diyCanRedo: false,
    canvasCanRedo: false,
    shiftKey: false,
    isY: false,
    isZ: true,
    modifier: true,
    isMac: false,
    ...overrides,
  }
}

describe('decideGlobalUndoKey：放行条件', () => {
  it('无修饰键 → ignore（裸按 Z 不是撤销）', () => {
    expect(decideGlobalUndoKey(base({ modifier: false }))).toBe('ignore')
  })

  it('IME 输入中（isComposing）→ 放行，不吞按键', () => {
    expect(
      decideGlobalUndoKey(base({ composing: true, diyCanUndo: true, favoritesHasUndo: true })),
    ).toBe('ignore')
  })

  it('焦点在可编辑元素时 Ctrl+Z 不触发全局撤销（INPUT/TEXTAREA/SELECT/contentEditable 统一判定）', () => {
    for (const typing of [true]) {
      expect(
        decideGlobalUndoKey(
          base({ typing, diyCanUndo: true, canvasCanUndo: true, favoritesHasUndo: true }),
        ),
      ).toBe('ignore')
    }
  })

  it('Dialog / 搜索面板打开时不跨层撤销', () => {
    expect(
      decideGlobalUndoKey(base({ dialogOpen: true, diyCanUndo: true, favoritesHasUndo: true })),
    ).toBe('ignore')
  })

  it('同一任务内 claimHomeDiyHistoryStep 被认领后只撤一步', () => {
    expect(
      decideGlobalUndoKey(base({ diyClaimed: true, diyCanUndo: true, favoritesHasUndo: true })),
    ).toBe('ignore')
  })

  it('无可撤销时不 preventDefault（返回 ignore，调用方不拦截）', () => {
    expect(decideGlobalUndoKey(base())).toBe('ignore')
  })

  it('按的不是 Z/Y → ignore', () => {
    expect(decideGlobalUndoKey(base({ isZ: false, isY: false }))).toBe('ignore')
  })
})

describe('decideGlobalUndoKey：优先级（一次按键只做一件事）', () => {
  it('DIY 编排态优先于画布、回收站、收藏栈', () => {
    expect(
      decideGlobalUndoKey(
        base({ diyCanUndo: true, canvasCanUndo: true, maskHasTrash: true, favoritesHasUndo: true }),
      ),
    ).toBe('undo-diy')
  })

  it('DIY 不可撤时画布其次', () => {
    expect(
      decideGlobalUndoKey(base({ canvasCanUndo: true, maskHasTrash: true, favoritesHasUndo: true })),
    ).toBe('undo-canvas')
  })

  it('画布不可撤时 feature-mask 再次', () => {
    expect(decideGlobalUndoKey(base({ maskHasTrash: true, favoritesHasUndo: true }))).toBe(
      'undo-mask',
    )
  })

  it('最后才轮到收藏栈', () => {
    expect(decideGlobalUndoKey(base({ favoritesHasUndo: true }))).toBe('undo-favorites')
  })

  it('DIY 未编排态时不抢：编排态才认 DIY 历史', () => {
    // diyCanUndo 由调用方按 isEditingLayout && past>0 换算；未编排态传 false
    expect(decideGlobalUndoKey(base({ diyCanUndo: false, favoritesHasUndo: true }))).toBe(
      'undo-favorites',
    )
  })
})

describe('decideGlobalUndoKey：重做只走 DIY/画布，不重做收藏删除', () => {
  it('Cmd+Z（Mac）与 Ctrl+Z 都触发（modifier 由调用方按平台换算）', () => {
    expect(decideGlobalUndoKey(base({ favoritesHasUndo: true, isMac: true }))).toBe(
      'undo-favorites',
    )
    expect(decideGlobalUndoKey(base({ favoritesHasUndo: true, isMac: false }))).toBe(
      'undo-favorites',
    )
  })

  it('Ctrl+Shift+Z 只重做 DIY，不重做收藏删除', () => {
    expect(
      decideGlobalUndoKey(base({ shiftKey: true, diyCanRedo: true, favoritesHasUndo: true })),
    ).toBe('redo-diy')
    expect(
      decideGlobalUndoKey(base({ shiftKey: true, canvasCanRedo: true, favoritesHasUndo: true })),
    ).toBe('redo-canvas')
    // 无可重做时放行，不吞按键（收藏类无 redo）
    expect(decideGlobalUndoKey(base({ shiftKey: true, favoritesHasUndo: true }))).toBe('ignore')
  })

  it('Ctrl+Y（非 Mac）只重做 DIY/画布；Mac 上 Ctrl+Y 不是重做', () => {
    expect(decideGlobalUndoKey(base({ isZ: false, isY: true, diyCanRedo: true }))).toBe('redo-diy')
    expect(
      decideGlobalUndoKey(base({ isZ: false, isY: true, diyCanRedo: true, isMac: true })),
    ).toBe('ignore')
    expect(decideGlobalUndoKey(base({ isZ: false, isY: true, favoritesHasUndo: true }))).toBe(
      'ignore',
    )
  })
})

describe('接线守卫：三处旧监听收敛为一处分发', () => {
  it('use-home-diy / modular-canvas / navigation-content 里不再有 keydown 监听', () => {
    for (const rel of [
      'src/lib/modular/use-home-diy.ts',
      'src/components/modular/modular-canvas.tsx',
      'src/components/navigation-content.tsx',
    ]) {
      const src = overlaySource(rel)
      expect(src, rel + ' 仍挂着 window keydown').not.toContain("window.addEventListener('keydown'")
      expect(src, rel + ' 仍挂着 window keydown').not.toContain('window.addEventListener("keydown"')
    }
  })

  it('use-global-undo 是唯一真源：统一用 keyboard-guards 判定输入框/对话框', () => {
    const src = overlaySource('src/hooks/use-global-undo.ts')
    expect(src).toContain('isEventTargetTyping')
    expect(src).toContain('isAnyDialogOpen')
    expect(src).toContain('didHomeDiyHistoryStepClaimThisTask')
    expect(src).toContain('claimHomeDiyHistoryStep')
    expect(src).toContain('undoHomeDiy')
    expect(src).toContain('getCanvasUndoHandler')
    expect(src).toContain('undoLastFeatureRemove')
    expect(src).toContain('undoLast')
  })

  it('Providers 里只挂一次 useGlobalUndo；layout 旁挂 UndoBar', () => {
    const providers = overlaySource('src/components/providers.tsx')
    expect(providers).toContain('useGlobalUndo()')
    expect(providers.match(/useGlobalUndo\(\)/g)?.length).toBe(1)
    const layout = overlaySource('src/app/layout.tsx')
    expect(layout).toContain('<UndoBar />')
  })

  it('删看板确认已去掉（删板有快照撤销，确认是重复设防）', () => {
    const src = overlaySource('src/components/modular/modular-canvas.tsx')
    expect(src).not.toContain('确定要删除看板')
    expect(src).toContain('按 Ctrl/Cmd+Z 可撤销恢复')
  })

  it('useNumberDial 监听没动（数字键与 Ctrl+Z 无交集，收敛时不碰它）', () => {
    const src = overlaySource('src/components/navigation-content.tsx')
    expect(src).toContain('useNumberDial')
  })
})
