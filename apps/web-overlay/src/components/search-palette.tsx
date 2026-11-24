'use client'

/**
 * SearchPalette —— 接入中枢混合检索引擎的命令面板。
 *
 * 与上游 search-bar 的区别：上游只在客户端对 navigation.json 做 includes() 过滤，
 * 拼音 / 语义 / BM25 / 个性化全部闲置。本组件把同一个 ⌘K 面板接到
 * /api/search 上，四路召回 + RRF 融合的结果直接可用。
 *
 * 工程要点：
 *  - 防抖 200ms + AbortController 取消在途请求（快打字不抖动、不竞态）
 *  - 结果带通道徽标（exact/fts/pinyin/semantic/personal）与语义可用性提示
 *  - 中枢不可用时明示降级，而不是假装"没有结果"
 *  - 空查询展示最近搜索（服务端历史，匿名 anonId 也可用）
 */

import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Input } from '@/registry/new-york/ui/input'
import { Command, CommandList } from '@/registry/new-york/ui/command'
import { Search, X, Star, Clock, Loader2, Sparkles, Layers, GitCompare, Zap, ArrowRight, GitFork, Store, Download, ExternalLink, PencilLine, Share2, Upload, RotateCcw, LayoutTemplate, Sun, Moon, Accessibility, Plus, Wrench, Calculator, Braces, Binary, Link2, KeyRound, Timer, Terminal, Hash, Globe, Network, Palette, CalendarDays, Regex, Scale, Activity, Ruler, Fingerprint } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  searchSites,
  searchPlugins,
  reportClick,
  fetchSearchHistoryPage,
  deleteSearchHistoryItem,
  clearCloudSearchHistory,
  fetchCollections,
  createCustomSite,
  type HubSearchHit,
  type HubSearchResult,
  type HubSiteRelation,
  type HubPluginSearchResponse,
  type HubCollection,
} from '@/lib/navhub-api'
import { queryToTitleAndUrl } from '@/lib/submit-prefill'
import { saveWantedSearch } from '@/lib/wanted-searches'
import { searchChannelStatus } from '@/lib/search-degrade'
import { buildSearchSuggestions, matchSuggestionText } from '@/lib/search-suggestions'
import {
  clearSearchHistorySnapshot,
  removeRecentSearchItem,
  toRecentSearchItems,
  type RecentSearchItem,
} from '@/lib/recent-search'
import { pluginKindLabel } from '@/lib/plugins/plugin-manifest'
import { OFFLINE_RECENT_LIMIT, buildMruNormBySiteId, recordOfflineVisit, readOfflineVisits, splitRecentVisitsForBoost, type RecentVisit } from '@/lib/offline-recent'
import { highlightParts } from '@/lib/highlight'
import { planSearchPanel, type SearchPanelAction } from '@/lib/search-panel'
import { rankSearchHits } from '@/lib/search-rerank'
import { openCopilot } from '@/lib/ai-entry'
import {
  SEARCH_AI_PLACEHOLDER,
  readSearchAiMode,
  resolveAiModeInput,
  writeSearchAiMode,
} from '@/lib/search-ai-mode'
import { getIdentity } from '@/lib/identity'
import { relaxedPricingNotice, searchHref } from '@/lib/search-page'
import { useFavorites } from '@/hooks/useFavorites'
import { useToast } from '@/components/ui/use-toast'
import type { SiteConfig } from '@/types/site'
import { parseSpeculativeIntent } from '@/lib/speculative'
import { spotlightHotkeyHint, useExternalLinkTarget, useUserPreferences } from '@/lib/user-preferences'
import { parseTechComparisonQuery } from '@/lib/comparison'
import { findMatchingArchitectureRecipe } from '@/lib/architecture-recipe'
import { SiteFavicon } from '@/components/site-favicon'
import { isSafeHttpUrl, safeHref, safeWindowOpen } from '@/lib/safe-url'
import { getModifierKey } from '@/lib/platform'
import {
  useFeatureMask,
  computePrunedSearchRecall,
  stripFeaturePrefix,
} from '@/lib/modular/feature-mask-store'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { useDensity, type ContentDensity } from '@/components/density-provider'
import { BUILTIN_DIY_PRESETS } from '@/lib/modular/diy-presets'
import { copyFailureToast, copyText } from '@/lib/clipboard'
import {
  matchDiyPaletteActions,
  type DiyPaletteActionId,
  type DiyPaletteActionItem,
} from '@/lib/modular/diy-palette-actions'
import { matchScenePaletteActions } from '@/lib/modular/scene-palette-actions'
import { performSceneSwitch, useUserScenes } from '@/components/scene-switcher'
import {
  altDigitFromKeyOrCode,
  altDigitTargetIndex,
  buildPaletteNavItems,
  matchPaletteActions,
  matchPaletteFavorites,
  matchPaletteQuicklinks,
  matchPaletteTools,
  ZERO_RTT_TOOLS,
  type PaletteActionEntry,
  type PaletteActionId,
  type PaletteFavoriteLike,
  type PaletteQuicklinkItem,
  type PaletteToolEntry,
} from '@/lib/palette-actions'
import { ensurePinyinLoaded, isLatinQuery } from '@/lib/palette-pinyin'
import {
  matchQuicklinkCommand,
  quicklinkFromFavorite,
  type QuicklinkEntry,
} from '@/lib/quicklinks'
import { useTheme } from 'next-themes'
import {
  ELDER_MODE_CHANGED_EVENT,
  loadElderMode,
  setElderMode,
} from '@/lib/elder-mode'
import { createCustomSiteId, normalizeCustomSiteHref } from '@/lib/modular/custom-site-input'
import { suggestCategoryForSite } from '@/lib/modular/diy-presets'



// 三张「命中才出现」的富卡片：只有查询触发对应意图时才需要它们的代码。
// 静态导入会把投机解析、对比矩阵、架构配方三条知识库一起打进首屏。
const SpeculativeIntentCard = dynamic(
  () => import('@/components/speculative-intent-card').then((m) => m.SpeculativeIntentCard),
  { ssr: false }
)
const TechComparisonCard = dynamic(
  () => import('@/components/tech-comparison-card').then((m) => m.TechComparisonCard),
  { ssr: false }
)
const ArchitectureRecipeCard = dynamic(
  () => import('@/components/architecture-recipe-card').then((m) => m.ArchitectureRecipeCard),
  { ssr: false }
)
const ActionIntentCard = dynamic(
  () => import('@/components/action-intent-card').then((m) => m.ActionIntentCard),
  { ssr: false }
)
import type { ActionIntentCardData } from '@/components/action-intent-card'
import { AlgorithmHudBadge } from './algorithm-hud-badge'
/** 添加自定义站点弹窗（P1 #8）：与 navigation-content 同款懒加载，Radix Dialog 不进首屏 */
const AddSiteDialog = dynamic(
  () => import('@/components/add-site-dialog').then((m) => m.AddSiteDialog),
  { ssr: false }
)
import type { CategorySuggestion } from '@/components/add-site-dialog'

/**
 * 04 §2.1：`parseOmniCommand` 是薄壳（写死）——签名与返回值保持不变，
 * 内部只调 `matchQuicklinkCommand`（唯一 bang 权威，内置引擎表
 * `DEFAULT_QUICKLINK_ENTRIES` 是全仓唯一定义点），不写任何正则、
 * 不维护引擎表；`/gh x` 不解析（裁决 D2）。未知前缀与无占位符模板
 * 在这里都映射为 null（OMNI 调用方行为不变），明示行由渲染层
 * 直接读 `matchQuicklinkCommand` 的结构化结果单独处理。
 */
export function parseOmniCommand(raw: string): { engine: string; engineName: string; term: string; url: string } | null {
  const hit = matchQuicklinkCommand(raw, [])
  if (hit.kind !== 'hit' || !hit.url) return null
  return {
    engine: hit.entry.quickPrefix,
    engineName: hit.entry.title,
    term: hit.arg,
    url: hit.url,
  }
}

const CHANNEL_LABELS: Record<string, string> = {
  exact: '精确',
  fts: '全文',
  pinyin: '拼音',
  semantic: '语义',
  personal: '个性化',
}

/** DIY 操作行图标（8c） */
const DIY_ACTION_ICONS: Record<DiyPaletteActionId, typeof PencilLine> = {
  edit: PencilLine,
  preset: LayoutTemplate,
  share: Share2,
  import: Upload,
  reset: RotateCcw,
}

/** 万能栏操作行图标（P1 #8）：主题图标随深浅变，单独处理，不进这张表 */
const PALETTE_ACTION_ICONS: Record<Exclude<PaletteActionId, 'theme'>, typeof PencilLine> = {
  elder: Accessibility,
  'add-site': Plus,
  density: LayoutTemplate,
}

/** 极速工具行图标（P1 #8）：装饰性图标，与抽屉各 tab 的图标同口径 */
const PALETTE_TOOL_ICONS: Record<string, typeof PencilLine> = {
  math: Calculator,
  json: Braces,
  base64: Binary,
  uuid: Fingerprint,
  timestamp: Clock,
  'date-to-ts': CalendarDays,
  color: Palette,
  regex: Regex,
  semver: Scale,
  'http-status': Activity,
  'hash-detect': Hash,
  'hash-calc': Hash,
  ip: Globe,
  cidr: Network,
  'byte-size': Ruler,
  jwt: KeyRound,
  cron: Timer,
  curl: Terminal,
  url: Link2,
}

/** 结果行文本高亮：命中片段上色，未命中原样（仅字面命中的词有高亮，拼音/语义召回本就无字面） */
function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((seg, i) =>
        seg.hit ? (
          <span key={i} className="text-primary font-semibold bg-primary/10 rounded-xs px-0.5">
            {seg.text}
          </span>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  )
}

interface SearchPaletteProps {
  siteConfig?: SiteConfig
  /** 类目筛选（侧栏点击类目时带入） */
  categoryId?: string
  placeholder?: string
}

/**
 * 数字徽标（04 §4.2）：navItems 前 10 条（index 0..9）显示 1..9、0，
 * 第 11 条起不显示；行首、图标左侧，复用行内 kbd 样式；纯视觉辅助，
 * `aria-hidden="true"`（读屏器读行标题即可，Alt+数字的操作说明在底部提示行）。
 */
export function NavDigitBadge({ index }: { index: number }) {
  if (index < 0 || index > 9) return null
  const digit = index === 9 ? '0' : String(index + 1)
  return (
    <kbd
      aria-hidden="true"
      className="px-1.5 py-0.5 rounded border border-border/50 bg-muted/60 font-mono text-[10px] text-muted-foreground shrink-0"
    >
      {digit}
    </kbd>
  )
}

/**
 * 面板底部快捷键提示（04 §7.3）：文案一字不差——
 * `↑↓ 选择 · Enter 打开 · Alt+1–0 直达前 10 条 · Esc 关闭`
 *（`·` 为分隔，`–` 为 en dash；kbd 键位芯片只影响样式，不影响文案）。
 */
export function PaletteFooterHint() {
  return (
    <>
      <span className="inline-flex items-center gap-1">
        <kbd className="rounded border border-border/70 bg-background px-1 font-mono">↑</kbd>
        <kbd className="rounded border border-border/70 bg-background px-1 font-mono">↓</kbd>
        {' '}选择
      </span>
      {' · '}
      <span className="inline-flex items-center gap-1">
        <kbd className="rounded border border-border/70 bg-background px-1 font-mono">Enter</kbd>
        {' '}打开
      </span>
      {' · '}
      <span className="inline-flex items-center gap-1">
        <kbd className="rounded border border-border/70 bg-background px-1 font-mono">Alt+1–0</kbd>
        {' '}直达前 10 条
      </span>
      {' · '}
      <span className="inline-flex items-center gap-1">
        <kbd className="rounded border border-border/70 bg-background px-1 font-mono">Esc</kbd>
        {' '}关闭
      </span>
    </>
  )
}

