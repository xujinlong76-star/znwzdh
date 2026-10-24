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
import { copyText } from '@/lib/clipboard'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { SectionState } from '@/components/user-center/section-state'
import { fetchVisitsPage, clearProfileSignals, type HubVisitItem } from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'
import {
  batchCleanZeroResultSearchHistory,
  clearCloudSearchHistory,
  deleteSearchHistoryItem,
  fetchSearchHistoryPage,
  type HubSearchHistoryItem,
} from '@/lib/navhub-api'
import { ArrowUpRight, Copy, Filter, History, Loader2, Search, Sparkles, Trash2 } from 'lucide-react'

type ViewState = 'loading' | 'ready' | 'error' | 'no-identity'
type ResultFilterMode = 'all' | 'with-results' | 'zero-results'

const PAGE_SIZE = 20

/** 离线快照键（T24）：只存最近一页（≤20 条）+ 时间戳，会话级过期不设、随新数据覆盖 */
const HISTORY_SNAPSHOT_KEY = 'navhub.search_history.cache.v1'
const HISTORY_SNAPSHOT_MAX = 20

function writeHistorySnapshot(items: HubSearchHistoryItem[]): void {
  try {
    window.localStorage.setItem(
      HISTORY_SNAPSHOT_KEY,
      JSON.stringify({ at: Date.now(), items: items.slice(0, HISTORY_SNAPSHOT_MAX) }),
    )
  } catch {
    // 隐私模式写不进：快照是尽力而为的增强，不构成功能承诺
  }
}

