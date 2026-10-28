'use client'

/**
 * 通知与送达面板（管理端）。
 *
 * 两块内容刻意分开：
 *   1. 管理员收件箱：任务终态失败、保留策略完成等系统告警（只经 scope=admin 接口读）；
 *   2. 投递记录：outbox 每个渠道一行。`deferred` 表示「服务器没配置该渠道发送器」——
 *      消息还留在队列里，既没送达也不是重试失败，不能显示成绿色成功。
 *
 * 只读 + 全部已读：不提供「立即重发」，避免绕过 outbox 的退避与幂等语义。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, CheckCheck, Inbox, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'

interface AdminNotification {
  id: string
  kind: string
  title: string
  body: string | null
  readAt: number | null
  createdAt: number
}

interface DeliveryItem {
  id: string
  identity: string
  channel: 'inapp' | 'email' | 'push'
  kind: string
  status: 'pending' | 'delivered' | 'deferred' | 'failed'
  attempts: number
  nextAttemptAt: number | null
  lastError: string | null
  createdAt: number
  deliveredAt: number | null
}

interface InboxResponse {
  items?: AdminNotification[]
  unread?: number
  hasMore?: boolean
  nextOffset?: number
}

interface DeliveriesResponse {
  items?: DeliveryItem[]
  hasMore?: boolean
  nextOffset?: number
}

type DeliveryStatus = DeliveryItem['status']
type StatusFilter = 'all' | DeliveryStatus

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待投递' },
  { value: 'delivered', label: '已送达' },
  { value: 'deferred', label: '未配置发送器' },
  { value: 'failed', label: '失败' },
]

const DELIVERY_META: Record<DeliveryStatus, { label: string; className: string }> = {
  pending: { label: '待投递', className: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  delivered: { label: '已送达', className: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' },
  deferred: { label: '未配置发送器', className: 'border-border bg-muted/40 text-muted-foreground' },
  failed: { label: '失败', className: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300' },
}

const PAGE_SIZE = 25

function formatTime(ts: number | null): string {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return '—'
  }
}

function errorMessage(err: unknown): string {
  return err ? describeDegrade(err).message : ''
}

export function NotificationDeliveryPanel() {
  const [inbox, setInbox] = useState<AdminNotification[]>([])
  const [inboxUnread, setInboxUnread] = useState(0)
  const [inboxHasMore, setInboxHasMore] = useState(false)
  const [inboxNext, setInboxNext] = useState(0)
  const [inboxLoading, setInboxLoading] = useState(true)
  const [inboxMore, setInboxMore] = useState(false)
  const [inboxError, setInboxError] = useState<unknown>(null)
  const [inboxActionError, setInboxActionError] = useState<string | null>(null)
  const [inboxBusy, setInboxBusy] = useState(false)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([])
  const [deliveriesHasMore, setDeliveriesHasMore] = useState(false)
  const [deliveriesNext, setDeliveriesNext] = useState(0)
  const [deliveriesLoading, setDeliveriesLoading] = useState(true)
  const [deliveriesMore, setDeliveriesMore] = useState(false)
  const [deliveriesError, setDeliveriesError] = useState<unknown>(null)

  // 每次请求带代数：切换筛选或连点刷新时，旧响应不得覆盖新结果。
  const inboxToken = useRef(0)
  const deliveryToken = useRef(0)

  const loadInbox = useCallback(async (offset: number, append: boolean) => {
    const token = ++inboxToken.current
    if (append) setInboxMore(true)
    else setInboxLoading(true)
    try {
      const data = await hubGet<InboxResponse>(`/api/hub/admin/notifications?limit=20&offset=${offset}`)
      if (token !== inboxToken.current) return
      const items = Array.isArray(data.items) ? data.items : []
      setInbox((prev) => (append ? [...prev, ...items] : items))
      setInboxUnread(Number.isFinite(data.unread) ? Number(data.unread) : 0)
      setInboxHasMore(Boolean(data.hasMore))
      setInboxNext(Number.isFinite(data.nextOffset) ? Number(data.nextOffset) : offset + items.length)
      setInboxError(null)
    } catch (err) {
      if (token !== inboxToken.current) return
      setInboxError(err)
    } finally {
      if (token === inboxToken.current) {
        setInboxLoading(false)
        setInboxMore(false)
      }
    }
  }, [])

  const loadDeliveries = useCallback(
    async (offset: number, append: boolean) => {
      const token = ++deliveryToken.current
      if (append) setDeliveriesMore(true)
      else setDeliveriesLoading(true)
      try {
        const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
        if (statusFilter !== 'all') query.set('status', statusFilter)
        const data = await hubGet<DeliveriesResponse>(`/api/hub/admin/notifications/deliveries?${query.toString()}`)
        if (token !== deliveryToken.current) return
        const items = Array.isArray(data.items) ? data.items : []
        setDeliveries((prev) => (append ? [...prev, ...items] : items))
        setDeliveriesHasMore(Boolean(data.hasMore))
        setDeliveriesNext(Number.isFinite(data.nextOffset) ? Number(data.nextOffset) : offset + items.length)
        setDeliveriesError(null)
      } catch (err) {
        if (token !== deliveryToken.current) return
        // 失败时保留上一次成功的数据，由 UI 明说「下面是旧数据」，不伪装成空队列。
        setDeliveriesError(err)
      } finally {
        if (token === deliveryToken.current) {
          setDeliveriesLoading(false)
          setDeliveriesMore(false)
        }
      }
    },
    [statusFilter],
  )

  useEffect(() => {
    // 放微任务：effect 同步段不触发 setState（react-hooks/set-state-in-effect）
    void Promise.resolve().then(() => loadInbox(0, false))
  }, [loadInbox])

  useEffect(() => {
    void Promise.resolve().then(() => {
      // 换筛选时旧列表属于另一个状态，必须先清掉；手动刷新失败才保留旧数据。
      setDeliveries([])
      setDeliveriesHasMore(false)
      setDeliveriesNext(0)
      setDeliveriesError(null)
      return loadDeliveries(0, false)
    })
  }, [loadDeliveries])

  const markAllRead = useCallback(async () => {
    setInboxBusy(true)
    setInboxActionError(null)
    try {
      await hubSend('/api/hub/admin/notifications/read-all', 'POST', {})
      await loadInbox(0, false)
    } catch (err) {
      setInboxActionError(errorMessage(err) || '操作失败，请稍后重试')
    } finally {
      setInboxBusy(false)
    }
  }, [loadInbox])

  const inboxDegrade = inboxError ? errorMessage(inboxError) : ''
  const deliveryDegrade = deliveriesError ? errorMessage(deliveriesError) : ''

  return (
    <section className="grid grid-cols-1 gap-5" aria-label="通知与送达">
      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-primary" />
              管理员收件箱
              {inboxUnread > 0 && (
                <Badge variant="outline" className="text-[10px] tabular-nums">
                  {inboxUnread} 条未读
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={inboxLoading}
                onClick={() => void loadInbox(0, false)}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${inboxLoading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={inboxBusy || inboxUnread === 0}
                title={inboxUnread === 0 ? '没有未读告警' : undefined}
                onClick={() => void markAllRead()}
              >
                <CheckCheck className="w-3.5 h-3.5 mr-1" />
                {inboxBusy ? '处理中…' : '全部已读'}
              </Button>
            </div>
          </div>
          <CardDescription className="text-xs">
            任务停止重试、保留策略执行完成等系统告警。只有管理员接口能读取这个收件箱，普通用户看不到。
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-1 space-y-3">
          {inboxActionError && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              全部已读失败：{inboxActionError}
            </div>
          )}

          {inboxDegrade && inbox.length > 0 && (
            <div role="status" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              本次刷新失败，下面是上一次成功获取的告警。{inboxDegrade}
            </div>
          )}

          {inboxLoading && inbox.length === 0 ? (
            <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">正在加载管理员收件箱…</p>
          ) : inboxError && inbox.length === 0 ? (
            <div role="status" className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive space-y-3">
              <p>没能取到管理员收件箱。{inboxDegrade}</p>
              <Button variant="outline" size="sm" onClick={() => void loadInbox(0, false)}>
                重试
              </Button>
            </div>
          ) : inbox.length === 0 ? (
            <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
              暂无管理员告警。任务失败或保留策略完成后，提醒会出现在这里。
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border overflow-hidden rounded-md border">
                {inbox.map((n) => (
                  <li key={n.id} className={`px-3 py-2.5 text-xs space-y-1 ${n.readAt === null ? 'bg-primary/5' : ''}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      {n.readAt === null && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />}
                      <span className={n.readAt === null ? 'font-semibold' : 'font-medium text-muted-foreground'}>{n.title}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">{formatTime(n.createdAt)}</span>
                    </div>
                    {n.body && <p className="break-words text-[11px] leading-relaxed text-muted-foreground">{n.body}</p>}
                    <p className="text-[10px] font-mono text-muted-foreground/70">{n.kind}</p>
                  </li>
                ))}
              </ul>
              {inboxHasMore && (
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={inboxMore} onClick={() => void loadInbox(inboxNext, true)}>
                    {inboxMore ? '加载中…' : '加载更多'}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Inbox className="w-4 h-4 text-primary" />
              投递记录（outbox）
            </CardTitle>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground" htmlFor="delivery-status-filter">
                状态
              </label>
              <select
                id="delivery-status-filter"
                className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              >
                {STATUS_FILTERS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={deliveriesLoading}
                onClick={() => void loadDeliveries(0, false)}
              >
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${deliveriesLoading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
            </div>
          </div>
          <CardDescription className="text-xs">
            站内信写入即完成；邮件/推送在未配置发送器时标为 <span className="font-medium text-foreground">deferred</span>
            ——消息仍在队列里，但没有发送，也不算投递成功。
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-1 space-y-3">
          {deliveryDegrade && deliveries.length > 0 && (
            <div role="status" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              本次刷新失败，下面是上一次成功获取的记录。{deliveryDegrade}
            </div>
          )}

          {deliveriesLoading && deliveries.length === 0 ? (
            <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">正在加载投递记录…</p>
          ) : deliveryDegrade && deliveries.length === 0 ? (
            <div role="status" className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive space-y-3">
              <p className="flex items-center justify-center gap-1.5">
                <AlertTriangle className="w-4 h-4" aria-hidden />
                没能取到投递记录。{deliveryDegrade}
              </p>
              <Button variant="outline" size="sm" onClick={() => void loadDeliveries(0, false)}>
                重试
              </Button>
            </div>
          ) : deliveries.length === 0 ? (
            <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
              {statusFilter === 'all' ? '投递队列为空。' : `没有「${DELIVERY_META[statusFilter].label}」状态的投递记录。`}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-border overflow-hidden rounded-md border">
                {deliveries.map((d) => {
                  const meta = DELIVERY_META[d.status] ?? { label: d.status, className: '' }
                  return (
                    <li key={d.id} className="px-3 py-2.5 text-xs space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={`text-[10px] ${meta.className}`}>
                          {meta.label}
                        </Badge>
                        <span className="font-mono text-[11px] text-muted-foreground">{d.channel}</span>
                        <span className="font-medium break-all">{d.kind}</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{formatTime(d.createdAt)}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        <span>尝试 {d.attempts} / 3</span>
                        {d.status === 'pending' && d.nextAttemptAt != null && <span>下次重试 {formatTime(d.nextAttemptAt)}</span>}
                        {d.deliveredAt != null && <span>送达于 {formatTime(d.deliveredAt)}</span>}
                        <span className="break-all">收件人 {d.identity}</span>
                      </div>
                      {d.lastError && (
                        <p className="break-words text-[11px] text-rose-600 dark:text-rose-400">最近错误：{d.lastError}</p>
                      )}
                      {d.status === 'deferred' && (
                        <p className="text-[11px] text-muted-foreground">未配置该渠道发送器：消息留在队列中，未发送，也不是失败重试。</p>
                      )}
                    </li>
                  )
                })}
              </ul>
              {deliveriesHasMore && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={deliveriesMore}
                    onClick={() => void loadDeliveries(deliveriesNext, true)}
                  >
                    {deliveriesMore ? '加载中…' : '加载更多'}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
