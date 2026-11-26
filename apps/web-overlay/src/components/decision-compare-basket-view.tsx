'use client'

/**
 * P12 对比卡 PoC：对比篮视图（`/compare?basket=1` 的篮模式主体）。
 *
 * 篮内容只读本机 localStorage（加入顺序），不要求登录、不要求收藏、
 * 不发任何请求；与收藏夹对照流（`/compare?siteIds=`，登录 + 收藏）
 * 是两条独立入口。移出/清空只改本机篮，不动任何服务端数据。
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DecisionCompareCard } from '@/components/decision-compare-card'
import {
  readDecisionBasket,
  removeFromDecisionBasket,
  writeDecisionBasket,
  type DecisionCompareEntry,
} from '@/lib/decision-compare'

export function DecisionCompareBasketView() {
  const [entries, setEntries] = useState<DecisionCompareEntry[] | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    setEntries(readDecisionBasket())
  }, [])

  const handleRemove = useCallback((siteId: string) => {
    setEntries((current) => {
      if (!current) return current
      const next = removeFromDecisionBasket(current, siteId)
      if (!writeDecisionBasket(next)) {
        setNote('本机存储写不进去，该站没有移出对比篮。')
        return current
      }
      setNote(null)
      return next
    })
  }, [])

  const handleClear = useCallback(() => {
    if (!writeDecisionBasket([])) {
      setNote('本机存储写不进去，对比篮没有清空。')
      return
    }
    setEntries([])
    setNote(null)
  }, [])

  if (entries === null) {
    return <p className="text-sm text-muted-foreground">正在读取对比篮…</p>
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-border/70 bg-card p-5 space-y-3">
        <p className="text-sm font-semibold text-foreground">对比篮是空的</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          去站详情页点“加入对比”，把 2–3 个同类站点放进对比篮（只存在本机浏览器里），
          再回到这里并排对照。
        </p>
        <div>
          <Button asChild size="sm" variant="outline" className="h-8 text-xs">
            <Link href="/">回首页找站</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span>
          对比篮里有 {entries.length} 个站（本地保存，最多 3 个；按加入顺序排列，不排序）。
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClear}
          className="h-7 text-xs cursor-pointer"
        >
          清空对比篮
        </Button>
        {note && (
          <span role="alert" className="text-destructive-text">
            {note}
          </span>
        )}
      </div>
      <DecisionCompareCard entries={entries} onRemove={handleRemove} />
    </div>
  )
}
