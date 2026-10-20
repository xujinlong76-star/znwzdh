'use client'

/**
 * 标签云页：按站点计数展示全部标签，点击进入标签结果。
 * 数据来自中枢 GET /api/tags（真实计数，非客户端统计）。
 */

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { fetchTags, type HubTag } from '@/lib/navhub-api'
import { describeDegrade, type DegradeNotice } from '@/lib/degrade'
import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import { Footer } from '@/components/footer'
import { Tags, ArrowLeft, Search, Hash, Flame } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

export default function TagsPage() {
  const [tags, setTags] = useState<HubTag[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  /** 中枢挂了时「共聚合 0 个标签」是假事实，要说清是取不到而不是没有 */
  const [notice, setNotice] = useState<DegradeNotice | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const reload = () => setReloadToken((n) => n + 1)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotice(null)
    void fetchTags((error) => {
      if (!cancelled) setNotice(describeDegrade(error, '标签数据'))
    }).then((t) => {
      if (cancelled) return
      setTags(t)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return tags
    const q = searchQuery.toLowerCase().trim()
    return tags.filter((t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q))
  }, [tags, searchQuery])

  const tagStats = useMemo(() => {
    const coveredSites = tags.reduce((sum, t) => sum + (Number.isFinite(t.count) ? t.count : 0), 0)
    const heavyTags = tags.filter((t) => t.count >= 10).length
    return { coveredSites, heavyTags }
  }, [tags])

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-6">
        {/* 沉浸式 Hero 展板（对齐插件市场轮的展板语言：market-hero + 光斑 + 水印图标） */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-6 sm:p-8 shadow-xs">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 w-48 h-48 bg-sky-400/10 rounded-full blur-3xl" />
          <Tags
            aria-hidden
            strokeWidth={1}
            className="pointer-events-none absolute right-5 bottom-5 hidden sm:block w-16 h-16 text-border/70"
          />

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
              <Badge variant="outline" className="text-indigo-500 border-indigo-500/30 bg-indigo-500/5 text-xs">
                技术全景索引
              </Badge>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div className="max-w-2xl">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 shadow-xs">
                    <Tags className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <span>全景技术标签索引云</span>
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  {notice
                    ? '标签统计暂时取不回来，下方数量不代表真实收录情况。'
                    : `共聚合 ${tags.length} 个技术与生态领域标签。点击任意标签下钻查看归类工具，或在右侧实时过滤搜索。`}
                </p>
              </div>

              {/* 即时搜索框 */}
              <div className="relative w-full sm:w-64 shrink-0">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                <Input aria-label="搜索标签名称或技术栈"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索标签名称或技术栈..."
                  className="pl-9 h-9 text-xs sm:text-sm rounded-xl border-border/70 bg-background/90"
                />
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-border/50 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-indigo-500/25 bg-indigo-500/5 text-xs text-indigo-600 dark:text-indigo-400">
                <Tags className="w-3 h-3" />
                共 {tags.length} 个标签
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/25 bg-primary/5 text-xs text-primary">
                <Flame className="w-3 h-3" />
                热门（≥10）{tagStats.heavyTags} 个
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                <Hash className="w-3 h-3 text-border" />
                覆盖 {tagStats.coveredSites} 次站点归类
              </span>
            </div>
          </div>
        </div>

        {notice && <HubDegradedNotice notice={notice} onRetry={reload} />}

        {loading ? (
          <div
            aria-busy="true"
            aria-live="polite"
            aria-label="正在加载标签云"
            className="rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-7 backdrop-blur-xs shadow-2xs"
          >
            <span className="sr-only">正在加载全景技术标签…</span>
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              {Array.from({ length: 24 }).map((_, i) => (
                <div
                  key={i}
                  className="h-8 rounded-xl bg-muted/70 animate-pulse"
                  style={{ width: `${[72, 96, 64, 120, 84, 108, 76, 132][i % 8]}px` }}
                />
              ))}
            </div>
          </div>
        ) : tags.length === 0 ? (
          <EmptyState
            icon={Tags}
            iconTone="warning"
            title={notice ? '本次未能取回标签数据' : '暂无标签数据'}
            description={
              notice
                ? '中枢暂时不可用，标签统计没有取回来；这不代表站点没有标签。'
                : '收录站点补齐标签后，这里会出现可按热度浏览的标签云。'
            }
            action={
              <Button asChild size="sm" variant="outline" className="text-xs">
                <Link href="/">去主页浏览站点</Link>
              </Button>
            }
          />
        ) : filteredTags.length === 0 ? (
          <EmptyState
            icon={Search}
            iconTone="muted"
            title={`暂未找到与 “${searchQuery}” 匹配的技术标签`}
            description={<>标签并没有丢：共有 {tags.length} 个标签，只是当前关键词没匹配到。</>}
            action={
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setSearchQuery('')}>
                清除搜索
              </Button>
            }
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 p-5 sm:p-7 rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xs shadow-2xs">
            {filteredTags.map((t) => {
              const isHeavy = t.count >= 10
              const isMedium = t.count >= 4
              return (
                <Link
                  key={t.id}
                  href={'/tags/' + encodeURIComponent(t.slug)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all duration-150 transform hover:scale-105 active:scale-95 ${
                    isHeavy
                      ? 'bg-primary/10 hover:bg-primary/15 border-primary/30 text-primary font-semibold shadow-2xs'
                      : isMedium
                      ? 'bg-card hover:bg-accent border-border/80 text-foreground font-medium shadow-2xs'
                      : 'bg-muted/40 hover:bg-muted/80 border-border/50 text-muted-foreground hover:text-foreground text-xs'
                  }`}
                  title={`${t.count} 个站点收录`}
                >
                  <Hash className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs sm:text-sm">{t.name}</span>
                  <span
                    className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                      isHeavy
                        ? 'bg-primary text-primary-foreground font-bold'
                        : 'bg-muted text-muted-foreground border border-border/40'
                    }`}
                  >
                    {t.count}
                  </span>
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
