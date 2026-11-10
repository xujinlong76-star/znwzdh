'use client'

/**
 * 页面单例视频播放弹窗（从 video-card.tsx 拆出，2026-11-10 包体积治理）：
 * 弹窗只在用户点开视频后出现，独立成模块后可被 dynamic 懒加载，
 * 不再压在 /videos 网格页的首屏包里。实现与行为与拆分前完全一致。
 */
import React, { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { safeWindowOpen } from '@/lib/safe-url'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Clock, Check, ExternalLink, Eye, User, MonitorPlay, FileText } from 'lucide-react'
import type { NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { isInWatchLater, toggleWatchLater, PLAYLIST_UPDATE_EVENT } from '@/lib/user-playlists'
import { buildVideoEmbedUrlForSeo } from '@/lib/video-embed-url'
import { VIDEO_PLATFORM_REGISTRY } from '@/lib/video-platform-registry'

const VideoBilibiliHdPlayer = dynamic(
  () => import('@/components/video-bilibili-hd-player').then((m) => m.VideoBilibiliHdPlayer),
  { ssr: false },
)

/**
 * 页面单例视频播放弹窗组件：
 * 挂载在最外层 DOM，避免在网格中多重触发重排与 Accessibility 树全表重算
 */
export function VideoPlayerModal({
    item,
    siteConfig,
    open,
    onOpenChange,
}: {
    item: NavigationSubItem
    siteConfig?: SiteConfig
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const { videoConfig } = item
    const [inWatchLater, setInWatchLater] = useState(false)

    useEffect(() => {
        setInWatchLater(isInWatchLater(item.id))
        const handleSync = () => setInWatchLater(isInWatchLater(item.id))
        window.addEventListener(PLAYLIST_UPDATE_EVENT, handleSync)
        return () => window.removeEventListener(PLAYLIST_UPDATE_EVENT, handleSync)
    }, [item.id])

    const handleToggleWatchLater = (e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        const added = toggleWatchLater(item)
        setInWatchLater(added)
    }

    const renderContent = () => {
        if (!videoConfig) return null
        if (videoConfig.type === 'bilibili') {
            const { bvid, aid, cid, p = 1 } = videoConfig
            return (
                <VideoBilibiliHdPlayer
                    bvid={bvid}
                    aid={aid}
                    cid={cid}
                    p={p}
                    title={item.title}
                    poster={item.mediaProxyIconUrl || item.icon}
                    autoPlay={true}
                    className="rounded-lg"
                />
            )
        }
        const embedUrl = buildVideoEmbedUrlForSeo(videoConfig)
        if (embedUrl) {
            return (
                <div className="w-full aspect-video">
                    <iframe
                        className="w-full h-full rounded-lg"
                        src={embedUrl}
                        title={item.title}
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                    />
                </div>
            )
        }
        return null
    }

    if (!videoConfig) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-[920px] p-0 overflow-hidden bg-zinc-950 border-zinc-800 gap-0 shadow-2xl rounded-2xl"
            >
                {/* 无障碍访问 */}
                <div className="sr-only">
                    <DialogTitle>{item.title}</DialogTitle>
                    <DialogDescription>正在播放：{item.title}</DialogDescription>
                </div>

                {/* 视频播放器 */}
                <div className="bg-black">
                    {renderContent()}
                </div>

                {/* 视频信息与操作栏 */}
                <div className="p-4 sm:p-5 bg-zinc-900/90 border-t border-zinc-800 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <span
                                    className="px-2 py-0.5 text-[10px] font-semibold text-white rounded"
                                    style={{ backgroundColor: (VIDEO_PLATFORM_REGISTRY[videoConfig?.type || 'bilibili'] || VIDEO_PLATFORM_REGISTRY.custom).badgeColor }}
                                >
                                    {(VIDEO_PLATFORM_REGISTRY[videoConfig?.type || 'bilibili'] || VIDEO_PLATFORM_REGISTRY.custom).shortName}
                                </span>
                                {videoConfig?.author && (
                                    <span className="text-xs text-zinc-400 flex items-center gap-1">
                                        <User className="w-3 h-3 text-zinc-500" />
                                        {videoConfig.author}
                                    </span>
                                )}
                                {videoConfig?.stats?.views ? (
                                    <span className="text-xs text-zinc-400 font-mono flex items-center gap-1">
                                        <Eye className="w-3 h-3 text-zinc-500" />
                                        {videoConfig.stats.views > 10000
                                            ? `${(videoConfig.stats.views / 10000).toFixed(1)}万次观看`
                                            : `${videoConfig.stats.views}次观看`}
                                    </span>
                                ) : null}
                            </div>
                            <h3 className="text-white font-semibold text-base sm:text-lg line-clamp-2 tracking-tight">
                                {item.title}
                            </h3>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={handleToggleWatchLater}
                                className={cn(
                                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                                    inWatchLater
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                                )}
                            >
                                {inWatchLater ? <Check className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                                <span>稍后再看</span>
                            </button>
                            {item.href && (
                                <button
                                    type="button"
                                    onClick={() => safeWindowOpen(item.href)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    <span>原站直达</span>
                                </button>
                            )}
                            <Link
                                href={`/videos/v/${encodeURIComponent(item.id)}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                                title="查看独立详情与关键时刻目录"
                            >
                                <FileText className="w-3.5 h-3.5" />
                                <span>详情</span>
                            </Link>
                            <Link
                                href={`/videos/player?id=${encodeURIComponent(item.id)}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white transition-colors"
                            >
                                <MonitorPlay className="w-3.5 h-3.5" />
                                <span>演播室</span>
                            </Link>
                        </div>
                    </div>
                    {item.description && (
                        <p className="text-zinc-400 text-xs sm:text-sm line-clamp-2 leading-relaxed border-t border-zinc-800/60 pt-2.5">
                            {item.description}
                        </p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
