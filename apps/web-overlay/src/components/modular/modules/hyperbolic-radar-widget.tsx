'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { GitCompare, ExternalLink, Search, TriangleAlert } from 'lucide-react'
import Link from 'next/link'

import {
  fetchHyperbolicAlternatives,
  searchSites,
  type HubHyperbolicHit,
  type HubSite,
} from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'
import { SiteFavicon } from '@/components/site-favicon'

/**
 * 双曲平替雷达。
 *
 * 历史问题：这张卡曾渲染 5 组硬编码「商业 vs 开源」对照，其中「内存开销减少 80%」
 * 是编造的量化结论，页脚的「Poincaré 双曲空间几何平替推演」描述的是卡片里根本不存在的
 * 算法（组件只有 useState）。中枢其实有真端点 `/api/rank/alternatives/:siteId`
 * （洛伦兹双曲测地距离 + 同层级平替得分），现在卡片改读它。
 *
 * 口径必须外显：端点在拿不到语义向量时退回「同分类 + 标签 Jaccard」的启发式投影，
 * 那个得分是估算而不是语义结论；把它和真向量得分混成同一种展示就是把未知当已知。
 */

/** 只是示例检索词，不是卡片给出的结论 */
const EXAMPLE_QUERIES = ['Figma', 'Notion', 'Postman']
const DEBOUNCE_MS = 400
const DEFAULT_LIMIT = 4
const MIN_LIMIT = 3
const MAX_LIMIT = 8

type LookupState =
  | { kind: 'idle' }
  | { kind: 'searching'; query: string }
  | { kind: 'not_found'; query: string }
  | { kind: 'empty'; site: HubSite; manifold: string }
  | { kind: 'ready'; site: HubSite; hits: HubHyperbolicHit[]; manifold: string; semantic: boolean }
  | { kind: 'error'; message: string }

function clampLimit(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(n)))
}

/** 得分保留 2 位：端点给的是 4 位小数，展示 4 位是给估算镀金 */
export function formatAltScore(score: number): string {
  if (!Number.isFinite(score)) return '—'
  return score.toFixed(2)
}

/**
 * 把端点的 manifold 口径翻译成一句人话。
 * 未知取值一律落到「未能计算」，不按启发式渲染——宁可少说，不能说错。
 */
export function manifoldLabel(manifold: string, semanticAvailable: boolean): string {
  if (manifold === 'lorentz-hyperboloid' && semanticAvailable) return '真实语义向量 · 双曲测地距离'
  if (manifold === 'lorentz-heuristic') return '启发式投影（同分类 + 标签重叠估算，非语义结论）'
  if (manifold === 'missing_site') return '该站点已不在中枢库中'
  return '双曲推理未能完成'
}

function pickSite(hits: HubSite[], query: string): HubSite | null {
  if (!hits.length) return null
  const needle = query.trim().toLowerCase()
  return hits.find((s) => s.title.toLowerCase() === needle) ?? hits[0] ?? null
}

