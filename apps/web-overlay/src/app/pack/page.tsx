'use client'

/**
 * 链接包接收页（`/pack#pack=…`）。
 *
 * 只读快照：内容来自链接本身的 hash，不联网、不登录、不写库；
 * 唯一联网的动作是「站点已删」核对（fetchSite 逐条查 siteId，404 才标
 * 注；中枢不可达时不标注、不误报），且核对结果不影响链接本身可用。
 *
 * 错误分两层：
 *   - 信封级损坏（无 hash / base64 坏 / 版本未知 / 空包）→ 整页错误态，
 *     给原因 + 回收藏页（没有可逐条恢复的内容，逐条标注无从谈起）；
 *   - 条目级损坏 → 逐条标注「链接无效」，其余照常打开、导入。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { SiteFavicon } from '@/components/site-favicon'
import { cn } from '@/lib/utils'
import { useFavorites } from '@/hooks/useFavorites'
import { fetchSite } from '@/lib/navhub-api'
import { isSafeHttpUrl, safeHref, safeWindowOpen } from '@/lib/safe-url'
import {
  LINK_PACK_HASH_PREFIX,
  decodeLinkPackPayload,
  describeLinkPackSnapshot,
  linkPackItemsToImportJson,
  openAllPackItems,
  parseLinkPack,
  planLinkPackImport,
  type ParsedLinkPack,
  type ParsedLinkPackItem,
} from '@/lib/link-pack'
import { ExternalLink, Link2, Package, AlertTriangle, CheckCircle2, Download, ArrowLeft } from 'lucide-react'

type PackState =
  | { kind: 'loading' }
  | { kind: 'error'; reason: string }
  | { kind: 'ready'; parsed: ParsedLinkPack }

function readPackFromHash(): PackState {
  if (typeof window === 'undefined') return { kind: 'loading' }
  const hash = window.location.hash
  if (!hash.startsWith(LINK_PACK_HASH_PREFIX)) {
    return {
      kind: 'error',
      reason: '这不是一条链接包链接：链接里没有链接包内容。请让对方重新发一条，或从「我的收藏」里重新打包。',
    }
  }
  const decoded = decodeLinkPackPayload(hash)
  if (!decoded.ok) return { kind: 'error', reason: decoded.reason }
  const parsed = parseLinkPack(decoded.raw)
  if (!parsed.ok) return { kind: 'error', reason: parsed.error ?? '链接包无法打开' }
  return { kind: 'ready', parsed }
}

export default function LinkPackPage() {
  const favorites = useFavorites()
  const [state, setState] = useState<PackState>({ kind: 'loading' })
  // 已从本站下架的站点 id（fetchSite 404 才进这里；网络失败不进）
  const [deletedSiteIds, setDeletedSiteIds] = useState<Set<string>>(new Set())
  const [openNote, setOpenNote] = useState<string | null>(null)
  const [importNote, setImportNote] = useState<string | null>(null)
  const [importTone, setImportTone] = useState<'success' | 'info' | 'error'>('info')
  const [importBusy, setImportBusy] = useState(false)

  useEffect(() => {
    const refresh = () => setState(readPackFromHash())
    refresh()
    window.addEventListener('hashchange', refresh)
    return () => window.removeEventListener('hashchange', refresh)
  }, [])

  const parsed = state.kind === 'ready' ? state.parsed : null

  // 导入预览：逐条「新增 / 已收藏 / 无效」，与 importJson 同一把去重尺子
  const plan = useMemo(
    () =>
      parsed
        ? planLinkPackImport(
            parsed.items,
            favorites.ready ? favorites.items.map((f) => f.href) : [],
          )
        : [],
    [parsed, favorites.ready, favorites.items],
  )
  const newCount = useMemo(() => plan.filter((p) => p.status === 'new').length, [plan])
  const alreadyCount = useMemo(() => plan.filter((p) => p.status === 'already-saved').length, [plan])

  // 站点已删核对：只查带 siteId 的有效条目；404 = 下架，网络失败 = 不标注。
  useEffect(() => {
    if (!parsed) return
    const ids = [...new Set(parsed.items.filter((i) => i.status === 'ok' && i.siteId).map((i) => i.siteId!))]
    if (ids.length === 0) return
    let cancelled = false
    void (async () => {
      const deleted = new Set<string>()
      await Promise.all(
        ids.map(async (id) => {
          let degraded = false
          const site = await fetchSite(id, () => {
            degraded = true
          })
          if (!degraded && site === null) deleted.add(id)
        }),
      )
      if (!cancelled && deleted.size > 0) setDeletedSiteIds(deleted)
    })()
    return () => {
      cancelled = true
    }
  }, [parsed])

  const itemsWithDeleted = useMemo(() => {
    if (!parsed) return [] as ParsedLinkPackItem[]
    return parsed.items.map((item) =>
      item.siteId && deletedSiteIds.has(item.siteId)
        ? { ...item, status: 'deleted' as const, problem: '该站点已从本站下架，链接本身仍可直接打开' }
        : item,
    )
  }, [parsed, deletedSiteIds])

  const handleOpenAll = useCallback(() => {
    if (!parsed) return
    const result = openAllPackItems(parsed.items, (href) => safeWindowOpen(href))
    setOpenNote(
      result.attempted === 0
        ? '这个包里没有能打开的链接'
        : result.blocked === 0
          ? `已尝试打开 ${result.opened} 个链接`
          : `已打开 ${result.opened} 个链接，${result.blocked} 个被浏览器拦截了弹出窗口——请在地址栏允许本站弹出窗口后，再点一次「全部打开」`,
    )
  }, [parsed])

  const handleImportAll = useCallback(() => {
    if (!parsed || importBusy) return
    if (newCount === 0) {
      setImportNote(
        alreadyCount > 0
          ? `这 ${alreadyCount} 个站点你都已收藏，无需重复导入`
          : '这个包里没有能导入的站点',
      )
      setImportTone('info')
      return
    }
    setImportBusy(true)
    const result = favorites.importJson(linkPackItemsToImportJson(parsed.items))
    setImportBusy(false)
    if (!result.ok) {
      setImportNote(`导入失败：${result.error ?? '未知错误'}，收藏未受影响`)
      setImportTone('error')
      return
    }
    setImportNote(
      `已导入 ${result.imported} 个新收藏` +
        (result.alreadyExisted > 0 ? `，${result.alreadyExisted} 个已收藏的跳过未重复建` : '') +
        (result.updated > 0 ? `，${result.updated} 个更新了标题/备注` : ''),
    )
    setImportTone('success')
  }, [parsed, importBusy, newCount, alreadyCount, favorites])

  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <Link
          href="/favorites"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60 min-h-11"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>我的收藏</span>
        </Link>

        {state.kind === 'loading' ? (
          <div aria-busy="true" aria-live="polite" className="space-y-4">
            <span className="sr-only">正在打开链接包…</span>
            <div className="h-9 w-full max-w-md rounded-xl bg-muted/60 animate-pulse" />
            <div className="h-24 w-full rounded-xl bg-muted/60 animate-pulse" />
          </div>
        ) : state.kind === 'error' ? (
          <div role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5 sm:p-6 space-y-3">
            <h1 className="text-lg font-bold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive-text" />
              链接包打不开
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">{state.reason}</p>
            <p className="text-xs text-muted-foreground">
              链接包是快照：内容直接存在链接里，不经过服务器——链接本身坏了就没法恢复，只能请对方重新发一条。
            </p>
            <Button asChild variant="outline" size="sm" className="min-h-11 text-xs">
              <Link href="/favorites">去我的收藏自己打包一个</Link>
            </Button>
          </div>
        ) : (
          parsed && (
            <>
              <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface p-4 sm:p-6 shadow-xs space-y-3">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                    <Package className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight break-words">{parsed.title}</h1>
                    <p className="text-xs text-muted-foreground mt-1" role="status">
                      {describeLinkPackSnapshot(parsed.publishedAt)}
                    </p>
                    {parsed.note && (
                      <p className="text-sm text-muted-foreground mt-2 leading-relaxed break-words">{parsed.note}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-muted-foreground">
                    共 {parsed.items.length} 个站点
                    {parsed.invalidCount > 0 ? `（${parsed.invalidCount} 个链接无效）` : ''}
                  </span>
                  {alreadyCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3" />
                      其中 {alreadyCount} 个你已收藏
                    </span>
                  )}
                </div>
                {parsed.notes.length > 0 && (
                  <p className="text-xs text-muted-foreground" role="note">
                    {parsed.notes.join('；')}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    variant="default"
                    size="sm"
                    className="min-h-11 text-xs"
                    disabled={parsed.validCount === 0}
                    onClick={handleOpenAll}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    全部打开（{parsed.validCount} 个）
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 text-xs"
                    disabled={newCount === 0 || importBusy || !favorites.ready}
                    title={
                      !favorites.ready
                        ? '正在读取你的收藏，稍候'
                        : newCount === 0
                          ? '这个包里的站点你都已收藏，或没有能导入的站点'
                          : `把其中 ${newCount} 个新站点导入我的收藏（已收藏的不重复建）`
                    }
                    onClick={handleImportAll}
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    一键导入我的收藏{newCount > 0 ? `（新增 ${newCount} 个）` : ''}
                  </Button>
                </div>
                {openNote && (
                  <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
                    {openNote}
                  </p>
                )}
                {importNote && (
                  <p
                    className={cn(
                      'text-xs',
                      importTone === 'success' && 'text-emerald-700 dark:text-emerald-400',
                      importTone === 'error' && 'text-destructive-text',
                      importTone === 'info' && 'text-muted-foreground',
                    )}
                    role="status"
                    aria-live="polite"
                  >
                    {importNote}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  全部打开可能被浏览器拦截部分弹出窗口；导入只新增你没有的站点，已收藏的不会重复建。
                </p>
              </div>

              <ul className="space-y-2.5" aria-label="链接包站点清单">
                {itemsWithDeleted.map((item) => {
                  const planItem = plan.find((p) => p.index === item.index)
                  const isBad = item.status === 'invalid'
                  // 渲染期安全闸：包内容来自外部链接，http(s) 之外的一律不渲染成可点链接。
                  // safeHref 内联在 href 里（url-hygiene 扫描机只认这种形态），
                  // isSafeHttpUrl 决定「链还是不链」。
                  const linkable = !isBad && isSafeHttpUrl(item.href)
                  return (
                    <li
                      key={item.index}
                      className={cn(
                        'rounded-xl border border-border/70 bg-card/50 p-3 sm:p-4',
                        isBad && 'opacity-80 border-destructive/30',
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg border border-border/60 bg-background shrink-0 p-1 overflow-hidden">
                          {item.href ? (
                            <SiteFavicon title={item.title} url={item.href} className="w-full h-full object-contain rounded-xs" />
                          ) : (
                            <Link2 className="w-5 h-5 m-1.5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          {!linkable ? (
                            <span className="text-sm font-semibold break-words">{item.title}</span>
                          ) : (
                            <a
                              href={safeHref(item.href, '')}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-semibold break-words hover:underline underline-offset-2 inline-flex items-center gap-1 min-h-11"
                            >
                              {item.title}
                              <ExternalLink className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                            </a>
                          )}
                          {item.purpose && (
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed break-words">
                              {item.purpose}
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground mt-0.5 break-all">{item.href || '无链接'}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {planItem?.status === 'already-saved' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 bg-background/60 text-[11px] text-muted-foreground">
                                <CheckCircle2 className="w-3 h-3" />
                                已收藏
                              </span>
                            )}
                            {planItem?.status === 'new' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-primary/30 bg-primary/5 text-[11px] text-primary">
                                未收藏
                              </span>
                            )}
                            {item.status === 'deleted' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="w-3 h-3" />
                                已从本站下架
                              </span>
                            )}
                            {item.problem && (
                              <span className="text-[11px] text-destructive-text" role="note">
                                {item.problem}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )
        )}
      </div>
    </Container>
  )
}
