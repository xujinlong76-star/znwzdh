/**
 * P3-13 / U-37②：最近搜索加单条删除 + 一键清空。
 *
 * 行为断言：lib/recent-search.ts 的纯函数（映射去重 / 移除）直接测；
 * 两个面板（SearchPalette / SpotlightModal）的接线是客户端交互，
 * vitest 无 jsdom 写不了渲染断言，接线断言见本文件下半部分（随面板
 * 改动补入），真点按靠 CI E2E 闭合。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  clearSearchHistorySnapshot,
  removeRecentSearchItem,
  SEARCH_HISTORY_SNAPSHOT_KEY,
  toRecentSearchItems,
  type RecentSearchItem,
} from '../src/lib/recent-search'
import type { HubSearchHistoryItem } from '../src/lib/navhub-api'

// mock 卫生兜底：本文件无跨模块 mock，但与同 worker 的后续文件隔离，
// 沿用 drama-due-badge.test.ts / search-plugin-results.test.ts 的口径。
afterAll(() => {
  vi.resetModules()
})

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

function historyItem(over: Partial<HubSearchHistoryItem> & { id: number; query: string }): HubSearchHistoryItem {
  const { id, query, ...rest } = over
  return {
    id,
    query,
    resultCount: 3,
    createdAt: 1700000000000,
    ...rest,
  }
}

/* ---------- 纯函数行为 ---------- */

describe('toRecentSearchItems：服务端历史页 → 面板行', () => {
  it('保留 id 与 query，去掉空词', () => {
    expect(
      toRecentSearchItems([
        historyItem({ id: 7, query: 'react' }),
        historyItem({ id: 8, query: '   ' }),
        historyItem({ id: 9, query: 'vue' }),
      ]),
    ).toEqual([
      { id: 7, query: 'react' },
      { id: 9, query: 'vue' },
    ])
  })

  it('同一查询词去重，只留最近一条（服务端先返回最近的）', () => {
    expect(
      toRecentSearchItems([
        historyItem({ id: 11, query: 'React' }),
        historyItem({ id: 5, query: 'react' }),
        historyItem({ id: 3, query: 'vue' }),
      ]),
    ).toEqual([
      { id: 11, query: 'React' },
      { id: 3, query: 'vue' },
    ])
  })

  it('空历史返回空数组', () => {
    expect(toRecentSearchItems([])).toEqual([])
  })
})

describe('removeRecentSearchItem：单条删除', () => {
  const items: RecentSearchItem[] = [
    { id: 1, query: 'a' },
    { id: 2, query: 'b' },
    { id: 3, query: 'c' },
  ]

  it('按 id 只删一行，其余不动，不改原数组', () => {
    expect(removeRecentSearchItem(items, 2)).toEqual([
      { id: 1, query: 'a' },
      { id: 3, query: 'c' },
    ])
    expect(items).toHaveLength(3)
  })

  it('id 不存在时原样返回', () => {
    expect(removeRecentSearchItem(items, 99)).toEqual(items)
  })
})

describe('clearSearchHistorySnapshot：清空后删快照键（R4）', () => {
  it('键名就是 /me/history 用的 navhub.search_history.cache.v1', () => {
    expect(SEARCH_HISTORY_SNAPSHOT_KEY).toBe('navhub.search_history.cache.v1')
  })

  it('调 localStorage.removeItem 删该键；无 window 时不抛错', () => {
    const removeItem = vi.fn()
    const prevWindow = (globalThis as { window?: unknown }).window
    ;(globalThis as { window?: unknown }).window = { localStorage: { removeItem } }
    try {
      clearSearchHistorySnapshot()
      expect(removeItem).toHaveBeenCalledWith('navhub.search_history.cache.v1')
      expect(removeItem).toHaveBeenCalledTimes(1)
    } finally {
      if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window
      else (globalThis as { window?: unknown }).window = prevWindow
    }
    expect(() => clearSearchHistorySnapshot()).not.toThrow()
  })
})

/* ---------- 面板接线（源码断言；真点按靠 CI E2E） ---------- */

