'use client'

/**
 * 站内通知面板（T13）：面向用户的轻量消息（同步失败、备份超期提醒）。
 * 走 BFF /api/me/notifications（会话派生身份，匿名无通知——通知都挂在登录身份上）。
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Footer } from '@/components/footer'
import { useToast } from '@/components/ui/use-toast'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { SectionState } from '@/components/user-center/section-state'
import { Bell, CheckCheck } from 'lucide-react'

interface NotificationItem {
  id: string
  kind: string
  title: string
  body: string | null
  readAt: number | null
  createdAt: number
}

type ViewState = 'loading' | 'ready' | 'error'

const PAGE_SIZE = 20

function formatTime(ts: number): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}

export default function NotificationsPage() {
  const { toast } = useToast()
  const [state, setState] = useState<ViewState>('loading')
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (offset: number) => {
    if (offset === 0) setState('loading')
    try {
      const res = await fetch('/api/me/notifications?limit=' + PAGE_SIZE + '&offset=' + offset, { cache: 'no-store' })
      if (!res.ok) {
        if (offset === 0) setState('error')
        return
      }
      const data = (await res.json()) as {
        items?: NotificationItem[]
        unread?: number
        hasMore?: boolean
        nextOffset?: number
      }
      setItems((prev) => (offset === 0 ? (data.items ?? []) : [...prev, ...(data.items ?? [])]))
      setUnread(Number(data.unread ?? 0))
      setHasMore(Boolean(data.hasMore))
      setNextOffset(Number(data.nextOffset ?? offset))
      setState('ready')
    } catch {
      if (offset === 0) setState('error')
    }
  }, [])

  useEffect(() => {
    void load(0)
  }, [load])

  const markRead = useCallback(
    async (id: string) => {
      try {
        await fetch('/api/me/notifications/' + id + '/read', { method: 'POST', cache: 'no-store' })
        setItems((prev) => prev.map((n) => (n.id === id && n.readAt === null ? { ...n, readAt: Date.now() } : n)))
        setUnread((u) => Math.max(0, u - 1))
      } catch {
        // 已读标记失败不打断浏览：下次进页面未读数会自动对齐
      }
    },
    [],
  )

  const markAll = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/me/notifications/read-all', { method: 'POST', cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as { marked?: number }
      if (!res.ok) {
        toast({ title: '操作失败', description: '云端暂不可用，请稍后重试', variant: 'destructive' })
        return
      }
      setItems((prev) => prev.map((n) => (n.readAt === null ? { ...n, readAt: Date.now() } : n)))
      setUnread(0)
      toast({ title: `已把 ${data.marked ?? 0} 条通知标为已读` })
    } finally {
      setBusy(false)
    }
  }, [toast])

  return (
    <Container as="main" id="main-content" className="space-y-5 pb-8 pt-3 sm:space-y-6 sm:pb-10 sm:pt-4">
      <CenterPageHeader
        title="通知"
        icon={Bell}
        back={{ href: '/me', label: '用户中心' }}
        description="同步失败、备份提醒等站内消息。通知只发给你自己的身份，不含营销内容。"
        actions={
          unread > 0 ? (
            <Button variant="outline" size="sm" className="w-full text-xs sm:w-auto" disabled={busy} onClick={() => void markAll()}>
              <CheckCheck className="mr-1.5 h-3.5 w-3.5" />
              全部已读 ({unread})
            </Button>
          ) : null
        }
      />

      {state === 'loading' && <SectionState variant="loading" rows={4} loadingLabel="正在加载通知" />}

      {state === 'error' && (
        <SectionState
          variant="error"
          title="通知暂时取不到"
          description="云端暂时不可用，稍后重试即可——这不代表有未读的重要消息被漏掉。"
          onRetry={() => void load(0)}
        />
      )}

      {state === 'ready' && items.length === 0 && (
        <SectionState
          variant="empty"
          icon={Bell}
          title="还没有通知"
          description="出现同步失败、备份超期等情况时，这里会收到提醒。"
        />
      )}

      {state === 'ready' && items.length > 0 && (
        <>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card/60">
            {items.map((n) => (
              <li key={n.id} className={n.readAt === null ? 'bg-primary/5' : ''}>
                <button
                  type="button"
                  onClick={() => void markRead(n.id)}
                  className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/30 disabled:cursor-default"
                  disabled={n.readAt !== null}
                  aria-label={n.readAt === null ? `标记已读：${n.title}` : n.title}
                >
                  <span className="flex items-center gap-2">
                    {n.readAt === null && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />}
                    <span className={`text-xs ${n.readAt === null ? 'font-semibold' : 'font-medium text-muted-foreground'}`}>
                      {n.title}
                    </span>
                  </span>
                  {n.body && <span className="block text-[11px] leading-relaxed text-muted-foreground">{n.body}</span>}
                  <span className="block text-[11px] tabular-nums text-muted-foreground">{formatTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                disabled={loadingMore}
                onClick={() => {
                  setLoadingMore(true)
                  void load(nextOffset).finally(() => setLoadingMore(false))
                }}
              >
                加载更多
              </Button>
            </div>
          )}
          <p className="text-center text-[11px] text-muted-foreground">
            通知保留在服务端，随注销一并删除；<Link href="/me/data" className="underline underline-offset-2">数据与隐私</Link> 页可管理你的全部数据。
          </p>
        </>
      )}

      <Footer />
    </Container>
  )
}
