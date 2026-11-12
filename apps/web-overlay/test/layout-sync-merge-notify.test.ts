/**
 * 8a：跨标签页合并的可见性 —— 合并结果必须说得出「远端赢了哪些插槽、
 * 其中哪些丢弃了本地改动」，通知摘要才能据此弹 toast / 写 live region。
 * 合并本身仍不碰撤销栈（那是 home-diy-storage 的契约，这里只测
 * layout-sync.ts 的纯函数部分）。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  mergeLayoutSlots,
  slotValue,
  describeLayoutSlot,
} from '@/lib/modular/layout-sync'
import {
  summarizeRemoteMerge,
  formatLayoutSyncMerge,
  notifyLayoutSyncMerge,
  subscribeLayoutSyncEvents,
} from '@/lib/modular/layout-sync-events'

describe('mergeLayoutSlots：remoteWon / discardedLocal', () => {
  it('远端时钟更新且值不同 → remoteWon，本地改过则进 discardedLocal', () => {
    const result = mergeLayoutSlots(
      { config: { viewMode: 'classic', updatedAt: 1 }, clocks: { viewMode: 1 } },
      { config: { viewMode: 'hybrid', updatedAt: 2 }, clocks: { viewMode: 2 } },
    )
    expect(result.changed).toBe(true)
    expect(result.config.viewMode).toBe('hybrid')
    expect(result.remoteWon).toEqual(['viewMode'])
    expect(result.discardedLocal).toEqual(['viewMode'])
  })

  it('远端赢了本地没改过的插槽 → remoteWon 但不算丢弃本地改动', () => {
    const result = mergeLayoutSlots(
      { config: { viewMode: 'classic', updatedAt: 1 }, clocks: {} },
      { config: { viewMode: 'hybrid', updatedAt: 2 }, clocks: { viewMode: 1 } },
    )
    expect(result.remoteWon).toEqual(['viewMode'])
    expect(result.discardedLocal).toEqual([])
  })

  it('本地时钟更新 → 远端输，remoteWon / discardedLocal 为空', () => {
    const result = mergeLayoutSlots(
      { config: { viewMode: 'classic', updatedAt: 2 }, clocks: { viewMode: 5 } },
      { config: { viewMode: 'hybrid', updatedAt: 1 }, clocks: { viewMode: 2 } },
    )
    expect(result.changed).toBe(false)
    expect(result.config.viewMode).toBe('classic')
    expect(result.remoteWon).toEqual([])
    expect(result.discardedLocal).toEqual([])
  })

  it('元素级：远端改了专属分类标题 → 字段级与元素级插槽都记，丢弃只记元素级', () => {
    const localCat = { id: 'c1', title: '旧名字', items: [] }
    const remoteCat = { id: 'c1', title: '新名字', items: [] }
    const result = mergeLayoutSlots(
      {
        config: { customCategories: [localCat], updatedAt: 1 },
        clocks: { 'customCategories::c1': 1 },
      },
      {
        config: { customCategories: [remoteCat], updatedAt: 2 },
        clocks: { 'customCategories::c1': 2 },
      },
    )
    expect(result.changed).toBe(true)
    expect(result.config.customCategories[0].title).toBe('新名字')
    expect(result.remoteWon).toContain('customCategories')
    expect(result.remoteWon).toContain('customCategories::c1')
    expect(result.discardedLocal).toEqual(['customCategories::c1'])
  })

  it('远端删了本地元素 → 也算远端赢、本地改动被丢弃', () => {
    const localCat = { id: 'c1', title: 'A', items: [] }
    const result = mergeLayoutSlots(
      {
        config: { customCategories: [localCat], updatedAt: 1 },
        clocks: { 'customCategories::c1': 3 },
      },
      { config: { customCategories: [], updatedAt: 2 }, clocks: { 'customCategories::c1': 4 } },
    )
    expect(result.config.customCategories).toEqual([])
    expect(result.remoteWon).toContain('customCategories::c1')
    expect(result.discardedLocal).toContain('customCategories::c1')
  })

  it('值相同 → 不算变化也不算赢', () => {
    const result = mergeLayoutSlots(
      { config: { viewMode: 'classic', updatedAt: 1 }, clocks: { viewMode: 1 } },
      { config: { viewMode: 'classic', updatedAt: 2 }, clocks: { viewMode: 2 } },
    )
    expect(result.changed).toBe(false)
    expect(result.remoteWon).toEqual([])
  })
})

describe('slotValue / describeLayoutSlot', () => {
  it('字段级与元素级取值', () => {
    expect(slotValue({ viewMode: 'classic' }, 'viewMode')).toBe('classic')
    expect(slotValue({ customCategories: [{ id: 'c1', title: 'A' }] }, 'customCategories::c1')).toEqual({
      id: 'c1',
      title: 'A',
    })
    expect(slotValue({ pinnedSiteIdsByCategory: { cat1: ['s1'] } }, 'pinnedSiteIdsByCategory::cat1')).toEqual([
      's1',
    ])
    expect(slotValue({ viewMode: 'classic' }, 'nope')).toBeUndefined()
  })

  it('插槽键翻译成中文名，未知字段原样返回', () => {
    expect(describeLayoutSlot('viewMode')).toBe('视图模式')
    expect(describeLayoutSlot('customCategories::c1')).toBe('专属分类')
    expect(describeLayoutSlot('someFutureField')).toBe('someFutureField')
  })
})

describe('summarizeRemoteMerge / formatLayoutSyncMerge', () => {
  const before = { viewMode: 'classic', accentColor: 'default', updatedAt: 1 }
  const remote = { viewMode: 'hybrid', accentColor: 'violet', updatedAt: 2 }

  it('远端赢的插槽被点名；本地改过的被覆盖时单独标为冲突', () => {
    const after = { viewMode: 'hybrid', accentColor: 'violet', updatedAt: 2 }
    const summary = summarizeRemoteMerge(before, after, remote, { viewMode: 1, accentColor: 0 })
    expect(summary.changedSlots).toContain('viewMode')
    expect(summary.remoteWon).toContain('viewMode')
    expect(summary.discardedLocal).toEqual(['viewMode'])
    const copy = formatLayoutSyncMerge(summary)
    expect(copy.variant).toBe('destructive')
    expect(copy.title).toContain('覆盖')
    expect(copy.description).toContain('视图模式')
  })

  it('没有丢弃本地改动时用普通提示', () => {
    const after = { viewMode: 'hybrid', accentColor: 'violet', updatedAt: 2 }
    const summary = summarizeRemoteMerge(before, after, remote, {})
    expect(summary.discardedLocal).toEqual([])
    const copy = formatLayoutSyncMerge(summary)
    expect(copy.variant).toBe('default')
    expect(copy.description).toContain('视图模式')
    expect(copy.description).toContain('强调色')
  })

  it('无变化 → 摘要为空', () => {
    const summary = summarizeRemoteMerge(before, before, remote, {})
    expect(summary.changedSlots).toEqual([])
    expect(summary.remoteWon).toEqual([])
  })
})

describe('notifyLayoutSyncMerge', () => {
  it('有变化时通知订阅者；无变化时返回 null 且不通知', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLayoutSyncEvents(listener)
    try {
      const before = { viewMode: 'classic', updatedAt: 1 }
      const summary = notifyLayoutSyncMerge({
        before,
        after: { viewMode: 'hybrid', updatedAt: 2 },
        remote: { viewMode: 'hybrid', updatedAt: 2 },
        beforeClocks: {},
      })
      expect(summary).not.toBeNull()
      expect(summary!.remoteWon).toContain('viewMode')
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0]![0].remoteWon).toContain('viewMode')

      listener.mockClear()
      const none = notifyLayoutSyncMerge({
        before,
        after: before,
        remote: { viewMode: 'hybrid', updatedAt: 2 },
        beforeClocks: {},
      })
      expect(none).toBeNull()
      expect(listener).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })
})
