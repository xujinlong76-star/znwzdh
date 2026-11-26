'use client'

/**
 * P12 对比卡 PoC：站详情页“加入对比”按钮（对比篮入口）。
 *
 * 把本站的结构化事实快照（详情页已有字段，不发请求）放进本机对比篮
 * （localStorage，上限 3 个、去重）；与收藏夹对照流（登录 + 收藏 + 2–4 个）
 * 是两条独立入口，互不干扰。
 * 满篮时不加入并如实提示，不静默吞掉。
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  addToDecisionBasket,
  buildDecisionCompareHref,
  MAX_DECISION_COMPARE_SITES,
  readDecisionBasket,
  removeFromDecisionBasket,
  snapshotSiteForDecisionCompare,
  writeDecisionBasket,
  type DecisionCompareEntry,
} from '@/lib/decision-compare'
import type { HubSite } from '@/lib/navhub-api'

export function DecisionCompareBasketButton({ site }: { site: HubSite }) {
  const [basket, setBasket] = useState<DecisionCompareEntry[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setBasket(readDecisionBasket())
    setLoaded(true)
  }, [])

  const inBasket = basket.some((e) => e.siteId === site.id)

  const handleToggle = useCallback(() => {
    const current = readDecisionBasket()
    if (current.some((e) => e.siteId === site.id)) {
      const next = removeFromDecisionBasket(current, site.id)
      if (!writeDecisionBasket(next)) {
        setNote('本机存储写不进去，本站没有移出对比篮。')
        return
      }
      setBasket(next)
      setNote(null)
      return
    }
    const result = addToDecisionBasket(current, snapshotSiteForDecisionCompare(site))
    if (!result.added) {
      setNote(result.message)
      setBasket(current)
      return
    }
    if (!writeDecisionBasket(result.entries)) {
      setNote('本机存储写不进去，本站没有加入对比篮。')
      setBasket(current)
      return
    }
    setBasket(result.entries)
    setNote(null)
  }, [site])

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleToggle}
        disabled={!loaded}
        className="h-9 text-xs px-3 gap-1.5 font-medium shadow-2xs cursor-pointer"
        aria-pressed={inBasket}
        aria-label={inBasket ? '已加入对比篮，点击移出' : '加入对比篮'}
        title={
          inBasket
            ? '已在对比篮中，点击移出'
            : `把本站加入对比篮（本地保存，最多 ${MAX_DECISION_COMPARE_SITES} 个）`
        }
      >
        <span>{inBasket ? '已加入对比' : '加入对比'}</span>
        <span className="font-mono text-muted-foreground">
          {basket.length}/{MAX_DECISION_COMPARE_SITES}
        </span>
      </Button>
      {basket.length >= 2 && (
        <Button asChild variant="ghost" size="sm" className="h-9 text-xs px-3 cursor-pointer">
          <Link href={buildDecisionCompareHref()}>查看对比篮（{basket.length} 个）</Link>
        </Button>
      )}
      {note && (
        <span role="alert" className="text-xs text-destructive-text">
          {note}
        </span>
      )}
    </span>
  )
}
