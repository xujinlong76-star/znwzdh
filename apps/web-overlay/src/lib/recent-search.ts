/**
 * 最近搜索行（P3-13 / U-37②）：面板里的「最近搜索」不再只有点选回填。
 *
 * 历史存在服务端（GET /api/search-history），单条删除与一键清空复用
 * 已有的 DELETE /api/search-history/:id 与 DELETE /api/search-history
 *（/me/history 管理页同款接线，见 lib/navhub-api.ts）。
 *
 * 本模块只放纯函数（映射 + 移除），供 SearchPalette 与 SpotlightModal
 * 两个面板共用；渲染行为断言写不了 jsdom（vitest 无 jsdom），接线
 * 部分由 test/p3-13-recent-search.test.ts 做源码断言，端到端点按
 * 靠 CI E2E 闭合。
 */
import type { HubSearchHistoryItem } from '@/lib/navhub-api'

/**
 * 离线快照键（T24，/me/history 写入）：只存最近一页（≤20 条）+ 时间戳。
 * 本键是唯一事实源——/me/history 的读写与各处的清空都要走它；
 * 以前清空只清云端不删本键，下次降级加载会把已清空的历史当快照
 * 「复活」展示（R4）。
 */
export const SEARCH_HISTORY_SNAPSHOT_KEY = 'navhub.search_history.cache.v1'

/**
 * 删掉本机历史快照。清空成功后必须调：否则下次取数降级时
 * /me/history 会把快照里的旧记录原样展示出来，清空等于没清。
 * 隐私模式 / 非浏览器环境写不进也不抛错（快照只是尽力而为的增强）。
 */
export function clearSearchHistorySnapshot(): void {
  try {
    window.localStorage.removeItem(SEARCH_HISTORY_SNAPSHOT_KEY)
  } catch {
    // 尽力而为：删不掉也不构成功能承诺
  }
}

/** 面板里一行最近搜索：服务端 id（单条删除用）+ 查询词（回填用）。 */
export interface RecentSearchItem {
  id: number
  query: string
}

/**
 * 服务端历史页 → 面板行。
 *
 * 同一查询词可能有多条记录（搜过多次）：面板按词去重、只留最近一条，
 * 否则 key 撞车、同一词出现两次，单条删除也删不干净。
 */
export function toRecentSearchItems(items: HubSearchHistoryItem[]): RecentSearchItem[] {
  const seen = new Set<string>()
  const out: RecentSearchItem[] = []
  for (const item of items) {
    const query = item.query.trim()
    if (!query) continue
    const key = query.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: item.id, query })
  }
  return out
}

/** 删掉指定 id 的一行（乐观更新用）；id 不存在时原样返回。 */
export function removeRecentSearchItem(items: RecentSearchItem[], id: number): RecentSearchItem[] {
  return items.filter((item) => item.id !== id)
}
