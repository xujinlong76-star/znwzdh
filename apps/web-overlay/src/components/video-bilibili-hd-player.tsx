'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Sparkles,
  RefreshCw,
  Tv,
  KeyRound,
  ShieldCheck,
  Check,
  X,
  Loader2,
  Layers,
  Shuffle,
  ChevronDown,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
// 只从 client-safe 模块取值：解析器顶层引用 bilibili-wbi（node:crypto），
// 从它 import 会把 node 内建带进浏览器包
import { buildBilibiliEmbedUrl, ensureHttpsUrl } from '@/lib/video-bilibili-hd-url'
import type { BilibiliHdParseResult } from '@/lib/video-bilibili-hd-parser'

const BILI_ACCESS_KEY_STORAGE = 'navhub_bili_access_key'
const BILI_PLAY_MODE_STORAGE = 'navhub_bili_prefer_mode'
const BILI_SELECTED_ENGINE_STORAGE = 'navhub_bili_selected_engine'

export interface BiliEngineOption {
  id: string
  name: string
  shortLabel: string
  tag: string
  tagColor: string
  desc: string
  quality: string
}

export const BILI_ENGINE_OPTIONS: BiliEngineOption[] = [
  {
    id: 'auto',
    name: '自动最优（多源容灾）',
    shortLabel: '自动优选',
    tag: '智能推荐',
    tagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    desc: '按可用性自动在 6 个解析引擎间毫秒级故障转移',
    quality: '720P / 1080P+',
  },
  {
    id: 'xingzhige',
    name: '星之阁 API（首选源）',
    shortLabel: '星之阁 HD',
    tag: '主通道',
    tagColor: 'bg-[#FB7299]/20 text-[#FB7299] border-[#FB7299]/30',
    desc: '免登录 720P / 填入 access_key 可解锁大会员 1080P+',
    quality: '720P ~ 1080P+',
  },
  {
    id: 'mir6',
    name: '米人 API（备用源 1）',
    shortLabel: '米人 API',
    tag: '备用 1',
    tagColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    desc: '免登录 720P MP4 直链高速解析通道',
    quality: '720P',
  },
  {
    id: 'bilibili_wbi',
    name: '官方 WBI 签名（备用源 2）',
    shortLabel: '官方 WBI',
    tag: '备用 2',
    tagColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    desc: '基于官方 mixinKey 算法动态算签 playurl 接口',
    quality: '720P',
  },
  {
    id: 'bilibili_html5',
    name: '官方 HTML5 直连（备用源 3）',
    shortLabel: 'HTML5 直连',
    tag: '备用 3',
    tagColor: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    desc: '官方 Web HTML5 高可用 CDN 直连通道',
    quality: '720P',
  },
  {
    id: 'bilibili_pc',
    name: '官方 PC 兼容源（备用源 4）',
    shortLabel: 'PC 兼容源',
    tag: '备用 4',
    tagColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    desc: 'B 站 PC 端 UPOS 节点分流直连',
    quality: '720P/480P',
  },
  {
    id: 'bilibili_android',
    name: '官方 Android 分流（备用源 5）',
    shortLabel: '移动端源',
    tag: '备用 5',
    tagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    desc: 'B 站 Android 移动客户端容灾分流节点',
    quality: '720P/480P',
  },
  {
    id: 'iframe',
    name: 'B 站官方内嵌播放器（保底）',
    shortLabel: '官方内嵌',
    tag: '保底模式',
    tagColor: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',
    desc: '官方 iframe 原版播放器，保留完整官方弹幕与交互',
    quality: '自动',
  },
]

export interface VideoBilibiliHdPlayerProps {
  bvid?: string
  aid?: string
  cid?: string
  p?: number
  title?: string
  poster?: string
  autoPlay?: boolean
  /** 章节跳转目标秒数（变化时原生 <video> 直接 seek，无需重载整页） */
  seekSec?: number | null
  /** 紧凑模式（用于右下角迷你悬浮窗） */
  compact?: boolean
  className?: string
  /** 播放进度回调（原生 <video> 可将真实播放秒数同步给外层字幕/章节轴） */
  onTimeUpdateSec?: (currentTimeSec: number, durationSec: number) => void
  /** 外部指定的解析引擎偏好 */
  preferredEngine?: string
  /** 当解析源变更时的回调 */
  onEngineChange?: (engineId: string, engineName: string) => void
}

