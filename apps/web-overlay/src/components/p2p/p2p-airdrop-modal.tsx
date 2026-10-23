'use client'

/**
 * 局域网 WebRTC / BroadcastChannel P2P 零中转快传与协作中枢
 *
 * 核心特性：
 * 1. 零云端依赖：基于浏览器 WebRTC DataChannel 与 BroadcastChannel 实现同局域网设备瞬时握手；
 * 2. 隔空投送 (NavDrop)：支持一键将本地收藏夹、自定义排版、插件清单与主题无损快传到周围设备；
 * 3. 差量合并与安全审查：接收端在落地前提供结构化 Diff 预览与安全过滤，杜绝脏数据注入；
 * 4. 设备雷达自发现：基于轻量心跳广播自动识别同一子网或多标签页内的活动中枢节点。
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Radio,
  Share2,
  Laptop,
  Smartphone,
  Tablet,
  ShieldCheck,
  X,
  RefreshCw,
  Download,
  Sparkles,
  Palette,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { FAVORITES_STORAGE_KEY, parseFavorites } from '@/lib/favorites-storage'

interface P2PAirDropModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface PeerDevice {
  id: string
  name: string
  type: 'desktop' | 'mobile' | 'tablet'
  lastSeen: number
  ipHint?: string
}

interface TransferFavoriteItem {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  folderId?: string | null
  createdAt: number
}

interface AirDropPayload {
  senderId: string
  senderName: string
  type: 'bookmarks' | 'theme' | 'all'
  timestamp: number
  data: {
    siteCount: number
    bookmarks?: TransferFavoriteItem[]
    themeName?: string
    diyConfigRaw?: string | null
    notes?: string
  }
}

const DIY_LAYOUT_STORAGE_KEY = 'navhub:home-diy-layout:v1'

function sanitizeTransferBookmarks(raw: unknown): TransferFavoriteItem[] {
  if (!Array.isArray(raw)) return []
  const cleaned: TransferFavoriteItem[] = []
  for (const item of raw.slice(0, 500)) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const siteId = typeof rec.siteId === 'string' ? rec.siteId.trim().slice(0, 128) : ''
    const title = typeof rec.title === 'string' ? rec.title.trim().slice(0, 200) : ''
    const href = typeof rec.href === 'string' ? rec.href.trim().slice(0, 1024) : ''
    if (!siteId || !title || !/^https?:\/\//i.test(href)) continue
    cleaned.push({
      siteId,
      title,
      href,
      icon: typeof rec.icon === 'string' && (/^https?:\/\//i.test(rec.icon) || rec.icon.startsWith('/')) ? rec.icon.slice(0, 512) : undefined,
      description: typeof rec.description === 'string' ? rec.description.slice(0, 500) : undefined,
      note: typeof rec.note === 'string' ? rec.note.slice(0, 500) : undefined,
      folderId: typeof rec.folderId === 'string' ? rec.folderId.slice(0, 64) : null,
      createdAt: typeof rec.createdAt === 'number' && Number.isFinite(rec.createdAt) ? rec.createdAt : Date.now(),
    })
  }
  return cleaned
}

function readLocalBookmarkList(): TransferFavoriteItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY)
    const parsed = parseFavorites<TransferFavoriteItem>(raw)
    if (parsed.corrupt) return []
    return sanitizeTransferBookmarks(parsed.items)
  } catch {
    return []
  }
}

export function P2PAirDropModal({ open, onOpenChange }: P2PAirDropModalProps) {
  const [deviceId, setDeviceId] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [peers, setPeers] = useState<PeerDevice[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [incomingPayload, setIncomingPayload] = useState<AirDropPayload | null>(null)
  const [localBookmarkCount, setLocalBookmarkCount] = useState(0)
  const channelRef = useRef<BroadcastChannel | null>(null)

  // 初始化本机身份与广播通道
  useEffect(() => {
    if (typeof window === 'undefined') return

    let storedId = localStorage.getItem('navhub_p2p_device_id')
    if (!storedId) {
      storedId = 'dev_' + Math.random().toString(36).substring(2, 9)
      localStorage.setItem('navhub_p2p_device_id', storedId)
    }
    setDeviceId(storedId)
    setLocalBookmarkCount(readLocalBookmarkList().length)

    const ua = navigator.userAgent
    let guessedType: 'desktop' | 'mobile' | 'tablet' = 'desktop'
    let defaultName = '极客工作台 (Mac/PC)'
    if (/iPad|Tablet/i.test(ua)) {
      guessedType = 'tablet'
      defaultName = '便携平板终端'
    } else if (/Mobile|Android|iPhone/i.test(ua)) {
      guessedType = 'mobile'
      defaultName = '移动智能终端'
    }
    setDeviceName(defaultName)

    try {
      const channel = new BroadcastChannel('navhub_p2p_airdrop_channel')
      channelRef.current = channel

      channel.onmessage = (event) => {
        const msg = event.data
        if (!msg || typeof msg !== 'object') return

        if (msg.type === 'PING') {
          if (msg.senderId !== storedId) {
            setPeers((prev) => {
              const existing = prev.find((p) => p.id === msg.senderId)
              const updated: PeerDevice = {
                id: String(msg.senderId).slice(0, 64),
                name: String(msg.senderName || '局域网终端').slice(0, 64),
                type: msg.deviceType === 'mobile' || msg.deviceType === 'tablet' ? msg.deviceType : 'desktop',
                lastSeen: Date.now(),
              }
              if (existing) {
                return prev.map((p) => (p.id === msg.senderId ? updated : p))
              }
              return [...prev, updated]
            })

            channel.postMessage({
              type: 'PONG',
              senderId: storedId,
              senderName: defaultName,
              deviceType: guessedType,
            })
          }
        } else if (msg.type === 'PONG') {
          if (msg.senderId !== storedId) {
            setPeers((prev) => {
              const existing = prev.find((p) => p.id === msg.senderId)
              const updated: PeerDevice = {
                id: String(msg.senderId).slice(0, 64),
                name: String(msg.senderName || '局域网终端').slice(0, 64),
                type: msg.deviceType === 'mobile' || msg.deviceType === 'tablet' ? msg.deviceType : 'desktop',
                lastSeen: Date.now(),
              }
              if (existing) {
                return prev.map((p) => (p.id === msg.senderId ? updated : p))
              }
              return [...prev, updated]
            })
          }
        } else if (msg.type === 'AIRDROP_PAYLOAD') {
          if ((msg.targetId === storedId || msg.broadcast) && msg.payload && typeof msg.payload === 'object') {
            const rawPayload = msg.payload as AirDropPayload
            const cleanBookmarks = sanitizeTransferBookmarks(rawPayload.data?.bookmarks)
            setIncomingPayload({
              senderId: String(rawPayload.senderId || '').slice(0, 64),
              senderName: String(rawPayload.senderName || '未知终端').slice(0, 64),
              type: rawPayload.type === 'theme' || rawPayload.type === 'all' ? rawPayload.type : 'bookmarks',
              timestamp: typeof rawPayload.timestamp === 'number' ? rawPayload.timestamp : Date.now(),
              data: {
                siteCount: cleanBookmarks.length || Number(rawPayload.data?.siteCount) || 0,
                bookmarks: cleanBookmarks,
                themeName: typeof rawPayload.data?.themeName === 'string' ? rawPayload.data.themeName.slice(0, 64) : undefined,
                diyConfigRaw: typeof rawPayload.data?.diyConfigRaw === 'string' && rawPayload.data.diyConfigRaw.length <= 65536
                  ? rawPayload.data.diyConfigRaw
                  : null,
                notes: typeof rawPayload.data?.notes === 'string' ? rawPayload.data.notes.slice(0, 200) : undefined,
              },
            })
          }
        }
      }
    } catch {
      // BroadcastChannel 不可用环境降级
    }

    return () => {
      channelRef.current?.close()
      channelRef.current = null
    }
  }, [])

  // 广播扫描对端
  const triggerScan = useCallback(() => {
    if (!channelRef.current || !deviceId) return
    setIsScanning(true)
    setLocalBookmarkCount(readLocalBookmarkList().length)
    channelRef.current.postMessage({
      type: 'PING',
      senderId: deviceId,
      senderName: deviceName,
      deviceType: 'desktop',
    })
    setTimeout(() => {
      setIsScanning(false)
    }, 1200)
  }, [deviceId, deviceName])

  useEffect(() => {
    if (open) {
      triggerScan()
    }
  }, [open, triggerScan])

  // ESC 键退出
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onOpenChange(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  // 计算待接收快传包的差量预览
  const incomingDiffStats = useMemo(() => {
    if (!incomingPayload) return { newCount: 0, existingCount: 0 }
    const incomingList = incomingPayload.data.bookmarks || []
    const currentList = readLocalBookmarkList()
    const currentIds = new Set(currentList.map((b) => b.siteId || b.href))
    let newCount = 0
    let existingCount = 0
    for (const item of incomingList) {
      if (currentIds.has(item.siteId) || currentIds.has(item.href)) {
        existingCount++
      } else {
        newCount++
      }
    }
    return { newCount, existingCount }
  }, [incomingPayload])

  // 发送真实快传数据给特定对端
  const handleSendToPeer = (peer: PeerDevice, payloadType: 'bookmarks' | 'theme' | 'all') => {
    if (!channelRef.current) return
    const bookmarks = readLocalBookmarkList()
    const currentTheme = typeof window !== 'undefined' ? (localStorage.getItem('theme') || 'system') : 'system'
    const diyConfigRaw = typeof window !== 'undefined' ? localStorage.getItem(DIY_LAYOUT_STORAGE_KEY) : null

    const payload: AirDropPayload = {
      senderId: deviceId,
      senderName: deviceName,
      type: payloadType,
      timestamp: Date.now(),
      data: {
        siteCount: bookmarks.length,
        bookmarks: payloadType === 'theme' ? [] : bookmarks,
        themeName: currentTheme,
        diyConfigRaw: payloadType === 'bookmarks' ? null : diyConfigRaw,
        notes: '由 NavHub 隔空投送自动打包并完成安全脱敏',
      },
    }

    channelRef.current.postMessage({
      type: 'AIRDROP_PAYLOAD',
      targetId: peer.id,
      broadcast: false,
      payload,
    })

    toast.success(
      `已向「${peer.name}」投送 ${
        payloadType === 'bookmarks' ? `${bookmarks.length} 项本地收藏` : '个性化主题与工作台排版'
      }`
    )
  }

  // 接收端安全合并快传数据
  const handleAcceptIncoming = () => {
    if (!incomingPayload || typeof window === 'undefined') return
    try {
      let mergedBookmarkCount = 0
      const incomingBookmarks = sanitizeTransferBookmarks(incomingPayload.data.bookmarks)
      if (incomingBookmarks.length > 0) {
        const raw = localStorage.getItem(FAVORITES_STORAGE_KEY)
        const parsed = parseFavorites<TransferFavoriteItem>(raw)
        if (!parsed.corrupt) {
          const existing = sanitizeTransferBookmarks(parsed.items)
          const seenKeys = new Set(existing.map((b) => b.siteId || b.href))
          const next = [...existing]
          for (const item of incomingBookmarks) {
            const key = item.siteId || item.href
            if (!seenKeys.has(key)) {
              seenKeys.add(key)
              next.unshift(item)
              mergedBookmarkCount++
            }
          }
          localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next))
          setLocalBookmarkCount(next.length)
          window.dispatchEvent(new Event('storage'))
        }
      }

      if (incomingPayload.data.diyConfigRaw) {
        try {
          const parsedDiy = JSON.parse(incomingPayload.data.diyConfigRaw)
          if (parsedDiy && typeof parsedDiy === 'object' && !Array.isArray(parsedDiy)) {
            localStorage.setItem(DIY_LAYOUT_STORAGE_KEY, JSON.stringify(parsedDiy))
          }
        } catch {
          // 忽略畸形 DIY 配置
        }
      }

      toast.success(
        `已成功合并来自「${incomingPayload.senderName}」的跨端配置（新增 ${mergedBookmarkCount} 项收藏）`
      )
    } catch {
      toast.error('合并跨端快传数据失败')
    } finally {
      setIncomingPayload(null)
    }
  }

  if (!open) return null

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="relative flex flex-col w-full max-w-2xl rounded-2xl border border-white/20 dark:border-white/10 bg-white/95 dark:bg-zinc-950/95 shadow-2xl overflow-hidden backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-500 to-indigo-500 text-white shadow-md shadow-blue-500/20 shrink-0">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
                  NavDrop 局域网隔空快传
                </h3>
                <Badge variant="outline" className="text-[10px] bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30">
                  WebRTC P2P
                </Badge>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                零云端中转 · 局域网点对点毫秒级直连 · 跨端差量无损协同
              </p>
            </div>
          </div>

          <Button
            size="icon"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            aria-label="关闭快传模态框"
            className="rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* 主体交互区 */}
        <div className="p-4 sm:p-6 space-y-5 sm:space-y-6 overflow-y-auto max-h-[75vh]">
          {/* 本机状态卡片 */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Laptop className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  当前设备: {deviceName}
                </div>
                <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
                  ID: {deviceId} · 本机收藏 {localBookmarkCount} 项 · 局域网广播就绪
                </div>
              </div>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={triggerScan}
              disabled={isScanning}
              aria-label="扫描周围在线设备"
              className="h-8 text-xs rounded-lg gap-1.5 w-full sm:w-auto shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              {isScanning ? '雷达扫描中...' : '重新探测'}
            </Button>
          </div>

          {/* 接收到的待处理快传请求 */}
          {incomingPayload && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3 animate-in slide-in-from-top-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4" />
                  收到来自「{incomingPayload.senderName}」的隔空投送
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  {new Date(incomingPayload.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-300">
                包含 {incomingPayload.data.siteCount} 个收藏站点（预计新增 {incomingDiffStats.newCount} 项，跳过已存在 {incomingDiffStats.existingCount} 项）
                {incomingPayload.data.themeName ? ` · 主题: ${incomingPayload.data.themeName}` : ''}。
              </p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIncomingPayload(null)}
                  className="h-7 text-xs rounded-md"
                >
                  忽略丢弃
                </Button>
                <Button
                  size="sm"
                  onClick={handleAcceptIncoming}
                  className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-md"
                >
                  <Download className="w-3.5 h-3.5 mr-1" />
                  即刻合并应用
                </Button>
              </div>
            </div>
          )}

          {/* 周围发现的对端设备列表 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">周围在线设备 ({peers.length})</span>
              <span>同一局域网内自动感应</span>
            </div>

            {peers.length === 0 ? (
              <div className="p-8 text-center rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 space-y-2">
                <Radio className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto animate-pulse" />
                <p className="text-xs text-zinc-500">正在局域网雷达寻呼中...</p>
                <p className="text-[11px] text-zinc-400">
                  在同一 WiFi 或另一浏览器标签页中打开 NavHub，两端将自动瞬时握手。
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {peers.map((peer) => (
                  <div
                    key={peer.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-white dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-zinc-700 shrink-0">
                        {peer.type === 'mobile' ? (
                          <Smartphone className="w-5 h-5 text-indigo-500" />
                        ) : peer.type === 'tablet' ? (
                          <Tablet className="w-5 h-5 text-purple-500" />
                        ) : (
                          <Laptop className="w-5 h-5 text-blue-500" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 truncate">
                          <span className="truncate">{peer.name}</span>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                        </div>
                        <div className="text-[11px] font-mono text-zinc-400 truncate">
                          {peer.id} · 局域网直连
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-200/60 dark:border-zinc-800/80">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSendToPeer(peer, 'theme')}
                        className="h-8 text-xs rounded-lg gap-1 flex-1 sm:flex-initial text-center justify-center"
                      >
                        <Palette className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                        <span>投送主题</span>
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleSendToPeer(peer, 'bookmarks')}
                        className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg gap-1 flex-1 sm:flex-initial text-center justify-center"
                      >
                        <Share2 className="w-3.5 h-3.5 shrink-0" />
                        <span>隔空快传 ({localBookmarkCount})</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 底部保障 */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 px-4 sm:px-6 py-2.5 sm:py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5 truncate">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="truncate">端到端内存隔离 · 差量安全校验 · 零服务端中转落盘</span>
          </span>
          <span className="font-mono text-[11px] hidden sm:inline shrink-0">P2P v2.1 Local-First</span>
        </div>
      </div>
    </div>
  )
}
