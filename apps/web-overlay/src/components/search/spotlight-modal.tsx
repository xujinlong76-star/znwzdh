'use client'

/**
 * SpotlightModal (Omnibar Pro) —— 全局超级搜索与命令控制台
 * 
 * 核心特性：
 * 1. 全局 Cmd+K / Ctrl+K 瞬时唤起（支持全站任意路由）；
 * 2. 多重交互模式：
 *    - 普通输入：四路召回 + RRF (Reciprocal Rank Fusion) 混合检索 + 插件市场跨模态并行召回；
 *    - `>` 前缀：系统快捷指令控制台（一键换肤、工作台直达、AI 抽屉唤起、数据快照导出等）；
 *    - `?` 或 `ai ` 前缀：直达 AI 问答与书签整理（具体模型以中枢回报为准）；
 * 3. 死链时间机器（Wayback Machine）快照一键自愈。
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  Search,
  Command,
  Sparkles,
  Terminal,
  ArrowRight,
  ExternalLink,
  History,
  Copy,
  Check,
  Clock,
  Layers,
  Store,
  X,
  AlertTriangle,
  Zap,
  LayoutGrid,
  Bot,
  Settings,
  ShieldCheck,
  Palette,
  Download,
  Loader2,
  HeartPulse,
  Code2,
  KeyRound,
  Fingerprint,
  Hash,
  Link2,
  FileJson,
  Compass,
  Radio,
  BookOpen,
} from 'lucide-react'
import { Input } from '@/registry/new-york/ui/input'
import { Button } from '@/registry/new-york/ui/button'
import { Badge } from '@/components/ui/badge'
import { useOverlayBehavior } from '@/components/ui/overlay'
import { SiteFavicon } from '@/components/site-favicon'
import {
  useExternalLinkTarget,
  useSpotlightShortcutMode,
  useUserPreference,
  spotlightHotkeyMatches,
} from '@/lib/user-preferences'
import { externalSearchEngineName, externalSearchUrl } from '@/lib/user-settings'
import { toast } from 'sonner'
import {
  searchSites,
  searchPlugins,
  reportClick,
  fetchSearchHistory,
  healSiteWayback,
  type HubSearchHit,
  type HubPluginSearchResponse,
} from '@/lib/navhub-api'
import { getIdentity } from '@/lib/identity'
import { getModifierKey } from '@/lib/platform'
import { isSafeHttpUrl, safeHref, safeWindowOpen } from '@/lib/safe-url'
import { recordOfflineVisit } from '@/lib/offline-recent'
import { copyFailureToast, copyText } from '@/lib/clipboard'
import { applyThemeTokens } from '@/lib/plugins/theme-runtime'

// 这些是 Spotlight 的「按需面板」，只在对应快捷键/指令被激活时才需要。
// 静态 import 会把它们全部塞进全局首屏 chunk（Spotlight 挂在 Providers 上），
// 2026-10-19 实测因此从 637 KB 涨到 909 KB（_not-found 基线）。改为 dynamic + 条件渲染，
// 未打开时连 chunk 都不加载。
const GeekMicroTools = dynamic(
  () => import('@/components/tools/geek-micro-tools').then((m) => m.GeekMicroTools),
  { ssr: false }
)
const SiteHealthAuditModal = dynamic(
  () => import('@/components/ai/site-health-audit-modal').then((m) => m.SiteHealthAuditModal),
  { ssr: false }
)
const KnowledgeStarMapModal = dynamic(
  () => import('@/components/graph/knowledge-star-map-modal').then((m) => m.KnowledgeStarMapModal),
  { ssr: false }
)
const SiteArchiveReaderModal = dynamic(
  () => import('@/components/reader/site-archive-reader-modal').then((m) => m.SiteArchiveReaderModal),
  { ssr: false }
)
const P2PAirDropModal = dynamic(
  () => import('@/components/p2p/p2p-airdrop-modal').then((m) => m.P2PAirDropModal),
  { ssr: false }
)

const CHANNEL_BADGES: Record<string, { label: string; className: string }> = {
  exact: { label: '精确', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  fts: { label: '全文', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  pinyin: { label: '拼音', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30' },
  semantic: { label: '语义', className: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30' },
  personal: { label: '个性化', className: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30' },
}

interface CommandAction {
  id: string
  title: string
  description: string
  icon: typeof Zap
  category: string
  handler: () => void
}

export function SpotlightModal({ initialOpen = false }: { initialOpen?: boolean } = {}) {
  const router = useRouter()
  const [open, setOpen] = useState(initialOpen)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [hits, setHits] = useState<HubSearchHit[]>([])
  const [pluginHits, setPluginHits] = useState<HubPluginSearchResponse | null>(null)
  const [recentQueries, setRecentQueries] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [healingId, setHealingId] = useState<string | null>(null)
  const [healthAuditOpen, setHealthAuditOpen] = useState(false)
  const [starMapOpen, setStarMapOpen] = useState(false)
  const [airdropOpen, setAirdropOpen] = useState(false)
  const [archiveSite, setArchiveSite] = useState<{ id: string; title: string; url: string; description?: string | null } | null>(null)
  const [archiveReaderOpen, setArchiveReaderOpen] = useState(false)
  const [modKey, setModKey] = useState<string>('⌘')
  const shortcutMode = useSpotlightShortcutMode()
  const searchEngine = useUserPreference('defaultSearchEngine')
  /** 站点召回通道是否失败（区别于「真的没有结果」） */
  const [sitesUnavailable, setSitesUnavailable] = useState(false)
  /** 重试令牌：只给「再问一次同一个词」用，不改查询文本 */
  const [searchNonce, setSearchNonce] = useState(0)
  useEffect(() => {
    setModKey(getModifierKey())
  }, [])

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const identity = useMemo(() => getIdentity(), [])

  /**
   * 浮层行为走公共原语：Esc、点遮罩、锁背景滚动、焦点圈养与还原、role=dialog。
   * 以前这里只有一条 window 上的 Esc 监听：背景照样滚、Tab 能一路走出面板落到正文，
   * 读屏软件也根本不认为这是一个对话框。
   */
  const { containerProps, scrimProps } = useOverlayBehavior({
    open,
    onClose: () => setOpen(false),
    ariaLabel: '全局超级搜索与系统指令控制台',
    initialFocusRef: inputRef,
  })

  /**
   * 打开站点的方式同样听用户中心的「新标签页打开站点」偏好。
   * 超级控制台是全站入口最全的地方，以前这里写死 `_blank`：
   * 用户在全局设置里关掉新标签页，只影响首页卡片，从这里打开照样弹新窗口。
   */
  const linkTarget = useExternalLinkTarget()
  const openSite = useCallback(
    (site: { id: string; title?: string | null; url: string; iconKey?: string | null }) => {
      const url = safeHref(site.url, '')
      // 先过安全闸再上报：给一个根本打不开的脏 URL 记一次点击，会污染热度信号
      if (!url || !isSafeHttpUrl(url)) return
      reportClick(site.id, identity)
      // 与首页卡片、内联搜索共用同一份离线「最近访问」：从 ⌘K 打开的站点
      // 断网后也要能在本地列表里找到，否则超级控制台这条路径就漏了快照。
      recordOfflineVisit({
        id: site.id,
        title: site.title ?? site.url,
        href: url,
        icon: site.iconKey ?? null,
      })
      if (linkTarget === '_self') window.location.href = url
      else window.open(url, '_blank', 'noopener,noreferrer')
    },
    [identity, linkTarget],
  )

  /** 站外出口：只有用户在「默认搜索引擎」里显式选了外部引擎才出现 */
  const externalSearchHref = externalSearchUrl(searchEngine, query)
  const externalSearchName = externalSearchEngineName(searchEngine)

  // 1. 全局快捷键监听（呼出键听用户中心的「搜索快捷键」偏好）与自定义事件唤起
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Esc 不在这里处理：useOverlayBehavior 在 document 捕获阶段拦下它，
      // 既能叠在别的浮层上（只关最上层），又不会漏给全局快捷键。
      if (spotlightHotkeyMatches(e, shortcutMode)) {
        // 如果焦点在其他复杂编辑器中，仍允许唤起超级控制台
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    const handleCustomOpen = (e: Event) => {
      const detail = (e as CustomEvent)?.detail
      setOpen(true)
      if (detail?.query) {
        setQuery(detail.query)
      }
    }

    const handleHealthAuditOpen = () => {
      setHealthAuditOpen(true)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('open-spotlight', handleCustomOpen)
    window.addEventListener('open-site-health-audit', handleHealthAuditOpen)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('open-spotlight', handleCustomOpen)
      window.removeEventListener('open-site-health-audit', handleHealthAuditOpen)
    }
  }, [shortcutMode])

  // 2. 加载历史记录（初始焦点由 useOverlayBehavior 的 initialFocusRef 交接）
  useEffect(() => {
    if (open) {
      fetchSearchHistory(identity)
        .then((items) => {
          if (Array.isArray(items)) setRecentQueries(items.slice(0, 8))
        })
        .catch(() => {
          // 最近搜索只是锦上添花：拉取失败当作没有历史，不打断搜索主流程
        })
    } else {
      setQuery('')
      setHits([])
      setPluginHits(null)
      setSelectedIndex(0)
    }
  }, [open, identity])

  // 3. 判断当前模式
  const isCommandMode = query.startsWith('>')
  const isAiMode = query.startsWith('?') || query.toLowerCase().startsWith('ai ')
  const cleanCmd = isCommandMode ? query.slice(1).trim().toLowerCase() : ''
  const cleanAiPrompt = isAiMode ? query.replace(/^[?]|ai\s+/i, '').trim() : ''

  const GEEK_TOOL_PREFIXES = ['b64', 'base64', 'jwt', 'time', 'timestamp', 'uuid', 'hash', 'sha256', 'json', 'url']
  const cleanCmdHead = cleanCmd.split(' ')[0]
  const isGeekToolActive = isCommandMode && GEEK_TOOL_PREFIXES.includes(cleanCmdHead)

  // 4. 指令模式内置动作列表
  const systemCommands: CommandAction[] = useMemo(() => [
    {
      id: 'cmd-audit',
      title: '全站健康自治巡检与无感自愈 (Autonomous Health)',
      description: '扫描死链与 301 重定向，调取 Wayback 快照并推荐同生态平替',
      icon: HeartPulse,
      category: '智能自愈',
      handler: () => {
        setOpen(false)
        setHealthAuditOpen(true)
      },
    },
    {
      id: 'cmd-tool-b64',
      title: '> b64 (Base64 极速编解码)',
      description: '本地纯前端 UTF-8 安全 Base64 编码与解码',
      icon: Code2,
      category: '极客微工具',
      handler: () => {
        setQuery('> b64 ')
      },
    },
    {
      id: 'cmd-tool-jwt',
      title: '> jwt (JWT 验签与声明解析)',
      description: '秒级解析 Header/Payload JSON 并计算过期时间',
      icon: KeyRound,
      category: '极客微工具',
      handler: () => {
        setQuery('> jwt ')
      },
    },
    {
      id: 'cmd-tool-time',
      title: '> time (Unix 时间戳与日期换算)',
      description: '毫秒级/秒级时间戳、本地时间与相对时间双向转换',
      icon: Clock,
      category: '极客微工具',
      handler: () => {
        setQuery('> time now')
      },
    },
    {
      id: 'cmd-tool-uuid',
      title: '> uuid (UUID v4 随机生成器)',
      description: '批量生成标准安全 RFC4122 v4 UUID',
      icon: Fingerprint,
      category: '极客微工具',
      handler: () => {
        setQuery('> uuid 1')
      },
    },
    {
      id: 'cmd-tool-hash',
      title: '> hash (WebCrypto 哈希计算)',
      description: '本地计算 SHA-256、SHA-1 与 SHA-512 摘要',
      icon: Hash,
      category: '极客微工具',
      handler: () => {
        setQuery('> hash ')
      },
    },
    {
      id: 'cmd-tool-json',
      title: '> json (JSON 格式化与校验)',
      description: '实时语法校验、结构美化与单行压缩',
      icon: FileJson,
      category: '极客微工具',
      handler: () => {
        setQuery('> json ')
      },
    },
    {
      id: 'cmd-tool-url',
      title: '> url (URL Component 编解码)',
      description: 'encodeURIComponent 与 decodeURIComponent 双向转换',
      icon: Link2,
      category: '极客微工具',
      handler: () => {
        setQuery('> url ')
      },
    },
    {
      id: 'cmd-canvas',
      title: '工作台画布 (Modular Canvas)',
      description: '跳转至拖拽式模块化生产力看板',
      icon: LayoutGrid,
      category: '页面直达',
      handler: () => {
        setOpen(false)
        router.push('/custom')
      },
    },
    {
      id: 'cmd-copilot',
      title: 'AI Web Copilot 智能助手',
      description: `呼出右下角全局 AI 生产力浮窗抽屉 (${modKey}+J)`,
      icon: Bot,
      category: 'AI 交互',
      handler: () => {
        setOpen(false)
        window.dispatchEvent(new CustomEvent('open-ai-copilot'))
      },
    },
    {
      id: 'cmd-marketplace',
      title: '插件生态市场 (Marketplace)',
      description: '发现并安装主题、网址包、搜索引擎与微组件',
      icon: Store,
      category: '页面直达',
      handler: () => {
        setOpen(false)
        router.push('/marketplace')
      },
    },
    {
      id: 'cmd-admin',
      title: '系统管理中心 (Admin Console)',
      description: '站点审校、模型配置、Token 遥测大盘与安全凭据',
      icon: ShieldCheck,
      category: '管理面',
      handler: () => {
        setOpen(false)
        router.push('/admin')
      },
    },
    {
      id: 'cmd-theme-dark',
      title: '切换为深色模式 (Dark Theme)',
      description: '一键将界面色彩方案设为深色暗夜',
      icon: Palette,
      category: '界面外观',
      handler: () => {
        document.documentElement.classList.add('dark')
        toast.success('已切换为深色暗夜模式')
        setOpen(false)
      },
    },
    {
      id: 'cmd-theme-light',
      title: '切换为浅色模式 (Light Theme)',
      description: '一键将界面色彩方案设为清新明亮',
      icon: Palette,
      category: '界面外观',
      handler: () => {
        document.documentElement.classList.remove('dark')
        toast.success('已切换为浅色明亮模式')
        setOpen(false)
      },
    },
    {
      id: 'cmd-backup',
      title: '快速备份与数据导出 (Export Backup)',
      description: '导出全量导航站点与自定义布局为 JSON 快照',
      icon: Download,
      category: '数据安全',
      handler: () => {
        setOpen(false)
        window.open('/api/navigation/export', '_blank', 'noopener,noreferrer')
        toast.success('已触发系统快照导出备份')
      },
    },
    {
      id: 'cmd-graph',
      title: '全景 2D 知识星图与拓扑演进中枢 (Star Map)',
      description: '可视化全站星系拓扑、技术演进最短寻路与关联边探测',
      icon: Compass,
      category: '知识网络',
      handler: () => {
        setOpen(false)
        setStarMapOpen(true)
      },
    },
    {
      id: 'cmd-dedup',
      title: '全站跨分类雷同站点查重审计 (Duplicate Sites)',
      description: '智能扫描高重合度站点并提供标签融合与冗余清洗建议',
      icon: Layers,
      category: '质量巡检',
      handler: () => {
        setOpen(false)
        setStarMapOpen(true)
      },
    },
    {
      id: 'cmd-airdrop',
      title: 'NavDrop 跨标签页快传 (Local First)',
      description: '在同一浏览器的标签页之间直连书签、主题与工作台排版；跨设备请改用导出备份',
      icon: Radio,
      category: '本地协同',
      handler: () => {
        setOpen(false)
        setAirdropOpen(true)
      },
    },
    {
      id: 'cmd-fluid',
      title: '动态流光毛玻璃背景切换 (Toggle Fluid Glass)',
      description: '开启或关闭极致平滑的流体渐变磨砂画布壁纸背景',
      icon: Sparkles,
      category: '界面外观',
      handler: () => {
        window.dispatchEvent(new CustomEvent('toggle-fluid-glass'))
        const isNow = localStorage.getItem('navhub_fluid_glass_enabled') === 'true'
        toast.success(isNow ? '已开启动态流光毛玻璃背景' : '已关闭流光背景')
        setOpen(false)
      },
    },
  ], [router, modKey])

  // 过滤当前指令
  const filteredCommands = useMemo(() => {
    if (!cleanCmd) return systemCommands
    return systemCommands.filter(
      (c) =>
        c.title.toLowerCase().includes(cleanCmd) ||
        c.description.toLowerCase().includes(cleanCmd) ||
        c.id.includes(cleanCmd)
    )
  }, [cleanCmd, systemCommands])

  // 5. 检索执行（防抖 180ms + 中断信号）
  useEffect(() => {
    if (isCommandMode || isAiMode) {
      setHits([])
      setPluginHits(null)
      setLoading(false)
      return
    }

    const trimmed = query.trim()
    if (!trimmed) {
      setHits([])
      setPluginHits(null)
      setSitesUnavailable(false)
      setLoading(false)
      return
    }

    if (abortRef.current) abortRef.current.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setLoading(true)
    const timer = setTimeout(() => {
      let siteSearchFailed = false
      Promise.all([
        searchSites({ q: trimmed, limit: 8, identity }, ac.signal).catch(() => {
          // 站点召回失败必须留痕：以前直接当成「这一路没有结果」，
          // 于是检索服务挂掉时用户看到的是「未找到相关站点」——谎报。
          siteSearchFailed = true
          return null
        }),
        searchPlugins({ q: trimmed, limit: 3 }).catch(() => {
          // 插件召回是附赠通道：失败就当没有插件结果，站点结果照常展示
          return null
        }),
      ]).then(([sitesRes, pluginsRes]) => {
        if (!ac.signal.aborted) {
          setHits(sitesRes?.hits ?? [])
          setPluginHits(pluginsRes)
          setSitesUnavailable(siteSearchFailed)
          setLoading(false)
          setSelectedIndex(0)
        }
      })
    }, 180)

    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [query, isCommandMode, isAiMode, identity, searchNonce])

  // 6. 复制链接
  const handleCopy = useCallback(async (url: string, id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const result = await copyText(url)
    if (!result.ok) {
      // 复制失败不许报喜：把原因如实说给用户，不标记「已复制」
      const note = copyFailureToast(result)
      toast.error(note.title, { description: note.description })
      return
    }
    setCopiedId(id)
    toast.success('链接已复制到剪贴板')
    setTimeout(() => setCopiedId(null), 1800)
  }, [])

  // 7. 时间机器快照自愈
  const handleWaybackHeal = useCallback(async (siteId: string, currentUrl: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setHealingId(siteId)
    try {
      const res = await healSiteWayback(siteId, { replaceUrl: true, markActive: true })
      if (res.ok && res.healed && res.recoveryUrl) {
        toast.success('时间机器自愈成功！已替换为 Wayback 历史镜像快照')
        // 本地更新 hits 中的对应站点
        setHits((prev) =>
          prev.map((h) =>
            h.siteId === siteId && h.site
              ? { ...h, site: { ...h.site, url: res.recoveryUrl!, status: 'active' } }
              : h
          )
        )
      } else {
        toast.info(res.message || '未在 Wayback 找到历史快照，建议点击即时归档保存')
        if (res.saveUrl) safeWindowOpen(res.saveUrl)
      }
    } catch {
      toast.error('时间机器自愈请求失败，请稍后重试')
    } finally {
      setHealingId(null)
    }
  }, [])

  // 8. 选中条目并执行回车
  const handleSelectCurrent = useCallback(() => {
    if (isCommandMode) {
      const cmd = filteredCommands[selectedIndex]
      if (cmd) cmd.handler()
      return
    }

    if (isAiMode) {
      if (!cleanAiPrompt) return
      setOpen(false)
      window.dispatchEvent(new CustomEvent('open-ai-copilot', { detail: { prompt: cleanAiPrompt } }))
      return
    }

    // 默认检索：站点优先，插件次之
    const totalSiteHits = hits.length
    if (selectedIndex < totalSiteHits) {
      const hit = hits[selectedIndex]
      if (hit?.site?.url) {
        openSite(hit.site)
        setOpen(false)
      }
    } else {
      const pluginIndex = selectedIndex - totalSiteHits
      const plugin = pluginHits?.items[pluginIndex]
      if (plugin?.slug) {
        setOpen(false)
        router.push(`/marketplace/${encodeURIComponent(plugin.slug)}`)
      }
    }
  }, [isCommandMode, isAiMode, filteredCommands, selectedIndex, cleanAiPrompt, hits, pluginHits, router, openSite])

  // 9. 键盘导航 (上下箭头 / 回车)
  const totalItemCount = useMemo(() => {
    if (isCommandMode) return filteredCommands.length
    if (isAiMode) return 1
    return hits.length + (pluginHits?.items.length ?? 0)
  }, [isCommandMode, isAiMode, filteredCommands.length, hits.length, pluginHits?.items.length])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (totalItemCount > 0 ? (prev + 1) % totalItemCount : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (totalItemCount > 0 ? (prev - 1 + totalItemCount) % totalItemCount : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleSelectCurrent()
    }
  }

  /**
   * 焦点始终留在搜索框，所以当前行只能通过 aria-activedescendant 告诉读屏。
   * 三种模式的行 id 共用一套扁平编号：指令行是 0..n、站点行是 0..n、
   * 插件行是 hits.length + idx —— 与 selectedIndex 的定义完全一致。
   */
  const optionIdOf = (index: number) => `spotlight-option-${index}`
  const activeOptionId = totalItemCount > 0 ? optionIdOf(selectedIndex) : undefined
  // 极客微工具面板里没有可选行（selectedIndex 走的是指令列表），此时不能声称控制着某个列表
  const hasListbox = totalItemCount > 0 && !(isCommandMode && isGeekToolActive)
  /** 当前选中行落在哪个列表：指令 / 站点 / 插件（插件行编号从 hits.length 起） */
  const listboxId = isCommandMode
    ? 'spotlight-cmd-listbox'
    : selectedIndex < hits.length
      ? 'spotlight-site-listbox'
      : 'spotlight-plugin-listbox'

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[max(env(safe-area-inset-top,0px),0.5rem)] sm:pt-[10vh] px-2 sm:px-4 pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] animate-in fade-in-0 duration-150">
          {/* 遮罩是面板的兄弟节点而不是包裹层：包裹层带 aria-hidden 会让读屏把对话框一起跳过 */}
          <div {...scrimProps} className="absolute inset-0 bg-background/80 backdrop-blur-md" />
      <div
        {...containerProps}
        className="relative z-10 w-full max-w-2xl bg-card/95 border border-border/80 shadow-2xl rounded-2xl overflow-hidden glass-surface flex flex-col max-h-[88dvh] sm:max-h-[75vh] outline-none"
        onKeyDown={handleKeyDown}
      >
        {/* 顶部搜索框区域 */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border/60 bg-muted/20">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 text-primary shrink-0">
            {isCommandMode ? (
              <Terminal className="w-4 h-4 text-amber-500" />
            ) : isAiMode ? (
              <Sparkles className="w-4 h-4 text-purple-500 animate-pulse" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </div>

          <div className="relative flex-1 flex items-center">
            <Input
              ref={inputRef}
              aria-label="全局超级搜索与系统指令"
              role="combobox"
              aria-expanded={hasListbox}
              aria-controls={hasListbox ? listboxId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={activeOptionId}
              placeholder={
                isCommandMode
                  ? '输入指令（如 canvas, copilot, theme, backup...）'
                  : isAiMode
                  ? '输入任何问题，回车直达 AI 深度问答...'
                  : '搜索站点、插件、输入 > 进入指令模式、输入 ? 询问 AI...'
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelectedIndex(0)
              }}
              className="h-9 border-0 bg-transparent shadow-none focus-visible:ring-0 text-base sm:text-sm px-0 placeholder:text-muted-foreground/60"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md"
                aria-label="清空输入"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isCommandMode && (
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                指令模式
              </Badge>
            )}
            {isAiMode && (
              <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-600 border-purple-500/30">
                AI Copilot
              </Badge>
            )}
            <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border/80 bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
              ESC
            </kbd>
          </div>
        </div>

        {/* 核心内容区 */}
        <div ref={listRef} className="overflow-y-auto p-2 space-y-2 flex-1">
          {/* A. 指令模式 */}
          {isCommandMode && (
            isGeekToolActive ? (
              <GeekMicroTools query={query} onSelectSample={(sample) => setQuery(sample)} />
            ) : (
              <div role="listbox" id="spotlight-cmd-listbox" aria-label="系统快捷指令" className="space-y-1">
                <div role="presentation" className="px-3 py-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span>系统控制台快捷指令 & 极客微工具</span>
                </div>
                {filteredCommands.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    未匹配到相关指令，可尝试输入 <span className="font-mono text-primary">&gt; canvas</span> 或 <span className="font-mono text-primary">&gt; b64</span>
                  </div>
                ) : (
                  filteredCommands.map((cmd, idx) => {
                    const Icon = cmd.icon
                    const isSelected = idx === selectedIndex
                    return (
                      <div
                        key={cmd.id}
                        onClick={() => cmd.handler()}
                        id={optionIdOf(idx)}
                        role="option"
                        aria-selected={isSelected}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50 text-foreground'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`p-2 rounded-lg ${isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{cmd.title}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{cmd.description}</div>
                          </div>
                        </div>
                        <Badge variant="secondary" className="text-[10px] shrink-0 font-normal">
                          {cmd.category}
                        </Badge>
                      </div>
                    )
                  })
                )}
              </div>
            )
          )}

          {/* B. AI 问答模式 */}
          {isAiMode && (
            <div className="p-4 space-y-4">
              <div className="p-4 rounded-xl border border-purple-500/20 bg-purple-500/5 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-purple-700 dark:text-purple-300">
                  <Sparkles className="w-4 h-4 text-purple-500" />
                  <span>AI 生产力问答</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {cleanAiPrompt
                    ? `准备深入分析问题：“${cleanAiPrompt}”`
                    : '随时向 AI Copilot 提问，支持网页对比、技术选型分析与智能书签归整。'}
                </p>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-muted-foreground">按回车 (Enter) 呼出抽屉继续推理</span>
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1.5 bg-purple-600 hover:bg-purple-700 text-white"
                    onClick={handleSelectCurrent}
                  >
                    <span>向 AI 发问</span>
                    <ArrowRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {/* 推荐问题场景 */}
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground px-1 font-medium">推荐提问情景：</div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    '帮我把未分类的网址按技术栈分类',
                    '对比 Supabase、Firebase 与 PocketBase 优劣',
                    '推荐 5 个好用的 Next.js 动画动效库',
                  ].map((tip, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setQuery(`? ${tip}`)}
                      className="text-xs px-2.5 py-1 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/50 transition-colors text-left"
                    >
                      {tip}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* C. 默认混合检索模式 */}
          {!isCommandMode && !isAiMode && (
            <>
              {loading && (
                <div className="py-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span>正在执行 RRF 多通道混合召回...</span>
                </div>
              )}

              {/* 空输入时展示：历史搜索与快速建议 */}
              {!query.trim() && (
                <div className="p-3 space-y-4">
                  {recentQueries.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        <span>最近搜索</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {recentQueries.map((item, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setQuery(item)}
                            className="text-xs px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-500" />
                      <span>功能速览</span>
                    </div>
                    <div className="grid grid-cols-1 min-[340px]:grid-cols-2 sm:grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false)
                          router.push('/custom')
                        }}
                        className="p-2.5 rounded-xl border border-border/60 bg-muted/20 hover:bg-muted/50 text-left flex items-center gap-2.5 transition-colors"
                      >
                        <LayoutGrid className="w-4 h-4 text-primary" />
                        <div>
                          <div className="text-xs font-medium">工作台画布</div>
                          <div className="text-[10px] text-muted-foreground">12 栅格看板</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false)
                          window.dispatchEvent(new CustomEvent('open-ai-copilot'))
                        }}
                        className="p-2.5 rounded-xl border border-border/60 bg-muted/20 hover:bg-muted/50 text-left flex items-center gap-2.5 transition-colors"
                      >
                        <Bot className="w-4 h-4 text-purple-500" />
                        <div>
                          <div className="text-xs font-medium">AI Web Copilot</div>
                          <div className="text-[10px] text-muted-foreground">{modKey}+J 助手</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false)
                          router.push('/marketplace')
                        }}
                        className="p-2.5 rounded-xl border border-border/60 bg-muted/20 hover:bg-muted/50 text-left flex items-center gap-2.5 transition-colors"
                      >
                        <Store className="w-4 h-4 text-rose-500" />
                        <div>
                          <div className="text-xs font-medium">插件应用市场</div>
                          <div className="text-[10px] text-muted-foreground">生态组件源</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false)
                          setStarMapOpen(true)
                        }}
                        className="p-2.5 rounded-xl border border-border/60 bg-muted/20 hover:bg-muted/50 text-left flex items-center gap-2.5 transition-colors"
                      >
                        <Compass className="w-4 h-4 text-indigo-500" />
                        <div>
                          <div className="text-xs font-medium">知识拓扑星图</div>
                          <div className="text-[10px] text-muted-foreground">2D 拓扑演进</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false)
                          setAirdropOpen(true)
                        }}
                        className="p-2.5 rounded-xl border border-border/60 bg-muted/20 hover:bg-muted/50 text-left flex items-center gap-2.5 transition-colors"
                      >
                        <Radio className="w-4 h-4 text-cyan-500" />
                        <div>
                          <div className="text-xs font-medium">NavDrop 快传</div>
                          <div className="text-[10px] text-muted-foreground">同浏览器直连</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false)
                          setHealthAuditOpen(true)
                        }}
                        className="p-2.5 rounded-xl border border-border/60 bg-muted/20 hover:bg-muted/50 text-left flex items-center gap-2.5 transition-colors"
                      >
                        <HeartPulse className="w-4 h-4 text-emerald-500" />
                        <div>
                          <div className="text-xs font-medium">站点自治巡检</div>
                          <div className="text-[10px] text-muted-foreground">健康度自愈</div>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 站点检索结果列表 (RRF 混合召回) */}
              {hits.length > 0 && (
                <div role="listbox" id="spotlight-site-listbox" aria-label={`站点检索结果，共 ${hits.length} 条`} className="space-y-1">
                  <div role="presentation" className="px-3 py-1 text-xs font-semibold text-muted-foreground flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" />
                      <span>导航站点（RRF 混合多通道排序）</span>
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground/70">{hits.length} 条命中</span>
                  </div>

                  {hits.map((hit, idx) => {
                    const isSelected = idx === selectedIndex
                    const site = hit.site
                    if (!site) return null
                    const isBroken = site.status === 'broken' || (site.health && !site.health.ok)
                    const channels = Object.keys(hit.contributions)

                    return (
                      <div
                        key={hit.siteId}
                        onClick={() => {
                          openSite(site)
                          setOpen(false)
                        }}
                        id={optionIdOf(idx)}
                        role="option"
                        aria-selected={isSelected}
                        className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/40 text-foreground'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-8 h-8 rounded-lg bg-muted/60 border border-border/60 flex items-center justify-center shrink-0 overflow-hidden">
                            <SiteFavicon title={site.title} url={site.url} icon={site.iconKey ?? undefined} className="w-5 h-5 object-contain" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold truncate group-hover:text-primary transition-colors">
                                {site.title}
                              </span>
                              {isBroken && (
                                <Badge variant="destructive" className="text-[10px] py-0 px-1.5 h-4 flex items-center gap-1">
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  <span>可能死链</span>
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate leading-relaxed">
                              {site.description || site.url}
                            </div>
                          </div>
                        </div>

                        {/* 右侧：RRF 通道徽标与快捷自愈动作 */}
                        <div className="flex items-center gap-1.5 shrink-0 ml-2">
                          <div className="hidden sm:flex items-center gap-1">
                            {channels.map((ch) => {
                              const meta = CHANNEL_BADGES[ch]
                              if (!meta) return null
                              return (
                                <span
                                  key={ch}
                                  title={ch === 'personal' ? '来自你近 30 天的点击与收藏偏好（可在「偏好设置」查看或清理画像）' : undefined}
                                  className={`text-[10px] px-1.5 py-0.2 rounded-full border font-medium ${meta.className}`}
                                >
                                  {meta.label}
                                </span>
                              )
                            })}
                          </div>

                          {/* 死链一键自愈按钮 */}
                          {isBroken && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px] gap-1 px-2 border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                              title="调取 Wayback Machine 历史快照自愈修复此站点"
                              disabled={healingId === site.id}
                              onClick={(e) => handleWaybackHeal(site.id, site.url, e)}
                            >
                              {healingId === site.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <History className="w-3 h-3" />
                              )}
                              <span>自愈</span>
                            </Button>
                          )}

                          <button
                            type="button"
                            className="p-1.5 -m-0.5 rounded-md text-muted-foreground hover:text-foreground focus-visible:opacity-100 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity"
                            title="离线纯净阅读快照"
                            aria-label={`离线纯净阅读 ${site.title}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setArchiveSite(site)
                              setArchiveReaderOpen(true)
                            }}
                          >
                            <BookOpen className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            className="p-1.5 -m-0.5 rounded-md text-muted-foreground hover:text-foreground focus-visible:opacity-100 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity"
                            title="复制网址"
                            aria-label={`复制网址 ${site.url}`}
                            onClick={(e) => handleCopy(site.url, site.id, e)}
                          >
                            {copiedId === site.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>

                          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* 插件市场并行召回 */}
              {pluginHits && pluginHits.items.length > 0 && (
                <div role="listbox" id="spotlight-plugin-listbox" aria-label={`插件检索结果，共 ${pluginHits.items.length} 条`} className="pt-2 border-t border-border/40 space-y-1">
                  <div className="px-3 py-1 text-xs font-semibold text-muted-foreground flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Store className="w-3.5 h-3.5 text-rose-500" />
                      <span>插件市场组件 (Plugins)</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        router.push(`/marketplace?q=${encodeURIComponent(query)}`)
                      }}
                      className="text-[11px] text-primary hover:underline"
                    >
                      查看全部
                    </button>
                  </div>

                  {pluginHits.items.map((plugin, idx) => {
                    const itemIndex = hits.length + idx
                    const isSelected = itemIndex === selectedIndex
                    return (
                      <div
                        key={plugin.slug}
                        onClick={() => {
                          setOpen(false)
                          router.push(`/marketplace/${encodeURIComponent(plugin.slug)}`)
                        }}
                        id={optionIdOf(itemIndex)}
                        role="option"
                        aria-selected={isSelected}
                        className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/40 text-foreground'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-600 flex items-center justify-center shrink-0">
                            <Store className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold truncate">{plugin.name}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{plugin.description}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 border-rose-500/20">
                            {plugin.kind}
                          </Badge>
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* 零结果提示：「没搜到」和「没搜成」是两句话，不能混着说 */}
              {!loading && query.trim() && hits.length === 0 && (!pluginHits || pluginHits.items.length === 0) && (
                <div className="py-12 text-center space-y-2">
                  {sitesUnavailable ? (
                    <>
                      <div className="text-xs text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>站点检索请求失败，暂时无法确认有没有匹配结果</span>
                      </div>
                      <div>
                        <button
                          type="button"
                          onClick={() => setSearchNonce((n) => n + 1)}
                          className="text-[11px] px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
                        >
                          重试
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs text-muted-foreground">
                        未找到与 “<span className="text-foreground font-medium">{query}</span>” 相关的站点或插件
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        提示：输入 <span className="font-mono text-primary">&gt;</span> 可执行系统控制指令，或输入 <span className="font-mono text-primary">?</span> 呼出 AI 助手
                      </div>
                    </>
                  )}
                  {externalSearchHref && (
                    <div>
                      <a
                        href={externalSearchHref}
                        target={linkTarget}
                        rel="noopener noreferrer nofollow"
                        onClick={() => setOpen(false)}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden />
                        <span>用 {externalSearchName} 搜索「{query.trim()}」</span>
                      </a>
                    </div>
                  )}
                </div>
              )}
              {/* 站点通道挂了但插件有结果：说清「下面不完整」，不要让用户以为整站就这些 */}
              {!loading && sitesUnavailable && hits.length === 0 && !!pluginHits && pluginHits.items.length > 0 && (
                <div className="px-3 py-2 text-[11px] text-amber-600 dark:text-amber-400">
                  站点检索通道暂时不可用，以下只有插件结果。
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部快捷键指南栏 */}
        <div className="px-4 py-2.5 border-t border-border/50 bg-muted/30 text-[11px] text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 text-[10px]">↑↓</kbd>
              <span>选择</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 text-[10px]">↵</kbd>
              <span>执行/打开</span>
            </span>
            <span className="hidden sm:flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 text-[10px]">&gt;</kbd>
              <span>指令模式</span>
            </span>
            <span className="hidden sm:flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 text-[10px]">?</kbd>
              <span>AI 问答</span>
            </span>
          </div>

          <div className="hidden min-[420px]:block text-[10px] text-muted-foreground/70 font-mono truncate">
            RRF Multi-Channel Fusion
          </div>
        </div>
      </div>
    </div>
      )}

      {/* 站点健康自治巡检与无感自愈中枢 */}
      {healthAuditOpen && (
        <SiteHealthAuditModal open={healthAuditOpen} onClose={() => setHealthAuditOpen(false)} />
      )}

      {/* 知识星图与拓扑演进中枢 */}
      {starMapOpen && <KnowledgeStarMapModal open={starMapOpen} onOpenChange={setStarMapOpen} />}

      {/* 离线快照纯净阅读器 */}
      {archiveReaderOpen && (
        <SiteArchiveReaderModal
          site={archiveSite}
          open={archiveReaderOpen}
          onOpenChange={setArchiveReaderOpen}
        />
      )}

      {/* NavDrop 跨标签页快传（BroadcastChannel，仅同一浏览器） */}
      {airdropOpen && <P2PAirDropModal open={airdropOpen} onOpenChange={setAirdropOpen} />}
    </>
  )
}

