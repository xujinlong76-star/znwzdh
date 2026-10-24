'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Folder, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react'
import Link from 'next/link'

import {
  fetchCategories,
  fetchCategoryCounts,
  searchSites,
  type HubCategoryLite,
  type HubSite,
} from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'
import { categoryHref } from '@/lib/seo/category-url'
import { SiteFavicon } from '@/components/site-favicon'

/**
 * 「精选分类导航」卡片。
 *
 * 历史问题：这张卡曾把 12 条硬编码外链当成「分类精选站点」渲染，
 * 页签 id（ai/dev/tools）既不是中枢类目 id 也不是 slug，注册表里却写着
 * 「嵌入指定技术分类的精选站点卡片集合」——用户以为自己在配置类目，
 * 实际改什么都没用。现在全部数据来自中枢 `/api/search` 的类目过滤，
 * 配置项 `categoryId` 第一次真正可达。
 *
 * 计数口径：站点只挂叶子类目，一级根的自身计数恒为 0，所以页签只取叶子
 * （`parentId` 非空）；用 `/api/categories/counts` 排序，保证点开的页签不是一片空。
 */

/** 页签最多列几个：卡片头部宽度有限，再多就挤成不可点的碎块 */
const MAX_TABS = 8
const DEFAULT_LIMIT = 6
const MIN_LIMIT = 3
const MAX_LIMIT = 12

interface CategoryTab {
  /** 传给中枢的类目标识（优先 slug，退回 id） */
  ref: string
  /** 类目主键 id（counts 用 id 索引） */
  id: string
  title: string
  /** 中枢计数；取不到计数时为 null（不猜） */
  siteCount: number | null
  /**
   * 只由 `toTab` 一处构造，走 `lib/seo/category-url` 的 categoryHref：
   * 段值已 encodeURIComponent，脏 slug 逃不出 `/category/`，也不与类目页规范形态分叉。
   */
  href: string
}

type CatalogState =
  | { kind: 'loading' }
  | { kind: 'ready'; tabs: CategoryTab[]; configuredMissing: boolean }
  | { kind: 'error'; message: string }

type SitesState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; items: HubSite[]; hasMore: boolean }
  | { kind: 'error'; message: string }

function clampLimit(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(n)))
}

function trimText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * 由类目表 + 计数表构造页签。
 *
 * 计数缺失（中枢 /counts 挂了但类目表拿到了）时退回「按 sort 取前 N 个叶子」，
 * 并把 siteCount 记成 null——卡片据此不显示任何数字，而不是显示 0。
 */
export function buildCategoryTabs(
  categories: HubCategoryLite[],
  counts: Map<string, number> | null,
  preferredRef: string,
): { tabs: CategoryTab[]; configuredMissing: boolean } {
  const leaves = categories.filter((c) => {
    // 类目表来自 HTTP：类型是「数组」不代表每个元素都是对象，脏行必须能咽下
    if (!c) return false
    if (c.enabled === false) return false
    if (!trimText(c.title)) return false
    // 无父级的是一级根：站点不挂根，做页签必然空
    return trimText(c.parentId) !== ''
  })
  const toTab = (c: HubCategoryLite): CategoryTab => ({
    ref: trimText(c.slug) || c.id,
    id: c.id,
    title: c.title,
    siteCount: counts ? (counts.get(c.id) ?? 0) : null,
    href: categoryHref(c),
  })
  const candidates = counts
    ? leaves.filter((c) => (counts.get(c.id) ?? 0) > 0).sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
    : [...leaves].sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))
  const tabs: CategoryTab[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    const tab = toTab(c)
    if (seen.has(tab.ref)) continue
    seen.add(tab.ref)
    tabs.push(tab)
    if (tabs.length >= MAX_TABS) break
  }
  const preferred = preferredRef.toLowerCase()
  const hitIndex = tabs.findIndex((t) => t.ref.toLowerCase() === preferred || t.id.toLowerCase() === preferred)
  let configuredMissing = false
  if (preferredRef) {
    if (hitIndex > 0) {
      // 配置的类目在表里但排在后面：提到第一位，避免用户改完配置看不到效果
      const [picked] = tabs.splice(hitIndex, 1)
      if (picked) tabs.unshift(picked)
    } else if (hitIndex < 0) {
      const matched = categories.find((c) => c.id.toLowerCase() === preferred || trimText(c.slug).toLowerCase() === preferred)
      if (matched) tabs.unshift(toTab(matched))
      else configuredMissing = true
    }
  }
  return { tabs, configuredMissing }
}