describe('接线：SearchPalette 最近搜索可单条删除 + 一键清空', () => {
  const palette = overlaySource('src/components/search-palette.tsx')

  it('取数走 fetchSearchHistoryPage（limit 8，带 id），不再用只回词的 fetchSearchHistory', () => {
    expect(palette).toContain('fetchSearchHistoryPage')
    expect(palette).toContain('toRecentSearchItems')
    expect(palette).not.toContain('fetchSearchHistory(')
  })

  it('单条删除按 id 走 deleteSearchHistoryItem，失败时列表不动 + toast', () => {
    expect(palette).toContain('deleteSearchHistoryItem(identity, item.id)')
    expect(palette).toContain("toast({ title: '删除失败'")
    // 先 await 再改列表：失败直接 return，setRecent 只在成功后执行
    const handler = palette.slice(palette.indexOf('handleDeleteRecent'), palette.indexOf('handleClearRecent'))
    expect(handler).toContain('const ok = await deleteSearchHistoryItem')
    expect(handler.indexOf('if (!ok)')).toBeLessThan(handler.indexOf('setRecent('))
  })

  it('一键清空两步确认（清空→确认清空），成功后删快照键；失败列表不动 + toast', () => {
    expect(palette).toContain('clearCloudSearchHistory(identity)')
    expect(palette).toContain('clearSearchHistorySnapshot()')
    expect(palette).toContain("'确认清空'")
    expect(palette).toContain("toast({ title: '清空失败'")
    expect(palette).toContain('将删除当前身份（登录身份或本机匿名 id）下的全部最近搜索')
  })

  it('行容器是 div、回填区与 × 并列（R3：不嵌套 button）；× 32px、触屏 44px、stopPropagation', () => {
    expect(palette).toContain('删除最近搜索')
    expect(palette).toContain('h-8 w-8')
    expect(palette).toContain('pointer-coarse:h-11 pointer-coarse:w-11')
    expect(palette).toContain('e.stopPropagation()')
  })

  it('× 不进 navItems（最近行只在空查询面板，不在结果键盘导航列表里）', () => {
    const navBlock = palette.slice(palette.indexOf('const navItems = useMemo'), palette.indexOf('const navIndexById'))
    expect(navBlock).not.toContain('recent')
  })

  it('建议层的 history 仍传查询词数组（RecentSearchItem 需先 map 回 query）', () => {
    expect(palette).toContain('history: recent.map((item) => item.query)')
  })
})

describe('接线：SpotlightModal 最近搜索可单条删除 + 一键清空', () => {
  const spotlight = overlaySource('src/components/search/spotlight-modal.tsx')

  it('取数走 fetchSearchHistoryPage（limit 8，带 id），不再用只回词的 fetchSearchHistory', () => {
    expect(spotlight).toContain('fetchSearchHistoryPage')
    expect(spotlight).toContain('toRecentSearchItems')
    expect(spotlight).not.toContain('fetchSearchHistory(')
  })

  it('单条删除按 id 走 deleteSearchHistoryItem，失败时列表不动 + toast', () => {
    expect(spotlight).toContain('deleteSearchHistoryItem(identity, item.id)')
    expect(spotlight).toContain("toast.error('删除失败'")
    const handler = spotlight.slice(spotlight.indexOf('handleDeleteRecent'), spotlight.indexOf('handleClearRecent'))
    expect(handler).toContain('const ok = await deleteSearchHistoryItem')
    expect(handler.indexOf('if (!ok)')).toBeLessThan(handler.indexOf('setRecentQueries('))
  })

  it('一键清空两步确认（清空→确认清空），成功后删快照键；失败列表不动 + toast', () => {
    expect(spotlight).toContain('clearCloudSearchHistory(identity)')
    expect(spotlight).toContain('clearSearchHistorySnapshot()')
    expect(spotlight).toContain("'确认清空'")
    expect(spotlight).toContain("toast.error('清空失败'")
    expect(spotlight).toContain('将删除当前身份（登录身份或本机匿名 id）下的全部最近搜索')
  })

  it('chip 是 span 容器、回填区与 × 并列（R3：不嵌套 button）；× 32px、触屏 44px、stopPropagation', () => {
    expect(spotlight).toContain('删除最近搜索')
    expect(spotlight).toContain('h-8 w-8')
    expect(spotlight).toContain('pointer-coarse:h-11 pointer-coarse:w-11')
    expect(spotlight).toContain('e.stopPropagation()')
  })
})

describe('R4：/me/history 清空成功后删快照键，不让已清空的历史「复活」', () => {
  const historyPage = overlaySource('src/app/me/history/page.tsx')

  it('clearAll 成功后调 clearSearchHistorySnapshot()，失败时不删', () => {
    const block = historyPage.slice(historyPage.indexOf('const clearAll'), historyPage.indexOf('const zeroResultItems'))
    expect(block).toContain('clearSearchHistorySnapshot()')
    expect(block.indexOf('if (!ok)')).toBeLessThan(block.indexOf('clearSearchHistorySnapshot()'))
    expect(block.indexOf('setItems([])')).toBeLessThan(block.indexOf('clearSearchHistorySnapshot()'))
  })

  it('clearAll 成功后同步清掉快照时间戳，横幅不残留', () => {
    const block = historyPage.slice(historyPage.indexOf('const clearAll'), historyPage.indexOf('const zeroResultItems'))
    expect(block).toContain('setOfflineSnapshotAt(null)')
    expect(block.indexOf('clearSearchHistorySnapshot()')).toBeLessThan(block.indexOf('setOfflineSnapshotAt(null)'))
    // 只在成功分支清时间戳：失败提前 return 在清零之前，快照态与横幅原样保留
    expect(block.indexOf('if (!ok)')).toBeLessThan(block.indexOf('setOfflineSnapshotAt(null)'))
    // 注释不再陈述已修复的旧 bug 行为（回归锚点：防 R4 修复时「修代码忘修注释」重演）
    expect(block).not.toContain('只清云端不删快照键')
  })

  it('快照键不再本地重复定义，唯一事实源在 lib/recent-search.ts', () => {
    expect(historyPage).not.toContain('const HISTORY_SNAPSHOT_KEY')
    expect(historyPage).toContain("from '@/lib/recent-search'")
    expect(historyPage).toContain('SEARCH_HISTORY_SNAPSHOT_KEY')
  })
})
