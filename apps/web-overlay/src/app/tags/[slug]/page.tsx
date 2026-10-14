'use client'

/**
 * 标签结果页：某标签下的全部站点。
 * 走中枢检索（q 为空 + tag 过滤），与搜索面板同一引擎，排序一致。
 */

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { FavoriteButton } from '@/components/favorite-button'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { searchSites, type HubSite } from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'

export default function TagDetailPage() {
  const params = useParams<{ slug: string }>()
  const slug = decodeURIComponent(params?.slug ?? '')
  const [sites, setSites] = useState<HubSite[]>([])
  const [loading, setLoading] = useState(true)
  const [degraded, setDegraded] = useState(false)
  const identity = useMemo(() => getIdentity(), [])

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    void searchSites({ q: '', tag: slug, limit: 100, identity }).then((res) => {
      setSites(res.hits.map((h) => h.site).filter((s): s is HubSite => Boolean(s)))
      setDegraded(Boolean(res.degraded))
      setLoading(false)
    })
  }, [slug, identity])

  return (
    <Container>
      <div className="py-6 sm:py-10 space-y-6">
        {/* 顶部面包屑与标题展板 */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface subtle-mesh p-6 sm:p-7 shadow-xs">
          <div className="flex items-center gap-2 mb-3">
            <Link
              href="/tags"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回标签云</span>
            </Link>
            <span className="text-border">/</span>
            <span className="text-xs text-primary font-medium">{slug}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2">
            <span>🏷️</span>
            <span>「{slug}」相关站点</span>
            <span className="text-xs font-mono font-normal text-muted-foreground ml-2 px-2.5 py-0.5 rounded-full bg-muted border border-border/60">
              共 {sites.length} 个站点
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
            基于中枢多通道检索与向量图谱，为您汇总所有归属于「{slug}」分类的优质技术资产与工具。
          </p>
        </div>

        {degraded && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
            <span>⚠️ 检索服务暂时不可用，已自动启用本地离线降级索引。</span>
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-muted-foreground text-sm flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span>正在检索并对齐标签关联站点...</span>
          </div>
        ) : sites.length === 0 ? (
          <div className="py-16 text-center rounded-2xl border border-dashed border-border/60 bg-muted/10 p-8 space-y-3">
            <p className="text-muted-foreground text-sm">该标签下暂无收录站点</p>
            <Button asChild variant="outline" size="sm" className="text-xs">
              <Link href="/tags">浏览其他标签</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5 sm:gap-4">
            {sites.map((site) => (
              <div
                key={site.id}
                className="relative group rounded-xl border border-border/70 glass-surface subtle-mesh p-4 transition-all duration-200 hover:shadow-md hover:border-primary/40 flex flex-col justify-between"
              >
                <a href={site.url} target="_blank" rel="noopener noreferrer" className="block min-w-0">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-muted/60 border border-border/50 p-1 flex items-center justify-center overflow-hidden">
                      {site.iconKey ? (
                        <img
                          src={site.iconKey}
                          alt=""
                          className="w-full h-full object-contain rounded"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <span className="text-xs font-bold text-muted-foreground font-mono">
                          {site.title.slice(0, 1)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 pr-6">
                      <div className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                        {site.title}
                      </div>
                      {site.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                          {site.description}
                        </p>
                      )}
                    </div>
                  </div>
                </a>
                <div className="absolute top-3 right-3 opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity">
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
              </div>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </Container>
  )
}
