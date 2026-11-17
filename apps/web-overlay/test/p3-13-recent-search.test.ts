/**
 * P3-13 / U-37②：最近搜索加单条删除 + 一键清空。
 *
 * 行为断言：lib/recent-search.ts 的纯函数（映射去重 / 移除）直接测；
 * 两个面板（SearchPalette / SpotlightModal）的接线是客户端交互，
 * vitest 无 jsdom 写不了渲染断言，接线断言见本文件下半部分（随面板
 * 改动补入），真点按靠 CI E2E 闭合。
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  removeRecentSearchItem,
  toRecentSearchItems,
  type RecentSearchItem,
} from '../src/lib/recent-search'
import type { HubSearchHistoryItem } from '../src/lib/navhub-api'

// mock 卫生兜底：本文件无跨模块 mock，但与同 worker 的后续文件隔离，
// 沿用 drama-due-badge.test.ts / search-plugin-results.test.ts 的口径。
afterAll(() => {
  vi.resetModules()
})

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