export function CustomCategoryWidget({ config }: { config?: Record<string, any> }) {
  const configuredRef = trimText(config?.categoryId)
  const limit = clampLimit(config?.limit)

  const [catalog, setCatalog] = useState<CatalogState>({ kind: 'loading' })
  const [selected, setSelected] = useState<CategoryTab | null>(null)
  const [sites, setSites] = useState<SitesState>({ kind: 'idle' })
  const [reload, setReload] = useState(0)
  const catalogReqId = useRef(0)
  const sitesReqId = useRef(0)
  const sitesAbort = useRef<AbortController | null>(null)

  // 页签集：只在挂载与「手动重试」时取，切类目不重复拉全表
  useEffect(() => {
    const id = ++catalogReqId.current
    setCatalog({ kind: 'loading' })
    void (async () => {
      const [categories, counts] = await Promise.all([fetchCategories(), fetchCategoryCounts()])
      if (id !== catalogReqId.current) return
      if (categories === null) {
        setCatalog({ kind: 'error', message: '中枢不可用，取不到类目表' })
        return
      }
      const { tabs, configuredMissing } = buildCategoryTabs(categories, counts, configuredRef)
      if (!tabs.length) {
        setCatalog({ kind: 'error', message: '中枢里还没有有存活站点的类目' })
        return
      }
      setCatalog({ kind: 'ready', tabs, configuredMissing })
    })()
  }, [configuredRef, reload])

  // 选中项：配置优先，否则用第一个页签；页签集变化后重新对齐
  useEffect(() => {
    if (catalog.kind !== 'ready') return
    setSelected((prev) => {
      const wantedRef = configuredRef.toLowerCase()
      const byConfig = wantedRef
        ? catalog.tabs.find((t) => t.ref.toLowerCase() === wantedRef || t.id.toLowerCase() === wantedRef)
        : undefined
      const next = byConfig ?? catalog.tabs.find((t) => t.ref === prev?.ref) ?? catalog.tabs[0] ?? null
      return next && next.ref === prev?.ref ? prev ?? next : next
    })
  }, [catalog, configuredRef])

  const loadSites = useCallback(
    async (tab: CategoryTab) => {
      const id = ++sitesReqId.current
      sitesAbort.current?.abort()
      const controller = new AbortController()
      sitesAbort.current = controller
      setSites({ kind: 'loading' })
      try {
        const res = await searchSites(
          { q: '', categoryId: tab.ref, status: 'active', limit },
          controller.signal,
        )
        if (id !== sitesReqId.current) return
        const items = res.hits.map((h) => h.site).filter((s): s is HubSite => Boolean(s))
        if (res.degraded) {
          setSites({ kind: 'error', message: `类目「${tab.title}」取数失败（中枢不可用）` })
        } else {
          setSites({ kind: 'ready', items, hasMore: res.hasMore === true })
        }
      } catch (err) {
        if (id !== sitesReqId.current) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setSites({ kind: 'error', message: `类目「${tab.title}」取数失败（请求未能发出）` })
      } finally {
        if (id === sitesReqId.current && sitesAbort.current === controller) {
          sitesAbort.current = null
        }
      }
    },
    [limit],
  )

  useEffect(() => {
    if (!selected) return
    void loadSites(selected)
    return () => sitesAbort.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.ref, limit])

  if (catalog.kind === 'loading') {
    return (
      <Shell>
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          正在读取中枢类目…
        </div>
      </Shell>
    )
  }

  if (catalog.kind === 'error') {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-3">
          <TriangleAlert className="w-5 h-5 text-amber-500" />
          <p className="text-xs text-muted-foreground leading-relaxed">{catalog.message}</p>
          <button
            onClick={() => setReload((n) => n + 1)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            重试
          </button>
        </div>
      </Shell>
    )
  }

  const isTemporary = Boolean(configuredRef) && selected !== null && configuredRef.toLowerCase() !== selected.ref.toLowerCase()
  const shownCount = sites.kind === 'ready' ? sites.items.length : 0
  // 「还有更多」只在中枢给出确切计数时才写数字，否则只说「可进分类页看全部」——
  // 计数缺失时编一个差额就是把未知当已知。
  const remaining = selected?.siteCount !== null && selected ? Math.max(0, selected.siteCount - shownCount) : null

  return (
    <Shell
      right={
        selected ? (
          <Link href={selected.href} className="text-xs text-primary hover:underline flex items-center gap-0.5">
            <span>分类页</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </Link>
        ) : null
      }
    >
      <div className="flex items-center gap-1 flex-wrap pb-1.5 shrink-0">
        {catalog.tabs.map((tab) => {
          const active = tab.ref === selected?.ref
          return (
            <button
              key={tab.ref}
              onClick={() => setSelected(tab)}
              title={tab.siteCount === null ? tab.title : `${tab.title} · ${tab.siteCount} 个存活站点`}
              className={`px-1.5 py-0.5 rounded text-xs truncate max-w-28 transition-colors ${
                active
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.title}
            </button>
          )
        })}
      </div>

      {catalog.configuredMissing && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed shrink-0">
          配置的类目「{configuredRef}」不在中枢类目表中，已改用其他类目。请填 slug、id 或唯一标题。
        </p>
      )}

      <div className="flex-1 py-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5 overflow-y-auto min-h-0 content-start">
        {sites.kind === 'loading' || sites.kind === 'idle' ? (
          Array.from({ length: Math.min(limit, 4) }).map((_, i) => (
            <div key={i} className="h-[46px] rounded-xl bg-muted/25 animate-pulse" />
          ))
        ) : sites.kind === 'error' ? (
          <div className="col-span-full flex flex-col items-center justify-center gap-1.5 py-3 text-center">
            <TriangleAlert className="w-4 h-4 text-amber-500" />
            <p className="text-xs text-muted-foreground leading-relaxed">{sites.message}</p>
            <button
              onClick={() => selected && void loadSites(selected)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-xs hover:bg-primary/20 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              重试
            </button>
          </div>
        ) : sites.items.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center gap-1 py-3 text-center">
            <p className="text-xs text-muted-foreground">「{selected?.title}」下暂无存活站点（已排除失效与待审）</p>
            {selected && (
              <Link href={selected.href} className="text-xs text-primary hover:underline">
                看该分类页
              </Link>
            )}
          </div>
        ) : (
          sites.items.map((site) => (
            <a
              key={site.id}
              href={safeHref(site.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2.5 p-2 rounded-xl bg-muted/20 hover:bg-muted/50 border border-border/40 hover:border-primary/40 transition-all group"
            >
              <div className="w-7 h-7 rounded-lg bg-background border border-border/60 flex items-center justify-center p-1 shrink-0 group-hover:scale-105 transition-transform overflow-hidden">
                <SiteFavicon
                  title={site.title}
                  url={site.url}
                  icon={site.iconKey ?? undefined}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate flex items-center gap-1">
                  <span>{site.title}</span>
                  <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {trimText(site.description) || '中枢未填写简介'}
                </p>
              </div>
            </a>
          ))
        )}
      </div>

      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono flex items-center justify-center gap-1.5 flex-wrap shrink-0">
        {isTemporary && (
          <span className="px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] leading-none">
            临时
          </span>
        )}
        <span>
          {selected ? `${selected.title} · ` : ''}
          {sites.kind === 'ready'
            ? remaining === null
              ? `本卡 ${shownCount} 个${sites.hasMore ? '（类目内还有更多）' : ''}`
              : `本卡 ${shownCount} 个 / 类目 ${selected?.siteCount} 个存活站点`
            : '数据来自中枢类目检索'}
        </span>
        {selected && sites.kind === 'ready' && remaining !== null && remaining > 0 && (
          <Link href={selected.href} className="text-primary hover:underline">
            还有 {remaining} 个 →
          </Link>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2 mb-1.5 shrink-0">
        <div className="flex items-center gap-1.5 font-medium min-w-0">
          <Folder className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className="truncate">中枢分类精选站点</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">{right}</div>
      </div>
      {children}
    </div>
  )
}