export function HyperbolicRadarWidget({ config }: { config?: Record<string, any> }) {
  const seedQuery = typeof config?.site === 'string' ? config.site.trim() : ''
  const limit = clampLimit(config?.limit)
  const [query, setQuery] = useState(seedQuery)
  const [state, setState] = useState<LookupState>({ kind: 'idle' })
  const reqId = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  /** 最近一次真正发出过查询的词：同一词的重复触发（示例词 + 防抖尾巴）直接吞掉 */
  const lastQuery = useRef('')

  const lookup = useCallback(
    async (raw: string, force = false) => {
      const q = raw.trim()
      if (!q) {
        lastQuery.current = ''
        setState({ kind: 'idle' })
        return
      }
      if (!force && q === lastQuery.current) return
      lastQuery.current = q

      const id = ++reqId.current
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setState({ kind: 'searching', query: q })
      try {
        const res = await searchSites({ q, limit: 5, status: 'active' }, controller.signal)
        if (id !== reqId.current) return
        if (res.degraded) {
          setState({ kind: 'error', message: '中枢不可用，检索请求未能完成' })
          return
        }
        const site = pickSite(
          res.hits.map((h) => h.site).filter((s): s is HubSite => Boolean(s)),
          q,
        )
        if (!site) {
          setState({ kind: 'not_found', query: q })
          return
        }
        let failed = false
        const hyper = await fetchHyperbolicAlternatives(site.id, limit, () => {
          failed = true
        })
        if (id !== reqId.current) return
        if (!hyper) {
          setState({ kind: 'error', message: failed ? `「${site.title}」的平替推理取数失败（中枢不可用）` : '平替推理请求失败' })
          return
        }
        if (!hyper.hits.length) {
          setState({ kind: 'empty', site, manifold: hyper.manifold })
          return
        }
        setState({ kind: 'ready', site, hits: hyper.hits, manifold: hyper.manifold, semantic: hyper.semanticAvailable })
      } catch (err) {
        if (id !== reqId.current) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setState({ kind: 'error', message: '请求未能发出（网络异常或本地服务不可用）' })
      } finally {
        if (id === reqId.current && abortRef.current === controller) abortRef.current = null
      }
    },
    [limit],
  )

  // 输入防抖：逐字触发会把中枢打成检索洪水，也让用户看到中间态闪烁。
  // 配置预置了产品名时走同一通道，挂载后自动出结果。
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setState({ kind: 'idle' })
      return
    }
    const timer = setTimeout(() => void lookup(q), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, lookup])

  useEffect(() => () => abortRef.current?.abort(), [])

  return (
    <div className="h-full flex flex-col p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2 shrink-0">
        <div className="flex items-center gap-1.5 font-medium min-w-0">
          <GitCompare className="w-3.5 h-3.5 text-purple-500 shrink-0" />
          <span className="truncate">双曲平替雷达</span>
        </div>
        <Link href="/graph" className="text-xs text-primary hover:underline flex items-center gap-0.5 shrink-0">
          <span>关系图谱</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </Link>
      </div>

      <form
        className="relative shrink-0 py-2"
        onSubmit={(e) => {
          e.preventDefault()
          void lookup(query, true)
        }}
      >
        <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入产品名，如 Figma / Postman"
          aria-label="要查平替的产品名"
          className="w-full pl-8 pr-2 py-1.5 rounded-lg bg-muted/25 border border-border/40 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary/60"
        />
      </form>

      <div className="flex-1 min-h-0 overflow-y-auto pb-1 space-y-1.5">
        {state.kind === 'idle' && (
          <div className="h-full flex flex-col justify-center gap-1.5">
            <p className="text-xs text-muted-foreground leading-relaxed">
              输入产品名，在中枢里找它的双曲空间近邻平替。
            </p>
            <div className="flex items-center gap-1 flex-wrap">
              {EXAMPLE_QUERIES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => {
                    setQuery(ex)
                    void lookup(ex)
                  }}
                  className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 text-xs hover:bg-purple-500/20 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {state.kind === 'searching' && (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            正在检索「{state.query}」并做双曲投影…
          </div>
        )}

        {state.kind === 'error' && (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center">
            <TriangleAlert className="w-4 h-4 text-amber-500" />
            <p className="text-xs text-muted-foreground leading-relaxed">{state.message}</p>
            <button onClick={() => void lookup(query, true)} className="text-xs text-primary hover:underline">
              重试
            </button>
          </div>
        )}

        {state.kind === 'not_found' && (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center">
            <p className="text-xs text-muted-foreground leading-relaxed">
              中枢里没有收录「{state.query}」，无法计算平替。
            </p>
            <Link href="/submit" className="text-xs text-primary hover:underline">
              提交该站点
            </Link>
          </div>
        )}

        {state.kind === 'empty' && (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center">
            <p className="text-xs text-muted-foreground leading-relaxed">
              「{state.site.title}」已收录，但没有可比较的候选。
            </p>
            <p className="text-[10px] text-muted-foreground/80 font-mono">{manifoldLabel(state.manifold, false)}</p>
            <Link href={`/site/${state.site.id}`} className="text-xs text-primary hover:underline">
              看该站点详情
            </Link>
          </div>
        )}

        {state.kind === 'ready' && (
          <>
            <div className="flex items-center gap-2 p-1.5 rounded-lg bg-muted/25 border border-border/40">
              <div className="w-6 h-6 rounded-md bg-background border border-border/60 flex items-center justify-center p-1 shrink-0 overflow-hidden">
                <SiteFavicon
                  title={state.site.title}
                  url={state.site.url}
                  icon={state.site.iconKey ?? undefined}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground truncate">{state.site.title}</div>
                <div className="text-[10px] text-muted-foreground font-mono truncate">
                  {manifoldLabel(state.manifold, state.semantic)}
                </div>
              </div>
            </div>
            {state.hits.map((hit) => (
              <a
                key={hit.site.id}
                href={safeHref(hit.site.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-2 rounded-xl bg-purple-500/5 border border-purple-500/20 hover:border-purple-500/40 transition-colors group"
              >
                <div className="w-6 h-6 rounded-md bg-background border border-border/60 flex items-center justify-center p-1 shrink-0 overflow-hidden">
                  <SiteFavicon
                    title={hit.site.title}
                    url={hit.site.url}
                    icon={hit.site.iconKey ?? undefined}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground group-hover:text-primary truncate flex items-center gap-1">
                    <span>{hit.site.title}</span>
                    <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    {hit.site.description?.trim() || '中枢未填写简介'}
                  </p>
                </div>
                <div className="shrink-0 text-right font-mono">
                  <div className="text-xs font-bold text-purple-600 dark:text-purple-400">
                    {formatAltScore(hit.alternativeScore)}
                  </div>
                  {hit.sameCategory && (
                    <div className="text-[10px] text-muted-foreground">同类目</div>
                  )}
                </div>
              </a>
            ))}
          </>
        )}
      </div>

      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono shrink-0 truncate">
        {state.kind === 'ready'
          ? `平替得分来自双曲投影 · 共 ${state.hits.length} 个候选`
          : '候选与得分由中枢实时计算，非人工编排的对照表'}
      </div>
    </div>
  )
}
