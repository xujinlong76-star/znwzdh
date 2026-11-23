'use client'

/**
 * /search 提交记账岛（只记历史、不渲染）。
 *
 * 为什么需要它：主搜索提交此前全仓无任何记账调用——21:22 轮 W3 核查：
 * 全仓唯一写入 `recordLocalSearchHistory` 只挂在 5 处页内筛选框，
 * 首页顶栏搜索、SearchPalette 提交、/search?q= 全都不记。于是
 * SearchPalette「最近搜索」与 /search 空态 RecentSearchChips 只能吃到
 * 筛选框的词，主搜索的词永远进不了历史，核心回路对主搜索不成立。
 *
 * 为什么挂在 /search 结果页：它是唯一 choke point——顶栏面板「查看全部
 * 结果」、热词点选、历史条目重搜、直接进 URL、分页/分面导航全都经过它
 * （本文件是纯服务端组件，SearchResults 在每次 /search 渲染时都跑到）。
 * 不在 SearchPalette 记：直接进 URL 与热词点选会绕过它。
 *
 * 语义与 5 处筛选框完全一致：调同一条 `useLocalSearchRecorder(q, 命中数)`，
 * 停手 800ms 记一次；命中数取本页实际展示的 hits.length（中枢不返回 total，
 * 与历史页「N 条结果」同一口径；取数失败时 hits 为空、按 0 条记，历史页
 * 「零结果」筛选可筛出）；空查询与身份未就绪时 hook 内部跳过；分面
 * 同一词重记由服务端 5 分钟去重窗口折成一行，这里不做第二道去重；
 * 分页不再重记：岛只在 page===1 挂载（与服务端 isFirstPage 同口径）。
 * 失败静默，记历史是附带行为，不能打断搜索。
 */

import { useLocalSearchRecorder } from '@/lib/local-search-record'

export function SearchHistoryRecorder({
  q,
  resultCount,
}: {
  q: string
  resultCount: number
}) {
  useLocalSearchRecorder(q, resultCount)
  return null
}
