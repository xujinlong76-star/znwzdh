'use client'

import React, { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { safeWindowOpen } from '@/lib/safe-url'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { PlayCircle, Clock, Check, Download, Bookmark, Play, Eye, User, ExternalLink, Sparkles, MonitorPlay, FileText } from 'lucide-react'
import type { NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { formatDuration } from '@/lib/video-format'
import { isInWatchLater, toggleWatchLater, PLAYLIST_UPDATE_EVENT } from '@/lib/user-playlists'
import { saveOfflineVideo, isOfflineVideo } from '@/lib/offline-video-cache'
import { VideoBilibiliHdPlayer } from '@/components/video-bilibili-hd-player'
import { buildVideoEmbedUrlForSeo } from '@/lib/video-seo'
import { VIDEO_PLATFORM_REGISTRY } from '@/lib/video-platform-registry'
import Image from 'next/image'
import Link from 'next/link'

interface VideoCardProps {
    item: NavigationSubItem
    siteConfig?: SiteConfig
    /** 首屏第一张封面：预加载以压低 LCP，其余卡片保持懒加载 */
    priority?: boolean
    /** 顶层弹窗播放回调：由页面级单例弹窗接管，杜绝在 360+ 网格卡片内挂载 Portal 导致 3 秒重排 */
    onPlay?: (item: NavigationSubItem) => void
}

export const VideoCard = React.memo(function VideoCard({ item, siteConfig, priority = false, onPlay }: VideoCardProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [imageLoaded, setImageLoaded] = useState(false)
    const [imageError, setImageError] = useState(false)
    const [isUsingProxy, setIsUsingProxy] = useState(false)
    const [inWatchLater, setInWatchLater] = useState(false)
    const [isSavedOffline, setIsSavedOffline] = useState(false)
    const { videoConfig } = item

    useEffect(() => {
        setInWatchLater(isInWatchLater(item.id))
        // 离线状态只影响角标显示，探测失败时保持「未离线」即可，不影响播放
        isOfflineVideo(item.id).then(setIsSavedOffline).catch(() => { /* 见上：纯装饰性状态 */ })

        const handleSync = () => {
            setInWatchLater(isInWatchLater(item.id))
        }
        if (typeof window !== 'undefined') {
            window.addEventListener(PLAYLIST_UPDATE_EVENT, handleSync)
            return () => window.removeEventListener(PLAYLIST_UPDATE_EVENT, handleSync)
        }
    }, [item.id])

    const handleToggleWatchLater = (e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        const added = toggleWatchLater(item)
        setInWatchLater(added)
    }

    const handleSaveOffline = async (e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        await saveOfflineVideo(item)
        setIsSavedOffline(true)
    }

    const isExternalIcon = item.icon?.startsWith('http') || item.icon?.startsWith('//')
    const isLocalIcon = item.icon && !isExternalIcon

    const coverPath = isLocalIcon && item.icon
        ? item.icon.startsWith('/')
            ? item.icon
            : `/${item.icon}`
        : item.icon || ''

    // 处理可能以 // 或 http:// 开头的 URL，统一升级为 https:// 防止 Mixed Content 警告
    const rawCoverPath = coverPath.startsWith('//')
        ? `https:${coverPath}`
        : coverPath.startsWith('http://')
            ? `https://${coverPath.slice('http://'.length)}`
            : coverPath

    // 默认尝试直链；触发防盗链拦截或 CDN 错误时，降级到服务端预签的代理地址
    // （签名不能在这里现算：node:crypto 会把 buffer/crypto 垫片打进客户端包）
    // 特别说明：对于 Bilibili（hdslb.com / biliimg.com）等存在已知严格防盗链及网络重置（net::ERR_CONNECTION_CLOSED）的域，
    // 若服务端已下发预签代理 URL，直接优先走代理，避免首屏控制台大量 ERR 噪音与闪烁重试
    const isStrictAntiLeech = rawCoverPath.includes('hdslb.com') || rawCoverPath.includes('biliimg.com')
    const normalizedCoverPath = (isUsingProxy || isStrictAntiLeech) && item.mediaProxyIconUrl
        ? item.mediaProxyIconUrl
        : rawCoverPath

    const handleCoverError = () => {
        if (!isUsingProxy && item.mediaProxyIconUrl && !isStrictAntiLeech) {
            setIsUsingProxy(true)
            setImageLoaded(false)
        } else {
            setImageError(true)
        }
    }

    // 卡片本身就是按钮（见下方根元素）：键盘 Enter / 空格会走同一条路径，
    // 不再依赖鼠标点击 —— 视频卡片此前是一个纯 <div onClick>，没有任何可聚焦元素，
    // 键盘与读屏用户根本没法打开视频。
    const handleCardClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        // 点击时立即解除卡片按钮的 DOM 焦点，避免弹窗唤起后被标记 aria-hidden 的父容器内保留焦点，
        // 从而彻底杜绝 WAI-ARIA 规范冲突与 Chrome 750ms 强制重排
        e.currentTarget.blur()
        if (onPlay && videoConfig) {
            onPlay(item)
            return
        }
        if (videoConfig) {
            setIsOpen(true)
        } else if (item.href) {
            safeWindowOpen(item.href)
        }
    }

    const renderVideoContent = () => {
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
                    poster={normalizedCoverPath || undefined}
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
                    ></iframe>
                </div>
            )
        }

        return null
    }

    // 获取平台标识
    const getPlatformBadge = () => {
        const platform = videoConfig?.type || 'bilibili'
        const platformMeta = VIDEO_PLATFORM_REGISTRY[platform] || VIDEO_PLATFORM_REGISTRY.custom

        return (
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
                <span
                    className="px-2 py-0.5 text-[11px] font-semibold text-white rounded-md shadow-xs backdrop-blur-md tracking-tight"
                    style={{ backgroundColor: platformMeta.badgeColor }}
                >
                    {platformMeta.shortName}
                </span>
                {videoConfig?.sourceType === 'auto_trend' && (
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/95 text-amber-950 dark:text-amber-100 rounded-md shadow-xs backdrop-blur-md">
                        🔥 热门
                    </span>
                )}
                {videoConfig?.qualityScore && videoConfig.qualityScore >= 90 && (
                    <span className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-semibold bg-violet-600/90 text-white rounded-md shadow-xs backdrop-blur-md">
                        <Sparkles className="w-2.5 h-2.5" />
                        精选
                    </span>
                )}
            </div>
        )
    }

    return (
        <>
            <div
                className="group relative cursor-pointer text-left w-full overflow-hidden rounded-xl bg-card border border-border/50 
                           transition-all duration-300 ease-out depth-card hover:shadow-xl hover:shadow-primary/5 
                           hover:border-primary/20 hover:-translate-y-1"
            >
                {/* 主点击区必须是真 <button>：键盘可达、读屏识别为按钮。
                    右上角「稍后再看 / 离线缓存」是独立按钮，必须放在它**之外** ——
                    嵌套 <button> 是非法 HTML，浏览器会重排 DOM 并触发 hydration 告警，
                    此前正是因此退回了 <div role="button">。 */}
                <button
                    type="button"
                    onClick={handleCardClick}
                    className="block w-full text-left"
                >
                {/* 封面图区域 */}
                <div className="relative aspect-video overflow-hidden bg-muted">
                    {/* 封面图 */}
                    {normalizedCoverPath && !imageError ? (
                        <>
                            {/* 骨架屏加载效果 */}
                            {!imageLoaded && (
                                <div className="absolute inset-0 bg-gradient-to-r from-muted via-muted-foreground/10 to-muted animate-pulse" />
                            )}
                            <Image
                                src={normalizedCoverPath}
                                alt=""
                                fill
                                priority={priority}
                                loading={priority ? "eager" : "lazy"}
                                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                referrerPolicy="no-referrer"
                                className={`object-cover transition-all duration-500 
                                           group-hover:scale-105 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                                onLoad={() => setImageLoaded(true)}
                                onError={handleCoverError}
                            />
                        </>
                    ) : (
                        /* 默认占位符 */
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted-foreground/20">
                            <PlayCircle className="w-16 h-16 text-muted-foreground/30" />
                        </div>
                    )}

                    {/* 播放按钮遮罩 */}
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/35 backdrop-blur-[1px] transition-all duration-300 
                                    flex items-center justify-center pointer-events-none">
                        <div className="w-12 h-12 rounded-full bg-white/95 dark:bg-white/90 text-primary 
                                        flex items-center justify-center opacity-0 group-hover:opacity-100 
                                        transform scale-75 group-hover:scale-100 transition-all duration-300
                                        shadow-xl">
                            <Play className="w-5 h-5 ml-0.5 fill-current" />
                        </div>
                    </div>

                    {/* 平台标识 */}
                    {getPlatformBadge()}

                    {/* 时长角标 */}
                    {videoConfig?.durationSec ? (
                        <span className="absolute bottom-2.5 right-2.5 px-2 py-0.5 text-[11px] font-mono font-medium bg-black/80 text-white/95 rounded-md backdrop-blur-md shadow-xs z-10">
                            {formatDuration(videoConfig.durationSec)}
                        </span>
                    ) : null}

                    {/* 渐变遮罩 - 底部 */}
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/60 to-transparent" />
                </div>

                {/* 标题区域 */}
                <div className="p-3.5 space-y-1.5">
                    {/* button 只允许 phrasing content：标题用 span，
                        卡片名由可见文本提供，封面 alt 留空避免重复朗读 */}
                    <span className="block font-semibold text-sm leading-snug line-clamp-2 text-foreground 
                                   group-hover:text-primary transition-colors duration-200 min-h-[2.5rem]">
                        {item.title}
                    </span>

                    {videoConfig?.author && (
                        <div className="text-[11px] text-muted-foreground/80 flex items-center justify-between pt-0.5">
                            <span className="truncate flex items-center gap-1.5 font-medium text-foreground/80 max-w-[65%]">
                                <User className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                                <span className="truncate">{videoConfig.author}</span>
                            </span>
                            {videoConfig.stats?.views ? (
                                <span className="shrink-0 font-mono text-[11px] text-muted-foreground/75 tabular-nums flex items-center gap-1">
                                    <Eye className="w-3 h-3 opacity-70" />
                                    {videoConfig.stats.views > 10000
                                        ? `${(videoConfig.stats.views / 10000).toFixed(1)}万次`
                                        : `${videoConfig.stats.views}次`}
                                </span>
                            ) : null}
                        </div>
                    )}

                    {item.description && (
                        <p className="text-xs text-muted-foreground/75 line-clamp-1 leading-relaxed">
                            {item.description}
                        </p>
                    )}
                </div>
                </button>

                {/* 右上角快捷操作：稍后再看 / 离线缓存 */}
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-20">
                    <button
                        type="button"
                        onClick={handleToggleWatchLater}
                        title={inWatchLater ? '已加入稍后再看' : '稍后再看'}
                        className={`p-1.5 rounded-lg backdrop-blur-md transition-all duration-200 ${
                            inWatchLater
                                ? 'bg-primary text-primary-foreground shadow-md'
                                : 'bg-black/60 text-white/80 hover:bg-black/85 hover:text-white'
                        }`}
                    >
                        {inWatchLater ? <Check className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        type="button"
                        onClick={handleSaveOffline}
                        title={isSavedOffline ? '已离线缓存' : '离线缓存'}
                        className={`p-1.5 rounded-lg backdrop-blur-md transition-all duration-200 ${
                            isSavedOffline
                                ? 'bg-emerald-600 text-white shadow-md'
                                : 'bg-black/60 text-white/80 hover:bg-black/85 hover:text-white'
                        }`}
                    >
                        <Download className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* 降级弹窗：当卡片未接入页面单例时保留自封闭播放能力 */}
            {isOpen && videoConfig && !onPlay && (
                <VideoPlayerModal
                    item={item}
                    siteConfig={siteConfig}
                    open={isOpen}
                    onOpenChange={setIsOpen}
                />
            )}
        </>
    )
})

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
