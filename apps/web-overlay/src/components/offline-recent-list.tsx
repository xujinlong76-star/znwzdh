"use client"

import { useEffect, useState } from "react"
import { History, Trash2 } from "lucide-react"
import { clearOfflineVisits, readOfflineVisits, type RecentVisit } from "@/lib/offline-recent"
import { safeHref } from "@/lib/safe-url"

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
    return <p className="mt-6 text-sm text-muted-foreground">正在读取本地记录…</p>
  }

  if (visits.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
        还没有本地记录。联网时打开任意站点，这里就会留下可离线查看的入口。
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
            <a href={safeHref(v.href)} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border border-border/70 p-3 hover:bg-accent">
              {v.icon ? <img src={v.icon} alt="" className="h-8 w-8 rounded" /> : <History className="h-5 w-5 text-muted-foreground" />}
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
