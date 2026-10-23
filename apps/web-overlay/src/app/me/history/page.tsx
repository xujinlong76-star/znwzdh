'use client'

/**
 * 搜索历史管理 4.0（支持实时关键词检索、结果状态筛选、一键重搜、复制关键词与零结果无效记录批量清理）。
 *
 * 数据在终端用户的身份下（登录身份或本机匿名 id），分页用 offset + hasMore。
 * 删除单条不会重排其余记录；「清空」是显式两步确认，避免误触。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Footer } from '@/components/footer'
import { useToast } from '@/components/ui/use-toast'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import {
  clearCloudSearchHistory,
  deleteSearchHistoryItem,
  fetchSearchHistoryPage,
  type HubSearchHistoryItem,
} from '@/lib/navhub-api'
import { ArrowUpRight, Copy, Filter, History, Loader2, Search, Sparkles, Trash2 } from 'lucide-react'

type ViewState = 'loading' | 'ready' | 'error' | 'no-identity'
type ResultFilterMode = 'all' | 'with-results' | 'zero-results'

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
  // 身份就绪（N1）：登录/合并/退出后自动重取，不再出现「匿名历史 + 已登录头部」
  const identityReady = useIdentityReady()
  const [identity, setIdentity] = useState('')
  const [items, setItems] = useState<HubSearchHistoryItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextOffset, setNextOffset] = useState(0)
  const [state, setState] = useState<ViewState>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // 检索过滤与零结果批量清理状态
  const [keyword, setKeyword] = useState('')
  const [filterMode, setFilterMode] = useState<ResultFilterMode>('all')
  const [cleaningZero, setCleaningZero] = useState(false)

  const load = useCallback(async (id: string) => {
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
    // 等身份就绪再取数：登录/合并/退出都会改变 identity，从而自动重取
    if (!identityReady.ready) return
    void load(identityReady.identity ?? '')
  }, [load, identityReady.ready, identityReady.identity])

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

  const zeroResultItems = useMemo(
    () => items.filter((item) => item.resultCount === 0),
    [items],
  )

  const filteredItems = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return items.filter((item) => {
      if (filterMode === 'with-results' && item.resultCount <= 0) return false
      if (filterMode === 'zero-results' && item.resultCount !== 0) return false
      if (q && !item.query.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, keyword, filterMode])

  const handleCleanZeroResults = useCallback(async () => {
    if (!identity || zeroResultItems.length === 0 || cleaningZero) return
    setCleaningZero(true)
    let removedCount = 0
    const removedIds = new Set<number>()
    try {
      for (const item of zeroResultItems) {
        const ok = await deleteSearchHistoryItem(identity, item.id)
        if (ok) {
          removedCount += 1
          removedIds.add(item.id)
        }
      }
      if (removedIds.size > 0) {
        setItems((prev) => prev.filter((i) => !removedIds.has(i.id)))
      }
      toast({
        title: `已清理 ${removedCount} 条零结果无效搜索记录`,
        description: '保留了全部有效命中的搜索历史。',
      })
    } finally {
      setCleaningZero(false)
    }
  }, [cleaningZero, identity, toast, zeroResultItems])

  const handleCopyQuery = useCallback(
    async (queryText: string) => {
      try {
        await navigator.clipboard.writeText(queryText)
        toast({ title: '已复制搜索词', description: queryText })
      } catch {
        toast({ title: '复制失败', description: '当前浏览器环境不支持剪贴板写入', variant: 'destructive' })
      }
    },
    [toast],
  )

  return (
    <Container as="main" id="main-content" className="space-y-6 pt-3 pb-8 sm:pt-4 sm:pb-10">
      <CenterPageHeader
        title="搜索历史"
        icon={History}
        back={{ href: '/me', label: '用户中心' }}
        description="历史记录用于「最近搜索」快捷入口与个性化画像。支持关键词检索、一键再次搜索与零结果记录批量清理。"
        actions={
          items.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {zeroResultItems.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs sm:w-auto"
                  disabled={cleaningZero}
                  onClick={() => void handleCleanZeroResults()}
                >
                  {cleaningZero ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5 text-amber-500" />
                  )}
                  清理零结果记录 ({zeroResultItems.length})
                </Button>
              )}
              <Button
                variant={confirmClear ? 'destructive' : 'outline'}
                size="sm"
                className="w-full text-xs sm:w-auto"
                onClick={() => void clearAll()}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {confirmClear ? '确认清空全部' : '清空全部'}
              </Button>
            </div>
          ) : null
        }
      />

      {state === 'loading' && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl border border-border/70 bg-card/50" />
          ))}
        </div>
      )}

      {state === 'no-identity' && (
        <section className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-6 text-sm leading-relaxed text-muted-foreground">
          还没有可用的身份标识。先在首页搜索一次或登录账号，再回到这里管理历史。
        </section>
      )}

      {state === 'error' && (
        <section className="space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-6" role="alert">
          <p className="text-sm font-semibold">历史记录暂时取不到</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            云端暂时不可用，这不代表历史被清空——恢复后记录会原样回来。
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs sm:w-auto"
            onClick={() => void load(identityReady.identity ?? '')}
          >
            重试
          </Button>
        </section>
      )}

      {state === 'ready' && items.length === 0 && (
        <section className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-10 text-center">
          <Search className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm font-medium">还没有搜索记录</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            在首页搜索框里输入关键词后，这里会出现最近的历史。
          </p>
        </section>
      )}

      {state === 'ready' && items.length > 0 && (
        <>
          {/* 检索与状态筛选工具栏 */}
          <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                aria-label="筛选搜索历史"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="输入关键词筛选历史记录…"
                className="h-9 pl-8 text-xs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Filter className="h-3 w-3" aria-hidden />
                筛选：
              </span>
              {(
                [
                  ['all', `全部 (${items.length})`],
                  ['with-results', `有命中 (${items.length - zeroResultItems.length})`],
                  ['zero-results', `零结果 (${zeroResultItems.length})`],
                ] as const
              ).map(([mode, label]) => (
                <Button
                  key={mode}
                  size="sm"
                  variant={filterMode === mode ? 'default' : 'outline'}
                  className="h-7 text-[11px]"
                  onClick={() => setFilterMode(mode)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <section className="rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-center text-xs text-muted-foreground">
              当前筛选条件下没有匹配的搜索历史。
            </section>
          ) : (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card/60">
              {filteredItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/?q=${encodeURIComponent(item.query)}`}
                        className="line-clamp-2 break-words text-sm font-medium leading-snug text-foreground hover:text-primary hover:underline"
                        title={`再次搜索：${item.query}`}
                      >
                        {item.query}
                      </Link>
                      {item.resultCount === 0 && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                          无命中
                        </span>
                      )}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-muted-foreground">
                      <span>{formatTime(item.createdAt)}</span>
                      <span aria-hidden>·</span>
                      <span>{item.resultCount} 条结果</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      asChild
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                    >
                      <Link href={`/?q=${encodeURIComponent(item.query)}`} aria-label={`再次搜索 ${item.query}`}>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => void handleCopyQuery(item.query)}
                      aria-label={`复制搜索词 ${item.query}`}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      disabled={deletingId === item.id}
                      onClick={() => void removeItem(item.id)}
                      aria-label={`删除历史 ${item.query}`}
                    >
                      {deletingId === item.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {state === 'ready' && hasMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="w-full min-w-32 text-xs sm:w-auto"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            加载更多
          </Button>
        </div>
      )}

      <Footer />
    </Container>
  )
}
