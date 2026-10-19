'use client'

/**
 * 相似插件（详情页发现回路）。
 *
 * 数据来自 GET /api/plugins/:slug/similar（语义向量近邻）。语义未就绪 /
 * 索引尚未建立时接口返回空列表，本组件静默隐藏：不占位、不报错、
 * 不阻塞详情页主内容。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { fetchSimilarPlugins, type HubPluginItem } from '@/lib/navhub-api'
import { pluginKindLabel } from '@/lib/plugins/plugin-manifest'
import { Sparkles } from 'lucide-react'

export function PluginSimilar({ slug }: { slug: string }) {
  const [items, setItems] = useState<HubPluginItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    setItems([])
    setLoaded(false)
    void fetchSimilarPlugins(slug, 6).then((res) => {
      if (!alive) return
      setItems(res.items)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [slug])

  if (!loaded || items.length === 0) return null

  return (
    <section aria-labelledby="similar-plugins-heading" className="mt-10">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-muted-foreground" aria-hidden />
        <h2 id="similar-plugins-heading" className="text-base font-semibold text-foreground">
          相似插件
        </h2>
        <span className="text-xs text-muted-foreground">按语义相似度推荐</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((p) => (
          <Link
            key={p.slug}
            href={`/marketplace/${encodeURIComponent(p.slug)}`}
            className="group rounded-xl border border-border/70 bg-card/60 p-4 space-y-2 transition-colors hover:border-primary/40 hover:bg-card"
          >
            <div className="flex items-center gap-2">
              <span className="text-lg leading-none" aria-hidden>
                {p.icon || '🧩'}
              </span>
              <span className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                {p.name}
              </span>
              <span className="ml-auto text-[11px] px-1.5 py-0.5 rounded-md bg-muted/60 text-muted-foreground shrink-0">
                {pluginKindLabel(p.kind)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{p.description}</p>
            <div className="text-[11px] text-muted-foreground/80 font-mono">
              v{p.version} · 安装 {p.installCount} · 星标 {p.starCount}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
