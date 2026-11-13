/**
 * DRAG-2：拖拽决策（diy-drag.ts）单测——纯函数，node 环境可跑。
 * 覆盖：卡片落点决策、⋯ 菜单移动决策、播报文案。
 */
import { describe, expect, it } from 'vitest'
import {
  buildDragAnnouncement,
  KEYBOARD_DRAG_INSTRUCTIONS,
  moveCardInDisplayedOrder,
  resolveCardDrop,
  resolveCategoryDropIndex,
  withoutAccessibilityPlugin,
} from '../src/lib/modular/diy-drag'

const CARD = {
  kind: 'card' as const,
  siteId: 's1',
  title: '示例站',
  href: 'https://example.com',
  sourceCategoryId: 'cat-a',
}

describe('resolveCardDrop', () => {
  it('落到自定义分类 → 收录', () => {
    expect(
      resolveCardDrop({
        source: CARD,
        target: { kind: 'category', categoryId: 'custom-1', isCustom: true },
        isEditing: false,
        targetHasSite: false,
      }),
    ).toEqual({ action: 'collect', reason: '收录进自定义分类' })
  })

  it('目标分类里已有 → noop（不弹假成功）', () => {
    expect(
      resolveCardDrop({
        source: CARD,
        target: { kind: 'category', categoryId: 'custom-1', isCustom: true },
        isEditing: false,
        targetHasSite: true,
      }).action,
    ).toBe('noop')
  })

  it('编辑态跨分类 → 重归类；非编辑态跨分类 → noop', () => {
    const target = { kind: 'category', categoryId: 'cat-b', isCustom: false } as const
    expect(resolveCardDrop({ source: CARD, target, isEditing: true, targetHasSite: false }).action).toBe(
      'reclassify',
    )
    expect(resolveCardDrop({ source: CARD, target, isEditing: false, targetHasSite: false }).action).toBe(
      'noop',
    )
  })

  it('同分类内落下 → noop（顺序由置顶/排序决定）', () => {
    expect(
      resolveCardDrop({
        source: CARD,
        target: { kind: 'category', categoryId: 'cat-a', isCustom: false },
        isEditing: true,
        targetHasSite: false,
      }).action,
    ).toBe('noop')
  })

  it('起点/落点缺失 → noop，不抛错', () => {
    expect(resolveCardDrop({ source: null, target: null, isEditing: true, targetHasSite: false }).action).toBe(
      'noop',
    )
  })
})

