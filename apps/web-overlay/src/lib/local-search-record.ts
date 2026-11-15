'use client'

/**
 * 页内即时筛选的查询记录。
 *
 * 分类/热榜/标签/目录/合集页的筛选框是本机过滤：用户边输边筛，没有「提交」
 * 动作。没有这层 hook，那些查询永远进不了搜索历史（走查实测「考研」「微信」
 * 全漏记）。
 *
 * 语义：
 * - 停手 {@link LOCAL_SEARCH_RECORD_DEBOUNCE_MS} 后记一次：逐字输入不产生
 *   多条；结果数取停手那一刻实际展示的命中数；
 * - 身份未就绪（`useIdentityReady` 还没确认匿名/登录）时不记：没身份的
 *   记录在服务端落不成行，白发一次；
 * - 空查询不记；服务端 5 分钟去重窗口会把浮层重查、重复提交折成一行，
 *   这里不再做第二道去重。
 *
 * 调用方只需一行：`useLocalSearchRecorder(query, filteredCount)`。
 * 失败静默（`recordLocalSearchHistory` 本身不抛错）：记历史是附带行为，
 * 不能打断筛选。
 */
import { useEffect, useRef } from 'react'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { recordLocalSearchHistory } from '@/lib/navhub-api'

/** 停手多久后记一次：太短会把逐字输入记成多条，太长会漏掉输完即走的查询。 */
export const LOCAL_SEARCH_RECORD_DEBOUNCE_MS = 800

export function useLocalSearchRecorder(query: string, resultCount: number): void {
  const { ready, identity } = useIdentityReady()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (!ready || !identity || !q) return
    if (timerRef.current) clearTimeout(timerRef.current)
    const capturedCount = Math.max(0, Math.trunc(resultCount))
    timerRef.current = setTimeout(() => {
      void recordLocalSearchHistory(identity, q, capturedCount)
    }, LOCAL_SEARCH_RECORD_DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, resultCount, ready, identity])
}
