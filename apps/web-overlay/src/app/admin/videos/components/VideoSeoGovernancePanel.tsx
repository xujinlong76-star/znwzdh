'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Button } from "@/registry/new-york/ui/button"
import { Badge } from "@/registry/new-york/ui/badge"
import { useToast } from "@/registry/new-york/hooks/use-toast"
import { Input } from "@/registry/new-york/ui/input"
import {
    Sparkles,
    Search,
    Globe,
    CheckCircle2,
    AlertCircle,
    ExternalLink,
    RefreshCw,
    Send,
    ChevronDown,
    ChevronUp,
    FileText,
    Rss,
} from 'lucide-react'
import { VIDEO_PLATFORM_REGISTRY } from '@/lib/video-platform-registry'
import type { VideoPlatformType } from '@/types/navigation'

interface SeoIndexResponse {
    ok: boolean
    audit?: {
        totalVideos: number
        indexableVideos: number
        excludedBrokenOrDisabled: number
        withRichDescription: number
        withHttpsThumbnail: number
        withKeyMomentsChapters: number
        withSeoKeywords: number
        seoScore: number
        platformBreakdown: Record<string, number>
        recommendations: string[]
    }
    platformCounts?: Record<string, number>
    sitemapUrl?: string
    rssFeedUrl?: string
    sampleLandingUrls?: Array<{
        id: string
        title: string
        platform: string
        url: string
        seoSlug?: string
    }>
}

async function seoFetcher(url: string): Promise<SeoIndexResponse> {
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to load SEO index status')
    return res.json()
}

