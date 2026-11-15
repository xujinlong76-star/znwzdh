'use client'

/**
 * 我的待找（搜索容错纠错 · 出口一）。
 *
 * 列表走 lib/wanted-searches：登录态读服务端（open 在前、notified 在后），
 * 匿名读本地 localStorage。已通知行保留到用户删除；重新待找 = 删后重存
 * （回搜索页再搜一次、点「存为待找」即可）。
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Footer } from '@/components/footer'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { SectionState } from '@/components/user-center/section-state'
import { deleteWantedSearch, listWantedSearches } from '@/lib/wanted-searches'
import { searchHref } from '@/lib/search-page'
import { BookmarkPlus, Trash2 } from 'lucide-react'

interface WantedRow {
  key: string
  query: string
  correctedQuery: string | null
  status: 'open' | 'notified'
  createdAt: number
  mode: 'server' | 'local'
}

type ViewState = 'loading' | 'ready' | 'error'

function formatTime(ts: number): string {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}

export function WantedSearchesView() {
  const [state, setState] = useState<ViewState>('loading')
  const [items, setItems] = useState<WantedRow[]>([])
  const [isLocal, setIsLocal] = useState(false)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const rows = await listWantedSearches()
      const mapped: WantedRow[] = rows.map((r) =>
        'id' in r
          ? { key: r.id, query: r.query, correctedQuery: r.correctedQuery, status: r.status, createdAt: r.createdAt, mode: 'server' as const }
          : { key: `local:${r.query}`, query: r.query, correctedQuery: r.correctedQuery, status: 'open' as const, createdAt: r.createdAt, mode: 'local' as const },
      )
      setIsLocal(mapped.length > 0 && mapped.every((r) => r.mode === 'local'))
      setItems(mapped)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = useCallback(async (row: WantedRow) => {
    const ok = await deleteWantedSearch(row.mode === 'server' ? row.key : row.query, row.mode)
    if (ok) setItems((prev) => prev.filter((i) => i.key !== row.key))
  }, [])

  return (
    <Container className="space-y-5 pb-8 pt-3 sm:space-y-6 sm:pb-10 sm:pt-4">
      <CenterPageHeader
        title="我的待找"
        icon={BookmarkPlus}
        back={{ href: '/me', label: '用户中心' }}
        description="搜不到站时存下的查询。投稿审核通过、新站收录时，命中的待找会在站内通知你一次；已通知的行保留到你删除。"
      />

      {isLocal && state === 'ready' && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          你还没有登录，下面是只存在当前设备的待找——登录后才能在收录时通知你。
        </p>
      )}

      {state === 'loading' && <SectionState variant="loading" rows={4} loadingLabel="正在加载待找" />}

      {state === 'error' && (
        <SectionState
          variant="error"
          title="待找暂时取不到"
          description="云端暂时不可用，稍后重试即可。"
          onRetry={() => void load()}
        />
      )}

      {state === 'ready' && items.length === 0 && (
        <SectionState
          variant="empty"
          icon={BookmarkPlus}
          title="还没有待找"
          description="在搜索页搜不到站时，点「存为待找」，收录了就通知你。"
        />
      )}

      {state === 'ready' && items.length > 0 && (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card/60">
          {items.map((row) => (
            <li key={row.key} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={searchHref({ q: row.query })} className="truncate text-sm font-medium text-foreground hover:text-primary hover:underline">
                    {row.query}
                  </Link>
                  {row.status === 'notified' ? (
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                      已收录 · 已通知
                    </span>
                  ) : (
                    <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      等待收录
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {row.correctedQuery && row.correctedQuery !== row.query ? `纠正为「${row.correctedQuery}」· ` : ''}
                  存于 {formatTime(row.createdAt)}
                  {row.mode === 'local' ? ' · 仅当前设备' : ''}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs text-muted-foreground hover:text-destructive-text" onClick={() => void remove(row)}>
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Footer />
    </Container>
  )
}
