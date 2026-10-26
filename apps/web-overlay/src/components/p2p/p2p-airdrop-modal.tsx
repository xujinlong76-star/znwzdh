'use client'

/**
 * 同浏览器跨标签页的零中转快传中枢（NavDrop）
 *
 * 实现方式只有一条通道：`BroadcastChannel`。它的真实边界是
 * **同一浏览器、同一来源的多个标签页／窗口**——不是局域网，也没有 WebRTC
 * （全站没有 `RTCPeerConnection`／`iceServers`，早先的「局域网点对点直连」「手机也能收」
 * 是把做不到的能力写在标题上，用户拿手机试半天只会静默失败）。
 * 跨设备因此只能走「数据页导出备份 → 新设备导入」，界面上照实指路。
 *
 * 数据边界全部收在 `@/lib/p2p/airdrop-transfer`：单次条数上限、字段长度、
 * 逐因台账（超上限／脏记录／缺字段／截断），以及「本地收藏读不出来」这一独立状态。
 * 本组件只做存储 IO 与渲染，措辞一律照台账切换。
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTheme } from 'next-themes'
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
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { useOverlayBehavior } from '@/components/ui/overlay'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { FAVORITES_STORAGE_KEY, corruptBackupKey } from '@/lib/favorites-storage'
import {
  DIY_CONFIG_LIMIT,
  FAVORITES_ROLLBACK_FAILED_HINT,
  FAVORITES_WRITE_FAILED_HINT,
  MAX_TRANSFER_BOOKMARKS,
  buildIncomingReport,
  buildLocalBookmarkInventory,
  checkSendFeasibility,
  corruptInventory,
  countFavoriteDelta,
  formatIncomingSummary,
  formatMergeNotice,
  formatSendNotice,
  indexFavorites,
  isTransferableTheme,
  mergeBookmarkLists,
  type AirDropPayload,
  type AirDropPayloadType,
  type IncomingReport,
  type LocalBookmarkInventory,
  type MergeResult,
  type NoticeTone,
  type TransferableTheme,
} from '@/lib/p2p/airdrop-transfer'

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

const DIY_LAYOUT_STORAGE_KEY = 'navhub:home-diy-layout:v1'

function readLocalInventory(): LocalBookmarkInventory {
  if (typeof window === 'undefined') return buildLocalBookmarkInventory(null)
  try {
    return buildLocalBookmarkInventory(localStorage.getItem(FAVORITES_STORAGE_KEY))
  } catch {
    // 存储本身不可用（隐私模式／配额）：按「条数未知」处理，不能伪造成「你没有收藏」
    return corruptInventory(true)
  }
}

function toneToToast(tone: NoticeTone) {
  return tone === 'error' ? toast.error : tone === 'warn' ? toast.warning : toast.success
}

export function P2PAirDropModal({ open, onOpenChange }: P2PAirDropModalProps) {
  const { setTheme } = useTheme()
  const [deviceId, setDeviceId] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [peers, setPeers] = useState<PeerDevice[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [incoming, setIncoming] = useState<IncomingReport | null>(null)
  const [inventory, setInventory] = useState<LocalBookmarkInventory>(() => buildLocalBookmarkInventory(null))
  const channelRef = useRef<BroadcastChannel | null>(null)
  const deviceTypeRef = useRef<'desktop' | 'mobile' | 'tablet'>('desktop')

  // 初始化本机身份与广播通道
  useEffect(() => {
    if (typeof window === 'undefined') return

    let storedId = localStorage.getItem('navhub_p2p_device_id')
    if (!storedId) {
      storedId = 'dev_' + Math.random().toString(36).substring(2, 9)
      localStorage.setItem('navhub_p2p_device_id', storedId)
    }
    setDeviceId(storedId)
    setInventory(readLocalInventory())

    const ua = navigator.userAgent
    let guessedType: 'desktop' | 'mobile' | 'tablet' = 'desktop'
    let defaultName = '本机工作台'
    if (/iPad|Tablet/i.test(ua)) {
      guessedType = 'tablet'
      defaultName = '便携平板终端'
    } else if (/Mobile|Android|iPhone/i.test(ua)) {
      guessedType = 'mobile'
      defaultName = '移动智能终端'
    }
    // 原来 PING 硬写 deviceType: 'desktop'，手机端在对方列表里一律显示成电脑图标
    deviceTypeRef.current = guessedType
    setDeviceName(defaultName)

    const upsertPeer = (msg: { senderId?: unknown; senderName?: unknown; deviceType?: unknown }) => {
      const id = String(msg.senderId ?? '').slice(0, 64)
      if (!id || id === storedId) return
      const rawName = String(msg.senderName ?? '').trim()
      const updated: PeerDevice = {
        id,
        name: (rawName || '同浏览器标签页').slice(0, 64),
        type: msg.deviceType === 'mobile' || msg.deviceType === 'tablet' ? msg.deviceType : 'desktop',
        lastSeen: Date.now(),
      }
      setPeers((prev) =>
        prev.some((p) => p.id === id) ? prev.map((p) => (p.id === id ? updated : p)) : [...prev, updated]
      )
    }

    try {
      const channel = new BroadcastChannel('navhub_p2p_airdrop_channel')
      channelRef.current = channel

      channel.onmessage = (event) => {
        const msg = event.data
        if (!msg || typeof msg !== 'object') return

        if (msg.type === 'PING') {
          if (msg.senderId === storedId) return
          upsertPeer(msg)
          channel.postMessage({
            type: 'PONG',
            senderId: storedId,
            senderName: defaultName,
            deviceType: guessedType,
          })
        } else if (msg.type === 'PONG') {
          upsertPeer(msg)
        } else if (msg.type === 'AIRDROP_PAYLOAD') {
          if (msg.targetId !== storedId && !msg.broadcast) return
          // 外部（同浏览器另一端）来的包：整份过 buildIncomingReport，
          // 少发、脏记录、截断、排版超长全部记在台账里，界面照台账说话
          const report = buildIncomingReport(msg.payload)
          if (!report) return
          setIncoming(report)
        }
      }
    } catch {
      // BroadcastChannel 不可用环境降级：界面会显示「通道不可用」而不是假装在扫描
    }

    return () => {
      channelRef.current?.close()
      channelRef.current = null
    }
  }, [])

  // 广播扫描对端
  const triggerScan = useCallback(() => {
    setInventory(readLocalInventory())
    if (!channelRef.current || !deviceId) return
    setIsScanning(true)
    channelRef.current.postMessage({
      type: 'PING',
      senderId: deviceId,
      senderName: deviceName,
      deviceType: deviceTypeRef.current,
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

  // 浮层公共行为：Esc 关（捕获阶段）、点遮罩关、锁背景滚动、焦点圈养与还原、role=dialog + 名称
  const { containerProps, scrimProps } = useOverlayBehavior({
    open,
    onClose: () => onOpenChange(false),
    ariaLabelledBy: 'navhub-p2p-airdrop-modal-title',
  })

  // 计算待接收快传包的差量预览（与合并共用判定，预览与落地不会两个口径）
  const incomingDiff = useMemo(() => {
    if (!incoming) return { newCount: 0, existingCount: 0 }
    return countFavoriteDelta(indexFavorites(inventory.ledger.items), incoming.payload.data.bookmarks ?? [])
  }, [incoming, inventory])

  const incomingSummary = useMemo(
    () => (incoming ? formatIncomingSummary({ report: incoming, newCount: incomingDiff.newCount, existingCount: incomingDiff.existingCount }) : null),
    [incoming, incomingDiff]
  )

  const sendableCount = inventory.ledger.items.length
  const canSend = !inventory.corrupt && sendableCount > 0

  // 发送真实快传数据给特定对端
  const handleSendToPeer = (peer: PeerDevice, payloadType: AirDropPayloadType) => {
    if (!channelRef.current || typeof window === 'undefined') {
      toast.error('快传通道不可用：当前浏览器没有 BroadcastChannel，只能同浏览器标签页之间直连。')
      return
    }
    const latest = readLocalInventory()
    setInventory(latest)
    let currentTheme = 'system'
    let diyConfigRaw: string | null = null
    try {
      currentTheme = localStorage.getItem('theme') || 'system'
      diyConfigRaw = localStorage.getItem(DIY_LAYOUT_STORAGE_KEY)
    } catch {
      // 读不到就按「没有」处理，后面的台账会如实说明少了什么
    }

    const check = checkSendFeasibility({ payloadType, inventory: latest, diyConfigRaw, themeName: currentTheme })
    if (check?.kind === 'block') {
      toast.error(check.text)
      return
    }
    const carriesBookmarks = payloadType !== 'theme'
    const carriesDiy = payloadType !== 'bookmarks'
    const diyIncluded = carriesDiy && !!diyConfigRaw && diyConfigRaw.length <= DIY_CONFIG_LIMIT
    const items = carriesBookmarks ? latest.ledger.items : []
    const themeIncluded = carriesDiy && isTransferableTheme(currentTheme)

    const payload: AirDropPayload = {
      senderId: deviceId,
      senderName: deviceName,
      type: payloadType,
      timestamp: Date.now(),
      data: {
        siteCount: items.length,
        // 申报本机总数：对端因此能算出「这一包少了几项」，而不是只看包内条数
        declaredTotal: latest.corrupt ? null : latest.storedCount,
        bookmarks: items,
        themeName: themeIncluded ? currentTheme : undefined,
        diyConfigRaw: diyIncluded ? diyConfigRaw : null,
        diyDeclared: carriesDiy,
        notes: `由山羊胡 NavDrop 打包：本机收藏 ${latest.storedCount} 项，本次随包 ${items.length} 项`,
      },
    }

    channelRef.current.postMessage({
      type: 'AIRDROP_PAYLOAD',
      targetId: peer.id,
      broadcast: false,
      payload,
    })

    const notice = formatSendNotice({
      peerName: peer.name,
      ledger: latest.ledger,
      carriesBookmarks,
      sentBookmarks: items.length,
      sentDiy: diyIncluded,
      sentTheme: themeIncluded,
    })
    if (check?.kind === 'warn') toast.warning(`${check.text}（${notice.text}）`)
    else toneToToast(notice.tone)(notice.text)
  }

  // 接收端安全合并快传数据
  const handleAcceptIncoming = () => {
    if (!incoming || typeof window === 'undefined') return
    const report = incoming
    const local = readLocalInventory()
    setInventory(local)
    setIncoming(null)

    if (local.corrupt) {
      // 本地读不出来时绝不写回：旧实现会跳过合并却照样 toast「已成功合并」
      if (!local.unavailableRaw) {
        // 把坏数据挪进隔离键（与 useFavorites 同一形状），键还在、数据还在，可事后备份
        try {
          const rawNow = localStorage.getItem(FAVORITES_STORAGE_KEY)
          if (rawNow !== null) localStorage.setItem(corruptBackupKey(Date.now()), rawNow)
        } catch {
          // 隔离也写不进去：只能如实告诉用户数据仍在原键里
        }
      }
      toneToToast('error')(
        formatMergeNotice({
          senderName: report.payload.senderName,
          ledger: report.ledger,
          merge: null,
          localCorrupt: true,
          unavailableRaw: local.unavailableRaw,
          diyApplied: false,
          diyRejectedReason: null,
          appliedTheme: null,
          rejectedTheme: null,
          nothingUsable: false,
        }).text
      )
      return
    }

    let rawBefore: string | null = null
    try {
      rawBefore = localStorage.getItem(FAVORITES_STORAGE_KEY)
    } catch {
      // 读不到原值：写失败时无法回滚，下面按「状态未知」处理
    }

    let merge: MergeResult | null = null
    let writeFailed = false
    let rollbackFailed = false
    let diyApplied = false
    let diyRejectedReason: 'malformed' | 'oversize' | 'write-failed' | null = null
    let appliedTheme: TransferableTheme | null = null
    let rejectedTheme: string | null = null

    const incomingBookmarks = report.payload.data.bookmarks ?? []
    if (report.payload.type !== 'theme' && incomingBookmarks.length > 0) {
      const candidate = mergeBookmarkLists(local.ledger.items, incomingBookmarks)
      if (candidate.added > 0) {
        try {
          localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(candidate.next))
          merge = candidate
          setInventory(buildLocalBookmarkInventory(JSON.stringify(candidate.next)))
          window.dispatchEvent(new Event('storage'))
        } catch {
          writeFailed = true
          try {
            // 写坏就地回滚：宁可保留合并前的列表，也不留下半截结果
            if (rawBefore === null) localStorage.removeItem(FAVORITES_STORAGE_KEY)
            else localStorage.setItem(FAVORITES_STORAGE_KEY, rawBefore)
          } catch {
            rollbackFailed = true
            setInventory(corruptInventory())
          }
        }
      } else {
        merge = candidate
      }
    }

    const rawDiy = report.payload.data.diyConfigRaw
    if (report.payload.type !== 'bookmarks' && rawDiy) {
      if (rawDiy.length > DIY_CONFIG_LIMIT) {
        diyRejectedReason = 'oversize'
      } else {
        let parsedDiy: unknown = null
        let parsed = true
        try {
          parsedDiy = JSON.parse(rawDiy)
        } catch {
          parsed = false
          diyRejectedReason = 'malformed'
        }
        if (parsed) {
          if (parsedDiy && typeof parsedDiy === 'object' && !Array.isArray(parsedDiy)) {
            try {
              localStorage.setItem(DIY_LAYOUT_STORAGE_KEY, JSON.stringify(parsedDiy))
              diyApplied = true
            } catch {
              // 解析得出来却写不进去：这是存储问题，不能报成「排版内容不合法」
              diyRejectedReason = 'write-failed'
            }
          } else {
            diyRejectedReason = 'malformed'
          }
        }
      }
    }

    // 只有「主题/全部」包才允许改本机配色：点「投送收藏」不该顺手换肤
    const incomingTheme = report.payload.type === 'bookmarks' ? undefined : report.payload.data.themeName
    if (incomingTheme) {
      if (isTransferableTheme(incomingTheme)) {
        setTheme(incomingTheme)
        appliedTheme = incomingTheme
      } else {
        rejectedTheme = incomingTheme
      }
    }

    if (writeFailed) {
      toast.error(rollbackFailed ? FAVORITES_ROLLBACK_FAILED_HINT : FAVORITES_WRITE_FAILED_HINT)
      return
    }

    const nothingUsable = !diyApplied && appliedTheme === null && (merge === null || merge.added === 0)
    const notice = formatMergeNotice({
      senderName: report.payload.senderName,
      ledger: report.ledger,
      merge,
      localCorrupt: false,
      unavailableRaw: false,
      diyApplied,
      diyRejectedReason,
      appliedTheme,
      rejectedTheme,
      nothingUsable,
    })
    toneToToast(notice.tone)(notice.text)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        {...scrimProps}
        className="absolute inset-0 bg-black/60 backdrop-blur-md animate-in fade-in duration-200"
      />
      <div
        {...containerProps}
        className="relative flex flex-col w-full max-w-2xl rounded-2xl border border-white/20 dark:border-white/10 bg-white/95 dark:bg-zinc-950/95 shadow-2xl overflow-hidden backdrop-blur-2xl outline-none"
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-500 to-indigo-500 text-white shadow-md shadow-blue-500/20 shrink-0">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="navhub-p2p-airdrop-modal-title" className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
                  NavDrop 跨标签页快传
                </h3>
                <Badge variant="outline" className="text-[10px] bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30">
                  同浏览器直连
                </Badge>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                零云端中转 · 同一浏览器的标签页／窗口之间直连；换设备请用「数据」页导出备份再导入
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
          <div
            className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-xl border ${
              inventory.corrupt
                ? 'bg-amber-500/10 border-amber-500/30'
                : 'bg-blue-50/60 dark:bg-blue-950/20 border-blue-200/60 dark:border-blue-900/40'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Laptop className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  当前设备: {deviceName}
                </div>
                <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
                  {inventory.corrupt
                    ? `ID: ${deviceId} · 本机收藏读不出来（条数未知），已暂停读写`
                    : `ID: ${deviceId} · 本机收藏 ${inventory.storedCount} 项，可投送 ${sendableCount} 项`}
                </div>
              </div>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={triggerScan}
              disabled={isScanning}
              aria-label="扫描同浏览器的其他标签页"
              className="h-8 text-xs rounded-lg gap-1.5 w-full sm:w-auto shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              {isScanning ? '雷达扫描中...' : '重新探测'}
            </Button>
          </div>

          {/* 接收到的待处理快传请求 */}
          {incoming && incomingSummary && (
            <div
              className={`p-4 rounded-xl border space-y-3 animate-in slide-in-from-top-2 ${
                incomingSummary.tone === 'warn'
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-emerald-500/10 border-emerald-500/30'
              }`}
              role={incomingSummary.tone === 'warn' ? 'alert' : 'status'}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-semibold flex items-center gap-1.5 ${
                    incomingSummary.tone === 'warn'
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {incomingSummary.tone === 'warn' ? (
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  收到来自「{incoming.payload.senderName}」的快传
                </span>
                <span className="text-[10px] font-mono text-zinc-400">
                  {new Date(incoming.payload.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-300">{incomingSummary.text}。</p>
              {inventory.corrupt && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  本机收藏现在读不出来，接受会被拦下 —— 原数据不会被这份快传覆盖。
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIncoming(null)}
                  className="h-7 text-xs rounded-md"
                >
                  忽略丢弃
                </Button>
                <Button
                  size="sm"
                  onClick={handleAcceptIncoming}
                  disabled={inventory.corrupt}
                  className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-md"
                >
                  <Download className="w-3.5 h-3.5 mr-1" />
                  即刻合并应用
                </Button>
              </div>
            </div>
          )}

          {/* 同浏览器发现的对端标签页 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">已握手的标签页 ({peers.length})</span>
              <span>同一浏览器的其他标签页</span>
            </div>

            {peers.length === 0 ? (
              <div className="p-8 text-center rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 space-y-2">
                <Radio className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto animate-pulse" />
                <p className="text-xs text-zinc-500">
                  {channelRef.current ? '正在等待同浏览器的其他标签页应答...' : '当前浏览器不支持 BroadcastChannel，快传通道不可用'}
                </p>
                <p className="text-[11px] text-zinc-400">
                  在<b>同一个浏览器的另一个标签页或窗口</b>打开山羊胡，两端才会握手。
                  手机、别的浏览器或隐身窗口都收不到 —— 跨设备请去「数据」页导出备份，再到新设备导入。
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
                          {peer.id} · 同浏览器直连
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
                        <span>主题+排版</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSendToPeer(peer, 'all')}
                        disabled={!canSend}
                        className="h-8 text-xs rounded-lg gap-1 flex-1 sm:flex-initial text-center justify-center"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
                        <span>全部</span>
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleSendToPeer(peer, 'bookmarks')}
                        disabled={!canSend}
                        className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg gap-1 flex-1 sm:flex-initial text-center justify-center"
                      >
                        <Share2 className="w-3.5 h-3.5 shrink-0" />
                        <span>投送收藏 ({sendableCount})</span>
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
            <span className="truncate">
              {inventory.ledger.omitted > 0
                ? `本机 ${inventory.ledger.omitted} 项收藏不合格或超出单次上限，不会随包发出`
                : `单次最多 ${MAX_TRANSFER_BOOKMARKS} 项 · 落盘前逐条校验 · 不经服务端`}
            </span>
          </span>
          <span className="font-mono text-[11px] hidden sm:inline shrink-0">NavDrop v2.2 Local-First</span>
        </div>
      </div>
    </div>
  )
}
