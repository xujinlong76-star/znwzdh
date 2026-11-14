'use client'

/**
 * 首页「最近访问」行（升级第 5 条）。
 *
 * 回访用户一键直达昨天去过的站。数据源是本机「最近访问」快照
 *（`@/lib/offline-recent`），与搜索面板、速览坞同一份数据：
 *  - 只读本机（IndexedDB 优先，降级 localStorage），不回传服务端；
 *  - SSR 阶段不渲染：localStorage/IndexedDB 只在客户端可用，挂载后
 *    再读，避免 hydration 不一致（与搜索面板同一模式）。
 * 空清单时整行不渲染，不留占位。
 */
import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import {
  readOfflineVisits,
  recordOfflineVisit,
  type RecentVisit,
} from '@/lib/offline-recent'
import { getIdentity } from '@/lib/identity'
import { reportClick } from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'
import { SiteFavicon } from '@/components/site-favicon'

export const RECENT_VISITS_COUNT = 6

/**
 * 纯展示：给定访问列表渲染一行；空清单返回 null（整行不存在）。
 *
 * 样式复用搜索面板「常用与最近常去」的迷你卡片：favicon + 标题，
 * 移动端两列、桌面六列，跟随首页响应式。点击走现有站点点击链路
 *（记快照 + 上报点击，与导航卡片、搜索面板同一路）。
 */
export function RecentVisitsRow({ visits }: { visits: RecentVisit[] }) {
  if (visits.length === 0) return null
  return (
    <section aria-label="最近访问" className="mb-6 sm:mb-8">
      <div className="flex items-center justify-between gap-2 mb-2 px-1">
        <h2 className="text-base sm:text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <span className="w-1.5 h-5 rounded-full bg-primary" />
          <History className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span>最近访问</span>
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
            className="flex items-center gap-2 p-2 rounded-xl border border-border/50 bg-background/60 hover:bg-accent/50 hover:border-primary/30 transition-all text-xs group"
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

/** 容器：挂载后读本机最近访问，SSR 首帧不渲染（见文件头）。 */
export function HomeRecentVisits() {
  const [visits, setVisits] = useState<RecentVisit[]>([])
  useEffect(() => {
    let alive = true
    readOfflineVisits(RECENT_VISITS_COUNT)
      .then((list) => {
        if (alive) setVisits(list)
      })
      .catch(() => {
        // 本地读取失败保持空行不渲染，不阻断首页
      })
    return () => {
      alive = false
    }
  }, [])
  return <RecentVisitsRow visits={visits} />
}