describe('moveCardInDisplayedOrder（⋯ 菜单移动）', () => {
  // 显示顺序：a b（置顶） c d；置顶列表 [a, b]
  const displayed = ['a', 'b', 'c', 'd']
  const pinned = ['a', 'b']

  it('置顶区内上移：只换置顶列表里的顺序', () => {
    const res = moveCardInDisplayedOrder({ displayedIds: displayed, pinnedIds: pinned, siteId: 'b', direction: 'up' })
    expect(res).toEqual({ pinnedIds: ['b', 'a'], toIndex: 0 })
  })

  it('置顶区内下移到底部边界外 → 出置顶', () => {
    // b 下移到序号 2（c 的位置）：目标在置顶区外（置顶数 2），b 出置顶
    const res = moveCardInDisplayedOrder({ displayedIds: displayed, pinnedIds: pinned, siteId: 'b', direction: 'down' })
    expect(res).toEqual({ pinnedIds: ['a'], toIndex: 2 })
  })

  it('未置顶卡上移进置顶区 → 进置顶', () => {
    const res = moveCardInDisplayedOrder({ displayedIds: displayed, pinnedIds: pinned, siteId: 'c', direction: 'up' })
    expect(res).toEqual({ pinnedIds: ['a', 'c', 'b'], toIndex: 1 })
  })

  it('移到顶部：未置顶卡直接进置顶首位', () => {
    const res = moveCardInDisplayedOrder({ displayedIds: displayed, pinnedIds: pinned, siteId: 'd', direction: 'top' })
    expect(res).toEqual({ pinnedIds: ['d', 'a', 'b'], toIndex: 0 })
  })

  it('移到末尾：置顶卡出置顶', () => {
    const res = moveCardInDisplayedOrder({ displayedIds: displayed, pinnedIds: pinned, siteId: 'a', direction: 'bottom' })
    expect(res).toEqual({ pinnedIds: ['b'], toIndex: 3 })
  })

  it('边界外移动返回 null（菜单据此禁用）', () => {
    expect(moveCardInDisplayedOrder({ displayedIds: displayed, pinnedIds: pinned, siteId: 'a', direction: 'up' })).toBeNull()
    expect(moveCardInDisplayedOrder({ displayedIds: displayed, pinnedIds: pinned, siteId: 'a', direction: 'top' })).toBeNull()
    expect(moveCardInDisplayedOrder({ displayedIds: displayed, pinnedIds: pinned, siteId: 'd', direction: 'down' })).toBeNull()
    expect(moveCardInDisplayedOrder({ displayedIds: displayed, pinnedIds: pinned, siteId: 'd', direction: 'bottom' })).toBeNull()
    expect(moveCardInDisplayedOrder({ displayedIds: displayed, pinnedIds: pinned, siteId: 'ghost', direction: 'up' })).toBeNull()
  })

  it('其它卡的置顶状态不受影响', () => {
    const res = moveCardInDisplayedOrder({ displayedIds: displayed, pinnedIds: pinned, siteId: 'd', direction: 'up' })
    // d 从序号 3 上移到 2，仍在置顶区外：置顶列表不变
    expect(res).toEqual({ pinnedIds: ['a', 'b'], toIndex: 2 })
  })
})

describe('withoutAccessibilityPlugin（W2-8：只留中文播报）', () => {
  // 构造器的 .name 就是类名；dnd-kit 默认插件是裸构造器或 { plugin, options? }
  class Accessibility {}
  class AutoScroller {}
  class Cursor {}
  class Feedback {}

  it('去掉 Accessibility 构造器，保留其余插件', () => {
    expect(withoutAccessibilityPlugin([Accessibility, AutoScroller, Cursor])).toEqual([
      AutoScroller,
      Cursor,
    ])
  })

  it('去掉 { plugin: Accessibility } 描述符，保留带 options 的其余插件', () => {
    const feedback = { plugin: Feedback, options: { foo: 1 } }
    expect(withoutAccessibilityPlugin([{ plugin: Accessibility }, feedback])).toEqual([feedback])
  })

  it('不认识的条目原样保留（不误删）', () => {
    expect(withoutAccessibilityPlugin([null, undefined, 42])).toEqual([null, undefined, 42])
  })
})

