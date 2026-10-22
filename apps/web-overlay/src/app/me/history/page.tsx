'use client'

/**
 * 搜索历史管理。
 *
 * 数据在终端用户的身份下（登录身份或本机匿名 id），分页用 offset + hasMore。
 * 删除单条不会重排其余记录；「清空」是显式两步确认，避免误触。
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Footer } from '@/components/footer'
import { useToast } from '@/components/ui/use-toast'
import { getIdentity } from '@/lib/identity'
import {
  clearCloudSearchHistory,
  deleteSearchHistoryItem,
  fetchSearchHistoryPage,
  type HubSearchHistoryItem,
} from '@/lib/navhub-api'
import { ArrowLeft, History, Loader2, Search, Trash2 } from 'lucide-react'

type ViewState = 'loading' | 'ready' | 'error' | 'no-identity'

const PAGE_SIZE = 20

function formatTime(ts: number): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}

export default function SearchHistoryPage() {
  const { toast } = useToast()
  const [identity, setIdentity] = useState('')
  const [items, setItems] = useState<HubSearchHistoryItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [state, setState] = useState<ViewState>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    const id = getIdentity()
    setIdentity(id)
    if (!id) {
      setState('no-identity')
      return
    }
    setState('loading')
    // 降级 ≠ 空：取数失败必须落 error（带重试），不能渲染成「还没有搜索记录」——
    // 后者会让用户以为历史被清空。fetchSearchHistoryPage 的 degrade 回调正是为此存在。
    let degraded = false
    const page = await fetchSearchHistoryPage(id, { limit: PAGE_SIZE, offset: 0 }, () => {
      degraded = true
    })
    if (degraded) {
      setState('error')
      return
    }
    setItems(page.items)
    setHasMore(page.hasMore)
    setNextOffset(page.nextOffset)
    setState('ready')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const loadMore = useCallback(async () => {
    if (!identity || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await fetchSearchHistoryPage(identity, { limit: PAGE_SIZE, offset: nextOffset })
      setItems((prev) => [...prev, ...page.items])
      setHasMore(page.hasMore)
      setNextOffset(page.nextOffset)
    } finally {
      setLoadingMore(false)
    }
  }, [identity, loadingMore, nextOffset])

  const removeItem = useCallback(async (id: number) => {
    if (!identity) return
    setDeletingId(id)
    const ok = await deleteSearchHistoryItem(identity, id)
    setDeletingId(null)
    if (!ok) {
      toast({ title: '删除失败', description: '云端暂不可用，请稍后重试', variant: 'destructive' })
      return
    }
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [identity, toast])

  const clearAll = useCallback(async () => {
    if (!identity) return
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    const ok = await clearCloudSearchHistory(identity)
    setConfirmClear(false)
    if (!ok) {
      toast({ title: '清空失败', description: '云端暂不可用，请稍后重试', variant: 'destructive' })
      return
    }
    setItems([])
    setHasMore(false)
    setNextOffset(0)
    toast({ title: '搜索历史已清空' })
  }, [confirmClear, identity, toast])

  return (
    <Container as="main" id="main-content" className="py-4 sm:py-8 space-y-5">
      <section className="rounded-2xl border border-border/70 glass-surface market-hero p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
              <Link href="/me">
                <ArrowLeft className="mr-1 h-4 w-4" />
                用户中心
              </Link>
            </Button>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4 text-primary" />
              搜索历史
            </div>
          </div>
          {items.length > 0 && (
            <Button
              variant={confirmClear ? 'destructive' : 'outline'}
              size="sm"
              className="text-xs"
              onClick={() => void clearAll()}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {confirmClear ? '确认清空全部' : '清空全部'}
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
          历史记录只用于「最近搜索」快捷入口与个性化画像。删除后不影响收藏与账号。
        </p>
      </section>

      {state === 'loading' && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl border border-border/70 bg-card/50" />
          ))}
        </div>
      )}

      {state === 'no-identity' && (
        <section className="rounded-xl border border-dashed border-border/70 bg-card/40 p-6 text-sm text-muted-foreground">
          还没有可用的身份标识。先在首页搜索一次或登录账号，再回到这里管理历史。
        </section>
      )}

      {state === 'error' && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 space-y-3" role="alert">
          <p className="text-sm font-semibold">历史记录暂时取不到</p>
          <p className="text-xs text-muted-foreground">
            云端暂时不可用，这不代表历史被清空——恢复后记录会原样回来。
          </p>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => void load()}>
            重试
          </Button>
        </section>
      )}

      {state === 'ready' && items.length === 0 && (
        <section className="rounded-xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
          <Search className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">还没有搜索记录</p>
          <p className="mt-1 text-xs text-muted-foreground">在首页搜索框里输入关键词后，这里会出现最近的历史。</p>
        </section>
      )}

      {state === 'ready' && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.query}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatTime(item.createdAt)} · {item.resultCount} 条结果
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 px-2 text-muted-foreground hover:text-destructive"
                disabled={deletingId === item.id}
                onClick={() => void removeItem(item.id)}
                aria-label={`删除历史 ${item.query}`}
              >
                {deletingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {state === 'ready' && hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" className="text-xs" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            加载更多
          </Button>
        </div>
      )}

      <Footer />
    </Container>
  )
}
