'use client'

/**
 * 首页「我的常用」行（纯频次展示，最小切片）。
 *
 * 回访钩子：只展示用户本机真实访问频次最高的站点，不混推荐、不混兜底。
 * 解决速览坞混入推荐站、用户分不清「哪些是自己的常用站」的问题。
 * 数据源与「最近访问」行同一份本机快照（`@/lib/offline-recent`）：
 *  - 容器读全量快照（OFFLINE_RECENT_LIMIT 条），再用 topFrequentVisits
 *    按频次（次数降序，次数相同按最近访问降序）取前 6 条；
 *    只读最近 6 条再排频次是错的——昨天连点 10 次的站可能不在最近 6 条里；
 *  - 只读本机（IndexedDB 优先，降级 localStorage），不回传服务端；
 *  - SSR 阶段不渲染：挂载后才读，避免 hydration 不一致（与最近访问行同一模式）。
 * 空清单时整行不渲染，不留占位。
 */
import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import {
  OFFLINE_RECENT_LIMIT,
  readOfflineVisits,
  recordOfflineVisit,
  topFrequentVisits,
  type RecentVisit,
} from '@/lib/offline-recent'
import { getIdentity } from '@/lib/identity'
import { reportClick } from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'
import { SiteFavicon } from '@/components/site-favicon'

export const FREQUENT_VISITS_COUNT = 6

/**
 * 纯展示：给定已按频次排好的访问列表渲染一行；空清单返回 null（整行不存在）。
 *
 * 样式复用「最近访问」行的迷你卡片：favicon + 标题，移动端两列、桌面六列。
 * 唯一差别：卡片保证触点 ≥44px（min-h-11），360px 两列不溢出。
 * 点击走现有站点点击链路（记快照 + 上报点击，与导航卡片、搜索面板同一路）。
 * 本行只渲染传入的 visits，不补推荐、不补兜底——空就是空。
 */
export function FrequentVisitsRow({ visits }: { visits: RecentVisit[] }) {
  if (visits.length === 0) return null
  return (
    <section aria-label="我的常用" className="mb-6 sm:mb-8">
      <div className="flex items-center justify-between gap-2 mb-2 px-1">
        <h2 className="text-base sm:text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <span className="w-1.5 h-5 rounded-full bg-primary" />
          <Star className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span>我的常用</span>
          <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/40 shrink-0">
            {visits.length} 个站点
          </span>
        </h2>
        <span className="text-[11px] text-muted-foreground shrink-0">仅保存在本机</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {visits.map((visit) => (
          <a
            key={visit.id}
            href={safeHref(visit.href)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              recordOfflineVisit(visit)
              reportClick(visit.id, getIdentity())
            }}
            className="flex items-center gap-2 p-2 min-h-11 rounded-xl border border-border/50 bg-background/60 hover:bg-accent/50 hover:border-primary/30 transition-all text-xs group"
          >
            <div className="w-5 h-5 shrink-0 flex items-center justify-center">
              <SiteFavicon
                title={visit.title}
                url={visit.href}
                icon={visit.icon}
                className="w-5 h-5 object-contain rounded"
              />
            </div>
            <span className="truncate font-medium text-foreground group-hover:text-primary transition-colors">
              {visit.title}
            </span>
          </a>
        ))}
      </div>
    </section>
  )
}

/** 容器：挂载后读全量本机快照、按频次取前 6，SSR 首帧不渲染（见文件头）。 */
export function HomeFrequentVisits() {
  const [visits, setVisits] = useState<RecentVisit[]>([])
  useEffect(() => {
    let alive = true
    readOfflineVisits(OFFLINE_RECENT_LIMIT)
      .then((list) => {
        if (alive) setVisits(topFrequentVisits(list, FREQUENT_VISITS_COUNT))
      })
      .catch(() => {
        // 本地读取失败保持空行不渲染，不阻断首页
      })
    return () => {
      alive = false
    }
  }, [])
  return <FrequentVisitsRow visits={visits} />
}
