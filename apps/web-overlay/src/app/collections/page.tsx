'use client'

/**
 * 精选专题列表页：展示管理员策划的主题合集，点击进入专题详情。
 * 数据来自中枢 GET /api/collections（仅启用）。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { fetchCollections, type HubCollection } from '@/lib/navhub-api'
import { ArrowLeft, Layers, Compass, MapPin, Route } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

const KIND_META: Record<string, { label: string; icon: typeof Compass }> = {
  topic: { label: '主题', icon: Compass },
  geo: { label: '地域', icon: MapPin },
  roadmap: { label: '路线图', icon: Route },
}

export default function CollectionsPage() {
  const [cols, setCols] = useState<HubCollection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetchCollections().then((c: HubCollection[]) => { setCols(c); setLoading(false) })
  }, [])

  return (
    <Container>
      <div className="py-6 sm:py-10 space-y-6">
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface subtle-mesh p-6 sm:p-8 shadow-xs">
          <div className="absolute -right-12 -top-12 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10 space-y-3">
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>返回主页</span>
              </Link>
              <span className="text-border">/</span>
              <Badge variant="outline" className="text-violet-500 border-violet-500/30 bg-violet-500/5 text-xs">
                精选策划
              </Badge>
            </div>
            <div className="max-w-2xl">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-violet-500/10 text-violet-500 border border-violet-500/20 shadow-xs">
                  <Layers className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <span>精选专题</span>
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                由站长人工策划的主题合集：入门路线、地域资源、场景方案，开箱即用。
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-muted-foreground text-sm py-16 text-center">正在加载精选专题…</div>
        ) : cols.length === 0 ? (
          <div className="text-muted-foreground text-sm py-12 text-center border border-dashed rounded-xl bg-muted/10">
            暂无精选专题，站长正在策划中
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cols.map((c) => {
              const meta = KIND_META[c.kind] ?? KIND_META.topic!
              const Icon = meta.icon
              return (
                <Link
                  key={c.id}
                  href={'/collections/' + encodeURIComponent(c.slug)}
                  className="group rounded-xl border border-border/70 hover:border-primary/40 bg-card/85 backdrop-blur-xs p-5 transition-all duration-200 hover:-translate-y-0.5 shadow-2xs"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="p-1.5 rounded-lg bg-violet-500/10 text-violet-500 border border-violet-500/20">
                      <Icon className="w-4 h-4" />
                    </span>
                    <Badge variant="outline" className="text-xs">{meta.label}</Badge>
                  </div>
                  <div className="text-base font-semibold group-hover:text-primary transition-colors">{c.title}</div>
                  {c.description && (
                    <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mt-1.5">
                      {c.description}
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>
      <Footer />
    </Container>
  )
}