export function SearchPalette({ siteConfig, categoryId, placeholder = '搜索导航…（中文 / 拼音 / 语义）（按 / 快速搜索）' }: SearchPaletteProps) {
  const [query, setQuery] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  /**
   * AI 模式：打开后回车不再打开第一条站内结果，而是把整句查询直接发给
   * AI 找站（全局抽屉）。模式记在本地，下次打开搜索框还在；只影响回车
   * 去向，不动站内检索本身（方向键照常挑结果）。
   */
  const [aiMode, setAiMode] = useState<boolean>(() => readSearchAiMode())
  const effectivePlaceholder = aiMode ? SEARCH_AI_PLACEHOLDER : placeholder
  const toggleAiMode = useCallback(() => {
    setAiMode((prev) => {
      const next = !prev
      writeSearchAiMode(next)
      return next
    })
    inputRef.current?.focus()
  }, [])
  /**
   * 键盘高亮项索引。
   *
   * 输入框在 <Command> 之外（搜索框在顶部，结果面板在其下方），cmdk 的
   * keydown 监听挂在 Command 根节点上，键盘事件从输入框冒泡不到那里——
   * 结果就是「能打字、不能选」：↑↓/Enter 完全无反应，Tab 只会跳到每行的
   * 收藏星标。这里自己维护一条扁平列表（插件在前、站点在后，与 DOM 顺序一致），
   * 并用 aria-activedescendant 把高亮项告知读屏。
   */
  const [activeIndex, setActiveIndex] = useState(-1)
  const [hits, setHits] = useState<HubSearchHit[]>([])
  /** 统一搜索：同一关键词同时召回插件市场条目 */
  const [pluginHits, setPluginHits] = useState<HubPluginSearchResponse | null>(null)
  const [pluginLoading, setPluginLoading] = useState(false)
  /** 插件子检索请求失败：与「插件市场真的没有匹配」区分，不能让失败静默变成空分区 */
  const [pluginFailed, setPluginFailed] = useState(false)
  /** 插件语义未就绪：服务端已关键词回退，必须如实标注 */
  const [pluginSemanticFallback, setPluginSemanticFallback] = useState(false)
  const [allCollections, setAllCollections] = useState<HubCollection[]>([])

  useEffect(() => {
    if (isFocused && allCollections.length === 0) {
      void fetchCollections().then((cols) => {
        if (cols) setAllCollections(cols)
      })
    }
  }, [isFocused, allCollections.length])

  const matchedCollections = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    // 专题匹配与建议层共用容错匹配：一个字母打错（如 "githb"）不应让
    // 专题分组整个消失——中枢 fuzzy 只兜底站点召回，本地分组要自己容错
    return allCollections
      .filter((c) => matchSuggestionText(q, `${c.title} ${c.description ?? ''} ${c.slug}`))
      .slice(0, 3)
  }, [allCollections, query])
  const [loading, setLoading] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [semanticAvailable, setSemanticAvailable] = useState(true)
  /** 分页：召回池是否还有余量 / 追加页加载中 / 追加页请求失败（失败≠到底） */
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  /** 零结果兜底：推荐词 / 热门词 / 放宽提示（仅零结果时有值） */
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [popular, setPopular] = useState<string[]>([])
  const [fallbackHint, setFallbackHint] = useState<'filter' | 'fuzzy' | undefined>(undefined)
  /** A3：放宽时被丢弃的分面条件，用于把「已放宽」点名到付费条件上 */
  const [relaxedFacets, setRelaxedFacets] = useState<Record<string, string[]> | undefined>(undefined)
  const [recent, setRecent] = useState<RecentSearchItem[]>([])
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([])
  /** MRU 加分用的全量快照（上限 50 条）：与空面板直达区的 8 条分轨，
      8 条之外的收藏也能拿到 MRU 加分（W6b 补丁 2）。 */
  const [mruVisits, setMruVisits] = useState<RecentVisit[]>([])
  /** 中枢不可用（历史拉取降级）：与「真的没有历史」区分，避免把故障渲染成「暂无数据」 */
  const [recentDegraded, setRecentDegraded] = useState(false)
  /** 清空最近搜索的两步确认是否已 armed（同 /me/history「清空全部」→「确认清空全部」） */
  const [confirmClearRecent, setConfirmClearRecent] = useState(false)
  /** 知识图谱对标与实体关联方案命中 */
  const [relationHits, setRelationHits] = useState<HubSiteRelation[]>([])
  /** 智能析取到的分面筛选意图 */
  const [inferredFacets, setInferredFacets] = useState<Record<string, string[]>>({})
  /** 识别到的标签算子 (#tag) */
  const [inferredTag, setInferredTag] = useState<string | undefined>(undefined)
  /** 识别到的类目算子 (@category) */
  const [inferredCategory, setInferredCategory] = useState<string | undefined>(undefined)
  /** 识别到的负向排除词 (-keyword) */
  const [excludedTerms, setExcludedTerms] = useState<string[]>([])
  const [modKey, setModKey] = useState<string>('⌘')
  useEffect(() => {
    setModKey(getModifierKey())
  }, [])
  /** 零结果编辑距离拼写建议 */
  const [didYouMean, setDidYouMean] = useState<string | undefined>(undefined)
  /** 自动查询纠正（有值时替掉 didYouMean 块，两者二选一） */
  const [correction, setCorrection] = useState<HubSearchResult['correction'] | undefined>(undefined)
  /**
   * 「不是这个？搜原来的」回退：记下要以 nocorrect 重查的原查询词。
   * 只在等于当前查询时生效——用户改词后自动失效，不会把 nocorrect
   * 误带到新查询上。
   */
  const [nocorrectQuery, setNocorrectQuery] = useState<string | null>(null)
  /** 存为待找 / 新建收藏的操作回执（渲染在面板动作区下方） */
  const [wantedNote, setWantedNote] = useState<string | null>(null)
  /** 新建收藏预填弹窗（复用 AddSiteDialog，提交走 /api/me/custom-sites） */
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ title: '', href: '', note: '' })
  /** 同义词/标签别名扩展 */
  const [queryExpansion, setQueryExpansion] = useState<string[]>([])
  /** 重试计数：增长即重新发起同一查询（降级时的出口） */
  const [retryToken, setRetryToken] = useState(0)
  const searchRef = useRef<HTMLDivElement>(null)
  const resultsPanelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /**
   * 外部请求聚焦（2026-11-21）：裸 / 快捷键与 ?scene= 深链都走这个事件，
   * 而不是各自去摸 DOM 找 input——本组件是 dynamic({ ssr:false }) 挂载的，
   * 外部调用的那一帧 ref 还不存在。detail.ai 时顺带切到 AI 模式。
   *
   * 必须放在 inputRef 声明之后：effect 里引用的 ref 若声明在下方，
   * 闭包捕获时是 TDZ 未初始化，按键即抛 ReferenceError。
   */
  useEffect(() => {
    const onFocusSearch = (e: Event) => {
      const detail = (e as CustomEvent<{ ai?: boolean }>).detail
      if (detail?.ai) {
        setAiMode(true)
        writeSearchAiMode(true)
      }
      inputRef.current?.focus()
    }
    window.addEventListener('navhub:focus-search', onFocusSearch as EventListener)
    return () => window.removeEventListener('navhub:focus-search', onFocusSearch as EventListener)
  }, [])
  const abortRef = useRef<AbortController | null>(null)
  /** 当前查询的权威值：用来丢弃「已经过期的追加页」响应 */
  const activeQueryRef = useRef('')
  /** 「加载更多」在途请求的取消句柄 */
  const moreAbortRef = useRef<AbortController | null>(null)
  /** 已加载到的偏移（不进 React state，避免其变化误触发第一页重查） */
  const offsetRef = useRef(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** IME 组词守卫（04 §5.2-2）：组词期间暂停防抖检索（用 ref 不用 state，
      避免每次组词开始/结束都触发重渲染）；与 keydown 的 isComposing 守卫互补 */
  const isComposingRef = useRef(false)
  /** 组词完成后的那一次查询不等待 200ms 防抖、立即检索（§5.2-2） */
  const skipDebounceRef = useRef(false)
  /** 拼音库是否已加载（04 §1.3）：加载成功后本地行 matcher 才走拼音通道 */
  const [pinyinReady, setPinyinReady] = useState(false)
  const identity = useMemo(() => getIdentity(), [])
  const favorites = useFavorites()
  const { toast } = useToast()
  const preferences = useUserPreferences()
  const featureMask = useFeatureMask()
  const {
    unhideCategory,
    isEditingLayout,
    toggleEditingLayout,
    applyDIYPreset,
    exportPresetToUrlHash,
    stageImportForConfirm,
    resetDIYConfig,
    customCategories,
    addSiteToCustomCategory,
  } = useHomeDIY()
  /** 卡片密度住在用户偏好里（不在 DIY 配置里）：预设应用时当回调传给 applyDIYPreset */
  const { setDensity, cycleDensity, densityLabel } = useDensity()
  /** 主题切换（P1 #8）：与 ModeToggle 同一个 next-themes，不另起状态 */
  const { theme, resolvedTheme, setTheme } = useTheme()
  /**
   * 长辈模式当前态（P1 #8）：读法与 ElderModeToggle 完全一致——首帧默认关，
   * effect 里读 localStorage 并订阅 `navhub:elder-mode-changed`，工具栏上
   * 的开关改了，这里的行标题立刻跟着变，不会出现两处说法打架。
   */
  const [elderOn, setElderOnState] = useState(false)
  useEffect(() => {
    setElderOnState(loadElderMode(window.localStorage))
    const sync = () => setElderOnState(loadElderMode(window.localStorage))
    window.addEventListener(ELDER_MODE_CHANGED_EVENT, sync)
    return () => window.removeEventListener(ELDER_MODE_CHANGED_EVENT, sync)
  }, [])
  /**
   * 添加自定义站点（P1 #8）：弹窗本体就是 AddSiteDialog，提交走
   * useHomeDIY 的 addSiteToCustomCategory，与分类上「+ 添加网址」同一条路。
   * 目标分类没有预设：建议只从专属分类里算（见 addSiteSuggestion），
   * 建议一出现就自动作为目标——弹窗里推荐卡片本身就是可见的凭据，
   * 不会悄悄写进用户没看见的分类；没有专属分类时提交会明说。
   */
  const [addSiteOpen, setAddSiteOpen] = useState(false)
  const [addSiteTitle, setAddSiteTitle] = useState('')
  const [addSiteHref, setAddSiteHref] = useState('')
  const [addSiteDesc, setAddSiteDesc] = useState('')
  const [addSiteTargetCatId, setAddSiteTargetCatId] = useState<string | null>(null)
  const addSiteSuggestion: CategorySuggestion | null = useMemo(() => {
    if (!addSiteOpen) return null
    if (!addSiteTitle.trim() && !addSiteHref.trim()) return null
    // 只从专属分类里推荐：内置分类没有 addSiteToCustomCategory 的写入口，
    // 推荐过去提交会静默落空、toast 还谎称「已添加」。
    return suggestCategoryForSite(
      { title: addSiteTitle, href: addSiteHref, description: addSiteDesc },
      customCategories,
    )
  }, [addSiteOpen, addSiteTitle, addSiteHref, addSiteDesc, customCategories])
  useEffect(() => {
    setAddSiteTargetCatId(addSiteSuggestion?.categoryId ?? null)
  }, [addSiteSuggestion])
  /** DIY「导入」的文件选择框（与备份对话框同一条 stageImportForConfirm 路，不复制导入逻辑） */
  const diyImportInputRef = useRef<HTMLInputElement | null>(null)

  const prunedRecall = useMemo(
    () => computePrunedSearchRecall(query, featureMask, hits),
    [query, featureMask, hits]
  )
  /**
   * 「0-RTT 推测意图即时计算」开关决定要不要原地算：关掉后不再产出算式 / CIDR /
   * UUIDv7 / 时间戳 / 色值 / cron / base64 这类即时结果卡。
   * 此前这条设置在全仓无人读取 —— 用户关掉它，卡片照出，界面在说假话。
   */
  const speculativeResult = useMemo(
    () => (preferences.speculativeZeroRttEnabled ? parseSpeculativeIntent(query) : null),
    [preferences.speculativeZeroRttEnabled, query],
  )
  const comparisonMatrix = useMemo(() => parseTechComparisonQuery(query), [query])
  const architectureRecipe = useMemo(() => findMatchingArchitectureRecipe(query), [query])
  const [aiComparisonMatrix, setAiComparisonMatrix] = useState<ReturnType<typeof parseTechComparisonQuery>>(null)
  const [aiComparisonLoading, setAiComparisonLoading] = useState(false)
  const [aiRecipe, setAiRecipe] = useState<ReturnType<typeof findMatchingArchitectureRecipe>>(null)
  const [aiRecipeLoading, setAiRecipeLoading] = useState(false)
  const [actionIntentData, setActionIntentData] = useState<ActionIntentCardData | null>(null)
  const [actionIntentLoading, setActionIntentLoading] = useState(false)

  useEffect(() => {
    setActionIntentData(null)
    const trimmed = query.trim()
    if (!trimmed || trimmed.length < 5) {
      setActionIntentLoading(false)
      return
    }
    const isActionQuery = /(怎么|如何|怎样|有没有|把.+转|去除|提取|在线|免安装|替代|制作|生成|转换|下载|压缩|how to|how do|how can|what is best|convert|extract|transcribe|remove)/i.test(trimmed)
    if (!isActionQuery) {
      setActionIntentLoading(false)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setActionIntentLoading(true)
    const timer = setTimeout(() => {
      fetch(`/api/hub/intent/action?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled && data?.ok && data.isActionable) {
            setActionIntentData(data)
          }
        })
        .catch(() => { /* 降级或已取消 */ })
        .finally(() => {
          if (!cancelled) setActionIntentLoading(false)
        })
    }, 380)
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  useEffect(() => {
    setAiComparisonMatrix(null)
    setAiRecipe(null)
    setAiRecipeLoading(false)
    const trimmed = query.trim()
    if (!trimmed || comparisonMatrix) {
      setAiComparisonLoading(false)
      return
    }
    const isVsQuery = /^(.+?)\s*(?:\bvs\.?\b|\bVS\.?\b|\bpk\b|\bPK\b|对比|对决)\s*(.+?)$/i.test(trimmed)
    if (!isVsQuery) {
      setAiComparisonLoading(false)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setAiComparisonLoading(true)
    const timer = setTimeout(() => {
      fetch(`/api/hub/comparisons?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled && data?.ok && data.matrix) {
            setAiComparisonMatrix(data.matrix)
          }
        })
        // 配方请求失败不打扰用户：下方 catch 已经负责提示，这里只是避免未处理的 rejection
      .catch(() => { /* 由外层 catch 统一降级或已取消 */ })
        .finally(() => {
          if (!cancelled) setAiComparisonLoading(false)
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, comparisonMatrix])

  const triggerAiRecipe = useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed || aiRecipeLoading) return
    setAiRecipeLoading(true)
    try {
      const res = await fetch(`/api/hub/recipes?q=${encodeURIComponent(trimmed)}`)
      if (res.ok) {
        const data = await res.json()
        if (data?.item) {
          setAiRecipe(data.item)
        }
      }
    } catch {
      // 容错降级
    } finally {
      setAiRecipeLoading(false)
    }
  }, [query, aiRecipeLoading])



  /* P3-13：最近搜索单条删除 + 一键清空（U-37②）。
     删除按服务端 id，不按查询词过滤；失败时列表不动 + toast
     （沿用 /me/history removeItem 的口径）。清空是显式两步确认，
     成功后删本机快照键，否则下次降级加载会把已清空的历史「复活」（R4）。 */
  const refreshRecent = useCallback(async () => {
    if (!identity) return
    // 中枢不可用时 fetchSearchHistoryPage 返回兜底空页，与「真的没有历史」无法区分；
    // 用局部标记把「已降级」带出 then（onDegraded 在 resolve 之前同步触发）。
    let failed = false
    const page = await fetchSearchHistoryPage(identity, { limit: 8 }, () => {
      failed = true
    })
    setRecentDegraded(failed)
    setRecent(toRecentSearchItems(page.items))
  }, [identity])

  const handleDeleteRecent = useCallback(
    async (item: RecentSearchItem) => {
      if (!identity) return
      const ok = await deleteSearchHistoryItem(identity, item.id)
      if (!ok) {
        toast({ title: '删除失败', description: '云端暂不可用，请稍后重试', variant: 'destructive' })
        return
      }
      setRecent((prev) => removeRecentSearchItem(prev, item.id))
    },
    [identity, toast],
  )

  const handleClearRecent = useCallback(async () => {
    if (!identity || recent.length === 0) return
    if (!confirmClearRecent) {
      setConfirmClearRecent(true)
      return
    }
    setConfirmClearRecent(false)
    const ok = await clearCloudSearchHistory(identity)
    if (!ok) {
      toast({ title: '清空失败', description: '云端暂不可用，请稍后重试', variant: 'destructive' })
      return
    }
    setRecent([])
    clearSearchHistorySnapshot()
    toast({ title: '搜索历史已清空' })
  }, [identity, recent.length, confirmClearRecent, toast])

  /* 最近搜索与最近访问站点：聚焦且空查询时加载 */
  useEffect(() => {
    if (isFocused && !query.trim()) {
      readOfflineVisits(8).then((visits) => {
        setRecentVisits(visits)
      }).catch(() => {
        // 容错降级：本地最近访问读取失败保持空数组
      })
      // MRU 加分读全量（OFFLINE_RECENT_LIMIT = 50）：与 8 条直达区分轨，
      // 预填查询打开时快照也可能为空——读全量后 mruNorm 不再依赖直达区。
      readOfflineVisits(OFFLINE_RECENT_LIMIT).then((visits) => {
        setMruVisits(visits)
      }).catch(() => {
        // 容错降级：MRU 加分读取失败保持空映射（mruNorm 全为 0）
      })

      setConfirmClearRecent(false)
      void refreshRecent()
    }
  }, [isFocused, query, refreshRecent])

  /* 点击外部关闭 */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setIsFocused(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  /* 呼出键归 SpotlightModal 一处处理（它是超级控制台唯一的入口，没有别的按钮能开它）。
     原来这里也挂一个 keydown 抢焦点：同一次 ⌘K 既开弹窗又聚焦内联框，
     第二个按键还会把刚开的弹窗 toggle 掉 —— 用户看到的是快捷键失灵。
     内联面板只保留「在自己有焦点时 Esc 收起」。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.activeElement !== inputRef.current) return
      setIsFocused(false)
      inputRef.current?.blur()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /* 防抖检索 + 取消在途请求 */
  useEffect(() => {
    const q = query.trim()
    activeQueryRef.current = q
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (abortRef.current) abortRef.current.abort()
    // 查询变了，在途的「加载更多」也属于上一个查询，必须一起取消
    if (moreAbortRef.current) moreAbortRef.current.abort()
    // IME 组词期（04 §5.2-2）：不发请求、不清空旧结果——组词中途的半截
    // 拼音（如 `da`）既不能发请求、也不能把面板闪空；旧结果保留展示。
    // 在途请求已在上面取消；loading 标志复位，避免被取消的请求把转圈挂住。
    if (isComposingRef.current) {
      setLoading(false)
      setPluginLoading(false)
      return
    }
    // 新查询必须清空旧结果与旧提示：否则防抖 + 网络窗口里会拿上一个查询的结果
    // 冒充新查询的答案（还会带着上一个查询的「已放宽」横幅）
    setHits([])
    setPluginHits(null)
    setPluginLoading(false)
    setPluginFailed(false)
    setPluginSemanticFallback(false)
    setHasMore(false)
    setMoreFailed(false)
    setSuggestions([])
    setPopular([])
    setRelationHits([])
    setInferredFacets({})
    setInferredTag(undefined)
    setInferredCategory(undefined)
    setExcludedTerms([])
    setDidYouMean(undefined)
    setCorrection(undefined)
    setQueryExpansion([])
    setFallbackHint(undefined)
    setRelaxedFacets(undefined)
    setDegraded(false)
    setLoadingMore(false)
    if (!q) {
      setLoading(false)
      offsetRef.current = 0
      return
    }
    // 新查询 = 回到第一页（offsetRef 不进依赖，否则追加页会触发重查）
    offsetRef.current = 0
    setLoading(true)
    // 组词完成后的那一次查询不等待 200ms 防抖、立即检索（§5.2-2：用户已
    // 明确完成输入，等 200ms 是可感知的卡顿）；其余查询仍走 200ms 防抖。
    const delay = skipDebounceRef.current ? 0 : 200
    skipDebounceRef.current = false
    debounceRef.current = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller
      // 统一搜索：插件召回与站点召回并行，插件失败不影响站点结果
      setPluginLoading(true)
      setPluginFailed(false)
      setPluginSemanticFallback(false)
      // searchPlugins 网络失败时返回 degraded 兜底值而不抛错：只靠 catch 判失败
      // 会把「请求没到达」显示成「插件市场没有匹配」，onDegraded 才是可靠信号
      let pluginRequestFailed = false
      void searchPlugins({ q, limit: 5 }, () => {
        pluginRequestFailed = true
      })
        .then((res) => {
          if (controller.signal.aborted || activeQueryRef.current !== q) return
          const status = searchChannelStatus({
            sites: null,
            plugins: res,
            pluginsFailed: pluginRequestFailed,
          })
          setPluginHits(res)
          setPluginLoading(false)
          setPluginFailed(status.pluginUnavailable)
          setPluginSemanticFallback(status.pluginSemanticFallback)
        })
        .catch(() => {
          if (controller.signal.aborted || activeQueryRef.current !== q) return
          setPluginHits(null)
          setPluginLoading(false)
          setPluginFailed(true)
          setPluginSemanticFallback(false)
        })
      void searchSites({ q, limit: 12, categoryId, identity, nocorrect: nocorrectQuery !== null && nocorrectQuery === q }, controller.signal)
        .then((res) => {
          if (controller.signal.aborted || activeQueryRef.current !== q) return
          setHits(res.hits)
          setDegraded(Boolean(res.degraded))
          setSemanticAvailable(res.semanticAvailable)
          setHasMore(Boolean(res.hasMore))
          setSuggestions(res.suggestions ?? [])
          setPopular(res.popular ?? [])
          setRelationHits(res.relationHits ?? [])
          setInferredFacets(res.inferredFacets ?? {})
          setInferredTag(res.inferredTag)
          setInferredCategory(res.inferredCategory)
          setExcludedTerms(res.excludedTerms ?? [])
          setDidYouMean(res.didYouMean)
          setCorrection(res.correction)
          setQueryExpansion(res.queryExpansion ?? [])
          setFallbackHint(res.fallback)
          setRelaxedFacets(res.relaxedFacets)
          offsetRef.current = res.hits.length
          setLoading(false)
        })
        .catch(() => {
          if (controller.signal.aborted || activeQueryRef.current !== q) return
          setLoading(false)
          setDegraded(true)
        })
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, categoryId, identity, retryToken, nocorrectQuery])

  /**
   * 拼音库触发加载（04 §1.3，写死）：面板打开后，第一次出现拉丁字母查询
   * 且本地行目录非空时执行 `import('pinyin-pro')`（Promise 缓存复用，
   * 加载失败时静默回落旧匹配、面板不报错；pre-fetch 先不开，等 P-d 实测）。
   * 中文查询、空查询、纯数字查询均不触发；面板未打开时不加载。
   */
  useEffect(() => {
    if (pinyinReady || !isFocused) return
    if (!isLatinQuery(query)) return
    if (ZERO_RTT_TOOLS.length === 0 && favorites.items.length === 0) return
    let cancelled = false
    void ensurePinyinLoaded().then((ok) => {
      if (!cancelled && ok) setPinyinReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [query, isFocused, pinyinReady, favorites.items.length])

  /** 加载下一页并追加（同一查询的延续——服务端因此不重复记事件） */
  const loadMore = useCallback(() => {
    const q = query.trim()
    if (!q || loadingMore) return
    setLoadingMore(true)
    setMoreFailed(false)
    const controller = new AbortController()
    moreAbortRef.current = controller
    void searchSites({ q, limit: 12, offset: offsetRef.current, categoryId, identity }, controller.signal)
      .then((res) => {
        // 查询已经变了：这一页属于上一个查询。放进去会把旧结果混进新列表，
        // offsetRef 也会被污染，后续分页永远错位。
        if (controller.signal.aborted || activeQueryRef.current !== q) return
        setHits((prev) => [...prev, ...res.hits])
        offsetRef.current += res.hits.length
        setHasMore(Boolean(res.hasMore))
        // 追加页为空 = 池子到底（防御：服务端说有但实际没有）
        if (res.hits.length === 0) setHasMore(false)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        // 请求失败 ≠ 召回池到底：以前这里把 hasMore 置 false，按钮从此消失，
        // 一次瞬间故障就把后面的结果永久封住，而且没有任何说明。
        setMoreFailed(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMore(false)
      })
  }, [query, categoryId, identity, loadingMore])

  /** 提示块里的出口动作 */
  const runPanelAction = useCallback((action: SearchPanelAction) => {
    if (action.kind === 'retry') {
      setRetryToken((n) => n + 1)
      return
    }
    if (action.kind === 'clear') {
      // 2026-11-20 搜索假空态修复："换关键词"——清空查询词并聚焦输入框，
      // 面板保持打开（空查询时显示建议面板），用户直接输入新词。
      // 原先是 setIsFocused(false)（关闭面板），换关键词要多点一次输入框。
      setQuery('')
      setIsFocused(true)
      inputRef.current?.focus()
      return
    }
    if (action.kind === 'ai-find') {
      // A11 零结果出口：唤起全局 AI 找站抽屉并把完整查询词自动发过去；
      // 先收起面板，抽屉是全局挂载的（providers → GlobalAiGateway），不依赖面板存活。
      const q = query.trim()
      if (!q) return
      setIsFocused(false)
      openCopilot({ query: q, source: 'programmatic' })
      return
    }
    if (action.kind === 'save-wanted') {
      // 容错纠错出口一：存为待找（登录态调 API，匿名走本地存储）
      const q = query.trim()
      if (!q) return
      void saveWantedSearch(q, correction?.corrected ?? null).then((res) => {
        if (res.duplicate) setWantedNote('已在待找里了')
        else if (res.mode === 'local') setWantedNote('已存在本地待找，登录后才能在收录时通知你')
        else setWantedNote('已存为待找，收录时会在站内通知你')
      }).catch(() => setWantedNote('这次没能存下来，稍后再试'))
      return
    }
    if (action.kind === 'save-favorite') {
      // 容错纠错出口二：新建收藏——打开 AddSiteDialog 预填弹窗
      // （与 DIY 的 addSiteOpen 是两套状态：这里提交走 /api/me/custom-sites，
      //  不是本地 DIY 板，绝不能复用 handleAddCustomSiteSubmit）。
      const q = query.trim()
      if (!q) return
      const prefill = queryToTitleAndUrl(correction?.corrected ?? q)
      setCreateForm({
        title: prefill.title,
        href: prefill.url ?? '',
        note: correction?.corrected && correction.corrected !== q ? `原搜索词：${q}` : '',
      })
      setWantedNote(null)
      setCreateOpen(true)
      return
    }
    // browse-* / submit-site 由 <Link> 渲染，走客户端路由，不发生整页刷新
  }, [query, correction])

  /** 新建收藏弹窗提交：登录态存「我的站点」并联动收藏夹；401 匿名走本地收藏直存 */
  const handleCreateFavoriteSubmit = useCallback(async () => {
    // 存储读不出来时写入会被拒绝（为了不覆盖原数据）：必须先检查并说出来，
    // 与本文件收藏行入口、favorite-button 同款写法。
    if (favorites.storageBlocked) {
      toast({ title: '这一下没能保存', description: favorites.storageBlocked, variant: 'destructive' })
      return
    }
    const title = createForm.title.trim()
    const href = createForm.href.trim()
    if (!title || !href) return
    try {
      const item = await createCustomSite({ title, url: href, note: createForm.note.trim() || null })
      await favorites.toggle({ siteId: item.id, title: item.title, href: item.url })
      setCreateOpen(false)
      setWantedNote('已存入我的站点，并放进收藏夹')
    } catch (err) {
      if ((err as { status?: number })?.status === 401) {
        let hash = 5381
        const seed = `${title}\n${href}`
        for (let i = 0; i < seed.length; i += 1) hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0
        await favorites.toggle({ siteId: `custom:${hash.toString(16)}`, title, href })
        setCreateOpen(false)
        setWantedNote('已存进本地收藏（未登录，仅保存在当前设备）')
      } else {
        setWantedNote(err instanceof Error ? err.message : '保存失败，稍后再试')
      }
    }
  }, [createForm, favorites, toast])

  // 打开方式听用户中心的开关，站点配置只当默认值
  const linkTarget = useExternalLinkTarget(siteConfig?.navigation?.linkTarget)

  /**
   * DIY 快捷操作（8c）：执行全部复用 useHomeDIY / 备份对话框已有的函数，
   * 这里只做分发与提示。分享的复制流程与备份对话框的 handleShareUrlHash
   * 同口径（copyText + copyFailureToast），失败不谎称成功。
   */
  const handleDiyAction = useCallback(async (actionId: DiyPaletteActionId, presetId?: string) => {
    setIsFocused(false)
    if (actionId === 'edit') {
      toggleEditingLayout()
      toast({
        title: isEditingLayout ? '已退出排版编辑模式' : '已进入排版编辑模式',
        description: isEditingLayout ? '配置已自动持久化至本地' : '拖拽分类即可调整首页排版，按 Esc 退出。',
      })
      return
    }
    if (actionId === 'preset' && presetId) {
      // 密度不在 DIY 配置里，住在用户偏好（useDensity）：工具栏是把 setDensity
      // 当回调传给 applyDIYPreset 才让密度真正落地；这里以前没传，密度被丢掉，
      // toast 还照样宣称「卡片密度已完成智能匹配」。回调是同步调的，跑没跑
      // 用 densityApplied 当场验，toast 只在密度真的应用后才敢这么说。
      let densityApplied = false
      const ok = applyDIYPreset(presetId, (d) => {
        densityApplied = true
        setDensity(d as ContentDensity)
      })
      toast(
        !ok
          ? { title: '预设应用失败', description: '找不到这个预设。', variant: 'destructive' }
          : densityApplied
            ? { title: '✨ 预设情境已应用', description: '视窗形态、卡片密度与画布背景已完成智能匹配。' }
            : { title: '✨ 预设情境已应用', description: '视窗形态与画布背景已应用，卡片密度未改变。' },
      )
      return
    }
    if (actionId === 'share') {
      const out = exportPresetToUrlHash()
      if (!out.ok) {
        toast({ title: '❌ 分享链接生成失败', description: out.reason, variant: 'destructive' })
        return
      }
      const result = await copyText(out.url)
      if (!result.ok) {
        toast({ ...copyFailureToast(result), variant: 'destructive' })
        return
      }
      toast({
        title: '🔗 已复制免登专属分享链接！',
        description: '好友直接在浏览器打开该链接，即可预览，确认后应用您的专属排版与壁纸。',
      })
      return
    }
    if (actionId === 'import') {
      diyImportInputRef.current?.click()
      return
    }
    if (actionId === 'reset') {
      if (!window.confirm('确定要把首页排版恢复为系统默认吗？当前排版会先压入撤销历史，恢复后按 Ctrl/Cmd+Z 可撤销。')) {
        return
      }
      resetDIYConfig()
      toast({ title: '已重置为默认排版', description: '按 Ctrl/Cmd+Z 可撤销这次重置。' })
    }
  }, [isEditingLayout, toggleEditingLayout, applyDIYPreset, exportPresetToUrlHash, resetDIYConfig, setDensity, toast])

  /** DIY「导入」：读文件 → 先挂起待确认（确认对话框核对 diff 后才应用，应用前自动备份），与备份对话框同一条路；不再直接 importDIYConfig 一把应用。 */
  const handleDiyImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const staged = await stageImportForConfirm((await file.text()).trim())
      if (!staged.ok) {
        toast({ title: '导入失败', description: staged.message, variant: 'destructive' })
        return
      }
      toast({
        title: '请核对导入内容',
        description: '已按字段列出这次导入会改动的地方，确认后才会应用；应用前会自动备份当前排版。',
      })
    } catch (err) {
      toast({
        title: '导入失败',
        description: err instanceof Error ? err.message : '读取备份文件时遇到异常',
        variant: 'destructive',
      })
    } finally {
      if (diyImportInputRef.current) diyImportInputRef.current.value = ''
    }
  }, [stageImportForConfirm, toast])

  /**
   * 万能栏快捷操作（P1 #8）：四个操作全部复用已有 handler，只做分发与提示，
   * 不复制执行逻辑。主题 / 长辈 / 密度点完即生效（面板收起 + toast 说清
   * 结果）；添加站点打开录入弹窗（面板收起，弹窗接管焦点）。
   */
  const handlePaletteAction = useCallback((action: PaletteActionEntry) => {
    setIsFocused(false)
    if (action.id === 'theme') {
      const nextDark = resolvedTheme !== 'dark'
      setTheme(nextDark ? 'dark' : 'light')
      toast({ title: nextDark ? '已切换到深色模式' : '已切换到浅色模式' })
      return
    }
    if (action.id === 'elder') {
      const next = setElderMode(!elderOn, window.localStorage)
      setElderOnState(next)
      toast({
        title: next ? '长辈模式已开启' : '长辈模式已关闭',
        description: next ? '已切换为特大字与宽松间距。' : '已恢复开启前的字号。',
      })
      return
    }
    if (action.id === 'density') {
      cycleDensity()
      toast({ title: '卡片密度已切换', description: '紧凑 / 舒适 / 宽松三档循环切换，立即生效。' })
      return
    }
    setAddSiteTitle('')
    setAddSiteHref('')
    setAddSiteDesc('')
    setAddSiteTargetCatId(null)
    setAddSiteOpen(true)
  }, [resolvedTheme, setTheme, elderOn, cycleDensity, toast])

  /**
   * 极速工具（P1 #8）：回车即把示例填回输入框，面板不关闭——已有的
   * 0-RTT 卡片当场算出结果，用户直接改示例继续算。不打开抽屉：
   * 抽屉的开关状态住在 navigation-content，面板够不着，硬派事件过去
   * 没人接听就是假入口；填示例是同一引擎的真执行。
   */
  const handlePaletteTool = useCallback((tool: PaletteToolEntry) => {
    setQuery(tool.sampleQuery)
    inputRef.current?.focus()
  }, [])

  /** 收藏夹打开（P1 #8）：与「常用与最近常去」同款——安全闸 + 离线记录 + 上报 + 重温计时 */
  const openFavorite = useCallback((fav: PaletteFavoriteLike) => {
    // 回落 '' 而不是默认 '#'：'#' 恒真，`if (!href)` 守卫永远不触发，
    // 不安全收藏点一下会往离线记录写一条 '#' 假访问、面板还照常关掉。
    const href = safeHref(fav.href, '')
    if (!href) return
    recordOfflineVisit({ id: fav.siteId, title: fav.title, href, icon: fav.icon ?? null })
    reportClick(fav.siteId, identity)
    favorites.recordOpened(fav.siteId)
    setIsFocused(false)
  }, [favorites, identity])

  /**
   * 快捷链接打开：与收藏打开同口径（离线记录 + 点击上报 + 重温计时），
   * 上报带上搜索参数 `{query: arg}`。url 为 null（参数超 500 字符 /
   * 模板已不安全）时 toast、不开页，不静默走正常搜索。
   */
  const openQuicklink = useCallback((item: PaletteQuicklinkItem) => {
    if (!item.url) {
      toast({
        title: '快捷链接打不开',
        description: '参数超过 500 字符或模板不安全，已拦截。',
        variant: 'destructive',
      })
      return
    }
    recordOfflineVisit({
      id: item.entry.siteId,
      title: item.entry.title,
      href: item.entry.href,
      icon: item.entry.icon ?? null,
    })
    reportClick(item.entry.siteId, identity, { query: item.arg })
    favorites.recordOpened(item.entry.siteId)
    safeWindowOpen(item.url)
    setIsFocused(false)
  }, [favorites, identity, toast])

  /**
   * 添加自定义站点提交（P1 #8）：与 navigation-content 的
   * handleAddCustomSiteSubmit 同口径——伪协议拦截 + 协议补全在
   * normalizeCustomSiteHref 里，写盘结果只有 added / duplicate / failed
   * 三种说法，失败不关弹窗、不清输入。
   */
  const handleAddCustomSiteSubmit = useCallback(() => {
    if (!addSiteTargetCatId) {
      toast({
        title: '请先选择一个专属分类',
        description: '在下方推荐里点「选入该类」；还没有专属分类时，请先在首页新建一个分类。',
      })
      return
    }
    if (!addSiteTitle.trim() || !addSiteHref.trim()) return
    const normalized = normalizeCustomSiteHref(addSiteHref)
    if (!normalized.ok) {
      toast({
        title: normalized.reason === 'unsafe-protocol' ? '⚠️ 网址不安全' : '⚠️ 网址不合法',
        description:
          normalized.reason === 'unsafe-protocol'
            ? '仅允许 http/https 或站内相对路径。'
            : '请输入合法的 http(s) 网址。',
      })
      return
    }
    const outcome = addSiteToCustomCategory(addSiteTargetCatId, {
      id: createCustomSiteId(),
      title: addSiteTitle.trim(),
      href: normalized.href,
      description: addSiteDesc.trim() || undefined,
    })
    if (outcome === 'failed') {
      toast({
        title: '这一下没能保存',
        description: '浏览器拒绝写入本地存储（可能是隐私模式或空间已满）。站点只在当前页面生效，刷新后会消失。',
        variant: 'destructive',
      })
      return
    }
    if (outcome === 'duplicate') {
      toast({ title: '站点已在分类里', description: `「${addSiteTitle.trim()}」没有重复添加。` })
      setAddSiteOpen(false)
      return
    }
    toast({
      title: '✨ 自定义站点已添加',
      description: `站点「${addSiteTitle.trim()}」已成功收录至该分类。`,
    })
    setAddSiteOpen(false)
    setAddSiteTitle('')
    setAddSiteHref('')
    setAddSiteDesc('')
  }, [addSiteTargetCatId, addSiteTitle, addSiteHref, addSiteDesc, addSiteToCustomCategory, toast])

  /** 有查询词时命中的 DIY 操作行（空查询面板直接展示全部操作，不走匹配） */
  const matchedDiyActions = useMemo(
    () => matchDiyPaletteActions(query, BUILTIN_DIY_PRESETS, { isEditingLayout }),
    [query, isEditingLayout],
  )

  /** 我的场景：搜「场景/工作/学习」列出场景，回车切换（与工具栏下拉同一条执行） */
  const { doc: sceneDoc, save: saveSceneDoc } = useUserScenes()
  const matchedSceneActions = useMemo(
    () => matchScenePaletteActions(query, sceneDoc.scenes, sceneDoc.activeSceneId),
    [query, sceneDoc],
  )
  const handleSceneAction = useCallback(
    async (sceneId: string) => {
      const scene = sceneDoc.scenes.find((s) => s.id === sceneId)
      if (!scene) return
      setIsFocused(false)
      await performSceneSwitch(scene, sceneDoc, {
        theme: theme ?? undefined,
        setTheme,
        save: saveSceneDoc,
        toast,
      })
    },
    [sceneDoc, saveSceneDoc, theme, setTheme, toast],
  )

  /** 万能栏三组（P1 #8）：操作 / 工具 / 收藏夹，与建议层同一套容错匹配 */
  const paletteActionOpts = useMemo(
    () => ({ isDark: resolvedTheme === 'dark', elderOn, densityLabel }),
    [resolvedTheme, elderOn, densityLabel],
  )
  const matchedPaletteActions = useMemo(
    () => matchPaletteActions(query, paletteActionOpts),
    [query, paletteActionOpts, pinyinReady],
  )
  const matchedPaletteTools = useMemo(
    () => matchPaletteTools(query),
    [query, pinyinReady],
  )
  /**
   * 参数化快捷链接：收藏上挂了模板的条目即 quicklink（模板非法的不进）。
   * 命令命中时同一 siteId 不再出现在收藏分组里（去重走 excludeSiteIds）。
   */
  const quicklinkEntries = useMemo(
    () =>
      favorites.items
        .map((fav) => quicklinkFromFavorite(fav))
        .filter((e): e is QuicklinkEntry => e !== null),
    [favorites.items],
  )
  const quicklinkBySiteId = useMemo(
    () => new Map(quicklinkEntries.map((e) => [e.siteId, e])),
    [quicklinkEntries],
  )
  const quicklinkMatch = useMemo(
    () => matchQuicklinkCommand(query, quicklinkEntries),
    [query, quicklinkEntries],
  )
  const matchedPaletteQuicklinks = useMemo(
    () => matchPaletteQuicklinks(query, quicklinkEntries),
    [query, quicklinkEntries],
  )
  /**
   * 收藏行的 MRU 归一分（04 §3.3/§6）：`mruNorm = mruScore / 100`，无记录为 0，
   * 随 `matchPaletteFavorites` 传给 §6 总分的 0.15 权重项。数据源是全量
   * 50 条快照 `mruVisits`（与空面板 8 条直达区分轨），8 条之外的收藏
   * 也能拿到 MRU 加分；建库起点取本次快照最早一条（与 `topFrequentVisits`
   * 同口径）；同一调用内只取一次 now。
   */
  const mruNormBySiteId = useMemo(
    () => buildMruNormBySiteId(mruVisits),
    [mruVisits],
  )
  const matchedPaletteFavorites = useMemo(
    () =>
      matchPaletteFavorites(query, favorites.items, {
        excludeSiteIds: new Set([
          ...hits.map((h) => h.siteId),
          ...(quicklinkMatch.kind === 'hit' ? [quicklinkMatch.entry.siteId] : []),
        ]),
        mruNormBySiteId,
      }),
    [query, favorites.items, hits, quicklinkMatch, mruNormBySiteId, pinyinReady],
  )
  /**
   * 空查询「最近访问」分区顺序（04 §3.3，C2 前半）：count≥3 的 boosted
   * 段按 mruScore 置顶在前，count<3 的 rest 段按时间倒序排在后段；两段
   * 并起来就是原快照，不删除、不隐藏任何记录。
   */
  const orderedRecentVisits = useMemo(() => {
    const { boosted, rest } = splitRecentVisitsForBoost(recentVisits)
    return [...boosted, ...rest]
  }, [recentVisits])
  /** 空查询面板直接展示的四操作（matchPaletteActions('') 即全部）与收藏 */
  const emptyPanelActions = useMemo(
    () => matchPaletteActions('', paletteActionOpts),
    [paletteActionOpts],
  )
  const emptyPanelFavorites = useMemo(() => favorites.items.slice(0, 8), [favorites.items])

  /**
   * 分组建议（research #2）：打字时即时给出的快捷入口，排在结果分组之前。
   * 历史 / 专题 / 相关搜索三组（站点 / 插件 / DIY 操作下方已有完整分组，
   * 不复制）；由同一份防抖后的查询派生，不另起计时器、不发新请求——
   * 历史与专题是面板打开时已取到的数据，相关搜索随当次检索响应一起回来。
   * 总上限 8 条、每组至多 2 条，见 lib/search-suggestions。
   */
  const suggestionGroups = useMemo(
    () =>
      buildSearchSuggestions({
        query,
        history: recent.map((item) => item.query),
        collections: allCollections,
        relatedSearches: suggestions,
      }),
    [query, recent, allCollections, suggestions],
  )

  /** 采纳一条建议：历史 / 相关搜索行把词填回输入框（面板不关闭，可继续改）；
      专题行是 Link 直接进专题页，不走这里。 */
  const applySuggestion = useCallback((value: string) => {
    setQuery(value)
    inputRef.current?.focus()
  }, [])

  const openSite = useCallback((hit: HubSearchHit) => {
    const site = hit.site
    if (!site) return
    // 把「这次命中来自哪一路」带回中枢：telemetry.ts 只有在带 query 时才更新
    // LinUCB 通道权重；只发 siteId 会让在线学习永远收不到真实反馈。
    const channel = Object.entries(hit.contributions ?? {})
      .sort((a, b) => b[1].value - a[1].value)[0]?.[0]
    // site.url 来自后端检索结果（源头是站点库），先过安全闸再上报：
    // 非 http(s) 一律不跳也不记点击，避免 javascript: 之类的脏数据污染热度信号或直达执行
    const url = safeHref(site.url, '')
    if (!url || !isSafeHttpUrl(url)) return
    reportClick(site.id, identity, { query, channel })
    // 离线可用性（P2-3）：把这次访问写进本地「最近访问」快照（IndexedDB，
    // 隐私模式降级 localStorage）。断网时用户仍能从本地列表回到常用站点。
    // 放在安全闸之后：只记录真的会打开的站点。
    recordOfflineVisit({
      id: site.id,
      title: site.title ?? site.url,
      href: url,
      icon: site.iconKey ?? null,
    })
    if (linkTarget === '_self') window.location.href = url
    else window.open(url, linkTarget, 'noopener,noreferrer')
    // 查询词要保留：新标签页打开后用户回来还能在原查询上继续挑下一条，
    // 而不是被迫重打一遍（research #2「丢查询就要重打」的痛点）。
    // 面板只收起，查询与结果都留在原地；清空搜索仍由 × 按钮显式做。
    setIsFocused(false)
  }, [identity, linkTarget, query])

  const showResults = isFocused && query.trim().length > 0
  /**
   * 「什么都没有」时到底说什么：单一判定点。
   * 避免「检索服务暂时不可用」和「未找到…」同时出现（自相矛盾），
   * 也保证零结果一定给出出口，并且不因命中微组件就隐瞒「导航检索为空」。
   */
  const pluginItems = pluginHits?.items ?? []

  /**
   * 键盘可导航项：与渲染顺序严格一致（建议在前、DIY 操作次之、收藏 /
   * 操作 / 工具随后、插件在中、站点在后）。顺序的唯一来源是
   * lib/palette-actions 的 buildPaletteNavItems，渲染与导航共用它，
   * 改一边不改另一边索引就会错位。
   * 站点命中里 site 为空的脏数据不渲染，也不进导航列表——否则索引会错位。
   * 建议行也在列表里：↑↓ 能走到建议上，回车采纳；但「没有高亮时回车」的
   * 默认目标仍是第一条结果（见 onSearchKeyDown），不能被建议抢走。
   */
  /**
   * 客户端重排（2026-11-20 搜索假空态与相关性修复）：后端 RRF 会把弱语义命中
   * 也当结果返回（无意义词 12 条全是 semantic 尾巴），失效站点（status=broken）
   * 也会混进来。这里把 displayHits 当作唯一展示列表：
   *  - 失效站点剔除（status=broken；health.ok=false 不剔除，Google Gemini 本体就是
   *    healthOk=false 的活站）；
   *  - 精确名称匹配置顶（"Gemini" → Google Gemini），语义联想降权进 related 组；
   *  - 没有强匹配时 ordered 为空 → 面板走真空态（"没有找到相关站点"），不拿弱相关填充。
   * 原始 hits 只留给分页（offset / loadMore）与 pruned 回忆，不参与渲染与键盘导航。
   */
  const rankedHits = useMemo(() => rankSearchHits(hits, query), [hits, query])
  const displayHits = rankedHits.ordered
  const relatedStartIndex = rankedHits.exact.length + rankedHits.keyword.length

  const navItems = useMemo(() => {
    if (!showResults) return [] as Array<{ id: string; kind: 'plugin' | 'site' | 'diy' | 'suggestion' | 'favorite' | 'action' | 'tool' | 'quicklink' }>
    return buildPaletteNavItems({
      suggestionIds: suggestionGroups.flatMap((g) => g.items.map((s) => `suggestion-${s.key}`)),
      quicklinkIds: matchedPaletteQuicklinks.map((q) => q.key),
      diyIds: matchedDiyActions.map((d) => `diy-${d.key}`),
      sceneIds: matchedSceneActions.map((s) => `scene-${s.key}`),
      favoriteIds: matchedPaletteFavorites.map((f) => `favorite-${f.siteId}`),
      actionIds: matchedPaletteActions.map((a) => `action-${a.id}`),
      toolIds: matchedPaletteTools.map((t) => `tool-${t.id}`),
      pluginIds: pluginItems.map((p) => `plugin-${p.id}`),
      siteIds: displayHits.map((h) => `site-${h.siteId}`),
    })
  }, [showResults, suggestionGroups, matchedPaletteQuicklinks, matchedDiyActions, matchedSceneActions, matchedPaletteFavorites, matchedPaletteActions, matchedPaletteTools, pluginItems, displayHits])

  const navIndexById = useMemo(() => {
    const map = new Map<string, number>()
    navItems.forEach((item, index) => map.set(item.id, index))
    return map
  }, [navItems])

  // 查询词或结果集变化后，旧高亮可能指向另一条站点：归零比「跳到第 5 条」更可预期
  useEffect(() => {
    setActiveIndex(-1)
  }, [query])

  useEffect(() => {
    if (activeIndex >= navItems.length) setActiveIndex(-1)
  }, [activeIndex, navItems.length])

  /** 按扁平索引找真实行（插件是 Link、站点是 cmdk Item，二者 id 生成方式不同） */
  const findOptionElement = useCallback((index: number) => {
    return resultsPanelRef.current?.querySelector<HTMLElement>(`[data-nav-index="${index}"]`) ?? null
  }, [])

  /** 把高亮项滚进可视区（结果面板自身可滚动，浏览器默认只滚外层） */
  useEffect(() => {
    if (activeIndex < 0) return
    findOptionElement(activeIndex)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, navItems.length, findOptionElement])

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // IME 组词守卫（04 §5.2-1，裁决 D3：一票否决）：组词中任何键都不触发
      // 面板行为——Enter 不打开结果、↑↓ 不移动高亮、Alt+数字不直达；
      // 组词键（选词用的数字键、空格、Enter 选词）全部放行给输入法，
      // 不 preventDefault。写法照抄 batch-keyboard.ts 与 cmdk 源码守卫
      // 的同一条件（isComposing || keyCode === 229）。
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      if (e.key === 'Enter' && aiMode) {
        // AI 模式：回车不打开站内结果，直接把整句查询发给 AI 找站。
        // 空查询不发（抽屉打开却没问题，等于白点一下）。
        const q = query.trim()
        if (!q) return
        e.preventDefault()
        setIsFocused(false)
        openCopilot({ query: q, source: 'programmatic' })
        return
      }
      if (!showResults) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (navItems.length === 0) return
        e.preventDefault()
        setActiveIndex((prev) => {
          if (e.key === 'ArrowDown') return prev < 0 ? 0 : (prev + 1) % navItems.length
          return prev <= 0 ? navItems.length - 1 : prev - 1
        })
        return
      }
      // Alt+数字直达前 10 条（04 §4.1，裁决 D1）：Alt+1..9 → navItems[0..8]，
      // Alt+0 → navItems[9]。裸数字不劫持打字（输 123 正常进文本）；
      // meta/ctrl 同时按下时不触发（浏览器/系统组合键优先）。
      // macOS 回退（W6b 补丁 3，协调员已批）：macOS 上 Option+数字的
      // e.key 是 ¡/™ 等特殊字符，用 e.code（Digit*/Numpad*）取 OR 兜底。
      // IME 守卫在函数顶部（§5.2-1），组词中本分支不会执行到。
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const digit = altDigitFromKeyOrCode(e.key, e.code)
        const target = digit !== null ? altDigitTargetIndex(digit, navItems.length) : null
        if (target !== null) {
          // 与 Enter 打开同一行完全相同的打开逻辑：点真实元素（站点行 onClick
          // 打开、插件行 Link 跳转、建议行采纳），打开后按各行既有行为关闭面板
          // 并 recordOfflineVisit；先滚进可视区再打开（§7.4）。
          const el = findOptionElement(target)
          if (el) {
            e.preventDefault()
            el.scrollIntoView({ block: 'nearest' })
            el.click()
          }
          return
        }
        // Alt+数字但超出结果数（如只有 3 条时 Alt+5）：静默无操作，不落到其他分支。
        if (digit !== null) return
      }
      if (e.key === 'Enter') {
        // 优先级：quicklink 精确匹配 > 内置引擎 > 导航第一条结果。
        // 前缀命中但代入失败（参数超 500 字符 / 模板已不安全）时 toast、
        // 不开页，也不落到内置引擎或导航首条——否则超长参数会悄悄走另一条路。
        // 未知前缀 / 模板无占位符时不拦截：落到后面的普通搜索（Enter 打开
        // 首条结果，与明示行文案「按 Enter 按普通搜索」一致）。
        if (quicklinkMatch.kind === 'hit') {
          e.preventDefault()
          if (quicklinkMatch.url) {
            openQuicklink({
              key: `quicklink-${quicklinkMatch.entry.siteId}`,
              entry: quicklinkMatch.entry,
              arg: quicklinkMatch.arg,
              url: quicklinkMatch.url,
            })
          } else {
            toast({
              title: '快捷链接打不开',
              description: '参数超过 500 字符或模板不安全，已拦截。',
              variant: 'destructive',
            })
          }
          return
        }
        const omni = parseOmniCommand(query)
        if (omni) {
          e.preventDefault()
          safeWindowOpen(omni.url)
          setIsFocused(false)
          return
        }
        if (navItems.length === 0) return
        // 没有高亮项时回车 = 打开第一条结果。原实现在 activeIndex === -1（默认态）
        // 直接忽略，「输完词直接回车」这个最常见的动作等于完全没反应。
        // 默认目标必须是第一条「结果」（DIY/收藏/操作/工具/插件/站点），而不是第一条建议：
        // 建议是用来采纳改词的，直接回车的用户要的是打开，不是换词。
        const firstResultIndex = navItems.findIndex((item) => item.kind !== 'suggestion')
        const target = activeIndex >= 0 ? activeIndex : firstResultIndex >= 0 ? firstResultIndex : 0
        // 交给真实元素处理：站点行是 role=option 的 div（onClick 打开），插件行是 Link（路由跳转）
        const el = findOptionElement(target)
        if (el) {
          e.preventDefault()
          el.click()
        }
        return
      }
      if (e.key === 'Escape') {
        setIsFocused(false)
        inputRef.current?.blur()
      }
    },
    [showResults, navItems.length, activeIndex, findOptionElement, aiMode, query, quicklinkMatch, openQuicklink, toast],
  )

  const panel = planSearchPanel({
    loading: loading || pluginLoading,
    degraded,
    // 展示口径：只计站点（displayHits）。插件是独立通道——插件命中不能掩盖"没有找到相关站点"，
    // 否则无意义词因插件按单字弱匹配（如"站"）命中而永远看不到站点空态。
    // 插件结果仍在独立区块展示；站点空态只回答"有没有找到站点"。
    hitCount: displayHits.length,
    query,
    hasWidgetResult: Boolean(
      speculativeResult ||
      comparisonMatrix ||
      architectureRecipe ||
      relationHits.length > 0 ||
      didYouMean ||
      inferredTag ||
      inferredCategory ||
      excludedTerms.length > 0 ||
      Object.keys(inferredFacets).length > 0
    ),
    searchEngine: preferences.defaultSearchEngine,
  })

  const omniCommand = useMemo(() => parseOmniCommand(query), [query])

  return (
    <div ref={searchRef} className="relative w-full max-w-2xl min-w-0 mx-auto">
      {/* DIY「导入」的文件选择框 */}
      <input
        ref={diyImportInputRef}
        type="file"
        accept=".json,application/json"
        aria-label="选择排版配置 JSON 文件"
        onChange={handleDiyImportFile}
        className="hidden"
      />
      {/* 添加自定义站点弹窗（P1 #8）：只在打开时挂载，Radix Dialog 不进首屏 */}
      {addSiteOpen && (
        <AddSiteDialog
          open={addSiteOpen}
          onOpenChange={(open) => { if (!open) setAddSiteOpen(false) }}
          title={addSiteTitle}
          href={addSiteHref}
          desc={addSiteDesc}
          onTitleChange={setAddSiteTitle}
          onHrefChange={setAddSiteHref}
          onDescChange={setAddSiteDesc}
          suggestion={addSiteSuggestion}
          onPickSuggestion={(categoryId) => setAddSiteTargetCatId(categoryId)}
          onSubmit={handleAddCustomSiteSubmit}
        />
      )}
      {/* 新建收藏预填弹窗（容错纠错出口二）：与 DIY 的 addSiteOpen 是两套状态，
          提交走 /api/me/custom-sites + 收藏联动，不是本地 DIY 板 */}
      {createOpen && (
        <AddSiteDialog
          open={createOpen}
          onOpenChange={(open) => { if (!open) setCreateOpen(false) }}
          title={createForm.title}
          href={createForm.href}
          desc={createForm.note}
          onTitleChange={(v) => setCreateForm((f) => ({ ...f, title: v }))}
          onHrefChange={(v) => setCreateForm((f) => ({ ...f, href: v }))}
          onDescChange={(v) => setCreateForm((f) => ({ ...f, note: v }))}
          suggestion={null}
          onPickSuggestion={() => {}}
          onSubmit={handleCreateFavoriteSubmit}
          dialogTitle="新建收藏"
          dialogDescription="保存到「我的站点」（登录后跨设备同步）。网址必填：请粘贴真实网址，不会按关键词猜一个地址。"
        />
      )}
      {/* 搜索框 Flex 内布局：外层做输入框边框样式，左侧图标 + 中间 input（flex-1 min-w-0）
          + 右侧 shrink-0 操作区（AI 切换 / 清空 / ⌘K 徽章）。右侧操作区不用裸 absolute
          定位——旧实现里 absolute 簇 + 固定右 padding 在 1024px 档会被
          根节点的 lg 档 420px 最小宽度顶出父容器，与「AI 找站」「今日」按钮叠在一起。 */}
      <div
        className={`flex items-center gap-2 rounded-xl border bg-background/90 pl-3 pr-2 shadow-xs transition-all focus-within:ring-2 hover:border-border-strong dark:bg-muted/20 ${aiMode ? 'border-violet-400/70 focus-within:border-violet-400/80 focus-within:ring-violet-400/30' : 'border-border-strong focus-within:border-primary/50 focus-within:ring-primary/20'}`}
      >
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input aria-label={effectivePlaceholder}
          data-search-input
          ref={inputRef}
          /* 2026-11-21 移动端输入人因（与 ui/search-input 同口径）：
             关闭 autoCapitalize/autoCorrect 防「react」被改写；
             enterKeyHint 让 iOS/Android 回车键显示「搜索」。 */
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={isFocused}
          aria-autocomplete="list"
          aria-controls={showResults ? 'navhub-search-results-panel' : isFocused ? 'navhub-search-suggest-panel' : undefined}
          aria-activedescendant={
            activeIndex >= 0 && navItems.length > 0 ? `navhub-search-opt-${activeIndex}` : undefined
          }
          onKeyDown={onSearchKeyDown}
          placeholder={effectivePlaceholder}
          value={query}
          onChange={(e) => {
            // 与 Spotlight 同一约定：行首 `?` / `ai ` 自动进 AI 模式并去掉前缀。
            const resolved = resolveAiModeInput(e.target.value)
            if (resolved.aiMode && !aiMode) {
              setAiMode(true)
              writeSearchAiMode(true)
            }
            setQuery(resolved.query)
            setIsFocused(true)
          }}
          // IME 组词期暂停防抖检索（04 §5.2-2，三件套之二）：
          // 开始组词时取消在途检索（复用 AbortController 取消逻辑），防止
          // 半截查询回包覆盖组词完成后的结果；组词完成后立即用完整 query
          // 触发一次检索（不等待 200ms 防抖，见 skipDebounceRef）。
          onCompositionStart={() => {
            isComposingRef.current = true
            if (debounceRef.current) clearTimeout(debounceRef.current)
            if (abortRef.current) abortRef.current.abort()
            if (moreAbortRef.current) moreAbortRef.current.abort()
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
            skipDebounceRef.current = true
          }}
          onFocus={() => setIsFocused(true)}
          className="h-9.5 min-w-0 flex-1 border-0 bg-transparent px-0 py-1 shadow-none focus-visible:ring-0 text-base sm:text-sm"
        />
        <div className="flex shrink-0 items-center gap-1.5">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {!query && !aiMode && (
            <kbd
              aria-hidden="true"
              title="按 / 快速搜索"
              className="hidden h-5 min-w-5 select-none items-center justify-center rounded border border-border/60 bg-muted/60 px-1.5 font-mono text-[11px] font-medium text-muted-foreground shadow-2xs xl:inline-flex pointer-coarse:hidden"
            >
              /
            </kbd>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleAiMode}
            aria-pressed={aiMode}
            aria-label={aiMode ? '退出 AI 模式' : '切换到 AI 模式'}
            title={aiMode ? 'AI 模式开：回车直接问 AI 找站' : 'AI 模式：回车直接问 AI 找站'}
            className={`h-6 px-1.5 rounded-full text-[11px] font-semibold gap-0.5 ${aiMode ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300 ring-1 ring-violet-400/60' : 'text-muted-foreground hover:bg-muted'}`}
          >
            <Sparkles className="h-3 w-3" />
            AI
          </Button>
          {query && (
            <Button variant="ghost" size="sm" onClick={() => { setQuery(''); inputRef.current?.focus() }} className="h-6 w-6 p-0 rounded-full hover:bg-muted" aria-label="清空搜索词" title="清空搜索词">
              <X className="h-3 w-3" />
            </Button>
          )}
          {/* <1536px 隐藏：1280px 档徽章 91px 会把输入框压到只剩 18px（复核
              2026-11-20 实测），占位符全截断、核心搜索近乎不可用；改到 min-[1536px]
              才显示。隐藏后呼出键仍可按 ⌘K / / 使用，title 保留提示。
              2026-11-20：徽标改为可点击按钮——超级搜索改由 Ctrl/⌘+Shift+K 或
              此按钮触发（派发 open-spotlight，网守与弹窗都会接），Ctrl/⌘+K
              改为聚焦顶栏搜索框。 */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('open-spotlight'))}
            className="hidden h-5 select-none items-center gap-0.5 rounded-md border border-border/50 bg-muted/60 px-1.5 font-mono text-xs font-semibold text-muted-foreground opacity-100 min-[1536px]:flex min-[1536px]:pointer-coarse:hidden shadow-2xs hover:bg-muted cursor-pointer"
            title={spotlightHotkeyHint(preferences.spotlightShortcut, modKey) + ' 呼出超级搜索（点击打开）'}
            aria-label="打开超级搜索"
          >
            {/* 徽标必须与真正生效的呼出键一致：选了「仅 /」还显示 ⌘K 就是在骗用户 */}
            <kbd>
              <span>{spotlightHotkeyHint(preferences.spotlightShortcut, modKey)}</span>
            </kbd>
          </button>
        </div>
      </div>

      {/* 读屏播报：输入是防抖的，结果更新没有视觉焦点变化，
          没有 live region 时读屏用户完全不知道「搜到了几条 / 搜完了」。
          role=status 隐含 aria-live=polite，只播报增量，不打断当前朗读。 */}
      <p className="sr-only" role="status" aria-live="polite">
        {loading
          ? '正在检索'
          : query.trim()
            ? degraded && displayHits.length === 0
              ? // 读屏同样不能把「没问成功」说成「没有找到」
                '检索服务暂时不可用，本次没有取回站点结果'
              : displayHits.length > 0 || pluginItems.length > 0 || matchedPaletteFavorites.length > 0 || matchedPaletteActions.length > 0 || matchedPaletteTools.length > 0
                ? `找到 ${displayHits.length + pluginItems.length + matchedPaletteFavorites.length + matchedPaletteActions.length + matchedPaletteTools.length} 条结果`
                : '没有找到匹配结果'
            : ''}
      </p>

      {isFocused && !query.trim() && (
        <div id="navhub-search-suggest-panel" className="fixed inset-x-3 top-[calc(3.75rem+max(env(safe-area-inset-top,0px),0px))] sm:absolute sm:inset-x-auto sm:top-full sm:left-0 sm:right-0 mt-0 sm:mt-2.5 bg-background/95 backdrop-blur-md border border-border/80 rounded-xl shadow-2xl z-50 max-h-[min(75vh,calc(100dvh-120px))] overflow-y-auto divide-y divide-border/60 animate-in fade-in-50 zoom-in-95 duration-150">
          {/* DIY 排版快捷操作（8c）：空查询时直接展示全部操作；有查询词时改走匹配行 */}
          <div className="p-2.5">
            <div className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5 mb-2 px-1">
              <LayoutTemplate className="h-3 w-3 text-violet-500" />
              <span>DIY 排版快捷操作</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => void handleDiyAction('edit')}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-background/60 hover:bg-accent/50 hover:border-primary/30 transition-all text-xs font-medium text-left cursor-pointer"
              >
                <PencilLine className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                <span className="flex-1 truncate">{isEditingLayout ? '退出编辑模式' : '进入编辑模式'}</span>
                <kbd className="px-1 py-0.5 rounded border border-border/50 bg-muted/60 font-mono text-[10px] text-muted-foreground shrink-0">
                  {isEditingLayout ? 'Esc' : 'Ctrl/⌘+E'}
                </kbd>
              </button>
              <button
                type="button"
                onClick={() => void handleDiyAction('share')}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-background/60 hover:bg-accent/50 hover:border-primary/30 transition-all text-xs font-medium text-left cursor-pointer"
              >
                <Share2 className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                <span className="flex-1 truncate">分享当前排版</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDiyAction('import')}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-background/60 hover:bg-accent/50 hover:border-primary/30 transition-all text-xs font-medium text-left cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                <span className="flex-1 truncate">导入排版配置</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDiyAction('reset')}
                className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-background/60 hover:bg-accent/50 hover:border-primary/30 transition-all text-xs font-medium text-left cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                <span className="flex-1 truncate">重置排版为默认</span>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {BUILTIN_DIY_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => void handleDiyAction('preset', preset.id)}
                  className="px-2 py-1 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400 hover:bg-violet-500/20 border border-violet-500/20 transition-colors text-xs cursor-pointer"
                  title={preset.description}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* 快捷操作（P1 #8）：空查询时直接展示全部四项，点一下就执行（主题 / 长辈 / 密度即时生效，添加站点开弹窗） */}
          <div className="p-2.5">
            <div className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5 mb-2 px-1">
              <Zap className="h-3 w-3 text-amber-500" />
              <span>快捷操作</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {emptyPanelActions.map((action) => {
                const Icon = action.id === 'theme' ? (resolvedTheme === 'dark' ? Sun : Moon) : PALETTE_ACTION_ICONS[action.id]
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => handlePaletteAction(action)}
                    title={action.description}
                    className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-background/60 hover:bg-accent/50 hover:border-primary/30 transition-all text-xs font-medium text-left cursor-pointer"
                  >
                    <Icon className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span className="flex-1 truncate">{action.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 我的收藏（P1 #8）：空查询时展示最近 8 条收藏，打字可在结果面板里筛选 */}
          {emptyPanelFavorites.length > 0 && (
            <div className="p-2.5 bg-muted/20">
              <div className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between mb-2 px-1">
                <span className="flex items-center gap-1.5">
                  <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                  <span>我的收藏</span>
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">打字可筛选</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {emptyPanelFavorites.map((fav) => {
                  // 回落 '' 而不是默认 '#'：'#' 恒真，`if (!href)` 守卫永远不触发，
                  // 不安全收藏会渲染成 href="#" 的死链接（见 openFavorite 同款注释）。
                  const href = safeHref(fav.href, '')
                  if (!href) return null
                  return (
                    <a
                      key={fav.siteId}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => openFavorite(fav)}
                      className="flex items-center gap-2 p-1.5 rounded-lg border border-border/50 bg-background/60 hover:bg-accent/50 hover:border-primary/30 transition-all text-xs group"
                    >
                      <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                        <SiteFavicon
                          title={fav.title}
                          url={href}
                          icon={fav.icon}
                          className="w-4 h-4 object-contain rounded"
                        />
                      </div>
                      <span className="truncate font-medium text-foreground group-hover:text-primary transition-colors text-[11px]">
                        {fav.title}
                      </span>
                      {(() => {
                        const ql = quicklinkBySiteId.get(fav.siteId)
                        if (!ql) return null
                        return (
                          <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 font-mono text-[10px] font-bold text-primary">
                            !{ql.quickPrefix}
                          </span>
                        )
                      })()}
                    </a>
                  )
                })}
              </div>
              {(() => {
                const chips = emptyPanelFavorites
                  .map((fav) => quicklinkBySiteId.get(fav.siteId))
                  // Map.get() 查不到返回 undefined 不是 null：只排 null 会把
                  // undefined 漏进 chips，随后读 c.quickPrefix 整页崩溃
                  //（2026-11-17 实况日志两起）。判空与同文件 `if (!ql)` 同口径。
                  .filter((e): e is QuicklinkEntry => e != null)
                if (chips.length === 0) return null
                return (
                  <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                    输入 {chips.map((c) => `!${c.quickPrefix}`).join(' / ')} &lt;关键词&gt; 直达搜索
                  </p>
                )
              })()}
            </div>
          )}

          {/* 常用与最近常去站点快捷直达 */}
          {orderedRecentVisits.length > 0 && (
            <div className="p-2.5 bg-muted/20">
              <div className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between mb-2 px-1">
                <span className="flex items-center gap-1.5">
                  <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                  <span>常用与最近常去</span>
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">一键直达</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {orderedRecentVisits.map((visit) => (
                  <a
                    key={visit.id}
                    href={safeHref(visit.href)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      recordOfflineVisit(visit)
                      reportClick(visit.id, identity)
                      setIsFocused(false)
                    }}
                    className="flex items-center gap-2 p-1.5 rounded-lg border border-border/50 bg-background/60 hover:bg-accent/50 hover:border-primary/30 transition-all text-xs group"
                  >
                    <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                      <SiteFavicon
                        title={visit.title}
                        url={visit.href}
                        icon={visit.icon}
                        className="w-4 h-4 object-contain rounded"
                      />
                    </div>
                    <span className="truncate font-medium text-foreground group-hover:text-primary transition-colors text-[11px]">
                      {visit.title}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {recentDegraded && recent.length === 0 && (
            <div className="px-3.5 py-2 text-xs text-muted-foreground flex items-center gap-1.5 bg-muted/40">
              <Clock className="h-3 w-3" /> 最近搜索暂时不可用（服务未响应）
            </div>
          )}
          {recent.length > 0 && (
            <div>
              <div className="px-3.5 py-2 text-xs font-medium text-muted-foreground flex items-center justify-between gap-1.5 bg-muted/40">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3" /> 最近搜索
                </span>
                {/* P3-13：一键清空，两步确认（同 /me/history）；确认文案按
                    /me/history:6 的身份口径：当前身份是登录身份或本机匿名 id */}
                <button
                  type="button"
                  aria-label={confirmClearRecent ? '确认清空最近搜索' : '清空最近搜索'}
                  title={
                    confirmClearRecent
                      ? '将删除当前身份（登录身份或本机匿名 id）下的全部最近搜索'
                      : '清空最近搜索'
                  }
                  onClick={() => void handleClearRecent()}
                  className={
                    confirmClearRecent
                      ? 'rounded px-1.5 py-0.5 text-xs font-medium text-destructive-text hover:bg-destructive/15'
                      : 'rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }
                >
                  {confirmClearRecent ? '确认清空' : '清空'}
                </button>
              </div>
              <div className="p-1">
                {/* R3：行容器是 div，点选回填区与 × 按钮并列——<button> 里
                    不能再嵌 <button>；× 命中区 32px，触屏 44px，不进 navItems */}
                {recent.map((item) => (
                  <div key={item.id} className="flex items-center gap-1 rounded hover:bg-accent/50">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left px-3 py-1.5 text-xs rounded text-muted-foreground hover:text-foreground flex items-center justify-between gap-2"
                      onClick={() => setQuery(item.query)}
                    >
                      <span className="truncate min-w-0">{item.query}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 opacity-40" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`删除最近搜索“${item.query}”`}
                      title="删除这条最近搜索"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDeleteRecent(item)
                      }}
                      className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="p-3 bg-card">
            <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-2">
              <Sparkles className="h-3 w-3 text-amber-500" />
              下一代认知推测与架构探索（点击立即体验）
            </div>

            <div className="space-y-2">
              <div>
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <GitCompare className="h-2.5 w-2.5 text-blue-500" /> 竞品选型多维判胜矩阵
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: 'React vs Vue', q: 'react vs vue' },
                    { label: 'Cursor vs VS Code', q: 'cursor vs vscode' },
                    { label: 'pnpm vs Bun', q: 'pnpm vs bun' },
                  ].map((chip) => (
                    <button
                      key={chip.q}
                      onClick={() => setQuery(chip.q)}
                      className="px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-colors"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <Layers className="h-2.5 w-2.5 text-purple-500" /> Graph-RAG 技术栈蓝图配方
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: '本地 RAG 知识库配方', q: '@recipe 本地rag' },
                    { label: '协同富文本配方', q: '@recipe 协同文档' },
                  ].map((chip) => (
                    <button
                      key={chip.q}
                      onClick={() => setQuery(chip.q)}
                      className="px-2 py-0.5 rounded text-xs bg-purple-500/10 text-purple-700 dark:text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 transition-colors"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  <Zap className="h-2.5 w-2.5 text-emerald-500" /> 0-RTT 端侧推测执行
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: '2^10 * 8 (计算器)', q: '2^10 * 8' },
                    { label: '/^[a-z0-9]+$/i (正则)', q: '/^[a-z0-9_-]+$/i' },
                    { label: '^1.2.0 vs 1.4.0 (版本)', q: 'semver: ^1.2.0 vs 1.4.0' },
                    { label: '418 / 502 (状态码)', q: '418' },
                    { label: '#3b82f6 (色彩空间)', q: '#3b82f6' },
                    { label: 'now (时间戳)', q: 'now' },
                    { label: '@b64 Hello (编解码)', q: '@b64 Hello' },
                  ].map((chip) => (
                    <button
                      key={chip.q}
                      onClick={() => setQuery(chip.q)}
                      className="px-2 py-0.5 rounded text-xs bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors font-mono"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showResults && (
        <div id="navhub-search-results-panel" ref={resultsPanelRef} className="fixed inset-x-3 top-[calc(3.75rem+max(env(safe-area-inset-top,0px),0px))] sm:absolute sm:inset-x-auto sm:top-full sm:left-0 sm:right-0 mt-0 sm:mt-2.5 bg-background/95 backdrop-blur-md border border-border/80 rounded-xl shadow-2xl z-50 max-h-[min(75vh,calc(100dvh-120px))] flex flex-col overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
          {/* 未知前缀明示行（04 §2.2）：静默 null 改为一行明示，置于列表顶部、
              quicklink 行之上；Enter 走普通搜索，不拦截、不外跳 */}
          {quicklinkMatch.kind === 'unknown-prefix' && (
            <div className="px-3.5 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                未找到前缀 “{quicklinkMatch.prefix}”，按 Enter 按普通搜索
              </span>
            </div>
          )}
          {/* 模板无占位符明示行（04 §2.3）：Enter 不外跳、走普通搜索 */}
          {quicklinkMatch.kind === 'bad-template' && (
            <div className="px-3.5 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                快捷链接模板缺少占位符，无法填入查询词
              </span>
            </div>
          )}
          {/* 快捷链接横幅：精确匹配时置顶（复用 search-bar 的 matchedShortcut 横幅样式），鼠标可点，回车直达；命中时 OMNI 横幅让位 */}
          {quicklinkMatch.kind === 'hit' && quicklinkMatch.url && (
            <div className="px-3.5 py-2.5 bg-primary/10 border-b border-primary/20 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  openQuicklink({
                    key: `quicklink-${quicklinkMatch.entry.siteId}`,
                    entry: quicklinkMatch.entry,
                    arg: quicklinkMatch.arg,
                    url: quicklinkMatch.url!,
                  })
                }
                className="flex items-center gap-2 text-xs font-medium text-primary min-w-0 text-left cursor-pointer"
              >
                <span className="px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-mono text-[10px] font-bold shrink-0">
                  !{quicklinkMatch.entry.quickPrefix}
                </span>
                <span className="truncate min-w-0">
                  在 <strong className="font-semibold">{quicklinkMatch.entry.title}</strong> 搜索：
                  <strong className="font-semibold underline underline-offset-2">
                    {quicklinkMatch.arg ? `"${quicklinkMatch.arg}"` : '(全部)'}
                  </strong>
                </span>
              </button>
              <span className="inline-flex items-center gap-1 text-[11px] text-primary shrink-0 font-medium">
                <span>回车直达</span>
                <ExternalLink className="w-3 h-3" />
              </span>
            </div>
          )}
          {quicklinkMatch.kind !== 'hit' && omniCommand && (
            <div className="px-3.5 py-2.5 bg-primary/10 border-b border-primary/20 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-primary min-w-0">
                <span className="px-1.5 py-0.5 rounded bg-primary/20 font-mono text-[10px] uppercase font-bold shrink-0">
                  {omniCommand.engineName}
                </span>
                <span className="truncate min-w-0">
                  按 Enter 直达外部搜索：<strong className="font-semibold underline underline-offset-2">{omniCommand.term}</strong>
                </span>
              </div>
              <a
                href={safeHref(omniCommand.url)}
                target={linkTarget}
                rel="noopener noreferrer"
                onClick={() => setIsFocused(false)}
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline shrink-0 font-medium cursor-pointer"
              >
                <span>直达</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
          <Command className="border-0 shadow-none flex-1 overflow-hidden" shouldFilter={false}>
            <CommandList className="max-h-[min(75vh,calc(100dvh-120px))] overflow-y-auto">
              {degraded && panel.mode !== 'outage' && (
                <div className="px-3 py-2 text-xs text-amber-700 dark:text-amber-400 border-b flex items-center justify-between gap-2">
                  <span>
                    {displayHits.length > 0
                      ? '检索服务暂时不可用，已降级；下面结果可能不完整。'
                      : '站点检索这次没能问成功，下面的结果不保证覆盖；插件结果不受影响。'}
                  </span>
                  <button
                    className="underline underline-offset-2 hover:no-underline shrink-0"
                    onClick={() => setRetryToken((n) => n + 1)}
                  >
                    重试
                  </button>
                </div>
              )}
              {!degraded && !semanticAvailable && (
                <div className="px-3 py-2 text-xs text-muted-foreground border-b">
                  语义检索不可用（未配置本地模型），当前为关键词 / 拼音 / 全文混合检索。
                </div>
              )}
              {/* 放宽提示只在真的展示了放宽结果时出现：弱语义填充被重排抑制、
                  面板走真空态时不再挂这条横幅（否则"没有找到"和"以下是放宽结果"自相矛盾） */}
              {fallbackHint && displayHits.length > 0 && (
                <div className="px-3 py-2 text-xs text-amber-700 dark:text-amber-400 border-b">
                  {fallbackHint === 'filter'
                    ? (relaxedPricingNotice(relaxedFacets) ??
                      '当前筛选下没有结果，已放宽到全库匹配（结果可能来自其他类目）。')
                    : '没有精确匹配，以下是放宽匹配后的结果。'}
                </div>
              )}
              {/* 分组建议（research #2）：打字时即时给出的快捷入口，排在结果分组之前。
                  历史 / 专题 / 相关搜索三组，匹配词加粗（Highlighted），↑↓/Enter 可达：
                  建议行与 DIY/插件/站点行共用同一条 navItems 扁平列表，DOM 顺序
                  即导航顺序；回车采纳建议（历史/相关搜索填回输入框，专题直接进页）。 */}
              {suggestionGroups.map((group) => (
                <div key={group.kind} className="border-b border-border/60">
                  <div className="px-3.5 py-2 flex items-center gap-1.5 bg-muted/30">
                    {group.kind === 'history' ? (
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : group.kind === 'collection' ? (
                      <Layers className="h-3.5 w-3.5 text-violet-500" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                    )}
                    <span className="text-xs font-semibold text-muted-foreground">{group.title}</span>
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    {group.items.map((item) => {
                      const idx = navIndexById.get(`suggestion-${item.key}`) ?? -1
                      const selected = idx === activeIndex
                      const rowClass = `w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                      }`
                      const inner = (
                        <>
                          <NavDigitBadge index={idx} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">
                              <Highlighted text={item.label} query={query} />
                            </span>
                            {item.description && (
                              <span className="block text-xs text-muted-foreground line-clamp-1 mt-0.5">
                                <Highlighted text={item.description} query={query} />
                              </span>
                            )}
                          </span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 opacity-60" />
                        </>
                      )
                      return item.href ? (
                        <Link
                          key={item.key}
                          href={safeHref(item.href)}
                          onClick={() => setIsFocused(false)}
                          role="option"
                          id={`navhub-search-opt-${idx}`}
                          data-nav-index={idx}
                          data-nav-item="suggestion"
                          aria-selected={selected}
                          className={rowClass}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div
                          key={item.key}
                          role="option"
                          id={`navhub-search-opt-${idx}`}
                          data-nav-index={idx}
                          data-nav-item="suggestion"
                          aria-selected={selected}
                          onClick={() => applySuggestion(item.label)}
                          className={rowClass}
                        >
                          {inner}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {/* 快捷链接（命令命中）：建议之后、DIY 之前，↑↓/Enter 可达；命中时同一收藏不重复出现在收藏分组 */}
              {matchedPaletteQuicklinks.length > 0 && (
                <div className="border-b border-border/60">
                  <div className="px-3.5 py-2 flex items-center gap-1.5 bg-primary/5">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-semibold text-primary">快捷链接</span>
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    {matchedPaletteQuicklinks.map((item) => {
                      const idx = navIndexById.get(item.key) ?? -1
                      return (
                        <div
                          key={item.key}
                          role="option"
                          id={`navhub-search-opt-${idx}`}
                          data-nav-index={idx}
                          data-nav-item="quicklink"
                          aria-selected={idx === activeIndex}
                          onClick={() => openQuicklink(item)}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                            idx === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                          }`}
                        >
                          <NavDigitBadge index={idx} />
                          <span className="px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-mono text-[10px] font-bold shrink-0">
                            !{item.entry.quickPrefix}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">
                              在 {item.entry.title} 搜索：{item.arg ? `"${item.arg}"` : '(全部)'}
                            </span>
                            <span className="block text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {item.entry.href}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">回车直达</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {/* DIY 排版操作（8c）：查询命中操作关键词时置顶展示，参与 ↑↓/Enter 键盘导航 */}
              {matchedDiyActions.length > 0 && (
                <div className="border-b border-border/60">
                  <div className="px-3.5 py-2 flex items-center gap-1.5 bg-violet-500/5">
                    <LayoutTemplate className="h-3.5 w-3.5 text-violet-500" />
                    <span className="text-xs font-semibold text-violet-700 dark:text-violet-400">DIY 排版操作</span>
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    {matchedDiyActions.map((item: DiyPaletteActionItem) => {
                      const idx = navIndexById.get(`diy-${item.key}`) ?? -1
                      const Icon = DIY_ACTION_ICONS[item.actionId]
                      return (
                        <div
                          key={item.key}
                          role="option"
                          id={`navhub-search-opt-${idx}`}
                          data-nav-index={idx}
                          data-nav-item="diy"
                          aria-selected={idx === activeIndex}
                          onClick={() => void handleDiyAction(item.actionId, item.presetId)}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                            idx === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                          }`}
                        >
                          <NavDigitBadge index={idx} />
                          <span className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/15 flex items-center justify-center shrink-0">
                            <Icon className="h-4 w-4 text-violet-500" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">{item.title}</span>
                            <span className="block text-xs text-muted-foreground truncate mt-0.5">
                              {item.description}
                            </span>
                          </span>
                          {item.hint && (
                            <kbd className="px-1.5 py-0.5 rounded border border-border/50 bg-muted/60 font-mono text-[10px] text-muted-foreground shrink-0">
                              {item.hint}
                            </kbd>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {/* 我的场景（⌘K）：查询命中场景名或「场景」时展示，参与 ↑↓/Enter 键盘导航 */}
              {matchedSceneActions.length > 0 && (
                <div className="border-b border-border/60">
                  <div className="px-3.5 py-2 flex items-center gap-1.5 bg-teal-500/5">
                    <Layers className="h-3.5 w-3.5 text-teal-500" />
                    <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">我的场景</span>
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    {matchedSceneActions.map((item) => {
                      const idx = navIndexById.get(`scene-${item.key}`) ?? -1
                      return (
                        <div
                          key={item.key}
                          role="option"
                          id={`navhub-search-opt-${idx}`}
                          data-nav-index={idx}
                          data-nav-item="scene"
                          aria-selected={idx === activeIndex}
                          onClick={() => void handleSceneAction(item.sceneId)}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                            idx === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                          }`}
                        >
                          <NavDigitBadge index={idx} />
                          <span className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/15 flex items-center justify-center shrink-0">
                            <Layers className="h-4 w-4 text-teal-500" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">
                              {item.title}
                              {item.isActive ? ' · 当前' : ''}
                            </span>
                            <span className="block text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {item.description}
                            </span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {/* 我的收藏（P1 #8）：只出现用户自己的收藏，命中查询词的排在站点之前；已在站点结果里的不重复出现 */}
              {matchedPaletteFavorites.length > 0 && (
                <div className="border-b border-border/60">
                  <div className="px-3.5 py-2 flex items-center gap-1.5 bg-amber-500/5">
                    <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">我的收藏</span>
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    {matchedPaletteFavorites.map((fav) => {
                      const idx = navIndexById.get(`favorite-${fav.siteId}`) ?? -1
                      // 回落 '' 而不是默认 '#'：'#' 恒真，`if (!href)` 守卫永远不触发，
                      // 不安全收藏会占一个键盘导航位却打不开（死导航位）。源头
                      // matchPaletteFavorites 已先过滤，这里是纵深防御。
                      const href = safeHref(fav.href, '')
                      if (!href) return null
                      return (
                        <a
                          key={fav.siteId}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          role="option"
                          id={`navhub-search-opt-${idx}`}
                          data-nav-index={idx}
                          data-nav-item="favorite"
                          aria-selected={idx === activeIndex}
                          onClick={() => openFavorite(fav)}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                            idx === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                          }`}
                        >
                          <NavDigitBadge index={idx} />
                          <span className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/15 flex items-center justify-center shrink-0">
                            <SiteFavicon
                              title={fav.title}
                              url={href}
                              icon={fav.icon}
                              className="w-full h-full object-contain rounded-xs"
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">
                              <Highlighted text={fav.title} query={query} />
                            </span>
                            <span className="block text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {fav.description ?? fav.href}
                            </span>
                          </span>
                          <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 shrink-0" />
                        </a>
                      )
                    })}
                  </div>
                </div>
              )}
              {/* 快捷操作（P1 #8）：查询命中操作关键词时展示，↑↓/Enter 可达，点一下就执行 */}
              {matchedPaletteActions.length > 0 && (
                <div className="border-b border-border/60">
                  <div className="px-3.5 py-2 flex items-center gap-1.5 bg-amber-500/5">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">快捷操作</span>
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    {matchedPaletteActions.map((action) => {
                      const idx = navIndexById.get(`action-${action.id}`) ?? -1
                      const Icon = action.id === 'theme' ? (resolvedTheme === 'dark' ? Sun : Moon) : PALETTE_ACTION_ICONS[action.id]
                      return (
                        <div
                          key={action.id}
                          role="option"
                          id={`navhub-search-opt-${idx}`}
                          data-nav-index={idx}
                          data-nav-item="action"
                          aria-selected={idx === activeIndex}
                          onClick={() => handlePaletteAction(action)}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                            idx === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                          }`}
                        >
                          <NavDigitBadge index={idx} />
                          <span className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/15 flex items-center justify-center shrink-0">
                            <Icon className="h-4 w-4 text-amber-500" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">{action.label}</span>
                            <span className="block text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {action.description}
                            </span>
                          </span>
                          {action.hint && (
                            <kbd className="px-1.5 py-0.5 rounded border border-border/50 bg-muted/60 font-mono text-[10px] text-muted-foreground shrink-0">
                              {action.hint}
                            </kbd>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {/* 极速工具（P1 #8）：19 个零 RTT 工具，回车把示例填回输入框，0-RTT 卡片当场算出结果 */}
              {matchedPaletteTools.length > 0 && (
                <div className="border-b border-border/60">
                  <div className="px-3.5 py-2 flex items-center gap-1.5 bg-emerald-500/5">
                    <Wrench className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">极速工具 · 0-RTT</span>
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    {matchedPaletteTools.map((tool) => {
                      const idx = navIndexById.get(`tool-${tool.id}`) ?? -1
                      const Icon = PALETTE_TOOL_ICONS[tool.id] ?? Wrench
                      return (
                        <div
                          key={tool.id}
                          role="option"
                          id={`navhub-search-opt-${idx}`}
                          data-nav-index={idx}
                          data-nav-item="tool"
                          aria-selected={idx === activeIndex}
                          onClick={() => handlePaletteTool(tool)}
                          className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer ${
                            idx === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                          }`}
                        >
                          <NavDigitBadge index={idx} />
                          <span className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center shrink-0">
                            <Icon className="h-4 w-4 text-emerald-500" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">{tool.label}</span>
                            <span className="block text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {tool.description}
                            </span>
                          </span>
                          <code
                            className="max-w-[38%] truncate rounded border border-border/50 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground shrink-0"
                            title={tool.sampleQuery}
                          >
                            {tool.sampleQuery}
                          </code>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {actionIntentData && (
                <div className="p-2 border-b">
                  <ActionIntentCard data={actionIntentData} />
                </div>
              )}
              {actionIntentLoading && !actionIntentData && (
                <div className="px-3 py-2 border-b bg-amber-500/5 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>正在分析实操意图并匹配王牌工具与 3 步解决方案...</span>
                </div>
              )}
              {speculativeResult && (
                <div className="p-2 border-b">
                  <SpeculativeIntentCard result={speculativeResult} />
                </div>
              )}
              {(comparisonMatrix || aiComparisonMatrix) && (
                <div className="p-2 border-b">
                  <TechComparisonCard matrix={(comparisonMatrix || aiComparisonMatrix)!} />
                </div>
              )}
              {aiComparisonLoading && !comparisonMatrix && !aiComparisonMatrix && (
                <div className="px-3 py-2.5 border-b bg-primary/5 flex items-center gap-2 text-xs text-primary">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>正在调取 AI 实时生成并排选型对比矩阵...</span>
                </div>
              )}
              {(architectureRecipe || aiRecipe) && (
                <div className="p-2 border-b">
                  <ArchitectureRecipeCard recipe={(architectureRecipe || aiRecipe)!} />
                </div>
              )}
              {!architectureRecipe && !aiRecipe && query.trim().length >= 2 && !speculativeResult && !comparisonMatrix && !aiComparisonMatrix && (
                <div className="px-3 py-2 border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
                    <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="truncate">搜场景不求人：基于馆藏定制「<strong className="text-foreground">{query.trim()}</strong>」全流程工具链</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6.5 px-2.5 text-[11px] gap-1 border-primary/30 text-primary hover:bg-primary/10 shrink-0"
                    disabled={aiRecipeLoading}
                    onClick={triggerAiRecipe}
                  >
                    {aiRecipeLoading ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>AI 编排中...</span>
                      </>
                    ) : (
                      <>
                        <Layers className="w-3 h-3" />
                        <span>✨ AI 生成场景工作流</span>
                      </>
                    )}
                  </Button>
                </div>
              )}
              {/* 自动识别的分面筛选与检索算子胶囊 */}
              {(Object.keys(inferredFacets).length > 0 || inferredTag || inferredCategory || excludedTerms.length > 0 || queryExpansion.length > 0) && (
                <div className="px-3 py-1.5 bg-primary/5 border-b border-border/50 flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1 text-primary font-medium text-[11px]">
                    <Sparkles className="w-3 h-3" />
                    <span>意图解析：</span>
                  </span>
                  {inferredTag && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
                      <span>#{inferredTag}</span>
                    </span>
                  )}
                  {inferredCategory && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                      <span>@{inferredCategory}</span>
                    </span>
                  )}
                  {excludedTerms.map((ex) => (
                    <span
                      key={ex}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20"
                    >
                      <span>-{ex}</span>
                    </span>
                  ))}
                  {queryExpansion.map((exp) => (
                    <span
                      key={exp}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20"
                    >
                      <span>~{exp}</span>
                    </span>
                  ))}
                  {Object.entries(inferredFacets).map(([fKey, vals]) => (
                    <span
                      key={fKey}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-secondary text-secondary-foreground border border-border/60"
                    >
                      <span className="text-muted-foreground">{fKey}:</span>
                      <span className="font-semibold text-foreground">{vals.join(', ')}</span>
                    </span>
                  ))}
                </div>
              )}
              {/* 知识图谱对标与实体方案推荐 (Phase 3 知识图谱联动) */}
              {relationHits.length > 0 && (
                <div className="p-3 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-b border-amber-500/20">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2">
                    <GitFork className="w-3.5 h-3.5 text-amber-500" />
                    <span>知识图谱对标方案推荐：为您找到 “{query}” 的开源/平替选项</span>
                  </div>
                  <div className="space-y-2">
                    {relationHits.map((rel) => (
                      <div
                        key={rel.id}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-card/90 border border-border/70 hover:border-amber-500/40 transition-colors shadow-2xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs sm:text-sm text-foreground truncate">
                              {rel.sourceSite?.title || '推荐站点'}
                            </span>
                            {rel.isFreeOrOpenSource && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold border border-emerald-500/20 flex-shrink-0">
                                开源/免费
                              </span>
                            )}
                            <span className="text-[11px] text-muted-foreground truncate">
                              对标 {rel.targetTitle}
                            </span>
                          </div>
                          {rel.note && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              💡 {rel.note}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {rel.sourceSite && (
                            <Button asChild size="sm" variant="outline" className="h-7 text-xs px-2.5">
                              <Link href={`/site/${rel.sourceSite.id}`} onClick={() => setIsFocused(false)}>
                                详情
                              </Link>
                            </Button>
                          )}
                          {rel.sourceSite && (
                            <Button asChild size="sm" variant="default" className="h-7 text-xs px-2.5">
                              <a href={safeHref(rel.sourceSite.url)} target="_blank" rel="noopener noreferrer">
                                直达
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 统一搜索：插件市场命中（语义/关键词由 /api/plugins/search 返回） */}
              {/* 精选专题匹配推荐 */}
              {matchedCollections.length > 0 && (
                <div className="border-b border-border/70 bg-violet-500/5 p-2.5">
                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-xs font-semibold text-violet-700 dark:text-violet-400 flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5" />
                      精选专题推荐
                    </span>
                    <Link
                      href="/collections"
                      onClick={() => setIsFocused(false)}
                      className="text-[11px] text-muted-foreground hover:text-primary transition-colors"
                    >
                      查看全部专题 →
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {matchedCollections.map((col) => (
                      <Link
                        key={col.id}
                        href={`/collections/${encodeURIComponent(col.slug)}`}
                        onClick={() => setIsFocused(false)}
                        className="flex items-center gap-2 p-2 rounded-lg border border-violet-500/20 bg-card hover:bg-violet-500/10 transition-colors"
                      >
                        <Layers className="h-4 w-4 text-violet-500 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-foreground truncate">{col.title}</div>
                          {col.description && (
                            <div className="text-[10px] text-muted-foreground truncate">{col.description}</div>
                          )}
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-700 dark:text-violet-400 shrink-0 font-medium">
                          {col.kind === 'roadmap' ? '路线图' : '专题'}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {pluginItems.length > 0 && (
                <div className="border-b border-border/60">
                  <div className="px-3.5 py-2 flex items-center justify-between gap-2 bg-primary/5">
                    <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                      <Store className="h-3.5 w-3.5" />
                      插件市场
                      {pluginLoading && <Loader2 className="h-3 w-3 animate-spin opacity-60" />}
                      {pluginSemanticFallback && (
                        <span className="text-[10px] font-normal text-muted-foreground">语义未就绪 · 关键词匹配</span>
                      )}
                    </span>
                    <Link
                      href={`/marketplace?q=${encodeURIComponent(query.trim())}`}
                      onClick={() => setIsFocused(false)}
                      className="text-[11px] text-primary/80 hover:text-primary hover:underline"
                    >
                      查看全部插件结果
                    </Link>
                  </div>
                  <div className="p-1.5 space-y-1">
                    {pluginItems.map((p) => (
                      <Link
                        key={p.id}
                        id={`navhub-search-opt-${navIndexById.get('plugin-' + p.id) ?? -1}`}
                        data-nav-index={navIndexById.get('plugin-' + p.id) ?? -1}
                        data-nav-item="plugin"
                        aria-current={navIndexById.get('plugin-' + p.id) === activeIndex ? 'true' : undefined}
                        href={`/marketplace/${encodeURIComponent(p.slug)}`}
                        onClick={() => setIsFocused(false)}
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                          navIndexById.get('plugin-' + p.id) === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                        }`}
                      >
                        <NavDigitBadge index={navIndexById.get('plugin-' + p.id) ?? -1} />
                        <span className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                          <Store className="h-4 w-4 text-primary" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate">
                              <Highlighted text={p.name} query={query} />
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                              {pluginKindLabel(p.kind)}
                            </span>
                          </span>
                          {p.description && (
                            <span className="block text-xs text-muted-foreground truncate mt-0.5">
                              <Highlighted text={p.description} query={query} />
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2 text-[10px] text-muted-foreground shrink-0 font-mono">
                          {(p.installCount ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5">
                              <Download className="h-3 w-3" />
                              {p.installCount}
                            </span>
                          )}
                          {(p.reviewCount ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-amber-500">
                              <Star className="h-3 w-3 fill-amber-400" />
                              {(p.ratingAvg ?? 0).toFixed(1)}
                            </span>
                          )}
                          <ArrowRight className="h-3 w-3 opacity-40" />
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {pluginFailed && pluginItems.length === 0 && (
                <div className="px-3.5 py-2 text-[11px] text-amber-700 dark:text-amber-400 border-b flex items-center gap-1.5">
                  <Store className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>插件结果本次没有取回（不是插件市场没有匹配），站点结果不受影响。</span>
                  <button
                    className="underline underline-offset-2 hover:no-underline shrink-0"
                    onClick={() => setRetryToken((n) => n + 1)}
                  >
                    重试
                  </button>
                </div>
              )}
              {panel.mode !== 'hidden' ? (
                <div className="py-6 px-3 text-center">
                  <div className="text-muted-foreground text-sm">{panel.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{panel.hint}</div>
                  {correction ? (
                    <div
                      role="status"
                      className="mt-3 inline-flex flex-wrap items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs text-foreground"
                    >
                      <span>已替你纠正为：</span>
                      <button
                        type="button"
                        className="font-bold underline text-primary hover:text-primary/80 cursor-pointer"
                        onClick={() => setQuery(correction.corrected)}
                      >
                        {correction.corrected}
                      </button>
                      <span>不是这个？</span>
                      <button
                        type="button"
                        className="font-medium underline underline-offset-2 text-primary hover:no-underline cursor-pointer"
                        onClick={() => {
                          setNocorrectQuery(correction.original)
                          setRetryToken((n) => n + 1)
                        }}
                      >
                        搜原来的「{correction.original}」
                      </button>
                    </div>
                  ) : didYouMean ? (
                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-xs text-foreground">
                      <span>💡 您是不是想搜：</span>
                      <button
                        type="button"
                        className="font-bold underline text-primary hover:text-primary/80 cursor-pointer"
                        onClick={() => setQuery(didYouMean)}
                      >
                        {didYouMean}
                      </button>
                      <span>？</span>
                    </div>
                  ) : null}
                  {/* 纠正后隐藏通用建议 chips（协调人决定 1：纠正后仍零结果
                      只留明确出口，不叠泛推荐）；未纠正时照常显示 */}
                  {!correction && suggestions.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs text-muted-foreground mb-2">试试这些搜索</div>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {suggestions.map((s) => (
                          <button
                            key={s}
                            className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            onClick={() => setQuery(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {!correction && popular.length > 0 && (
                    <div className="mt-4">
                      <div className="text-xs text-muted-foreground mb-2">热门搜索</div>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {popular.map((s) => (
                          <button
                            key={s}
                            className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:bg-accent transition-colors"
                            onClick={() => setQuery(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {panel.actions.length > 0 && (
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {panel.actions.map((action) =>
                        action.external ? (
                          <a
                            key={action.kind}
                            href={safeHref(action.href ?? '', '')}
                            target={linkTarget}
                            rel="noopener noreferrer nofollow"
                            onClick={() => setIsFocused(false)}
                            className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:bg-accent transition-colors inline-flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {action.label}
                          </a>
                        ) : action.href ? (
                          <Link
                            key={action.kind}
                            href={safeHref(action.href)}
                            onClick={() => setIsFocused(false)}
                            className="text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:bg-accent transition-colors"
                          >
                            {action.label}
                          </Link>
                        ) : (
                          <button
                            key={action.kind}
                            className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            onClick={() => runPanelAction(action)}
                          >
                            {action.label}
                          </button>
                        ),
                      )}
                    </div>
                  )}
                  {wantedNote ? (
                    <div className="mt-3 text-[11px] text-muted-foreground">{wantedNote}</div>
                  ) : null}
                  {query.trim() && (
                    <div className="mt-4 pt-3 border-t border-border/40 flex flex-col items-center gap-2">
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <ExternalLink className="h-3 w-3 text-primary" />
                        <span>一键全网聚合搜索「{query.trim()}」：</span>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <a
                          href={safeHref(`https://www.google.com/search?q=${encodeURIComponent(query.trim())}`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setIsFocused(false)}
                          className="text-xs px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-colors font-medium"
                        >
                          Google
                        </a>
                        <a
                          href={safeHref(`https://github.com/search?q=${encodeURIComponent(query.trim())}`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setIsFocused(false)}
                          className="text-xs px-2.5 py-1 rounded-lg bg-neutral-500/10 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-500/20 border border-neutral-500/20 transition-colors font-medium"
                        >
                          GitHub
                        </a>
                        <a
                          href={safeHref(`https://www.baidu.com/s?wd=${encodeURIComponent(query.trim())}`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setIsFocused(false)}
                          className="text-xs px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 transition-colors font-medium"
                        >
                          百度
                        </a>
                        <a
                          href={safeHref(`https://www.bing.com/search?q=${encodeURIComponent(query.trim())}`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setIsFocused(false)}
                          className="text-xs px-2.5 py-1 rounded-lg bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20 transition-colors font-medium"
                        >
                          Bing
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              ) : (


                // 展示列表是重排后的 displayHits（失效站点已剔除、精确名称置顶、
                // 无强匹配时为空→走真空态）。语义联想组（related）单独标注"相关推荐"，
                // 不与主结果混排。
                displayHits.map((hit, displayIndex) => {
                  const site = hit.site
                  if (!site) return null
                  const channels = Object.keys(hit.contributions ?? {})
                  const faved = favorites.isFavorite(site.id)
                  return (
                    <Fragment key={hit.siteId}>
                      {displayIndex === relatedStartIndex && rankedHits.related.length > 0 && (
                        <div className="px-3.5 pt-3 pb-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                          <Sparkles className="h-3 w-3 text-violet-500" />
                          <span>相关推荐</span>
                        </div>
                      )}
                      <div
                        id={`navhub-search-opt-${navIndexById.get('site-' + site.id) ?? -1}`}
                        role="option"
                        data-nav-index={navIndexById.get('site-' + site.id) ?? -1}
                        data-nav-item="site"
                        aria-selected={navIndexById.get('site-' + site.id) === activeIndex}
                        onClick={() => openSite(hit)}
                        className={`flex items-center gap-3 py-3 px-3 cursor-pointer ${
                          navIndexById.get('site-' + site.id) === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                        }`}
                      >
                      <NavDigitBadge index={navIndexById.get('site-' + site.id) ?? -1} />
                      <div className="flex-shrink-0 w-8 h-8 rounded-md p-1 bg-muted/60 dark:bg-muted/30 border border-border/50 flex items-center justify-center">
                        <SiteFavicon
                          title={site.title}
                          url={site.url}
                          icon={site.iconKey ?? undefined}
                          className="w-full h-full object-contain rounded-xs"
                        />
                      </div>
                      <div className="flex flex-col flex-1 gap-1 min-w-0">
                        <span className="text-sm font-medium truncate">
                          <Highlighted text={site.title} query={query} />
                        </span>
                        {site.description && (
                          <span className="text-xs text-muted-foreground truncate">
                            <Highlighted text={site.description} query={query} />
                          </span>
                        )}
                        <div className="flex items-center gap-1 flex-wrap">
                          {(site.status === 'broken' || site.health?.ok === false) && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium border border-amber-500/20 inline-flex items-center gap-1"
                              title="检测到站点当前可能无法直接访问，已就绪 Wayback 时光机自愈镜像"
                            >
                              <Clock className="w-2.5 h-2.5 text-amber-500" />
                              <span>快照自愈</span>
                            </span>
                          )}
                          {channels.map((c) => (
                            <span
                              key={c}
                              className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground"
                              title={c === 'personal' ? '来自你近 30 天的点击与收藏偏好（可在「偏好设置」查看或清理画像）' : undefined}
                            >
                              {CHANNEL_LABELS[c] ?? c}
                            </span>
                          ))}
            <AlgorithmHudBadge contributions={hit.contributions} />
                          {site.tags?.slice(0, 3).map((t) => (
                            <span key={t} className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">{t}</span>
                          ))}
                        </div>
                      </div>
                      <button
                        className="flex-shrink-0 p-1 rounded hover:bg-muted"
                        title={faved ? '取消收藏' : '收藏'}
                        onClick={(e) => {
                          e.stopPropagation()
                          // 存储读不出来时写入会被拒绝（为了不覆盖原数据）：必须说出来
                          if (favorites.storageBlocked) {
                            toast({ title: '这一下没能保存', description: favorites.storageBlocked, variant: 'destructive' })
                            return
                          }
                          void favorites.toggle({
                            siteId: site.id, title: site.title, href: site.url,
                            icon: site.iconKey ?? undefined, description: site.description ?? undefined,
                          })
                        }}
                      >
                        <Star className={'h-4 w-4 ' + (faved ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground')} />
                      </button>
                      </div>
                    </Fragment>
                  )
                })
              )}
              {/* 键盘提示：能力存在但没人知道，等于不存在（桌面端才显示） */}
              {(displayHits.length > 0 || pluginItems.length > 0 || matchedPaletteFavorites.length > 0 || matchedPaletteActions.length > 0 || matchedPaletteTools.length > 0) && (
                <div className="hidden sm:flex sm:pointer-coarse:hidden items-center gap-3 border-t border-border/60 bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
                  <PaletteFooterHint />
                </div>
              )}
              {showResults && displayHits.length > 0 && hasMore && (
                <div className="p-2 border-t">
                  <button
                    className="w-full text-xs py-2 rounded-md bg-muted hover:bg-accent text-muted-foreground transition-colors disabled:opacity-50"
                    onClick={loadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore
                      ? '加载中…'
                      : moreFailed
                        ? `再试一次（已显示 ${displayHits.length} 条）`
                        : `加载更多（已显示 ${displayHits.length} 条）`}
                  </button>
                  {moreFailed && (
                    <p className="pt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                      下一页没加载成功（请求失败，不是没有更多了）。已显示的 {displayHits.length} 条仍然可用，点上面按钮可再试。
                    </p>
                  )}
                </div>
              )}
              {showResults && query.trim() && prunedRecall.count > 0 && (
                <div
                  data-search-penetration-recall=""
                  className="border-t border-amber-500/30 bg-amber-500/10 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-medium min-w-0">
                    <span>
                      🔍 在您已删减的功能/分类中匹配到 {prunedRecall.count} 个结果
                      {prunedRecall.titles.length > 0
                        ? `（${prunedRecall.titles.slice(0, 2).join('、')}）`
                        : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        featureMask.setBypassMaskTemporarily(true)
                        setIsFocused(false)
                        toast({
                          title: '👁️ 已开启完整版临时透视',
                          description: '已临时展现所有已删减分类与站点，您的精简掩码配置未丢失。',
                        })
                      }}
                      className="px-2 py-0.5 rounded-md bg-background/80 hover:bg-background text-foreground border border-border/70 text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      点击临时查看
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        for (const item of prunedRecall.matchedTrashItems) {
                          featureMask.restoreFeature(item.id)
                          if (item.level === 'L2_CATEGORY') {
                            unhideCategory(stripFeaturePrefix(item.id))
                          }
                        }
                        for (const siteId of prunedRecall.matchedPrunedSiteIds) {
                          featureMask.restoreFeature(`site:${siteId}`)
                        }
                        toast({
                          title: `✨ 已恢复 ${prunedRecall.count} 项已删减的功能/站点`,
                          description: '对应模块与站点已无损还原至原位。',
                        })
                      }}
                      className="px-2 py-0.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-[11px] font-semibold transition-opacity cursor-pointer"
                    >
                      一键恢复
                    </button>
                  </div>
                </div>
              )}
              {showResults && query.trim() && displayHits.length > 0 && (
                <div className="border-t border-border/60 bg-muted/10 px-2 py-1.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <ExternalLink className="h-3 w-3 text-primary shrink-0" />
                      <span>全网搜索：</span>
                    </span>
                    <a
                      href={safeHref(`https://www.google.com/search?q=${encodeURIComponent(query.trim())}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setIsFocused(false)}
                      className="px-1.5 py-0.5 rounded text-[11px] bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20 font-medium"
                    >
                      Google
                    </a>
                    <a
                      href={safeHref(`https://github.com/search?q=${encodeURIComponent(query.trim())}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setIsFocused(false)}
                      className="px-1.5 py-0.5 rounded text-[11px] bg-neutral-500/10 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-500/20 font-medium"
                    >
                      GitHub
                    </a>
                    <a
                      href={safeHref(`https://www.baidu.com/s?wd=${encodeURIComponent(query.trim())}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setIsFocused(false)}
                      className="px-1.5 py-0.5 rounded text-[11px] bg-rose-500/10 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 font-medium"
                    >
                      百度
                    </a>
                    <a
                      href={safeHref(`https://www.bing.com/search?q=${encodeURIComponent(query.trim())}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setIsFocused(false)}
                      className="px-1.5 py-0.5 rounded text-[11px] bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 hover:bg-cyan-500/20 font-medium"
                    >
                      Bing
                    </a>
                  </div>
                  <Link
                    href={searchHref({ q: query })}
                    onClick={() => setIsFocused(false)}
                    className="flex items-center justify-center gap-1 rounded-md py-1 text-xs text-primary/90 transition-colors hover:bg-primary/5 hover:text-primary shrink-0"
                  >
                    查看全部结果
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                </div>
              )}
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  )
}
