'use client'

/**
 * 管理端：站点纠错复核（升级第 10 条）。
 *
 * 复用投稿审核页模式：状态筛选 + 列表 + 流转按钮。
 * 上报绝不直接改数据——复核后管理员再去站点管理里手动改。
 *
 * 流转：open → in_progress → resolved / rejected。
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Flag } from 'lucide-react'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'

type ReportStatus = 'open' | 'in_progress' | 'resolved' | 'rejected'

interface SiteReportItem {
  id: string
  siteId: string
  siteTitle: string | null
  siteUrl: string | null
  kinds: string[]
  kindLabels: string[]
  detail: string
  contact: string | null
  source: string
  status: string
  createdAt: number
}

interface ReportsResponse {
  items: SiteReportItem[]
  total: number
  limit: number
  offset: number
}

const STATUS_TABS: Array<{ key: ReportStatus | 'all'; label: string }> = [
  { key: 'open', label: '待处理' },
  { key: 'in_progress', label: '处理中' },
  { key: 'resolved', label: '已处理' },
  { key: 'rejected', label: '已驳回' },
  { key: 'all', label: '全部' },
]

const STATUS_LABEL: Record<ReportStatus, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已处理',
  rejected: '已驳回',
}

const PAGE_SIZE = 50

export default function SiteReportsAdminPage() {
  const [status, setStatus] = useState<ReportStatus | 'all'>('open')
  const [items, setItems] = useState<SiteReportItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const load = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ status, limit: String(PAGE_SIZE) })
      if (offset > 0) params.set('offset', String(offset))
      // 必须自己兜住失败：中枢挂掉时 setLoading(false) 永远不会执行，
      // 页面就永远停在「加载中…」（与审计页同款教训）。
      void (async () => {
        try {
          const d = await hubGet<ReportsResponse>('/api/hub/admin/site-reports?' + params.toString())
          setItems((prev) => (offset === 0 ? d.items : [...prev, ...d.items]))
          setTotal(d.total)
          setLoadError(null)
        } catch (error) {
          setLoadError(error)
        } finally {
          setLoading(false)
        }
      })()
    },
    [status],
  )

  useEffect(() => {
    setLoading(true)
    setItems([])
    load(0)
  }, [load])

  const retry = () => {
    setLoading(true)
    setItems([])
    load(0)
  }

  const transition = async (id: string, next: ReportStatus) => {
    if (updatingId) return
    setUpdatingId(id)
    try {
      await hubSend(`/api/hub/admin/site-reports/${encodeURIComponent(id)}`, 'PATCH', { status: next })
      setItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, status: next } : item)),
      )
    } catch (error) {
      setLoadError(error)
    } finally {
      setUpdatingId(null)
    }
  }

  const notice = loadError === null ? null : describeDegrade(loadError)
  const hasMore = items.length < total

  // A-2：标准 ARIA Tabs 键盘交互。照抄 plugin-detail-view.tsx:143-170
  // 骨架 + A-1 的 disabled 跳过（全量列表保下标映射，步进跳 disabled；
  // 五 tab 当前均无 disabled，step() 是防后人加）。无 .click()、无 URL 同步。
  const STATUS_KEYS = STATUS_TABS.map((t) => t.key)
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.getAttribute('role') !== 'tab') return
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    )
    const index = tabs.indexOf(target as HTMLButtonElement)
    if (index < 0) return

    const enabled = tabs.map((t) => !t.disabled)
    if (!enabled.some(Boolean)) return
    const step = (from: number, dir: 1 | -1): number => {
      let i = from
      for (let n = 0; n < tabs.length; n++) {
        i = (i + dir + tabs.length) % tabs.length
        if (enabled[i]) return i
      }
      return from
    }
    const firstEnabled = enabled.findIndex(Boolean)
    const lastEnabled = enabled.lastIndexOf(true)

    let next = index
    if (event.key === 'ArrowRight') next = step(index, 1)
    else if (event.key === 'ArrowLeft') next = step(index, -1)
    else if (event.key === 'Home') next = firstEnabled
    else if (event.key === 'End') next = lastEnabled
    else return

    event.preventDefault()
    setStatus(STATUS_KEYS[next])
    tabs[next]?.focus()
  }

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto">
      <h1 className="text-xl font-bold mb-2">站点纠错</h1>
      <p className="text-xs text-muted-foreground mb-4">
        用户在站点详情页上报的问题。复核后请到站点管理里手动修正——上报本身不会改任何数据。
      </p>

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="按状态筛选" onKeyDown={handleTabKeyDown}>
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={status === tab.key}
            tabIndex={status === tab.key ? 0 : -1}
            variant={status === tab.key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatus(tab.key)}
            className="cursor-pointer"
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {notice && <HubDegradedNotice notice={notice} onRetry={retry} />}

      {loading ? (
        <p className="text-sm text-muted-foreground py-10 text-center">加载中…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Flag}
          iconTone="muted"
          title="暂无上报"
          description="该状态下还没有用户上报，等有人在详情页点「信息有误」就会出现在这里。"
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-border/70 bg-card p-4 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  {item.siteTitle ? (
                    <Link
                      href={`/site/${encodeURIComponent(item.siteId)}`}
                      className="font-semibold text-sm hover:text-primary break-all"
                    >
                      {item.siteTitle}
                    </Link>
                  ) : (
                    <span className="font-semibold text-sm text-muted-foreground">
                      站点已被清理（{item.siteId}）
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {item.source === 'search' ? '来自搜索纠错' : '来自站点详情页'}
                    {' · '}
                    {new Date(item.createdAt).toLocaleString('zh-CN')}
                  </p>
                </div>
                <span className="text-xs rounded-full border border-border/70 px-2.5 py-0.5">
                  {STATUS_LABEL[item.status as ReportStatus] ?? item.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.kindLabels.map((label) => (
                  <span
                    key={label}
                    className="text-xs px-2 py-0.5 rounded-full bg-muted/80 border border-border/50"
                  >
                    {label}
                  </span>
                ))}
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{item.detail}</p>
              {item.contact && (
                <p className="text-xs text-muted-foreground">联系方式：{item.contact}</p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {item.status === 'open' && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={updatingId === item.id}
                    onClick={() => transition(item.id, 'in_progress')}
                    className="cursor-pointer"
                  >
                    开始处理
                  </Button>
                )}
                {item.status === 'in_progress' && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={updatingId === item.id}
                    onClick={() => transition(item.id, 'resolved')}
                    className="cursor-pointer"
                  >
                    标记已处理
                  </Button>
                )}
                {(item.status === 'open' || item.status === 'in_progress') && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={updatingId === item.id}
                    onClick={() => transition(item.id, 'rejected')}
                    className="cursor-pointer"
                  >
                    驳回
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {hasMore && !loading && (
        <div className="mt-4 text-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => load(items.length)}
            className="cursor-pointer"
          >
            加载更多（已显示 {items.length} / {total}）
          </Button>
        </div>
      )}
    </div>
  )
}
