'use client'

/**
 * 站点详情页：完整信息 + 正交分面属性 + 强类型实体平替生态图谱 + 向量相似推荐。
 *
 * 核心能力：
 * 1. 核心站点展板：Favicon、SLA 状态、点击频次、外链与一键复制
 * 2. 正交分面属性胶囊：价格模型（免费/开源/商业）、支持平台、架构形态与语言
 * 3. 强类型实体知识图谱：对标平替 (Alternative)、生态搭配 (Complementary) 与上下游依赖 (Upstream)
 * 4. 向量相似推荐：基于嵌入向量 KNN 的相关站点发现
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { FavoriteButton } from '@/components/favorite-button'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import {
  ExternalLink,
  ArrowLeft,
  Copy,
  Check,
  Sparkles,
  Activity,
  ArrowRight,
  GitFork,
  Boxes,
  Workflow,
  ShieldCheck,
  Tag,
  DollarSign,
  Laptop,
  Box,
  Globe,
  X,
} from 'lucide-react'
import {
  fetchSite,
  fetchSimilar,
  fetchSiteRelations,
  type HubSite,
  type HubSiteRelation,
} from '@/lib/navhub-api'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { copyText } from '@/lib/clipboard'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { SiteFavicon } from '@/components/site-favicon'

const RELATION_TYPE_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  alternative: {
    label: '对标平替',
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800',
  },
  complementary: {
    label: '生态搭配',
    color: 'text-indigo-700 dark:text-indigo-300',
    bg: 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800',
  },
  ecosystem: {
    label: '同技术生态',
    color: 'text-blue-700 dark:text-blue-300',
    bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',
  },
  part_of: {
    label: '套件组件',
    color: 'text-purple-700 dark:text-purple-300',
    bg: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800',
  },
  upstream: {
    label: '核心依赖',
    color: 'text-rose-700 dark:text-rose-300',
    bg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800',
  },
  mirror: {
    label: '镜像分流',
    color: 'text-cyan-700 dark:text-cyan-300',
    bg: 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-800',
  },
  related: {
    label: '关联项目',
    color: 'text-gray-700 dark:text-gray-300',
    bg: 'bg-gray-50 dark:bg-gray-950/40 border-gray-200 dark:border-gray-800',
  },
}

const FACET_LABELS: Record<string, { label: string; icon: any }> = {
  pricing: { label: '付费模式', icon: DollarSign },
  platform: { label: '运行平台', icon: Laptop },
  form: { label: '形态架构', icon: Box },
  language: { label: '界面语言', icon: Globe },
}

export default function SiteDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const [site, setSite] = useState<HubSite | null>(null)
  const [similar, setSimilar] = useState<HubSite[]>([])
  const [relations, setRelations] = useState<HubSiteRelation[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = () => setReloadToken((n) => n + 1)

  const handleCopyUrl = async () => {
    if (!site?.url) return
    // 只有真的写入成功才显示「已复制」；失败要看得见（见 lib/clipboard.ts）
    const result = await copyText(site.url)
    setCopyState(result.ok ? 'copied' : 'failed')
    setTimeout(() => setCopyState('idle'), 2000)
  }

  // 加载站点主数据
  useEffect(() => {
    if (!id) return
    let cancelled = false
    let failed = false
    setLoading(true)
    setNotFound(false)
    setNotice(null)
    void fetchSite(id, (error) => {
      failed = true
      if (!cancelled) setNotice(describeDegrade(error, '站点数据'))
    }).then((s) => {
      if (cancelled) return
      setSite(s)
      if (!s && !failed) setNotFound(true)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id, reloadToken])

  // 加载 KNN 相似站点
  useEffect(() => {
    if (!id || !site) return
    let cancelled = false
    void fetchSimilar(id, 6, (error) => {
      if (!cancelled) setNotice(describeDegrade(error, '相似推荐'))
    }).then((s) => {
      if (!cancelled) setSimilar(s)
    })
    return () => {
      cancelled = true
    }
  }, [id, site, reloadToken])

  // 加载强类型实体关系网络 (Alternative / Complementary / Upstream 等)
  useEffect(() => {
    if (!id || !site) return
    let cancelled = false
    void fetchSiteRelations(id).then((res) => {
      if (!cancelled && res?.all) setRelations(res.all)
    })
    return () => {
      cancelled = true
    }
  }, [id, site, reloadToken])

  if (loading) {
    return (
      <Container as="main" id="main-content">
        <div className="py-24 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
          <span>加载站点详情中…</span>
        </div>
      </Container>
    )
  }

  if (!site && notice) {
    return (
      <Container as="main" id="main-content">
        <div className="py-20 text-center space-y-5 max-w-md mx-auto">
          <p className="text-muted-foreground text-sm">暂时无法加载该站点详情</p>
          <HubDegradedNotice notice={notice} onRetry={reload} incompleteHint={false} />
          <Button asChild variant="outline" size="sm" className="text-xs">
            <Link href="/">返回主站首页</Link>
          </Button>
        </div>
      </Container>
    )
  }

  if (notFound || !site) {
    return (
      <Container as="main" id="main-content">
        <div className="py-24 text-center space-y-4 max-w-md mx-auto">
          <p className="text-muted-foreground text-sm">站点不存在或已被收录源清理</p>
          <Button asChild variant="outline" size="sm" className="text-xs">
            <Link href="/">返回主站首页</Link>
          </Button>
        </div>
      </Container>
    )
  }

  const alternatives = relations.filter((r) => r.relationType === 'alternative')
  const ecosystemRelations = relations.filter((r) =>
    ['complementary', 'ecosystem', 'part_of'].includes(r.relationType),
  )
  const upstreamAndOthers = relations.filter((r) =>
    ['upstream', 'mirror', 'related'].includes(r.relationType),
  )

  const hasFacets = site.facets && Object.keys(site.facets).length > 0

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 max-w-4xl mx-auto space-y-8">
        {/* 面包屑 */}
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回导航</span>
          </Link>
          <span className="text-border">/</span>
          <span className="text-xs text-foreground font-medium truncate max-w-[200px]">{site.title}</span>
        </div>

        {/* 降级提示 */}
        {notice && <HubDegradedNotice notice={notice} onRetry={reload} />}

        {/* 核心站点展板 */}
        <div className="rounded-2xl border border-border/70 glass-surface subtle-mesh p-6 sm:p-8 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row items-start gap-5">
            <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-muted/60 border border-border/60 p-2 flex items-center justify-center overflow-hidden shadow-2xs">
              <SiteFavicon
                title={site.title}
                url={site.url}
                icon={site.iconKey ?? undefined}
                className="w-full h-full object-contain rounded-xl"
              />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                  {site.title}
                </h1>
                {site.health && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-xs border ${
                      site.health.ok
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${site.health.ok ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                    <span>{site.health.ok ? 'SLA 正常' : '响应缓慢'}</span>
                    {site.health.latencyMs && <span>({site.health.latencyMs}ms)</span>}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={site.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs sm:text-sm text-primary hover:underline break-all font-mono"
                >
                  {site.url}
                </a>
                <button
                  onClick={handleCopyUrl}
                  aria-label={
                    copyState === 'copied'
                      ? '已复制链接'
                      : copyState === 'failed'
                        ? '复制失败，请手动选中链接复制'
                        : '复制链接'
                  }
                  title={
                    copyState === 'copied'
                      ? '已复制'
                      : copyState === 'failed'
                        ? '复制失败，请手动选中链接复制'
                        : '复制链接'
                  }
                  className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
                >
                  {copyState === 'copied' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : copyState === 'failed' ? (
                    <X className="w-3.5 h-3.5 text-destructive" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {site.description && (
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  {site.description}
                </p>
              )}

              {/* 正交分面属性胶囊 (Phase 2) */}
              {hasFacets && (
                <div className="pt-2 flex flex-wrap items-center gap-2 border-t border-border/40 mt-3">
                  {Object.entries(site.facets!).map(([fKey, vals]) => {
                    const fMeta = FACET_LABELS[fKey] || { label: fKey, icon: Tag }
                    const FIcon = fMeta.icon
                    return vals.map((v) => (
                      <span
                        key={`${fKey}_${v}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-medium bg-secondary/80 text-secondary-foreground border border-border/60 shadow-2xs"
                      >
                        <FIcon className="w-3 h-3 text-muted-foreground" />
                        <span className="text-muted-foreground">{fMeta.label}:</span>
                        <span className="font-semibold text-foreground">{v}</span>
                      </span>
                    ))
                  })}
                </div>
              )}

              {/* 话题标签 */}
              {site.tags && site.tags.length > 0 && (
                <div className="pt-1 flex flex-wrap items-center gap-1.5">
                  {site.tags.map((t) => (
                    <Link
                      key={t}
                      href={'/tags/' + encodeURIComponent(t)}
                      className="text-xs px-2.5 py-0.5 rounded-full bg-muted/80 hover:bg-primary/10 hover:text-primary border border-border/50 transition-colors"
                    >
                      #{t}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 操作按钮栏 */}
          <div className="pt-4 border-t border-border/50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Button asChild size="sm" className="h-9 text-xs px-4 gap-1.5 shadow-xs font-semibold">
                <a href={site.url} target="_blank" rel="noopener noreferrer">
                  <span>立即直达官方主站</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </Button>
              <FavoriteButton
                site={{
                  siteId: site.id,
                  title: site.title,
                  href: site.url,
                  icon: site.iconKey ?? undefined,
                  description: site.description ?? undefined,
                }}
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground/80 font-mono">
              <Activity className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{(site.visitCount ?? 0) > 0 ? `${site.visitCount} 次点击` : '暂无点击'}</span>
              {site.health?.lastCheckedAt && (
                <span>· 巡检时间: {new Date(site.health.lastCheckedAt).toLocaleDateString('zh-CN')}</span>
              )}
            </div>
          </div>
        </div>

        {/* 强类型平替与竞品雷达 (Alternative Relations - Phase 3) */}
        {alternatives.length > 0 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-2 text-foreground">
                <GitFork className="w-4 h-4 text-amber-500" />
                <span>开源与对标平替 (Alternatives)</span>
              </h2>
              <span className="text-xs text-muted-foreground font-mono">{alternatives.length} 个平替方案</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {alternatives.map((alt) => (
                <div
                  key={alt.id}
                  className="rounded-xl border border-border/70 bg-card p-4 hover:border-amber-500/40 transition-all shadow-2xs space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {alt.targetSiteId ? (
                          <Link
                            href={`/site/${alt.targetSiteId}`}
                            className="font-semibold text-sm hover:text-primary hover:underline truncate"
                          >
                            {alt.targetTitle}
                          </Link>
                        ) : (
                          <span className="font-semibold text-sm text-foreground truncate">
                            {alt.targetTitle}
                          </span>
                        )}
                        {alt.isFreeOrOpenSource && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <ShieldCheck className="w-2.5 h-2.5" />
                            开源/免费
                          </span>
                        )}
                      </div>
                      <a
                        href={alt.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-primary font-mono truncate block mt-0.5"
                      >
                        {alt.targetUrl}
                      </a>
                    </div>

                    <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                      <a href={alt.targetUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </Button>
                  </div>

                  {alt.note && (
                    <p className="text-xs text-muted-foreground/90 bg-muted/30 p-2 rounded-lg border border-border/40">
                      💡 {alt.note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 生态搭配与技术套件 (Ecosystem & Complementary - Phase 3) */}
        {ecosystemRelations.length > 0 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-2 text-foreground">
                <Boxes className="w-4 h-4 text-indigo-500" />
                <span>推荐搭配与技术生态 (Ecosystem & Complementary)</span>
              </h2>
              <span className="text-xs text-muted-foreground font-mono">{ecosystemRelations.length} 个关联组件</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
              {ecosystemRelations.map((eco) => {
                const badge = RELATION_TYPE_LABEL[eco.relationType] || { label: eco.relationType, color: 'text-muted-foreground', bg: 'bg-muted' }
                return (
                  <div
                    key={eco.id}
                    className="rounded-xl border border-border/70 bg-card p-3.5 hover:border-indigo-500/40 transition-all shadow-2xs space-y-2 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${badge.bg} ${badge.color}`}>
                          {badge.label}
                        </span>
                        <a href={eco.targetUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                      <div className="font-semibold text-xs sm:text-sm truncate">
                        {eco.targetSiteId ? (
                          <Link href={`/site/${eco.targetSiteId}`} className="hover:text-primary hover:underline">
                            {eco.targetTitle}
                          </Link>
                        ) : (
                          eco.targetTitle
                        )}
                      </div>
                      {eco.note && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                          {eco.note}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 向量图谱相似推荐 (KNN) */}
        {similar.length > 0 && (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-2 text-foreground">
                <Sparkles className="w-4 h-4 text-primary" />
                <span>向量图谱相似站点推荐 (KNN)</span>
              </h2>
              <span className="text-xs text-muted-foreground font-mono">{similar.length} 个推荐项</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
              {similar.map((s) => (
                <div
                  key={s.id}
                  className="group relative rounded-xl border border-border/70 glass-surface subtle-mesh p-3.5 transition-all hover:shadow-md hover:border-primary/40 flex flex-col justify-between"
                >
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-muted/60 border border-border/50 p-1 flex items-center justify-center overflow-hidden">
                      <SiteFavicon
                        title={s.title}
                        url={s.url}
                        icon={s.iconKey ?? undefined}
                        className="w-full h-full object-contain rounded"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs sm:text-sm font-semibold truncate group-hover:text-primary transition-colors">
                        {s.title}
                      </div>
                      {s.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {s.description}
                        </div>
                      )}
                    </div>
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <Footer />
    </Container>
  )
}