export function VideoSeoGovernancePanel({ onRefresh }: { onRefresh?: () => void }) {
    const { toast } = useToast()
    const [isExpanded, setIsExpanded] = useState(true)
    const [isEnriching, setIsEnriching] = useState(false)
    const [isPingingIndexNow, setIsPingingIndexNow] = useState(false)
    const [indexNowKey, setIndexNowKey] = useState('')

    const { data, mutate, isLoading } = useSWR<SeoIndexResponse>(
        '/api/videos/seo-index',
        seoFetcher,
        { revalidateOnFocus: false }
    )

    const audit = data?.audit
    const platformCounts = data?.platformCounts || {}

    const handleBatchEnrich = async () => {
        setIsEnriching(true)
        try {
            const res = await fetch('/api/videos/seo-index', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || '批量富化失败')
            }
            const resData = await res.json()
            await mutate()
            onRefresh?.()
            toast({
                title: 'SEO 结构化富化完成',
                description: `已为 ${resData.enrichedCount || 0} 部视频补齐 SEO 标题、语义 Slug 与结构化摘要。`,
            })
        } catch (err) {
            toast({
                title: '富化失败',
                description: (err as Error).message || '网络请求错误',
                variant: 'destructive',
            })
        } finally {
            setIsEnriching(false)
        }
    }

    const handleIndexNowPing = async () => {
        setIsPingingIndexNow(true)
        try {
            const res = await fetch('/api/videos/seo-index', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ indexNowKey: indexNowKey.trim() || undefined }),
            })
            if (!res.ok) throw new Error('推送失败')
            const resData = await res.json()
            toast({
                title: 'IndexNow 推送成功',
                description: `已向搜索引擎主动提交 ${resData.indexNowSubmitted || 0} 个可索引落地页。`,
            })
        } catch (err) {
            toast({
                title: '推送失败',
                description: (err as Error).message,
                variant: 'destructive',
            })
        } finally {
            setIsPingingIndexNow(false)
        }
    }

    if (isLoading) {
        return (
            <div className="p-4 rounded-xl border border-border/80 bg-card text-xs text-muted-foreground animate-pulse">
                正在加载全库 SEO 索引与多平台就绪度分析...
            </div>
        )
    }

    if (!data?.ok || !audit) return null

    const seoScore = audit.seoScore ?? 85
    const scoreColor =
        seoScore >= 90
            ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10'
            : seoScore >= 75
                ? 'text-amber-500 border-amber-500/30 bg-amber-500/10'
                : 'text-rose-500 border-rose-500/30 bg-rose-500/10'

    return (
        <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs space-y-4">
            {/* 面板头部 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <Globe className="h-5 w-5" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-base font-bold tracking-tight text-foreground">
                                搜索引擎收录 (SEO) 与多平台分布治理
                            </h2>
                            <Badge variant="outline" className={`text-xs font-semibold px-2 py-0.5 ${scoreColor}`}>
                                就绪度评分: {seoScore} / 100
                            </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            支持国内外 12+ 视频平台聚合收录，为每部视频自动挂载 Schema.org VideoObject、Google Key Moments 与语义落地页
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleBatchEnrich}
                        disabled={isEnriching}
                        className="text-xs h-8.5 gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                    >
                        <Sparkles className={`h-3.5 w-3.5 ${isEnriching ? 'animate-spin' : ''}`} />
                        <span>{isEnriching ? '富化中...' : '全库一键 SEO 增强'}</span>
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8.5 w-8.5"
                        onClick={() => setIsExpanded(prev => !prev)}
                        title={isExpanded ? '收起详情' : '展开详情'}
                    >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                </div>
            </div>

            {/* 核心指标统计卡片 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
                <div className="p-3 rounded-lg bg-muted/40 border border-border/60 space-y-1">
                    <span className="text-muted-foreground">可索引有效视频</span>
                    <div className="text-lg font-bold text-foreground flex items-center gap-1.5">
                        <span>{audit.indexableVideos} 部</span>
                        <span className="text-[10px] text-muted-foreground font-normal">
                            ({Math.round((audit.indexableVideos / Math.max(1, audit.totalVideos)) * 100)}%)
                        </span>
                    </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/40 border border-border/60 space-y-1">
                    <span className="text-muted-foreground">Key Moments 章节覆盖</span>
                    <div className="text-lg font-bold text-amber-600 dark:text-amber-400">
                        {audit.withKeyMomentsChapters} 部
                    </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/40 border border-border/60 space-y-1">
                    <span className="text-muted-foreground">HTTPS 规范缩略图</span>
                    <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                        {audit.withHttpsThumbnail} 部
                    </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/40 border border-border/60 space-y-1">
                    <span className="text-muted-foreground">SEO 长尾关键词覆盖</span>
                    <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                        {audit.withSeoKeywords} 部
                    </div>
                </div>
            </div>

            {/* 展开区域：多平台分布胶囊与 IndexNow 提交 */}
            {isExpanded && (
                <div className="space-y-4 pt-2 border-t border-border/60 text-xs">
                    {/* 多平台内容源分布 */}
                    <div className="space-y-2">
                        <div className="font-semibold text-foreground flex items-center justify-between">
                            <span>国内外 12+ 视频平台分布</span>
                            <span className="text-muted-foreground font-normal">
                                已接入 {Object.keys(platformCounts).length} 个平台来源
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(VIDEO_PLATFORM_REGISTRY).map(([id, meta]) => {
                                const count = platformCounts[id] || 0
                                return (
                                    <div
                                        key={id}
                                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/70 bg-card"
                                    >
                                        <span
                                            className="w-2 h-2 rounded-full"
                                            style={{ backgroundColor: meta.badgeColor }}
                                        />
                                        <span className="font-medium text-foreground">{meta.shortName}</span>
                                        <Badge variant="secondary" className="text-[10px] h-4 px-1 py-0 font-mono">
                                            {count}
                                        </Badge>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* SEO 优化建议提示 */}
                    {audit.recommendations.length > 0 && (
                        <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 space-y-1.5">
                            <div className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>搜索引擎收录优化建议</span>
                            </div>
                            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                                {audit.recommendations.map((rec, idx) => (
                                    <li key={idx} className="leading-relaxed">{rec}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* 快捷出口与 IndexNow 推送入口 */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-border/40">
                        <div className="flex flex-wrap items-center gap-2">
                            {data.sitemapUrl && (
                                <a
                                    href={data.sitemapUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border/80 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    <FileText className="h-3.5 w-3.5 text-amber-500" />
                                    <span>Google Video Sitemap (XML) ↗</span>
                                </a>
                            )}
                            {data.rssFeedUrl && (
                                <a
                                    href={data.rssFeedUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border/80 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    <Rss className="h-3.5 w-3.5 text-orange-500" />
                                    <span>MRSS 视频广播订阅源 (XML) ↗</span>
                                </a>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            <Input
                                placeholder="IndexNow Key (选填)..."
                                aria-label="IndexNow Key（选填）"
                                value={indexNowKey}
                                onChange={(e) => setIndexNowKey(e.target.value)}
                                className="h-8 text-xs w-44 bg-background"
                            />
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleIndexNowPing}
                                disabled={isPingingIndexNow}
                                className="h-8 text-xs gap-1"
                                title="向 Bing/Yandex/IndexNow 立即提交最新视频落地页"
                            >
                                <Send className="h-3 w-3" />
                                <span>{isPingingIndexNow ? '提交中...' : '推送 IndexNow'}</span>
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