function readHistorySnapshot(): { at: number; items: HubSearchHistoryItem[] } | null {
  try {
    const raw = window.localStorage.getItem(HISTORY_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: number; items?: HubSearchHistoryItem[] }
    if (!Array.isArray(parsed.items) || typeof parsed.at !== 'number') return null
    return { at: parsed.at, items: parsed.items }
  } catch {
    return null
  }
}

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

  /* ---------------- 访问历史 tab（T23） ---------------- */
  const [tab, setTab] = useState<'searches' | 'visits'>('searches')
  const [visitState, setVisitState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [visits, setVisits] = useState<HubVisitItem[]>([])
  const [visitTotal, setVisitTotal] = useState(0)
  const [visitHasMore, setVisitHasMore] = useState(false)
  const [visitNextOffset, setVisitNextOffset] = useState(0)
  const [visitBusy, setVisitBusy] = useState(false)
  const [confirmClearVisits, setConfirmClearVisits] = useState(false)
  /** 非空 = 当前展示的是离线快照（时间戳用于如实标注） */
  const [offlineSnapshotAt, setOfflineSnapshotAt] = useState<number | null>(null)

  const load = useCallback(async (id: string) => {
    setIdentity(id)
    if (!id) {
      setState('no-identity')
      return
    }
    setState('loading')
    setOfflineSnapshotAt(null)
    // 降级 ≠ 空：取数失败必须落 error（带重试），不能渲染成「还没有搜索记录」——
    // 后者会让用户以为历史被清空。fetchSearchHistoryPage 的 degrade 回调正是为此存在。
    let degraded = false
    const page = await fetchSearchHistoryPage(id, { limit: PAGE_SIZE, offset: 0 }, () => {
      degraded = true
    })
    if (degraded) {
      // 离线快照（T24）：本机有最近的首页快照时展示它，并明确标注「这是快照」——
      // 有标注的旧数据好过一行错误；没有快照才落纯 error 态。
      const snapshot = readHistorySnapshot()
      if (snapshot) {
        setItems(snapshot.items)
        setHasMore(false)
        setNextOffset(0)
        setOfflineSnapshotAt(snapshot.at)
        setState('ready')
      } else {
        setState('error')
      }
      return
    }
    setItems(page.items)
    setHasMore(page.hasMore)
    setNextOffset(page.nextOffset)
    setState('ready')
    writeHistorySnapshot(page.items)
  }, [])

  useEffect(() => {
    // 等身份就绪再取数：登录/合并/退出都会改变 identity，从而自动重取。
    // 取数放微任务：effect 同步段不触碰 setState（set-state-in-effect）
    if (!identityReady.ready) return
    void Promise.resolve().then(() => load(identityReady.identity ?? ''))
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
    if (!identity || offlineSnapshotAt) return
    setDeletingId(id)
    const ok = await deleteSearchHistoryItem(identity, id)
    setDeletingId(null)
    if (!ok) {
      toast({ title: '删除失败', description: '云端暂不可用，请稍后重试', variant: 'destructive' })
      return
    }
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [identity, offlineSnapshotAt, toast])

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
    try {
      // T4：服务端一次往返完成筛选删除（此前是逐条 DELETE 串行循环）
      const removed = await batchCleanZeroResultSearchHistory(identity)
      if (removed === null) {
        toast({
          title: '清理失败',
          description: '云端暂不可用，请稍后重试。',
          variant: 'destructive',
        })
        return
      }
      // 已加载列表里的零结果条目按服务端口径移除（服务端删的可能比当前页更多）
      setItems((prev) => prev.filter((i) => i.resultCount !== 0))
      toast({
        title: `已清理 ${removed} 条零结果无效搜索记录`,
        description: '保留了全部有效命中的搜索历史。',
      })
    } finally {
      setCleaningZero(false)
    }
  }, [cleaningZero, identity, toast, zeroResultItems.length])

  const loadVisits = useCallback(async (offset: number) => {
    if (visitBusy) return
    if (offset === 0) setVisitState('loading')
    setVisitBusy(true)
    let degraded = false
    const page = await fetchVisitsPage({ limit: 20, offset }, () => {
      degraded = true
    })
    setVisitBusy(false)
    if (degraded || page === null) {
      // 降级 ≠ 空：首次加载失败落 error（带重试），加载更多失败保持原列表
      if (offset === 0) setVisitState('error')
      else setVisitHasMore(true)
      return
    }
    setVisits((prev) => (offset === 0 ? page.items : [...prev, ...page.items]))
    setVisitTotal(page.total)
    setVisitHasMore(page.hasMore)
    setVisitNextOffset(page.nextOffset)
    setVisitState('ready')
  }, [visitBusy])

  // 切到访问 tab 时首次加载；身份变化后回 idle（下次切入按新身份取）
  useEffect(() => {
    if (tab !== 'visits') return
    // 取数放微任务：effect 同步段不触碰 setState（set-state-in-effect）
    if (visitState === 'idle') void Promise.resolve().then(() => loadVisits(0))
  }, [tab, visitState, loadVisits])

  const clearVisits = useCallback(async () => {
    if (!identity || visitBusy) return
    setVisitBusy(true)
    const ok = await clearProfileSignals(identity, 'click')
    setVisitBusy(false)
    setConfirmClearVisits(false)
    if (!ok) {
      toast({ title: '清空访问记录失败', description: '云端暂不可用，请稍后重试', variant: 'destructive' })
      return
    }
    setVisits([])
    setVisitTotal(0)
    setVisitHasMore(false)
    setVisitNextOffset(0)
    toast({ title: '访问记录已清空', description: '画像已按剩余行为重建；收藏与搜索历史不受影响。' })
  }, [identity, toast, visitBusy])

  const handleCopyQuery = useCallback(
    async (queryText: string) => {
      const res = await copyText(queryText)
      if (res.ok) {
        toast({ title: '已复制搜索词', description: queryText })
      } else {
        toast({
          title: '复制失败',
          description: res.reason ?? '当前浏览器环境不支持剪贴板写入',
          variant: 'destructive',
        })
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

      {/* 双 tab（T23）：搜索历史 / 访问历史。访问历史来自服务端 click 流水，
          与搜索历史一样都是「用户自己的行为数据」。 */}
      <div role="tablist" aria-label="历史类型" className="flex w-full gap-1.5 sm:w-auto">
        {(
          [
            ['searches', '搜索历史'],
            ['visits', '访问历史'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
              tab === key
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {state === 'loading' && <SectionState variant="loading" rows={4} loadingLabel="正在加载搜索历史" />}

      {tab === 'searches' && offlineSnapshotAt && state === 'ready' && (
        <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
          云端暂时取不到，正在展示本机离线快照（截至 {new Date(offlineSnapshotAt).toLocaleString('zh-CN', { hour12: false })}）。这不是实时数据，联网后重试可获取最新记录。
        </p>
      )}

      {/* 匿名身份也有云端历史（绑定本浏览器身份）：如实说明归属，避免「这是谁的记录」的疑惑 */}
      {state === 'ready' && identity.startsWith('anon-') && (
        <p className="rounded-xl border border-dashed border-border/70 bg-card/50 px-3.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
          当前为匿名身份：这些历史绑定本浏览器的匿名标识，只用于「最近搜索」与画像；登录后会自动合并到账号。
        </p>
      )}

      {tab === 'visits' && state === 'ready' && (
        <>
          {visitState === 'loading' && <SectionState variant="loading" rows={4} loadingLabel="正在加载访问历史" />}

          {visitState === 'error' && (
            <SectionState
              variant="error"
              title="访问记录暂时取不到"
              description="云端暂时不可用，这不代表记录被清空——恢复后会原样回来。"
              onRetry={() => void loadVisits(0)}
            />
          )}

          {visitState === 'ready' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  共 {visitTotal} 条站点访问记录（用于画像与「最近访问」，不含搜索词）。
                </p>
                {visits.length > 0 && (
                  <Button
                    variant={confirmClearVisits ? 'destructive' : 'outline'}
                    size="sm"
                    className="w-full text-xs sm:w-auto"
                    disabled={visitBusy}
                    onClick={() => void clearVisits()}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {confirmClearVisits ? '确认清空访问记录' : '清空访问记录'}
                  </Button>
                )}
              </div>

              {visits.length === 0 ? (
                <SectionState
                  variant="empty"
                  icon={History}
                  title="还没有站点访问记录"
                  description="浏览站点后这里会按时间列出最近访问（只记录站点点击，不含搜索内容）。"
                />
              ) : (
                <>
                  <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card/60">
                    {visits.map((v) => (
                      <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          {v.site ? (
                            <a
                              href={safeHref(v.site.url)}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="block truncate text-xs font-medium hover:text-primary hover:underline"
                              title={v.site.title}
                            >
                              {v.site.title}
                            </a>
                          ) : (
                            <span className="block truncate text-xs font-medium text-muted-foreground" title="站点已不在库">
                              （站点已不在中枢）
                            </span>
                          )}
                          {v.site?.url && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{v.site.url}</p>}
                        </div>
                        <time
                          dateTime={new Date(v.at).toISOString()}
                          className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                        >
                          {formatTime(v.at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                  {visitHasMore && (
                    <div className="flex justify-center pt-1">
                      <Button variant="outline" size="sm" className="text-xs" disabled={visitBusy} onClick={() => void loadVisits(visitNextOffset)}>
                        {visitBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                        加载更多
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {state === 'no-identity' && (
        <section className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-6 text-sm leading-relaxed text-muted-foreground">
          还没有可用的身份标识。先在首页搜索一次或登录账号，再回到这里管理历史。
        </section>
      )}

      {state === 'error' && (
        <SectionState
          variant="error"
          title="历史记录暂时取不到"
          description="云端暂时不可用，这不代表历史被清空——恢复后记录会原样回来。"
          onRetry={() => void load(identityReady.identity ?? '')}
        />
      )}

      {tab === 'searches' && state === 'ready' && items.length === 0 && (
        <SectionState
          variant="empty"
          icon={Search}
          title="还没有搜索记录"
          description="在首页搜索框里输入关键词后，这里会出现最近的历史。"
        />
      )}

      {tab === 'searches' && state === 'ready' && items.length > 0 && (
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
                  aria-pressed={filterMode === mode}
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
