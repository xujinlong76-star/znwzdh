"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { History, Trash2 } from "lucide-react"
import { SiteFavicon } from "@/components/site-favicon"
import { clearOfflineVisits, readOfflineVisits, type RecentVisit } from "@/lib/offline-recent"
import { safeHref } from "@/lib/safe-url"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"

export function OfflineRecentList() {
  const [visits, setVisits] = useState<RecentVisit[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void readOfflineVisits(50).then((rows) => {
      if (!alive) return
      setVisits(rows)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const clear = async () => {
    await clearOfflineVisits()
    setVisits([])
  }

  if (loading) {
    return (
      <div aria-busy="true" aria-live="polite" aria-label="正在读取本地记录" className="mt-6 space-y-3">
        <span className="sr-only">正在读取本地记录…</span>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-3 animate-pulse"
          >
            <div className="h-9 w-9 rounded-lg bg-muted shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/3 rounded bg-muted" />
              <div className="h-3 w-2/3 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (visits.length === 0) {
    return (
      <div className="mt-6">
        <EmptyState
          icon={History}
          iconTone="muted"
          title="还没有离线记录"
          description="联网时打开任意站点，这里就会留下可离线查看的入口；记录只保存在本机，可随时清空。"
          action={
            <Button asChild size="sm" variant="outline" className="text-xs">
              <Link href="/">去主页浏览站点</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">共 {visits.length} 条 · 只保存在本机</p>
        <button onClick={clear} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Trash2 className="h-3.5 w-3.5" />
          清空
        </button>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {visits.map((v) => (
          <li key={v.id}>
            <a href={safeHref(v.href)} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-border/70 glass-surface p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-muted/60 p-1">
                <SiteFavicon
                  title={v.title}
                  url={v.href}
                  icon={v.icon ?? undefined}
                  className="h-full w-full rounded object-contain"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{v.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{v.href}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