type DeliveryStage = 'direct' | 'proxy' | 'iframe'

export function VideoBilibiliHdPlayer({
  bvid,
  aid,
  cid,
  p = 1,
  title = '哔哩哔哩视频',
  poster,
  autoPlay = true,
  seekSec = null,
  compact = false,
  className,
  onTimeUpdateSec,
  preferredEngine,
  onEngineChange,
}: VideoBilibiliHdPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const pendingSeekRef = useRef<number | null>(seekSec && seekSec > 0 ? seekSec : null)

  const [parseResult, setParseResult] = useState<BilibiliHdParseResult | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [deliveryStage, setDeliveryStage] = useState<DeliveryStage>('direct')
  const [userPreferIframe, setUserPreferIframe] = useState<boolean>(false)
  const [accessKey, setAccessKey] = useState<string>('')
  const [accessKeyDraft, setAccessKeyDraft] = useState<string>('')
  const [showKeyPanel, setShowKeyPanel] = useState<boolean>(false)
  const [showEnginePanel, setShowEnginePanel] = useState<boolean>(false)
  const [selectedEngine, setSelectedEngine] = useState<string>(preferredEngine || 'auto')
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null)
  const [streamErrorNotice, setStreamErrorNotice] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState<number>(0)

  // 初始化读取本地保存的 access_key、播放模式与首选解析线路
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const savedKey = window.localStorage.getItem(BILI_ACCESS_KEY_STORAGE) || ''
      setAccessKey(savedKey)
      setAccessKeyDraft(savedKey)
      const savedMode = window.localStorage.getItem(BILI_PLAY_MODE_STORAGE)
      if (savedMode === 'iframe') {
        setUserPreferIframe(true)
      }
      if (!preferredEngine) {
        const savedEngine = window.localStorage.getItem(BILI_SELECTED_ENGINE_STORAGE)
        if (savedEngine && BILI_ENGINE_OPTIONS.some(o => o.id === savedEngine)) {
          setSelectedEngine(savedEngine)
          if (savedEngine === 'iframe') {
            setUserPreferIframe(true)
          }
        }
      }
    } catch {
      // 忽略隐私模式 localStorage 异常
    }
  }, [preferredEngine])

  // 外部 preferredEngine prop 变化时同步更新
  useEffect(() => {
    if (preferredEngine && preferredEngine !== selectedEngine) {
      setSelectedEngine(preferredEngine)
      if (preferredEngine === 'iframe') {
        setUserPreferIframe(true)
        setDeliveryStage('iframe')
      } else {
        setUserPreferIframe(false)
        setDeliveryStage('direct')
        setRefreshTick(t => t + 1)
      }
    }
  }, [preferredEngine])

  // 请求服务端 /api/videos/bili-parse 解析高清视频流
  useEffect(() => {
    if (!bvid && !aid) {
      setIsLoading(false)
      return
    }

    if (selectedEngine === 'iframe') {
      setIsLoading(false)
      setUserPreferIframe(true)
      setDeliveryStage('iframe')
      return
    }

    const controller = new AbortController()
    setIsLoading(true)

    const params = new URLSearchParams()
    if (bvid) params.set('bvid', bvid)
    if (aid) params.set('aid', aid)
    if (cid) params.set('cid', cid)
    params.set('p', String(Math.max(1, p)))
    if (accessKey.trim()) {
      params.set('access_key', accessKey.trim())
    }
    if (selectedEngine && selectedEngine !== 'auto') {
      params.set('engine', selectedEngine)
    }
    if (refreshTick > 0 || (selectedEngine && selectedEngine !== 'auto')) {
      params.set('refresh', '1')
    }

    fetch(`/api/videos/bili-parse?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async res => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        return (await res.json()) as BilibiliHdParseResult
      })
      .then(data => {
        if (controller.signal.aborted) return
        setParseResult(data)
        if (data.ok && data.streamUrl && !userPreferIframe) {
          setDeliveryStage('direct')
        } else {
          setDeliveryStage('iframe')
        }
        setIsLoading(false)
      })
      .catch(err => {
        if (controller.signal.aborted) return
        console.warn('[VideoBilibiliHdPlayer] 解析请求失败，自动切换官方内嵌模式:', err)
        setParseResult({
          ok: false,
          source: 'iframe_fallback',
          canonicalUrl: bvid ? `https://www.bilibili.com/video/${bvid}` : '',
          bvid,
          aid,
          cid,
          p,
          qualityLabel: '官方内嵌播放',
          embedUrl: buildBilibiliEmbedUrl({ bvid, aid, cid, p, autoplay: autoPlay, seekSec }),
          expiresAt: Date.now() + 60_000,
        })
        setDeliveryStage('iframe')
        setIsLoading(false)
      })

    return () => {
      controller.abort()
    }
  }, [bvid, aid, cid, p, accessKey, refreshTick, autoPlay, selectedEngine, userPreferIframe])

  // 处理章节/时间轴跳转：如果是原生 <video>，直接修改 currentTime，极其丝滑
  useEffect(() => {
    if (seekSec === null || seekSec === undefined || seekSec < 0) return
    pendingSeekRef.current = seekSec
    const videoEl = videoRef.current
    if (videoEl && videoEl.readyState >= 1) {
      try {
        videoEl.currentTime = seekSec
        pendingSeekRef.current = null
        if (videoEl.paused && autoPlay) {
          videoEl.play().catch(() => {
          /* 自动播放可能被浏览器策略拒绝（NotAllowedError）或被随后的 pause 打断；
             这里只是「尽力起播」，失败时视频保持暂停即可，无需上报 */
        })
        }
      } catch {
        // 等待 metadata 加载完成后再跳转
      }
    }
  }, [seekSec, autoPlay])

  const handleLoadedMetadata = useCallback(() => {
    const videoEl = videoRef.current
    if (!videoEl) return
    if (pendingSeekRef.current !== null && pendingSeekRef.current > 0) {
      try {
        videoEl.currentTime = pendingSeekRef.current
        pendingSeekRef.current = null
      } catch {
        // 忽略跳转异常
      }
    }
  }, [])

  // 三级容灾自动切换：CDN 直链 -> 同源 Range 流代理 -> B站官方内嵌 iframe
  const handleVideoError = useCallback(() => {
    const currentTime = videoRef.current?.currentTime
    if (typeof currentTime === 'number' && currentTime > 1) {
      pendingSeekRef.current = Math.floor(currentTime)
    }

    if (deliveryStage === 'direct' && parseResult?.proxyStreamUrl) {
      console.info('[VideoBilibiliHdPlayer] CDN 直链受阻，自动切换至同源 Range 流代理节点')
      setDeliveryStage('proxy')
    } else {
      console.info('[VideoBilibiliHdPlayer] 流媒体加载受阻，降级至 B 站官方内嵌播放器')
      setDeliveryStage('iframe')
      setStreamErrorNotice('当前直连线路加载受阻，可点击上方【一键换源】或【选择线路】切换其他备用接口。')
    }
  }, [deliveryStage, parseResult?.proxyStreamUrl])

  const handleSwitchEngine = useCallback((engineId: string) => {
    setSelectedEngine(engineId)
    setShowEnginePanel(false)
    setStreamErrorNotice(null)
    try {
      window.localStorage.setItem(BILI_SELECTED_ENGINE_STORAGE, engineId)
    } catch {
      // 忽略存储异常
    }

    const targetOpt = BILI_ENGINE_OPTIONS.find(o => o.id === engineId)
    const label = targetOpt?.shortLabel || engineId
    setFeedbackMsg(`已切换至【${label}】`)
    setTimeout(() => setFeedbackMsg(null), 2500)

    if (engineId === 'iframe') {
      setUserPreferIframe(true)
      setDeliveryStage('iframe')
    } else {
      setUserPreferIframe(false)
      setDeliveryStage('direct')
      setRefreshTick(t => t + 1)
    }

    if (onEngineChange) {
      onEngineChange(engineId, label)
    }
  }, [onEngineChange])

  const handleCycleNextEngine = useCallback(() => {
    const currentIndex = BILI_ENGINE_OPTIONS.findIndex(o => o.id === selectedEngine)
    const nextIndex = (currentIndex + 1) % BILI_ENGINE_OPTIONS.length
    const nextOption = BILI_ENGINE_OPTIONS[nextIndex]
    handleSwitchEngine(nextOption.id)
  }, [selectedEngine, handleSwitchEngine])

  const handleTogglePlayMode = () => {
    const nextPreferIframe = !userPreferIframe
    setUserPreferIframe(nextPreferIframe)
    if (!nextPreferIframe && parseResult?.ok && parseResult.streamUrl) {
      setDeliveryStage('direct')
      setSelectedEngine(prev => (prev === 'iframe' ? 'auto' : prev))
    } else if (nextPreferIframe) {
      setDeliveryStage('iframe')
    }
    try {
      window.localStorage.setItem(BILI_PLAY_MODE_STORAGE, nextPreferIframe ? 'iframe' : 'hd')
    } catch {
      // 忽略存储限制
    }
  }

  const handleSaveAccessKey = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = accessKeyDraft.trim()
    setAccessKey(trimmed)
    setShowKeyPanel(false)
    setRefreshTick(t => t + 1)
    try {
      if (trimmed) {
        window.localStorage.setItem(BILI_ACCESS_KEY_STORAGE, trimmed)
      } else {
        window.localStorage.removeItem(BILI_ACCESS_KEY_STORAGE)
      }
    } catch {
      // 忽略存储限制
    }
  }

  const fallbackEmbedUrl = buildBilibiliEmbedUrl({
    bvid: parseResult?.bvid || bvid,
    aid: parseResult?.aid || aid,
    cid: parseResult?.cid || cid,
    p,
    autoplay: autoPlay,
    seekSec,
  })

  const effectiveStage: DeliveryStage = userPreferIframe ? 'iframe' : deliveryStage
  const activeVideoSrc =
    effectiveStage === 'direct'
      ? parseResult?.streamUrl
      : effectiveStage === 'proxy'
        ? parseResult?.proxyStreamUrl
        : undefined

  const resolvedPoster = ensureHttpsUrl(poster) || parseResult?.coverUrl
  const qualityBadgeText =
    effectiveStage === 'iframe'
      ? '官方内嵌模式'
      : parseResult?.qualityLabel || '高清 720P'

  const activeEngineSource =
    effectiveStage === 'iframe'
      ? 'iframe'
      : (selectedEngine !== 'auto' ? selectedEngine : (parseResult?.source || 'auto'))

  const currentEngineOption =
    BILI_ENGINE_OPTIONS.find(o => o.id === activeEngineSource) ||
    BILI_ENGINE_OPTIONS.find(o => o.id === selectedEngine) ||
    BILI_ENGINE_OPTIONS[0]

  const engineBadgeText =
    effectiveStage === 'iframe'
      ? 'Bilibili Player'
      : effectiveStage === 'proxy'
        ? `${currentEngineOption.shortLabel} · 代理加速`
        : selectedEngine !== 'auto'
          ? `手动 · ${currentEngineOption.shortLabel}`
          : `${currentEngineOption.shortLabel} 直连`

  return (
    <div
      className={cn(
        'relative w-full aspect-video bg-black overflow-hidden group select-none',
        className
      )}
    >
      {/* 顶部悬浮高清控制栏（鼠标悬停时平滑浮现） */}
      {!compact && (
        <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between gap-2 px-3.5 py-2 bg-gradient-to-b from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200 pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FB7299]/90 text-white shadow-sm backdrop-blur-md">
              <Sparkles className="w-3 h-3" />
              <span>{engineBadgeText}</span>
              <span className="opacity-75">·</span>
              <span>{qualityBadgeText}</span>
            </span>

            {effectiveStage !== 'iframe' && parseResult?.ok && (
              <span
                className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 backdrop-blur-md"
                title="已通过星之阁与备用引擎解除站外 360P 限制"
              >
                <ShieldCheck className="w-3 h-3" />
                免登录高清
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 pointer-events-auto">
            {/* 手动选择解析线路下拉菜单 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowEnginePanel(v => !v)
                  setShowKeyPanel(false)
                }}
                title="手动选择 B 站解析线路 / 备用源"
                aria-label="手动选择 B 站解析线路"
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border backdrop-blur-md transition-all cursor-pointer shadow-sm",
                  showEnginePanel
                    ? "bg-[#FB7299] text-white border-[#FB7299]"
                    : "bg-zinc-900/85 hover:bg-zinc-800 text-zinc-100 border-white/15 hover:border-white/30"
                )}
              >
                <Layers className="w-3.5 h-3.5 text-[#FB7299]" />
                <span>{currentEngineOption.shortLabel}</span>
                <ChevronDown className={cn("w-3 h-3 text-zinc-400 transition-transform duration-200", showEnginePanel && "rotate-180 text-white")} />
              </button>

              {/* 线路选择浮动面板 */}
              {showEnginePanel && (
                <div
                  className="absolute top-9 right-0 z-50 w-72 p-2.5 rounded-xl bg-zinc-950/95 border border-white/20 shadow-2xl backdrop-blur-2xl text-xs text-zinc-200 space-y-2 animate-in fade-in-0 zoom-in-95 duration-150"
                  role="menu"
                >
                  <div className="flex items-center justify-between pb-1.5 border-b border-white/10">
                    <span className="font-semibold text-white flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-[#FB7299]" />
                      手动切换解析线路
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowEnginePanel(false)}
                      className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white"
                      aria-label="关闭线路选择"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <p className="text-[11px] text-zinc-400 leading-tight">
                    已就绪 6 个高可用备用接口，遇到卡顿或失效可随时手动切换：
                  </p>

                  <div className="space-y-1 pt-0.5 max-h-60 overflow-y-auto pr-0.5">
                    {BILI_ENGINE_OPTIONS.map(opt => {
                      const isSelected = selectedEngine === opt.id
                      const isCurrentActive =
                        opt.id === 'iframe'
                          ? effectiveStage === 'iframe'
                          : (isSelected || (selectedEngine === 'auto' && parseResult?.source === opt.id))

                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleSwitchEngine(opt.id)}
                          className={cn(
                            "w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all cursor-pointer border",
                            isCurrentActive
                              ? "bg-[#FB7299]/20 border-[#FB7299]/50 text-white shadow-sm"
                              : "bg-zinc-900/60 hover:bg-zinc-800/80 border-white/5 text-zinc-300 hover:text-white"
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-[11px] truncate">{opt.name}</span>
                              <span className={cn("px-1.5 py-0.2 rounded text-[9px] font-medium border", opt.tagColor)}>
                                {opt.tag}
                              </span>
                            </div>
                            <div className="text-[10px] text-zinc-400 mt-0.5 truncate">
                              {opt.desc}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] text-zinc-400">{opt.quality}</span>
                            {isCurrentActive && <Check className="w-3.5 h-3.5 text-[#FB7299]" />}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  <div className="pt-1.5 border-t border-white/10 flex items-center justify-between text-[11px] text-zinc-400">
                    <span>已持久化线路偏好</span>
                    <button
                      type="button"
                      onClick={handleCycleNextEngine}
                      className="inline-flex items-center gap-1 text-[#FB7299] hover:underline cursor-pointer"
                    >
                      <Shuffle className="w-3 h-3" />
                      <span>切下一源</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 一键换源快捷按钮 */}
            <button
              type="button"
              onClick={handleCycleNextEngine}
              title="一键换源：快速轮换下一个备用解析线路"
              aria-label="一键换源"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-zinc-900/85 hover:bg-zinc-800 text-zinc-100 border border-white/15 hover:border-white/30 backdrop-blur-md transition-colors cursor-pointer"
            >
              <Shuffle className="w-3 h-3 text-[#FB7299]" />
              <span className="hidden sm:inline">一键换源</span>
            </button>

            {/* 切换原生高清 / 官方内嵌 */}
            {parseResult?.ok && parseResult.streamUrl && (
              <button
                type="button"
                onClick={handleTogglePlayMode}
                title={effectiveStage === 'iframe' ? '切换至 HD 原生高清直连' : '切换至 B 站官方内嵌播放器'}
                className="hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-zinc-900/85 hover:bg-zinc-800 text-zinc-100 border border-white/15 backdrop-blur-md transition-colors cursor-pointer"
              >
                <Tv className="w-3 h-3 text-[#FB7299]" />
                <span>{effectiveStage === 'iframe' ? '切直连' : '切官方'}</span>
              </button>
            )}

            {/* 切换代理节点按钮（当处于直连模式时允许手动切代理） */}
            {effectiveStage === 'direct' && parseResult?.proxyStreamUrl && (
              <button
                type="button"
                onClick={() => setDeliveryStage('proxy')}
                title="若直连卡顿，可切换同源流代理加速"
                className="hidden lg:inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-zinc-900/85 hover:bg-zinc-800 text-zinc-200 border border-white/15 backdrop-blur-md transition-colors cursor-pointer"
              >
                <span>代理加速</span>
              </button>
            )}

            {/* Access Key 配置按钮（解锁 1080P+ 大会员画质） */}
            <button
              type="button"
              onClick={() => {
                setShowKeyPanel(v => !v)
                setShowEnginePanel(false)
              }}
              title="配置 B 站 access_key 解锁更高画质 (1080P+)"
              aria-label="配置 B 站 access_key"
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border backdrop-blur-md transition-colors cursor-pointer',
                accessKey
                  ? 'bg-amber-500/20 text-amber-200 border-amber-400/40 hover:bg-amber-500/30'
                  : 'bg-zinc-900/85 hover:bg-zinc-800 text-zinc-200 border-white/15'
              )}
            >
              <KeyRound className="w-3 h-3" />
              <span className="hidden sm:inline">{accessKey ? 'VIP 密钥已启用' : '1080P+ 密钥'}</span>
            </button>

            {/* 重新解析刷新按钮 */}
            <button
              type="button"
              onClick={() => setRefreshTick(t => t + 1)}
              title="重新解析当前线路视频流"
              aria-label="重新解析视频流"
              className="p-1.5 rounded-md bg-zinc-900/85 hover:bg-zinc-800 text-zinc-200 border border-white/15 backdrop-blur-md transition-colors cursor-pointer"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            </button>
          </div>
        </div>
      )}

      {/* 换源反馈气泡 */}
      {feedbackMsg && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-40 px-3.5 py-1.5 rounded-full bg-zinc-950/90 text-white border border-[#FB7299]/40 shadow-xl backdrop-blur-md text-xs font-medium flex items-center gap-1.5 pointer-events-none animate-in fade-in-0 slide-in-from-top-2 duration-200">
          <Check className="w-3.5 h-3.5 text-[#FB7299]" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* 播放受阻换源提示条 */}
      {streamErrorNotice && effectiveStage === 'iframe' && (
        <div className="absolute bottom-3 inset-x-3 z-30 flex items-center justify-between gap-2 p-2.5 rounded-lg bg-zinc-950/95 border border-amber-500/40 text-amber-200 text-xs backdrop-blur-md shadow-2xl animate-in fade-in-0 duration-200">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="truncate">{streamErrorNotice}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setStreamErrorNotice(null)
                handleCycleNextEngine()
              }}
              className="px-2.5 py-1 rounded bg-[#FB7299] hover:bg-[#fb7299]/90 text-white font-medium text-xs transition-colors cursor-pointer"
            >
              立即换源
            </button>
            <button
              type="button"
              onClick={() => {
                setShowEnginePanel(true)
                setStreamErrorNotice(null)
              }}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-xs transition-colors cursor-pointer"
            >
              选其他线路
            </button>
            <button
              type="button"
              onClick={() => setStreamErrorNotice(null)}
              className="p-1 text-zinc-400 hover:text-white"
              aria-label="关闭提示"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Access Key 浮动设置面板 */}
      {showKeyPanel && !compact && (
        <form
          onSubmit={handleSaveAccessKey}
          className="absolute top-11 right-3.5 z-30 w-80 p-3 rounded-xl bg-zinc-950/95 border border-white/15 shadow-2xl backdrop-blur-xl text-xs text-zinc-200 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-[#FB7299]" />
              星之阁 B 站解析 · Access Key
            </span>
            <button
              type="button"
              onClick={() => setShowKeyPanel(false)}
              title="关闭密钥设置"
              aria-label="关闭密钥设置"
              className="p-0.5 rounded hover:bg-white/10 text-zinc-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            默认免密钥即可解析 <strong>高清 720P</strong> MP4 直链。如需解锁大会员 1080P+/4K 画质，可填入 B 站客户端 <code>access_key</code>：
          </p>
          <div className="flex items-center gap-1.5">
            <input
              type="password"
              autoComplete="new-password"
              value={accessKeyDraft}
              onChange={e => setAccessKeyDraft(e.target.value)}
              placeholder="可选：粘贴 B 站 access_key..."
              aria-label="B 站 access_key"
              className="flex-1 px-2.5 py-1.5 rounded-md bg-zinc-900 border border-white/15 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#FB7299]"
            />
            <button
              type="submit"
              title="保存并重新解析"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#FB7299] hover:bg-[#fb7299]/90 text-white font-medium text-xs transition-colors cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              应用
            </button>
          </div>
        </form>
      )}

      {/* 解析加载过渡态 */}
      {isLoading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-zinc-950/90 text-zinc-200 gap-2.5">
          <Loader2 className="w-8 h-8 text-[#FB7299] animate-spin" />
          <div className="text-xs font-medium tracking-wide text-zinc-300">
            正在通过【{currentEngineOption.shortLabel}】解析 B 站高清视频流...
          </div>
          {!compact && (
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={handleCycleNextEngine}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] text-zinc-300 hover:text-white bg-white/10 hover:bg-white/15 border border-white/15 transition-colors cursor-pointer"
              >
                <Shuffle className="w-3 h-3 text-[#FB7299]" />
                <span>卡顿换下一源</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeliveryStage('iframe')
                  setIsLoading(false)
                }}
                className="px-2.5 py-1 rounded-md text-[11px] text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
              >
                直接官方内嵌播放
              </button>
            </div>
          )}
        </div>
      )}

      {/* 播放主视图：优先使用原生 HTML5 <video> 播放解析出的高清 MP4 直链 */}
      {/* 注意：这里不要再给 <video> 加 referrerPolicy——它不是 <video> 的合法属性
          （只在 <iframe>/<img>/<a>/<script> 上生效），写了既过不了 tsc（TS2322），
          浏览器也完全忽略。防盗链走直链签名与媒体代理，不靠这个属性「看起来生效」。 */}
      {!isLoading && effectiveStage !== 'iframe' && activeVideoSrc ? (
        <video
          ref={videoRef}
          key={`${bvid || aid}-${p}-${effectiveStage}`}
          src={activeVideoSrc}
          poster={resolvedPoster}
          controls
          autoPlay={autoPlay}
          playsInline
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={e => {
            if (onTimeUpdateSec) {
              const el = e.currentTarget
              onTimeUpdateSec(el.currentTime || 0, el.duration || 0)
            }
          }}
          onError={handleVideoError}
          className="w-full h-full object-contain bg-black"
        >
          您的浏览器不支持 HTML5 视频播放。
        </video>
      ) : (
        !isLoading && (
          <iframe
            key={`${bvid || aid}-${p}-iframe-${seekSec || 0}`}
            src={fallbackEmbedUrl}
            title={title}
            scrolling="no"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full border-0"
          />
        )
      )}
    </div>
  )
}
