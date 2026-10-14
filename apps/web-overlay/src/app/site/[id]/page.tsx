'use client'

/**
 * 站点详情页：完整信息 + 相似推荐。
 * 相似推荐走中枢向量 KNN（/api/rank/similar/:id），零新依赖——
 * embedding 关闭时如实降级为「暂无推荐」而不是报错。
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { FavoriteButton } from '@/components/favorite-button'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { ExternalLink, ArrowLeft, Copy, Check, Sparkles, Activity } from 'lucide-react'
import { fetchSite, fetchSimilar, type HubSite } from '@/lib/navhub-api'

export default function SiteDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const [site, setSite] = useState<HubSite | null>(null)
  const [similar, setSimilar] = useState<HubSite[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopyUrl = () => {
    if (!site?.url) return
    navigator.clipboard.writeText(site.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    if (!id) return
    setLoading(true)
    void fetchSite(id).then((s) => {
      setSite(s)
      if (!s) setNotFound(true)
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    if (!id || !site) return
    void fetchSimilar(id, 6).then(setSimilar)
  }, [id, site])

  if (loading) {
    return (
      <Container>
        <div className="py-24 text-center text-muted-foreground text-sm flex items-center justify-center gap-2">
          <span>加载站点详情中…</span>
        </div>
      </Container>
    )
  }

  if (notFound || !site) {
    return (
      <Container>
        <div className="py-24 text-center space-y-4 max-w-md mx-auto">
          <p className="text-muted-foreground text-sm">站点不存在或已被收录源清理</p>
          <Button asChild variant="outline" size="sm" className="text-xs">
            <Link href="/">返回主站首页</Link>
          </Button>
        </div>
      </Container>
    )
  }

  return (
    <Container>
      <div className="py-6 sm:py-10 max-w-4xl mx-auto space-y-6">
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

        {/* 核心站点展板 */}
        <div className="rounded-2xl border border-border/70 glass-surface subtle-mesh p-6 sm:p-8 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row items-start gap-5">
            <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-muted/60 border border-border/60 p-2 flex items-center justify-center overflow-hidden shadow-2xs">
              {site.iconKey ? (
                <img
                  src={site.iconKey}
                  alt={site.title}
                  className="w-full h-full object-contain rounded-xl"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <span className="text-2xl font-extrabold text-muted-foreground font-mono">
                  {site.title.slice(0, 1)}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-2">
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
                  title="复制链接"
                  className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {site.description && (
                <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed pt-1">
                  {site.description}
                </p>
              )}

              {site.tags && site.tags.length > 0 && (
                <div className="pt-2 flex flex-wrap items-center gap-1.5">
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

        {/* 向量相似推荐 */}
        {similar.length > 0 && (
          <div className="space-y-3.5 pt-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-2">
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
                      {s.iconKey ? (
                        <img
                          src={s.iconKey}
                          alt=""
                          className="w-full h-full object-contain rounded"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <span className="text-xs font-bold text-muted-foreground font-mono">
                          {s.title.slice(0, 1)}
                        </span>
                      )}
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