describe('resolveCategoryDropIndex（分类拖拽落点换算，W2-7）', () => {
  it('指针上半区：上移/下移都插到目标之前', () => {
    // 下移：源在 1，目标在 3，上半区 → 插到目标之前 = 序号 2（旧实现给 3，落到目标之后）
    expect(resolveCategoryDropIndex({ fromIndex: 1, targetIndex: 3, afterTarget: false })).toBe(2)
    // 上移：源在 3，目标在 1，上半区 → 插到目标之前 = 序号 1
    expect(resolveCategoryDropIndex({ fromIndex: 3, targetIndex: 1, afterTarget: false })).toBe(1)
  })

  it('指针下半区：上移/下移都插到目标之后', () => {
    expect(resolveCategoryDropIndex({ fromIndex: 1, targetIndex: 3, afterTarget: true })).toBe(3)
    // 上移：源在 3，目标在 1，下半区 → 插到目标之后 = 序号 2（旧实现给 1，落到目标之前）
    expect(resolveCategoryDropIndex({ fromIndex: 3, targetIndex: 1, afterTarget: true })).toBe(2)
  })

  it('相邻目标：落点半区决定换位还是不动', () => {
    // 源 1 目标 2：上半区 = 插回原位（不动），下半区 = 换到 2
    expect(resolveCategoryDropIndex({ fromIndex: 1, targetIndex: 2, afterTarget: false })).toBe(1)
    expect(resolveCategoryDropIndex({ fromIndex: 1, targetIndex: 2, afterTarget: true })).toBe(2)
    // 源 2 目标 1：下半区 = 插回原位（不动），上半区 = 换到 1
    expect(resolveCategoryDropIndex({ fromIndex: 2, targetIndex: 1, afterTarget: true })).toBe(2)
    expect(resolveCategoryDropIndex({ fromIndex: 2, targetIndex: 1, afterTarget: false })).toBe(1)
  })

  it('键盘拖拽（无指针位置）：沿用旧语义——顺移动方向落远端', () => {
    expect(resolveCategoryDropIndex({ fromIndex: 1, targetIndex: 3 })).toBe(3)
    expect(resolveCategoryDropIndex({ fromIndex: 3, targetIndex: 1 })).toBe(1)
  })

  it('插到首尾不越界', () => {
    expect(resolveCategoryDropIndex({ fromIndex: 4, targetIndex: 0, afterTarget: false })).toBe(0)
    expect(resolveCategoryDropIndex({ fromIndex: 0, targetIndex: 4, afterTarget: true })).toBe(4)
  })
})

describe('卡片拖拽不承诺位置（W2-7）', () => {
  it('键盘说明不再说「菜单完成同样的操作」：拖拽是收录/重归类，位置只归菜单', () => {
    expect(KEYBOARD_DRAG_INSTRUCTIONS).not.toContain('完成同样的操作')
    expect(KEYBOARD_DRAG_INSTRUCTIONS).toContain('收录或重归类')
    expect(KEYBOARD_DRAG_INSTRUCTIONS).toContain('不改变它在分类内的位置')
    expect(KEYBOARD_DRAG_INSTRUCTIONS).toContain('更多操作菜单')
  })

  it('over 播报不再说「上方」：卡片是移到分类，不是放到分类上面', () => {
    expect(buildDragAnnouncement('over', { title: '示例站', toLabel: '「目标」分类' })).not.toContain('上方')
    expect(buildDragAnnouncement('over', { title: '示例站', toLabel: '「目标」分类' })).toContain('移到')
  })
})

describe('播报与常量', () => {
  it('键盘流程说明包含 Space/方向键/Enter/Esc 与菜单替代', () => {
    expect(KEYBOARD_DRAG_INSTRUCTIONS).toContain('空格')
    expect(KEYBOARD_DRAG_INSTRUCTIONS).toContain('方向键')
    expect(KEYBOARD_DRAG_INSTRUCTIONS).toContain('回车')
    expect(KEYBOARD_DRAG_INSTRUCTIONS).toContain('Esc')
    expect(KEYBOARD_DRAG_INSTRUCTIONS).toContain('更多操作菜单')
  })

  it('四阶段播报都带标题，取消明确说位置没变', () => {
    expect(buildDragAnnouncement('start', { title: '示例站', fromLabel: '第 1 个' })).toContain('示例站')
    expect(buildDragAnnouncement('over', { title: '示例站', toLabel: '「目标」分类' })).toContain('目标')
    expect(buildDragAnnouncement('end', { title: '示例站', toLabel: '目标分类' })).toContain('移到')
    expect(buildDragAnnouncement('cancel', { title: '示例站' })).toContain('位置没有变化')
  })

  it('nochange：放下了但没变化，报「位置没有变化」而不是「已取消」', () => {
    // 同分类内落下、目标里已有该站：用户没有按 Esc，也没有失败，
    // 「已取消」是错的（见 diy-drag-kit 里 noop 分支调 nochange 而不是 cancel）
    const msg = buildDragAnnouncement('nochange', { title: '示例站' })
    expect(msg).toContain('位置没有变化')
    expect(msg).not.toContain('已取消')
    expect(msg).toContain('示例站')
  })
})
