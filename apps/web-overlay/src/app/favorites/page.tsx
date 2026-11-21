'use client'

/**
 * 我的收藏页。
 * v1：localStorage 优先（未登录可用）；登录后自动尝试云端同步
 * （同步失败只提示，不影响本地数据）。
 */

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { safeHref } from '@/lib/safe-url'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { FavoriteButton } from '@/components/favorite-button'
import { SiteFavicon } from '@/components/site-favicon'
import { cn } from '@/lib/utils'
import {
  readSyncStatus,
  syncFavoritesToCloud,
  useFavorites,
  type CloudSyncResult,
  type FavoritesSyncStatus,
  type LocalFavorite,
} from '@/hooks/useFavorites'
import { useFavoritesFolderManager } from '@/hooks/use-favorites-folder-manager'
import { SmartCollectionsPanel } from '@/components/smart-collections-panel'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { LOCAL_FOLDERS_STORAGE_KEY, parseLocalFolders, serializeLocalFolders, type LocalFolder } from '@/lib/favorites-folders'
import { buildFavoritesSearch, parseFavoritesFilters, type FavoritesSort, type FavoritesView } from '@/lib/favorites-url'
import {
  favoritesToVaultItems,
  formatVaultRestoreNotice,
  vaultExportFilename,
  vaultItemsToFavorites,
} from '@/lib/favorites-vault'
import {
  findQuicklinkPrefixConflict,
  normalizeQuicklinkPrefix,
  quicklinkFromFavorite,
  validateQuicklink,
  type QuicklinkEntry,
} from '@/lib/quicklinks'
import { describeAnonymousFavoritesNote, describeSyncBanner, shouldOfferRetry, type SyncBannerInput } from '@/lib/favorites-sync-copy'
import { FavoritesSyncBadge } from '@/components/favorites/favorites-sync-badge'
import { FavoriteSyncDot, favoriteSyncRing } from '@/components/favorites/favorite-sync-dot'
import { deriveBadgeState, type SyncEngineSnapshot } from '@/lib/favorites-sync'
import { ConflictDrawer } from '@/components/favorites/conflict-drawer'
import { useFavoritesSyncBridge } from '@/hooks/useFavoritesSyncBridge'
import { createFavoritesSyncEngine, type FavoritesSyncEngine } from '@/lib/favorites-sync-engine'
import { createFavoritesPush } from '@/lib/favorites-sync-adapter'
import {
  filterFavorites,
  filterByTriage,
  sortFavorites,
  describeFavoritesFilter,
  favoriteFilterEmptyMessage,
} from '@/lib/favorites-filter'
import {
  describeTriage,
  resolveTriageStatus,
  selectInboxDueSoon,
  triageBadgeLabel,
  triageMsLeft,
} from '@/lib/favorites-triage'
import { readShelvedFavorites } from '@/lib/favorites-shelved'
import {
  HIBERNATION_RENDER_LIMIT,
  HIBERNATION_UPDATED_EVENT,
  describeHibernation,
  hibernationBadgeLabel,
  hibernationReason,
  hibernationSectionTitle,
  manualHibernatedSet,
  partitionFavorites,
  readManualHibernated,
  type ManualHibernatedItem,
} from '@/lib/favorites-hibernation'
import { useTriageSettings } from '@/hooks/useTriageSettings'
import { useHibernationSettings } from '@/hooks/useHibernationSettings'
import { recordCustomSiteAddedAction, recordGrowthEvent } from '@/lib/growth-lazy'
import { toast } from '@/components/ui/use-toast'
import {
  FavoritesManualAddModal,
  FavoritesQuickStartEmpty,
} from '@/components/user-center/favorites-quickstart'
import { TriageInboxRow } from '@/components/triage-inbox-row'
import { HibernationRow } from '@/components/hibernation-row'
import {
  MEANING_SEARCH_POOL_LIMIT,
  describeMeaningReadyLine,
  describeMeaningResults,
  favoriteMeaningEmptyMessage,
  nextSemanticSearchStatus,
  rankSavesByMeaning,
  saveMatchReasonLabel,
  semanticSiteScores,
  type RankedSave,
  type SaveMatchReason,
  type SaveSearchMode,
  type SemanticSaveStatus,
} from '@/lib/favorites-semantic-search'
import { useMergedVisits } from '@/lib/resurface-visits'
import { describeResurfaced, daysSinceOpen, latestVisitsById, selectStaleFavorites, staleBadgeLabel } from '@/lib/resurface'
import { encryptVault, decryptVault, type EncryptedVaultPayload } from '@/lib/vault'
import { UserCenterNav } from '@/components/user-center/user-center-nav'
import { StarredPluginsSection } from './starred-plugins-section'
import {
  clearCloudFavorites,
  searchSites,
  updateFavoriteMeta,
  type HubFavoriteFolder,
} from '@/lib/navhub-api'
import {
  Shield, KeyRound, CheckCircle2, AlertTriangle,
  RefreshCw, CloudOff, Search, X, Package, Folder, FolderPlus, Pencil, Trash2, Check, LogIn, ChevronUp, ChevronDown, Tag,
  Download, FileUp, CheckSquare, Square, Layers, Zap, Inbox, Link2, Moon, Sun,
} from 'lucide-react'
import {
  exportFavoritesToHtml,
  exportFavoritesToMarkdown,
  triggerFileDownload,
  type ParsedUniversalItem,
} from '@/lib/favorites-export-import'
import { LINK_PACK_MAX_ITEMS } from '@/lib/link-pack'
import { useBatchKeyboard } from '@/hooks/use-batch-keyboard'
import { resolveBatchKeyboardAction } from '@/lib/batch-keyboard'
import {
  isAnyDialogOpen,
  isAnyMenuOpen,
  isDragHandleFocused,
  isEventTargetTyping,
} from '@/lib/keyboard-guards'
import { pruneSelected } from '@/lib/selection'
import { buildCompareHref } from '@/lib/compare'
import dynamic from 'next/dynamic'

// 两个面板都只在用户点开时才需要：金库导入/导出、插件包导出向导。
// 静态引入会把它们连同依赖拉进 /favorites 的首屏 chunk（首屏预算已超 5 KB）。
const FavoritesVaultPanels = dynamic(
  () => import('@/components/user-center/favorites-vault-panels').then((m) => m.FavoritesVaultPanels),
  { ssr: false },
)
const ExportPluginModal = dynamic(
  () => import('@/components/plugins/export-plugin-modal').then((m) => m.ExportPluginModal),
  { ssr: false },
)
const UniversalBookmarkModal = dynamic(
  () => import('@/components/user-center/universal-bookmark-modal').then((m) => m.UniversalBookmarkModal),
  { ssr: false },
)
// 链接包对话框只在用户点「打包成链接包」时才需要：同款动态引入，不进 /favorites 首屏 chunk。
const LinkPackDialog = dynamic(
  () => import('@/components/link-pack-dialog').then((m) => m.LinkPackDialog),
  { ssr: false },
)
// 公开导航页管理区只在登录态有实际作用：同样动态引入，不进首屏 chunk。
const PublicPageManager = dynamic(
  () => import('@/components/public-page-manager').then((m) => m.default),
  { ssr: false },
)

/**
 * 本地收藏夹的存储键（P2）。
 *
 * 刻意新开一个键而不是塞进 `navhub.favorites.v1`：那个键的结构被注释明示
 * "改了等于丢老用户收藏"，而收藏夹是衍生数据，分开存才能在出问题时只丢分组、
 * 不丢收藏。登录后云端夹子成为事实源，这个键会被清空。
 */
const LOCAL_FOLDERS_KEY = LOCAL_FOLDERS_STORAGE_KEY

function readLocalFolders(): LocalFolder[] {
  try {
    return parseLocalFolders(window.localStorage.getItem(LOCAL_FOLDERS_KEY))
  } catch {
    return []
  }
}

function writeLocalFolders(folders: LocalFolder[]): void {
  try {
    window.localStorage.setItem(LOCAL_FOLDERS_KEY, serializeLocalFolders(folders))
  } catch {
    // 写不进去只丢分组能力，不影响收藏本身
  }
}

export default function FavoritesPage() {
  const router = useRouter()
  const favorites = useFavorites()
  // 身份就绪（N1）：不再在挂载时读一次 localStorage，登录/合并/退出都会自动重取
  const identityReady = useIdentityReady()
  // 登录态（与接力卡云端同步同款判定）：只有登录用户才取云端 visits；
  // 匿名用户不发任何云端请求，行为与接线前一致。
  const isLoggedIn =
    identityReady.ready && !identityReady.isAnonymous && !!identityReady.identity
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<'success' | 'error' | 'info'>('info')
  const [showPluginExport, setShowPluginExport] = useState(false)
  // 云端同步是一条会失败的链路，必须有独立状态：同步失败时用户最需要的
  // 是「收藏还在本机，换设备看不到」这个事实，而不是一片沉默。
  const [cloudResult, setCloudResult] = useState<CloudSyncResult | null>(null)
  const [syncingCloud, setSyncingCloud] = useState(false)
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [showUniversalImport, setShowUniversalImport] = useState(false)
  const [showManualAdd, setShowManualAdd] = useState(false)
  const [showCryptoHint, setShowCryptoHint] = useState(false)
  const [showLinkPack, setShowLinkPack] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedSiteIds, setSelectedSiteIds] = useState<Set<string>>(new Set())
  const [batchFolderTarget, setBatchFolderTarget] = useState<string>('')
  // 本页收藏的本地筛选（不联网）：收藏攒到几十个以后，「用眼睛扫网格」不是一种检索方式
  const [favoriteQuery, setFavoriteQuery] = useState('')
  // 「按意思搜」：复用中枢语义通道（mode=semantic）与本地收藏求交，再叠
  // 加本地全文匹配（备注/标签是中枢不知道的文本）。不传身份：这是本地
  // 收藏的筛选，不该因为一次筛选就把查询写进服务端的搜索历史。
  const [saveSearchMode, setSaveSearchMode] = useState<SaveSearchMode>('keyword')
  const [meaningStatus, setMeaningStatus] = useState<SemanticSaveStatus>('idle')
  const [meaningMatches, setMeaningMatches] = useState<RankedSave<LocalFavorite>[] | null>(null)
  const [meaningRetryToken, setMeaningRetryToken] = useState(0)
  // 已落定的语义状态（loading 不进这里）：状态机的输入必须是「上一次落定
  // 的状态」，否则每次 loading 都会把「重试仍不可用」误判成首次准备中。
  const meaningSettledRef = useRef<SemanticSaveStatus>('idle')
  const meaningQuery = saveSearchMode === 'meaning' ? favoriteQuery.trim() : ''
  // 收藏管理（云端文件夹 / 备注）：只在登录身份下出现
  const [cloudIdentity, setCloudIdentity] = useState('')
  // 清空云端收藏是两步确认：第一次点击只把按钮变成「再次点击确认」
  const [confirmClearCloud, setConfirmClearCloud] = useState(false)
  const [folders, setFolders] = useState<HubFavoriteFolder[]>([])
  // 本地收藏夹（P2）：匿名期与离线时的分组来源；登录同步成功后迁移到云端并清空
  const [localFolders, setLocalFolders] = useState<LocalFolder[]>(() =>
    typeof window === 'undefined' ? [] : readLocalFolders(),
  )
  const [activeFolder, setActiveFolder] = useState<string>('all')
  /** 工作区 Tab（?view= 同步）：站点收藏 / 星标插件 / 我的批注 / 公开导航页 */
  const [activeView, setActiveView] = useState<FavoritesView>('sites')
  /** 星标插件计数（Tab 角标用）：StarredPluginsSection 取数后回传 */
  const [starredCount, setStarredCount] = useState(0)
  const [starredCountLoaded, setStarredCountLoaded] = useState(false)
  const [noteEditor, setNoteEditor] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  // 标签编辑器（T22）：逗号分隔输入，保存时归一（≤8 个、各 ≤24 字符）
  const [tagEditor, setTagEditor] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  // 快捷链接编辑器：前缀 + 搜索模板（{q} 占位），复用备注/标签编辑器模式
  // （state + 保存走 favorites.updateMeta）。v1 必须先收藏再挂模板。
  const [quicklinkEditor, setQuicklinkEditor] = useState<string | null>(null)
  const [quickPrefixDraft, setQuickPrefixDraft] = useState('')
  const [quickTemplateDraft, setQuickTemplateDraft] = useState('')
  const [quicklinkError, setQuicklinkError] = useState<string | null>(null)
  const [manageBusy, setManageBusy] = useState(false)
  // 排序与渐进渲染（N8）：收藏上千条时「一屏渲染全部」会让首屏明显变慢，
  // 这里先排好序，再只渲染前若干条，其余按需加载。
  const [sortBy, setSortBy] = useState<FavoritesSort>('created')
  const [visibleCount, setVisibleCount] = useState(60)
  // 待读分流：状态筛选（与收藏夹筛选正交，可叠加）；默认视图不变，永久库仍是默认落点
  const [triageFilter, setTriageFilter] = useState<'all' | 'inbox' | 'read' | 'permanent'>('all')
  const triageSettings = useTriageSettings()
  const [shelvedCount, setShelvedCount] = useState<number>(() =>
    typeof window === 'undefined' ? 0 : readShelvedFavorites().length,
  )
  const [triageBannerDismissed, setTriageBannerDismissed] = useState(false)
  useEffect(() => {
    const refresh = () => setShelvedCount(readShelvedFavorites().length)
    refresh()
    window.addEventListener('navhub_shelved_updated', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('navhub_shelved_updated', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  // 冬眠收藏：手动冬眠集合（本机键）+ 冬眠区折叠态；订阅手动集合变更事件刷新。
  // 偏好（开关 / 阈值）走 useHibernationSettings 的 live 快照，与待读分流同款纪律。
  const hibernationSettings = useHibernationSettings()
  const [manualHibernated, setManualHibernated] = useState<ManualHibernatedItem[]>(() =>
    typeof window === 'undefined' ? [] : readManualHibernated(),
  )
  const [hibernationOpen, setHibernationOpen] = useState(false)
  useEffect(() => {
    const refresh = () => setManualHibernated(readManualHibernated())
    refresh()
    window.addEventListener(HIBERNATION_UPDATED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(HIBERNATION_UPDATED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  // 「好久没打开」的徽标与横幅：本机离线最近访问 + 登录用户的云端 visits
  // 合并后算旧（见 lib/resurface-visits；云端取不到时回落本机-only）；
  // 匿名用户只按本机算。读不到时按收藏时间算，不阻断收藏列表本身。
  const { visits: recentVisits } = useMergedVisits(isLoggedIn)
  const staleById = useMemo(() => {
    if (favorites.items.length === 0) return new Map<string, ReturnType<typeof selectStaleFavorites>[number]>()
    return new Map(selectStaleFavorites(favorites.items, recentVisits, Date.now()).map((s) => [s.siteId, s]))
  }, [favorites.items, recentVisits])
  /**
   * 冬眠徽标快查（所有视图共用，不只分区态）：有关键词 / 夹 / 状态筛选时分区
   * 不生效，但冬眠条目仍挂「冬眠中」徽标，用户才知道它为什么平时沉在底下。
   * 原因 / 天数 / 说明一次算好，卡片渲染期不再重算。
   */
  const hibernatingById = useMemo(() => {
    const map = new Map<string, { reason: 'manual' | 'auto'; days: number; description: string }>()
    if (favorites.items.length === 0) return map
    const now = Date.now()
    const visitsById = latestVisitsById(recentVisits)
    const manual = manualHibernatedSet(manualHibernated)
    for (const f of favorites.items) {
      const reason = hibernationReason(f, visitsById, hibernationSettings, manual, now)
      if (!reason) continue
      map.set(f.siteId, {
        reason,
        days: daysSinceOpen(f, visitsById, now),
        description: describeHibernation(f, visitsById, hibernationSettings, manual, now, isLoggedIn),
      })
    }
    return map
  }, [favorites.items, recentVisits, hibernationSettings, manualHibernated])
  /** 已挂模板的收藏（前缀冲突检查与卡片徽标共用；模板非法的进不来） */
  const quicklinkEntries = useMemo(
    () =>
      favorites.items
        .map((f) => quicklinkFromFavorite(f))
        .filter((e): e is QuicklinkEntry => e !== null),
    [favorites.items],
  )
  /**
   * 筛选条件同步到地址栏。
   *
   * 只在挂载后读一次 URL（避免 SSR/CSR 首帧不一致），之后每次变化 replaceState：
   * 不触发服务端导航，但返回、刷新、复制链接都能还原同一视图。
   */
  const [filtersReady, setFiltersReady] = useState(false)
  useEffect(() => {
    const syncFromUrl = () => {
      const parsed = parseFavoritesFilters(window.location.search)
      setFavoriteQuery(parsed.q)
      setActiveFolder(parsed.folder)
      setSortBy(parsed.sort)
      setActiveView(parsed.view)
    }
    syncFromUrl()
    setFiltersReady(true)
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [])

  useEffect(() => {
    if (!filtersReady) return
    const next =
      window.location.pathname +
      buildFavoritesSearch({
        q: favoriteQuery,
        folder: activeFolder,
        sort: sortBy,
        view: activeView,
      }) +
      window.location.hash
    const current = window.location.pathname + window.location.search + window.location.hash
    if (next !== current) window.history.replaceState(window.history.state, '', next)
  }, [filtersReady, favoriteQuery, activeFolder, sortBy, activeView])

  /** 按意思搜的查询生效中（有查询词且已拿到排序结果） */
  const meaningActive = saveSearchMode === 'meaning' && meaningQuery !== '' && meaningMatches !== null

  /**
   * 按意思搜：一次语义请求 + 本地全文匹配。
   *
   * 250ms 防抖 + AbortController：输入过程不刷请求，过期响应直接丢弃。
   * 语义不可用（模型首次下载中 / 未配置 / 中枢不可达）时不静默降级：
   * 状态机先报 preparing（「正在准备语义搜索」+ 重试），重试仍不可用
   * 才报 unavailable；两种状态下本地全文匹配都已算好并如实标注来源。
   */
  useEffect(() => {
    if (saveSearchMode !== 'meaning') {
      setMeaningMatches(null)
      setMeaningStatus('idle')
      meaningSettledRef.current = 'idle'
      return
    }
    if (meaningQuery === '' || !favorites.ready) {
      setMeaningMatches(null)
      return
    }
    const controller = new AbortController()
    setMeaningStatus('loading')
    const timer = setTimeout(() => {
      void searchSites(
        { q: meaningQuery, mode: 'semantic', limit: MEANING_SEARCH_POOL_LIMIT },
        controller.signal,
      )
        .then((res) => {
          if (controller.signal.aborted) return
          const next = nextSemanticSearchStatus(meaningSettledRef.current, res.semanticAvailable === true)
          meaningSettledRef.current = next
          setMeaningStatus(next)
          setMeaningMatches(rankSavesByMeaning(favorites.items, meaningQuery, semanticSiteScores(res.hits)))
        })
        .catch(() => {
          if (controller.signal.aborted) return
          // searchSites 自身失败只剩 AbortError 会走到这里（其余失败已折成
          // degraded 兜底值）：按语义不可用处理，本地全文兜底仍在。
          const next = nextSemanticSearchStatus(meaningSettledRef.current, false)
          meaningSettledRef.current = next
          setMeaningStatus(next)
          setMeaningMatches(rankSavesByMeaning(favorites.items, meaningQuery, new Map()))
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [saveSearchMode, meaningQuery, favorites.ready, favorites.items, meaningRetryToken])

  /** 只过滤本页已加载的收藏；空关键词原样返回，不做无谓的重渲染 */
  const filteredFavorites = useMemo(
    () =>
      meaningActive && meaningMatches
        ? meaningMatches.map((match) => match.item)
        : filterFavorites(favorites.items, favoriteQuery),
    [meaningActive, meaningMatches, favorites.items, favoriteQuery],
  )
  /** 按意思搜时每条收藏的匹配来源（卡片上的「语义匹配 / 备注匹配…」标签用） */
  const meaningReasonBySiteId = useMemo(() => {
    const bySiteId = new Map<string, SaveMatchReason>()
    if (meaningActive && meaningMatches) {
      for (const match of meaningMatches) bySiteId.set(match.item.siteId, match.reason)
    }
    return bySiteId
  }, [meaningActive, meaningMatches])
  const visibleFavorites = useMemo(() => {
    const byFolder =
      activeFolder === 'all' ? filteredFavorites : filteredFavorites.filter((f) => (f.folderId ?? '') === activeFolder)
    // 待读状态与 folderId 正交：夹筛选之后再叠加状态过滤
    const byTriage = filterByTriage(byFolder, triageFilter)
    // 排序是纯本地操作（收藏已在内存里），不引入服务端分页——本地优先是收藏页的根基，
    // 为排序把数据源改成接口会破坏离线可用性。
    if (meaningActive) {
      // 按意思搜的顺序就是语义相关度：再按时间/标题重排会把「最像的」埋掉。
      // 仍返回一份拷贝：与旧代码一致，下游不依赖入参数组引用。
      return [...byTriage]
    }
    return sortFavorites(byTriage, sortBy)
  }, [filteredFavorites, activeFolder, sortBy, meaningActive, triageFilter])
  /**
   * 冬眠分区：只在默认浏览态（全部、无搜索、无夹筛选、无待读筛选、非按意思搜）
   * 生效——有筛选时分区不生效，搜到的冬眠条目直接显示在正常位置（只挂徽标），
   * 避免「搜到了却藏在折叠区里找不到」。开关关了同样不分区。
   * 分区只改浏览顺序：冬眠条目仍在 visibleFavorites 的数据源里，没删没移出。
   */
  const hibernationActive =
    hibernationSettings.enabled &&
    activeFolder === 'all' &&
    triageFilter === 'all' &&
    favoriteQuery.trim() === '' &&
    !meaningActive
  const hibernationPartition = useMemo(() => {
    if (!hibernationActive) return null
    return partitionFavorites(visibleFavorites, recentVisits, hibernationSettings, manualHibernated, Date.now())
  }, [hibernationActive, visibleFavorites, recentVisits, hibernationSettings, manualHibernated])
  /** 分区时的清醒列表（分页与「加载更多」都按它算）；不分区时就是全部可见收藏 */
  const awakeFavorites = hibernationPartition ? hibernationPartition.awake : visibleFavorites
  /** 冬眠区条目（默认折叠）；展开后最多渲染 HIBERNATION_RENDER_LIMIT 条 */
  const hibernatingFavorites = hibernationPartition ? hibernationPartition.hibernating : []
  const renderedHibernating = hibernatingFavorites.slice(0, HIBERNATION_RENDER_LIMIT)
  /** 渐进渲染：只渲染前 visibleCount 条，避免上千个 DOM 同时进场 */
  const renderedFavorites = awakeFavorites.slice(0, visibleCount)

  /** 选中剪枝：筛选 / 切文件夹 / 冬眠分区变化后，丢掉已经不可见的选中项
   *（否则计数虚高，批量操作会动到用户看不到的收藏）。Ctrl+A 只选清醒 +
   * 已渲染（renderedFavorites），冬眠条目不在内——口径与 handleSelectAll 一致。 */
  useEffect(() => {
    const visibleIds = renderedFavorites.map((f) => f.siteId)
    setSelectedSiteIds((prev) => {
      if (prev.size === 0) return prev
      const kept = pruneSelected([...prev], visibleIds)
      return kept.length === prev.size ? prev : new Set(kept)
    })
  }, [renderedFavorites])
  // 按意思搜进行中（loading）或尚未出结果时不显示关键词筛选的计数——
  // 那是另一套匹配规则的数字，冒充按意思的结果会误导用户。
  const filterSummary =
    saveSearchMode === 'meaning' && meaningQuery !== ''
      ? meaningMatches !== null && meaningStatus !== 'loading'
        ? describeMeaningResults(meaningMatches, favorites.items.length)
        : null
      : describeFavoritesFilter(filteredFavorites.length, favorites.items.length, favoriteQuery)

  /** 夹计数一次性算好（O(条数)），替代渲染期每个夹 filter 一遍（O(条数×夹数)） */
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of favorites.items) {
      if (!f.folderId) continue
      counts.set(f.folderId, (counts.get(f.folderId) ?? 0) + 1)
    }
    return counts
  }, [favorites.items])

  /** 待读分流计数：待读箱 / 已读 / 永久库 / 24 小时内快到期（与夹计数正交） */
  const triageCounts = useMemo(() => {
    const now = Date.now()
    let inbox = 0
    let read = 0
    let permanent = 0
    for (const f of favorites.items) {
      const status = resolveTriageStatus(f, now)
      if (status === 'inbox') inbox += 1
      else if (status === 'read') read += 1
      else permanent += 1
    }
    const dueSoon = selectInboxDueSoon(favorites.items, triageSettings, now, favorites.items.length).length
    return { inbox, read, permanent, dueSoon }
  }, [favorites.items, triageSettings])

  // 零知识 E2EE 金库状态
  const [showVaultExport, setShowVaultExport] = useState(false)
  const [showVaultImport, setShowVaultImport] = useState(false)
  const [vaultPassword, setVaultPassword] = useState('')
  const [vaultPasswordConfirm, setVaultPasswordConfirm] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [syncLast, setSyncLast] = useState<FavoritesSyncStatus | null>(null)
  const [importVaultPayload, setImportVaultPayload] = useState('')
  const [showPasswordText, setShowPasswordText] = useState(false)
  const [vaultLoading, setVaultLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 登录用户：进页面时尝试把本地收藏合并到云端
  const runCloudSync = useCallback(async (): Promise<CloudSyncResult> => {
    setSyncingCloud(true)
    const result = await syncFavoritesToCloud()
    setCloudResult(result)
    setSyncingCloud(false)
    return result
  }, [])

  /**
   * 云端结果落地：文件夹列表 + 本地成员集合整体替换。
   * 首挂载与「重试同步」必须走同一条路径——否则重试成功后界面仍显示旧数据，
   * 用户只能手动刷新（历史缺陷：重试按钮只更新了 cloudResult）。
   */
  const applyCloudResult = useCallback(
    (result: CloudSyncResult) => {
      // nextItems 由 syncFavoritesToCloud 按「全量=覆盖 / 增量=逐行 upsert」算好：
      // 页面层不再自己跑 mergeCloudFavorites——增量结果做全量合并会删掉本地未推送的条目。
      if (!result.ok || !result.cloud || !result.cloudFolders || !result.nextItems) return false
      setFolders(result.cloudFolders)
      favorites.replaceAll(result.nextItems)
      // 墓碑来自另一台设备的删除：必须说出来，否则用户会以为本地数据「自己消失」
      if (result.remoteRemoved > 0) {
        setSyncNote(`另一台设备删除了 ${result.remoteRemoved} 条收藏，已与云端保持一致`)
        setSyncStatus('success')
      }
      return true
    },
    [favorites],
  )

  // 同步状态条的输入与文案（纯函数在 lib/favorites-sync-copy）。
  // 这里显式映射而不是直接传 cloudResult：CloudSyncResult 的云端条数在 cloud 数组里，
  // 直接传会把「cloud 为 null（没同步成功）」误读成「云端 0 条」。
  /**
   * 同步徽标快照（2026-11-21）。
   *
   * 这是 Header 徽标 / 卡片微点 / 冲突抽屉共享的**唯一真相**。
   * 当前阶段先接已有状态（登录态 + 在线 + 同步中 + 错误文案），
   * Outbox 计数与冲突集合由后续接入 IndexedDB 队列时补齐——
   * 未接时 pendingCount/冲突恒为 0，不影响现有行为。
   */
  /**
   * 同步引擎实例与桥接（2026-11-21）。
   *
   * 引擎负责 Outbox 排队、退避重试、冲突检测；
   * bridge 用快照差异把收藏变化喂给它，不侵入 useFavorites 内部。
   */
  const syncEngineRef = useRef<FavoritesSyncEngine | null>(null)
  /** 是否有已勾选但未确认的冲突选择——仅这种情况才做离开提醒 */
  const [hasUnconfirmedConflict, setHasUnconfirmedConflict] = useState(false)
  if (syncEngineRef.current === null && typeof window !== 'undefined') {
    const sinceRef = { v: 0 }
    syncEngineRef.current = createFavoritesSyncEngine({
      // 登录态判定与页面其余处同口径（identityReady 来自 useIdentityReady）
      isAuthed: () => identityReady.ready && !identityReady.isAnonymous && !!identityReady.identity,
      push: createFavoritesPush({
        getSince: () => sinceRef.v,
        setSince: (v) => { sinceRef.v = v },
        applyRemote: (payload) => {
          // 远端增量（含墓碑）由 useFavorites 的既有合并链路消费；
          // 这里只记录 version，实际条目合并交给 syncFavoritesToCloud
          void payload
        },
      }),
    })
  }
  /** 引擎快照：由 onChange 回调驱动，不轮询（轮询会让徽标延迟且浪费帧） */
  const [engineSnapshot, setEngineSnapshot] = useState<SyncEngineSnapshot | null>(null)
  useEffect(() => {
    const engine = syncEngineRef.current
    if (!engine) return
    engine.start()
    setEngineSnapshot(engine.snapshot())
    return () => engine.stop()
  }, [])

  // 2026-11-21：收藏变化 → Outbox 桥接（纯观察，不侵入 useFavorites）
  useFavoritesSyncBridge(favorites.items, syncEngineRef.current, favorites.ready)

  /**
   * 离开提醒只在**有未确认的冲突裁决选择**时生效。
   *
   * Local-First 下同步中/待同步都不该拦截离开——IndexedDB 事务已提交，
   * 关掉标签页数据 100% 安全，下次打开自动续传 Outbox。
   * 唯一例外是用户打开了冲突抽屉、看了但没点确认，那是未提交的 UI 决策。
   */
  useEffect(() => {
    if (!hasUnconfirmedConflict) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnconfirmedConflict])

  /** 冲突裁决抽屉是否打开（2026-11-21） */
  const [showConflictDrawer, setShowConflictDrawer] = useState(false)

  /**
   * 优先用引擎快照（含真实 Outbox 计数与冲突集合）；
   * 引擎尚未初始化完成时回退到手工构造的保守快照，避免徽标闪空。
   */
  const fallbackSnapshot: SyncEngineSnapshot = {
    badgeState: deriveBadgeState({
      // 登录态判定与页面其余处同口径：identityReady 是对象，不是布尔
      isAuthed: identityReady.ready && !identityReady.isAnonymous && !!identityReady.identity,
      isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
      pendingCount: 0,
      conflictCount: 0,
      isSyncing: syncingCloud,
      error: syncStatus === 'error' ? { kind: 'server_5xx', message: syncNote ?? '', canAutoRetry: true } : null,
    }),
    isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
    pendingCount: 0,
    dirtyItemIds: new Set<string>(),
    conflictItemIds: new Set<string>(),
    conflicts: [],
    lastSyncedAtMs: null,
    nextRetryAtMs: null,
    ...(syncStatus === 'error'
      ? { error: { kind: 'server_5xx' as const, message: syncNote ?? '', canAutoRetry: true } }
      : {}),
  }

  const syncSnapshot: SyncEngineSnapshot = engineSnapshot ?? fallbackSnapshot

  const syncBannerInput: SyncBannerInput | null = syncingCloud
    ? { syncing: true }
    : cloudResult
      ? {
          ok: cloudResult.ok,
          pushed: cloudResult.pushed,
          cloudCount: cloudResult.cloud ? cloudResult.cloud.length : null,
          remoteRemoved: cloudResult.remoteRemoved,
          error: cloudResult.error,
          retryable: cloudResult.retryable,
        }
      : null
  const syncBanner = describeSyncBanner(syncBannerInput)

  // B15：匿名收藏只活在本机。判定与上面「确认匿名」的效果同款（无身份或 anon- 前缀），
  // 且必须等 identityReady.ready——否则登录用户在会话同步完成前会闪一下这条提示。
  // 登录用户不触发云端同步失败时 syncBanner 为 hidden，这条提示是匿名态唯一的同步风险说明。
  // 合并 3 处重复警告（任务 52）：全页只保留这一条，可关闭（仅本次会话，刷新复现）。
  const [anonymousNoteDismissed, setAnonymousNoteDismissed] = useState(false)
  const showAnonymousNote =
    !anonymousNoteDismissed &&
    identityReady.ready && (!identityReady.identity || identityReady.identity.startsWith('anon-'))

  useEffect(() => {
    setSyncLast(readSyncStatus())
  }, [])

  // 本地收藏夹落盘：与收藏本体同生命周期，但独立键
  useEffect(() => {
    writeLocalFolders(localFolders)
  }, [localFolders])

  // 筛选 / 排序 / 收藏夹变化时回到首屏窗口：否则沿用旧窗口会让新筛选看起来「少了内容」
  useEffect(() => {
    setVisibleCount(60)
  }, [favoriteQuery, activeFolder, sortBy])

  useEffect(() => {
    // 两个就绪条件缺一不可：本地收藏读完（favorites.ready）+ 会话同步完成（N1）。
    // 只看 favorites.ready 会在「刚登录、userId 尚未写入」时把页面按匿名渲染，
    // 且不再重试——首次登录直接进本页就永远不同步。
    if (!favorites.ready || !identityReady.ready) return
    const identity = identityReady.identity
    if (!identity || identity.startsWith('anon-')) {
      // 退出登录 / 确认匿名：撤掉云端管理区，保留本地收藏
      setCloudIdentity('')
      return
    }
    setCloudIdentity(identity)
    void (async () => {
      const result = await runCloudSync()
      applyCloudResult(result)
      // 云端夹子已成为事实源：把本机分组按名称合并上去（P2）
      if (result.ok && result.cloudFolders && result.nextItems) {
        await migrateLocalFolders(result.cloudFolders, result.nextItems)
      }
    })()
  }, [runCloudSync, favorites.ready, identityReady.ready, identityReady.identity])

  /**
   * 当前生效的收藏夹列表（P2）。
   *
   * 登录态 = 云端夹子（事实源）；匿名态 = 本地夹子。两者形状对齐到 {id,name}，
   * 渲染层不关心来源——这是"匿名也能分组"能成立的关键：不是给匿名用户另做一套 UI，
   * 而是让同一套 UI 有两个数据源。
   */
  // 夹子管理（T14 拆分）：CRUD/重排/迁移逻辑在 hooks/use-favorites-folder-manager
  const folderManager = useFavoritesFolderManager({
    cloudIdentity,
    folders,
    setFolders,
    localFolders,
    setLocalFolders,
    activeFolder,
    setActiveFolder,
    favorites,
    report: (note, status) => {
      setSyncNote(note)
      setSyncStatus(status)
    },
  })
  const { newFolderName, setNewFolderName, folderBusy, editingFolder, setEditingFolder, editingName, setEditingName, addFolder, createFolderDirectly, saveFolderName, removeFolder, moveFolder, migrateLocalFolders } = folderManager

  const visibleFolders = useMemo<Array<{ id: string; name: string }>>(
    () => (cloudIdentity ? folders : localFolders),
    [cloudIdentity, folders, localFolders],
  )

  /**
   * 清空云端收藏（N3 接线）：两步确认，成功后连本地缓存一起清掉。
   * 只清云端不清本地会留下「本地还有、云端没了」的分裂状态，下次同步又会推回去。
   * D7：两步确认保留，但确认后同样进撤销条 + 回收站——清空前把夹子列表
   * 快照下来，撤销时连夹子一起恢复回来。夹子快照走 prepareClearRestore
   * 登记（与 clear() 之间没有 await），clear() 本身保持无参调用——
   * identity-ready 守卫把这条接线钉死为 `favorites.clear()`。
   */
  const clearCloud = useCallback(async () => {
    if (!cloudIdentity || manageBusy) return
    if (!confirmClearCloud) {
      setConfirmClearCloud(true)
      return
    }
    setConfirmClearCloud(false)
    setManageBusy(true)
    const ok = await clearCloudFavorites(cloudIdentity)
    setManageBusy(false)
    if (!ok) {
      setSyncNote('清空云端收藏失败：云端暂不可用，本地收藏未受影响')
      setSyncStatus('error')
      return
    }
    const restoreFolders = (restored: HubFavoriteFolder[]) => setFolders(restored)
    favorites.prepareClearRestore(folders, restoreFolders)
    favorites.clear()
    setFolders([])
    setActiveFolder('all')
    setSyncNote('云端收藏已清空，本机缓存也已清除')
    setSyncStatus('success')
  }, [cloudIdentity, confirmClearCloud, favorites, folders, manageBusy])

  const assignFolder = useCallback(async (siteId: string, folderId: string | null) => {
    const targetFolder = visibleFolders.find((f) => f.id === folderId)
    const targetName = targetFolder ? targetFolder.name : '未分组'
    favorites.updateMeta(siteId, { folderId }, {
      undoLabel: `已将 1 条收藏移至「${targetName}」`,
      undoDetail: targetName,
    })
    if (!cloudIdentity) return
    setManageBusy(true)
    const ok = await updateFavoriteMeta(cloudIdentity, siteId, { folderId })
    setManageBusy(false)
    if (!ok) {
      setSyncNote('移动收藏失败：云端暂不可用，已在本机保留位置')
      setSyncStatus('error')
    }
  }, [cloudIdentity, favorites])

  const saveNote = useCallback(async (siteId: string) => {
    const note = noteDraft.trim() || null
    favorites.updateMeta(siteId, { note })
    setNoteEditor(null)
    if (!cloudIdentity) return
    setManageBusy(true)
    const ok = await updateFavoriteMeta(cloudIdentity, siteId, { note })
    setManageBusy(false)
    if (!ok) {
      setSyncNote('保存备注失败：云端暂不可用，已保存在本机')
      setSyncStatus('error')
    }
  }, [cloudIdentity, favorites, noteDraft])

  /** 保存标签（T22）：逗号/空格分隔输入 → 归一 → 本机 + 云端（失败申报） */
  const saveTags = useCallback(async (siteId: string) => {
    const tags = tagDraft
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((t) => t.slice(0, 24))
    const deduped = [...new Set(tags)]
    favorites.updateMeta(siteId, { tags: deduped.length > 0 ? deduped : null })
    setTagEditor(null)
    if (!cloudIdentity) return
    setManageBusy(true)
    const ok = await updateFavoriteMeta(cloudIdentity, siteId, { tags: deduped.length > 0 ? deduped : null })
    setManageBusy(false)
    if (!ok) {
      setSyncNote('保存标签失败：云端暂不可用，已保存在本机')
      setSyncStatus('error')
    }
  }, [cloudIdentity, favorites, tagDraft])

  /**
   * 保存快捷链接：创建时全量校验（validateQuicklink），不过就地报错、
   * 不写盘。v1 本地 only：不推云端（FavoriteSyncOp 与服务端 zod 没有
   * 这两个字段），也不发 updateFavoriteMeta——云端没有消费方。
   * 前缀冲突只警告不拦截：触发时用户 quicklink 优先于内置引擎。
   */
  const saveQuicklink = useCallback((siteId: string) => {
    const checked = validateQuicklink({ prefix: quickPrefixDraft, templateUrl: quickTemplateDraft })
    if (!checked.ok) {
      setQuicklinkError(checked.message)
      return
    }
    favorites.updateMeta(siteId, { quickPrefix: checked.prefix, templateUrl: checked.templateUrl })
    setQuicklinkEditor(null)
    setQuicklinkError(null)
  }, [favorites, quickPrefixDraft, quickTemplateDraft])

  /** 清除快捷链接：两个字段一起清（null = 清除），只动本机 */
  const clearQuicklink = useCallback((siteId: string) => {
    favorites.updateMeta(siteId, { quickPrefix: null, templateUrl: null })
    setQuicklinkEditor(null)
    setQuicklinkError(null)
  }, [favorites])

  const handleExportPlain = () => {
    const blob = new Blob([favorites.exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'navhub-favorites.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  // 一键将收藏导出为标准网址包插件清单向导 (site-pack)
  const handleExportAsPlugin = () => {
    setShowPluginExport(true)
  }

  // 一键导出为浏览器标准 Netscape Bookmarks HTML
  const handleExportHtml = () => {
    if (favorites.items.length === 0) return
    const html = exportFavoritesToHtml(favorites.items, visibleFolders)
    const day = new Date().toISOString().slice(0, 10)
    triggerFileDownload(html, `navsphere-bookmarks-${day}.html`, 'text/html;charset=utf-8')
    setSyncNote(`已成功导出 ${favorites.items.length} 个书签为浏览器标准 HTML 格式（支持 Chrome/Edge/Safari/Firefox 直接导入）`)
    setSyncStatus('success')
  }

  // 一键导出为结构化 Markdown
  const handleExportMarkdown = () => {
    if (favorites.items.length === 0) return
    const md = exportFavoritesToMarkdown(favorites.items, visibleFolders)
    const day = new Date().toISOString().slice(0, 10)
    triggerFileDownload(md, `navsphere-bookmarks-${day}.md`, 'text/markdown;charset=utf-8')
    setSyncNote(`已成功导出 ${favorites.items.length} 个书签为结构化 Markdown 清单（适配 Notion/Obsidian）`)
    setSyncStatus('success')
  }

  // 批量选择切换
  const handleToggleSelect = (siteId: string) => {
    setSelectedSiteIds((prev) => {
      const next = new Set(prev)
      if (next.has(siteId)) next.delete(siteId)
      else next.add(siteId)
      return next
    })
  }

  const handleSelectAll = () => {
    if (selectedSiteIds.size === renderedFavorites.length && renderedFavorites.length > 0) {
      setSelectedSiteIds(new Set())
    } else {
      setSelectedSiteIds(new Set(renderedFavorites.map((f) => f.siteId)))
    }
  }

  // 批量删除/移动后焦点落点（设计 §3.3 / §7 风险 8）：被删卡片卸载后焦点会
  // 回落 body，键盘用户迷路。批量栏本身不随删除卸载，落到它的第一个按钮
  // （全选当前）是确定落点；栏在两处处理器之后仍挂载，同步 focus 即可。
  const batchBarRef = useRef<HTMLDivElement>(null)
  const focusBatchBar = () => {
    batchBarRef.current?.querySelector('button')?.focus()
  }

  // 批量移动到收藏夹（移夹进撤销栈：逐条 updateMeta 推条目，8 秒内
  // 同 kind 合并成一条"已将 N 条收藏移至「X」"，一次撤销全回原夹）
  const handleBatchMoveFolder = async () => {
    if (selectedSiteIds.size === 0) return
    const target = batchFolderTarget || null
    setManageBusy(true)
    let errCount = 0
    const targetFolder = visibleFolders.find((f) => f.id === target)
    const targetName = targetFolder ? targetFolder.name : '未分组'
    for (const siteId of selectedSiteIds) {
      favorites.updateMeta(siteId, { folderId: target }, {
        undoLabel: `已将 1 条收藏移至「${targetName}」`,
        undoDetail: targetName,
      })
      if (cloudIdentity) {
        const ok = await updateFavoriteMeta(cloudIdentity, siteId, { folderId: target })
        if (!ok) errCount++
      }
    }
    setManageBusy(false)
    setSyncNote(`已将 ${selectedSiteIds.size} 项移至「${targetName}」` + (errCount > 0 ? ` (云端有 ${errCount} 项待同步)` : ''))
    setSyncStatus(errCount > 0 ? 'info' : 'success')
    setSelectedSiteIds(new Set())
    focusBatchBar()
  }

  // 批量删除：不确认——逐条 favorites.remove() 各推一条撤销（8 秒内同 kind
  // 合并成一条），撤销条 + 回收站兜底；确认框是重复设防。
  const handleBatchDelete = async () => {
    if (selectedSiteIds.size === 0) return
    for (const siteId of selectedSiteIds) {
      favorites.remove(siteId)
    }
    setSyncNote(`已批量移除 ${selectedSiteIds.size} 个收藏`)
    setSyncStatus('success')
    setSelectedSiteIds(new Set())
    focusBatchBar()
  }

  // 批量导出选中项为 Markdown
  const handleBatchExportMarkdown = () => {
    const selected = favorites.items.filter((f) => selectedSiteIds.has(f.siteId))
    if (selected.length === 0) return
    const md = exportFavoritesToMarkdown(selected, visibleFolders)
    const day = new Date().toISOString().slice(0, 10)
    triggerFileDownload(md, `navsphere-selected-${day}.md`, 'text/markdown;charset=utf-8')
    setSyncNote(`已将选中的 ${selected.length} 个书签导出为 Markdown`)
    setSyncStatus('success')
  }

  // 批量导出选中项为 HTML
  const handleBatchExportHtml = () => {
    const selected = favorites.items.filter((f) => selectedSiteIds.has(f.siteId))
    if (selected.length === 0) return
    const html = exportFavoritesToHtml(selected, visibleFolders)
    const day = new Date().toISOString().slice(0, 10)
    triggerFileDownload(html, `navsphere-selected-${day}.html`, 'text/html;charset=utf-8')
    setSyncNote(`已将选中的 ${selected.length} 个书签导出为 HTML`)
    setSyncStatus('success')
  }

  /**
   * 卡片级键盘处理（批量模式）：Space/Enter 切换该卡选中，Delete/Backspace
   * 批量删除选中项。判定走 lib/batch-keyboard.ts 的纯函数，与 window 层同源；
   * <a> 的 Enter 原生激活拦不住，window 冒泡 preventDefault 来不及，必须卡片级拦截。
   * 焦点在左上角 checkbox 按钮上时不走这里——按钮的 Space/Enter 原生激活已切换
   * 选中，window 层再切换一次会来回跳（见 use-batch-keyboard.ts 的分流注释）。
   */
  const handleFavoriteCardKeyDown = (e: React.KeyboardEvent, siteId: string) => {
    // 只接 Space/Enter/Delete/Backspace 四个卡片级键：Esc 不归卡片管，
    // 归 window 层 useBatchKeyboard 的两段式（带 undo-bar 优先级）。
    // 曾踩过的坑：不对键设闸、所有键都走纯函数时，Esc 在卡片级命中
    // clear-selection 后被默认分支 stopPropagation 吞掉、却没执行，
    // window 层永远收不到 Esc——选中清不掉、撤销条也关不掉。
    if (
      e.key !== ' ' &&
      e.code !== 'Space' &&
      e.key !== 'Enter' &&
      e.key !== 'Delete' &&
      e.key !== 'Backspace'
    ) {
      return
    }
    const action = resolveBatchKeyboardAction(
      {
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        isComposing: e.nativeEvent.isComposing,
      },
      {
        composing: e.nativeEvent.isComposing ?? false,
        typing: isEventTargetTyping(e.nativeEvent),
        dialogOpen: isAnyDialogOpen(),
        menuOpen: isAnyMenuOpen(),
        editingLayout: false,
        dragHandleFocused: isDragHandleFocused(),
      },
      { surface: 'favorites', inBatchMode: batchMode, hasSelection: selectedSiteIds.size > 0, focusedSiteId: siteId },
    )
    if (!action) return
    if (action.kind === 'toggle-focused') {
      e.preventDefault()
      e.stopPropagation()
      handleToggleSelect(siteId)
      return
    }
    if (action.kind === 'batch-remove') {
      e.preventDefault()
      e.stopPropagation()
      void handleBatchDelete()
      return
    }
    if (action.kind === 'ignore') {
      // 收藏页没有 ignore 动作（只有首页 Delete 才吞）；防御性吞掉，不落回原生导航/滚动。
      e.preventDefault()
      e.stopPropagation()
    }
    // 其他动作不处理、不吞键。
  }

  const focusBatchMoveTarget = () => {
    if (selectedSiteIds.size === 0) {
      setSyncNote('请先选中收藏，再按 F 聚焦移夹')
      setSyncStatus('info')
      return
    }
    document
      .querySelector<HTMLElement>('select[aria-label="选择批量移动目标文件夹"]')
      ?.focus()
  }

  // 批量键盘（M / Ctrl+A / E / Shift+E / F / L / Del / Esc）：判定全在
  // lib/batch-keyboard.ts，执行只接线上面已有的批量处理器。
  // 挂载点注：不能放在 batchMode 状态旁边——回调引用的处理器定义在上面，
  // 放 state 旁会撞 const 的 TDZ；hook 内部用 ref 读最新回调，放这里等价。
  useBatchKeyboard({
    surface: 'favorites',
    inBatchMode: batchMode,
    hasSelection: selectedSiteIds.size > 0,
    editingLayout: false,
    callbacks: {
      // 与「批量管理」按钮同款：切换模式时清空选中。
      onToggleMode: () => {
        setBatchMode((prev) => !prev)
        setSelectedSiteIds(new Set())
      },
      onClearSelection: () => setSelectedSiteIds(new Set()),
      onExitMode: () => {
        setBatchMode(false)
        setSelectedSiteIds(new Set())
      },
      onToggleFocused: handleToggleSelect,
      onSelectAllVisible: handleSelectAll,
      onExportMarkdown: handleBatchExportMarkdown,
      onExportHtml: handleBatchExportHtml,
      onFocusMoveTarget: focusBatchMoveTarget,
      onLinkPack: () => setShowLinkPack(true),
      onBatchRemove: () => void handleBatchDelete(),
    },
  })

  // 通用多格式导入执行
  const handleImportUniversalItems = async (
    items: ParsedUniversalItem[],
    options: { createFolders: boolean; skipDuplicates: boolean },
  ) => {
    let foldersCreated = 0
    const folderNameToId = new Map<string, string>()

    for (const f of visibleFolders) {
      folderNameToId.set(f.name, f.id)
    }

    if (options.createFolders) {
      for (const item of items) {
        if (item.folderName && !folderNameToId.has(item.folderName)) {
          const newId = await createFolderDirectly(item.folderName)
          if (newId) {
            folderNameToId.set(item.folderName, newId)
            foldersCreated++
          }
        }
      }
    }

    const existingUrlSet = new Set(favorites.items.map((f) => f.href))
    const toImport: any[] = []
    let skipped = 0

    for (const item of items) {
      if (options.skipDuplicates && existingUrlSet.has(item.href)) {
        skipped++
        continue
      }
      const folderId = item.folderName ? folderNameToId.get(item.folderName) : null
      toImport.push({
        siteId: item.siteId,
        title: item.title,
        href: item.href,
        description: item.description,
        note: item.note,
        tags: item.tags,
        folderId,
        createdAt: item.createdAt || Date.now(),
      })
    }

    if (toImport.length > 0) {
      const payload = JSON.stringify({
        version: 1,
        items: toImport,
      })
      const result = favorites.importJson(payload)
      // importJson 报的是实际新增数（已存在的不再算进“成功添加”）
      setSyncNote(
        `导入完成：实际新增 ${result.imported} 条书签` +
          (result.updated > 0 ? `，更新 ${result.updated} 条已存书签` : '') +
          (result.alreadyExisted > 0 ? `，${result.alreadyExisted} 条已存在已跳过` : '') +
          (foldersCreated > 0 ? `，新建 ${foldersCreated} 个分类夹` : '') +
          (skipped > 0 ? `，跳过 ${skipped} 条重复项` : ''),
      )
      setSyncStatus('success')
      // 成长记账：逐条收藏事件（净增锁防重复刷分），并给首次导入里程碑提示
      for (const id of result.addedSiteIds ?? []) {
        recordGrowthEvent('favorite_add', { siteId: id })
      }
      if ((result.imported ?? 0) > 0) {
        celebrateFirstMilestone(
          'navhub.favorites.firstImportCelebrated.v1',
          '第一次批量搬家完成，收藏只存本机；登录后可跨设备同步。',
        )
      }
      return {
        imported: result.imported,
        skipped: skipped + result.alreadyExisted,
        foldersCreated,
      }
    }

    setSyncNote(`导入完成：成功添加 ${toImport.length} 条书签` + (foldersCreated > 0 ? `，新建 ${foldersCreated} 个分类夹` : '') + (skipped > 0 ? `，跳过 ${skipped} 条重复项` : ''))
    setSyncStatus('success')

    return {
      imported: toImport.length,
      skipped,
      foldersCreated,
    }
  }

  /**
   * 手动新建自定义收藏（0 收藏破冰空态第三卡）。
   * 与星标按钮同一落库入口（favorites.toggle），Schema 兼容 LocalFavorite；
   * 首次手动新建触发成长事件（数字方舟 / 自定义站同口径），并给克制 Toast。
   */
  const handleManualAdd = async (item: {
    siteId: string
    title: string
    href: string
    folderId: string | null
  }): Promise<boolean> => {
    const ok = await favorites.toggle({
      siteId: item.siteId,
      title: item.title,
      href: item.href,
      folderId: item.folderId,
    })
    if (!ok) return false
    // 成长记账：自定义站新增（与站内「自定义站」同一事件，净增锁防重复刷分）
    recordCustomSiteAddedAction()
    recordGrowthEvent('favorite_add', { siteId: item.siteId })
    toast({
      title: '已收进私密书签',
      description: `「${item.title}」已保存在本机金库${item.folderId ? '，已归入收藏夹' : ''}。`,
    })
    return true
  }

  /** 首次导入/首次加密备份的克制成功提示（成长事件由 useFavorites 落库链路统一记账）。 */
  const celebrateFirstMilestone = (key: string, message: string) => {
    try {
      if (window.localStorage.getItem(key)) return
      window.localStorage.setItem(key, '1')
    } catch {
      // 存不了就每次提示——比静默漏掉里程碑更好
    }
    toast({ title: '数字方舟进度 +1', description: message })
  }

  const handleImportPlain = () => {
    const result = favorites.importJson(importText)
    if (result.ok) {
      if (result.skippedInvalid > 0) {
        // 被过滤掉的残行不能藏在「已导入 N 条」背后
        setSyncNote(
          result.imported > 0
            ? `已导入 ${result.imported} 条书签；另有 ${result.skippedInvalid} 条缺少站点标识或链接，未导入`
            : `没有可导入的书签：${result.skippedInvalid} 条都缺少站点标识或链接`,
        )
        setSyncStatus(result.imported > 0 ? 'info' : 'error')
      } else if (result.alreadyExisted > 0 || result.updated > 0) {
        // 实际新增数才是 imported：已存在的不再冒充新增
        setSyncNote(
          `已导入 ${result.imported} 条书签` +
            (result.updated > 0 ? `，更新 ${result.updated} 条已存书签` : '') +
            (result.alreadyExisted > 0 ? `，${result.alreadyExisted} 条已存在，已跳过` : ''),
        )
        setSyncStatus('success')
      } else {
        setSyncNote('已导入 ' + result.imported + ' 条书签')
        setSyncStatus('success')
      }
      setImportText('')
      setShowImport(false)
    } else {
      setSyncNote('导入失败：' + (result.error ?? '未知错误'))
      setSyncStatus('error')
    }
  }

  // E2EE 零知识加密导出
  const handleExportVault = async () => {
    if (!vaultPassword || vaultPassword.length < 6) {
      setSyncNote('主密码至少需要 6 个字符')
      setSyncStatus('error')
      return
    }
    if (vaultPassword !== vaultPasswordConfirm) {
      setSyncNote('两次输入的金库密码不一致')
      setSyncStatus('error')
      return
    }

    setVaultLoading(true)
    try {
      const vaultItems = favoritesToVaultItems(favorites.items)
      const payload = await encryptVault(vaultItems, vaultPassword)
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/octet-stream',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = vaultExportFilename(Date.now())
      a.click()
      URL.revokeObjectURL(url)

      setSyncNote(`🔒 成功导出已加密金库，共 ${vaultItems.length} 条收藏（AES-256-GCM 保护）`)
      setSyncStatus('success')
      celebrateFirstMilestone(
        'navhub.favorites.firstVaultExportCelebrated.v1',
        '第一份加密备份已下载：密码不上云，丢了无法找回，请妥善保管。',
      )
      setShowVaultExport(false)
      setVaultPassword('')
      setVaultPasswordConfirm('')
    } catch (err) {
      setSyncNote('加密导出失败：' + (err instanceof Error ? err.message : '未知异常'))
      setSyncStatus('error')
    } finally {
      setVaultLoading(false)
    }
  }

  // 响应文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (text) {
        setImportVaultPayload(text)
      }
    }
    reader.readAsText(file)
  }

  // E2EE 零知识解密导入
  const handleImportVault = async () => {
    if (!importVaultPayload.trim()) {
      setSyncNote('请选择或粘贴 .navhub.vault 加密文件内容')
      setSyncStatus('error')
      return
    }
    if (!importPassphrase) {
      setSyncNote('请输入金库解密主密码')
      setSyncStatus('error')
      return
    }

    setVaultLoading(true)
    try {
      const parsedPayload = JSON.parse(importVaultPayload) as EncryptedVaultPayload
      if (!parsedPayload.cipherTextBase64 || !parsedPayload.saltHex || !parsedPayload.ivHex) {
        throw new Error('不是合法的山羊胡 E2EE 加密金库文件')
      }

      const decryptedItems = await decryptVault(parsedPayload, importPassphrase)

      // 还原为 LocalFavorite 格式（纯转换在 lib/favorites-vault，缺 id/url 的条目会被丢弃）
      const localItems = vaultItemsToFavorites(decryptedItems, Date.now())

      const importResult = favorites.importJson(JSON.stringify({ version: 1, items: localItems }))
      if (importResult.ok) {
        // 报「实际并入」而不是「解密到多少」：转换阶段出局的残行必须点名；
        // 实际并入 = 新增 + 更新（与 local-data-manager 同口径），已存在
        // 的条目单独点名，不算进“格式不完整”
        const notice = formatVaultRestoreNotice({
          decryptedCount: decryptedItems.length,
          convertibleCount: localItems.length,
          restoredCount: importResult.imported + importResult.updated,
          alreadyExisted: importResult.alreadyExisted,
        })
        setSyncNote(notice.text)
        setSyncStatus(notice.tone)
        if (notice.tone !== 'error') {
          setShowVaultImport(false)
          setImportPassphrase('')
          setImportVaultPayload('')
        }
      } else {
        throw new Error(importResult.error ?? '合并入库失败')
      }
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : '解密失败：密码错误或密文被篡改')
      setSyncStatus('error')
    } finally {
      setVaultLoading(false)
    }
  }

  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <UserCenterNav />
        {/* 紧凑 Header（单行/紧凑双行，高度 ~120px）：标题 + 状态徽标行 + 主动作 + 双下拉菜单。
            删除了 Hero 内冗余的返回主页面包屑与 E2EE 副标题——顶部 UserCenterNav
            已有「← 返回首页」。JSON 保真格式说明移入「备份与导出」菜单底部注脚。 */}
        <div className="rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-4 sm:p-5 shadow-xs">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* 左：精炼标题 + 轻量状态徽标行 */}
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-lg sm:text-2xl font-extrabold tracking-tight">
                <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                  <Shield className="w-4 h-4" aria-hidden />
                </span>
                <span>我的收藏与零知识金库</span>
                <FavoritesSyncBadge
                  snapshot={syncSnapshot}
                  onOpenConflicts={() => setShowConflictDrawer(true)}
                  onRetry={undefined}
                />
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Shield className="w-3 h-3" aria-hidden />
                  本地 {favorites.ready ? favorites.items.length : '—'} 条
                </span>
                <span aria-hidden className="text-border">·</span>
                <span className="inline-flex items-center gap-1">
                  <KeyRound className="w-3 h-3" aria-hidden />
                  AES-256-GCM 离线加密
                  <span className="relative inline-flex">
                    <button
                      type="button"
                      aria-expanded={showCryptoHint}
                      aria-label="展开加密技术说明"
                      title="密码不上云、不可逆、防篡改"
                      onClick={() => setShowCryptoHint((v) => !v)}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border/60 text-[9px] font-semibold text-muted-foreground hover:text-foreground"
                    >
                      ?
                    </button>
                    {showCryptoHint && (
                      <span
                        role="tooltip"
                        className="absolute left-0 top-6 z-20 w-56 rounded-lg border border-border/70 bg-popover p-2 text-[11px] leading-relaxed text-foreground shadow-md"
                      >
                        密码不上云：主密码只在本机派生密钥，绝不明文传输；AES-256-GCM
                        认证加密，密文不可逆、防篡改；密码丢失无法解密，请妥善保管。
                      </span>
                    )}
                  </span>
                </span>
                {favorites.trashCount > 0 && (
                  <Link
                    href="/favorites/trash"
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground underline underline-offset-2"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden />
                    🗑 回收站 ({favorites.trashCount})
                  </Link>
                )}
              </div>
            </div>

            {/* 右：1 个主动作 + 2 个高级下拉（导入 ▾ / 备份与导出 ▾） */}
            <div className="flex flex-wrap items-center gap-2">
              {favorites.items.length === 0 ? (
                /* 0 条时：导入书签提升为主视觉高亮按钮（当前页即可完成第一次行动） */
                <Button
                  size="sm"
                  className="h-8.5 rounded-xl text-xs gap-1.5 shadow-xs"
                  onClick={() => {
                    setShowUniversalImport(true)
                    setShowVaultExport(false)
                    setShowVaultImport(false)
                    setShowImport(false)
                  }}
                >
                  <FileUp className="w-3.5 h-3.5" aria-hidden />
                  导入书签
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white h-8.5 rounded-xl text-xs gap-1.5 shadow-xs"
                  onClick={() => {
                    setShowVaultExport(!showVaultExport)
                    setShowVaultImport(false)
                    setShowImport(false)
                  }}
                >
                  <Shield className="w-3.5 h-3.5" aria-hidden />
                  导出加密金库
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8.5 rounded-xl text-xs gap-1.5 border-border/70">
                    <FileUp className="w-3.5 h-3.5" aria-hidden />
                    导入
                    <ChevronDown className="w-3 h-3 opacity-60" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onSelect={() => {
                      setShowUniversalImport(true)
                      setShowVaultExport(false)
                      setShowVaultImport(false)
                      setShowImport(false)
                    }}
                  >
                    <FileUp className="w-3.5 h-3.5 mr-2" aria-hidden />
                    导入浏览器书签 / Markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setShowVaultImport(true)
                      setShowVaultExport(false)
                      setShowImport(false)
                      setShowUniversalImport(false)
                    }}
                  >
                    <KeyRound className="w-3.5 h-3.5 mr-2" aria-hidden />
                    解密导入加密金库 (.navhub.vault)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setShowImport(true)
                      setShowVaultExport(false)
                      setShowVaultImport(false)
                      setShowUniversalImport(false)
                    }}
                  >
                    <Link2 className="w-3.5 h-3.5 mr-2" aria-hidden />
                    导入明文 JSON
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={favorites.items.length === 0}
                    title={favorites.items.length === 0 ? '收藏至少 1 个站点后可导出' : undefined}
                    className="h-8.5 rounded-xl text-xs gap-1.5 border-border/70 disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden />
                    备份与导出
                    <ChevronDown className="w-3 h-3 opacity-60" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem
                    onSelect={() => {
                      setShowVaultExport(true)
                      setShowVaultImport(false)
                      setShowImport(false)
                      setShowUniversalImport(false)
                    }}
                  >
                    <Shield className="w-3.5 h-3.5 mr-2 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <span className="flex-1">导出加密金库 (.navhub.vault)</span>
                    <span className="ml-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                      推荐
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleExportPlain}>
                    <Link2 className="w-3.5 h-3.5 mr-2" aria-hidden />
                    导出明文 JSON（唯一保留快捷模板）
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleExportHtml}>
                    <Download className="w-3.5 h-3.5 mr-2" aria-hidden />
                    导出书签 HTML
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleExportMarkdown}>
                    <Download className="w-3.5 h-3.5 mr-2" aria-hidden />
                    导出 Markdown
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleExportAsPlugin}>
                    <Package className="w-3.5 h-3.5 mr-2" aria-hidden />
                    导出为插件
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <p className="px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                    JSON 是唯一保真格式：快捷链接模板只随 JSON 导出 / 导入，HTML 与 Markdown 导出不含模板。
                  </p>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* 工作区同级 Tab 切换栏（?view= 同步）：站点收藏 / 星标插件 / 我的批注 / 公开导航页。
            星标插件与公开导航页从首屏常驻卡改为 Tab 承接——不再需要解释「两套东西」。 */}
        <div
          role="tablist"
          aria-label="收藏工作区视图"
          className="mt-4 flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-card/40 p-1"
        >
          {(
            [
              ['sites', `站点收藏 (${favorites.ready ? favorites.items.length : '—'})`, '管理文件夹与私密书签'],
              ['plugins', `星标插件${starredCount > 0 ? ` (${starredCount})` : ''}`, '插件星标独立于网站收藏'],
              ['annotations', '我的批注', '划线批注汇总，可搜索可导出'],
              ['public', '公开导航页 (/pub)', '把收藏夹发布成只读页面'],
            ] as const
          ).map(([view, label, tip]) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={activeView === view}
              aria-pressed={activeView === view}
              title={tip}
              onClick={() => {
                setActiveView(view)
                if (view === 'plugins') setStarredCountLoaded(false)
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeView === view
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 我的批注：Tab 承接（直达 /me/annotations 完整页） */}

        {/* 云端同步状态：失败必须说出来，否则用户以为换设备也能看到。
            文案与图标由 lib/favorites-sync-copy 的纯函数决定（五种分支有单测）。 */}
        {syncBanner.tone !== 'hidden' && (
          <div
            className={`mb-6 p-3 rounded-lg border text-xs flex flex-wrap items-center gap-2 ${
              syncBanner.tone === 'syncing'
                ? 'bg-muted border-border text-muted-foreground'
                : syncBanner.tone === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
            }`}
          >
            {syncBanner.tone === 'syncing' ? (
              <RefreshCw className="w-4 h-4 flex-shrink-0 animate-spin" />
            ) : syncBanner.tone === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <CloudOff className="w-4 h-4 flex-shrink-0" />
            )}
            <span className="flex-1 min-w-0">{syncBanner.text}</span>
            {shouldOfferRetry(syncBannerInput) && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs rounded-lg gap-1.5"
                onClick={() =>
                  void (async () => {
                    const result = await runCloudSync()
                    applyCloudResult(result)
                  })()
                }
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重试同步
              </Button>
            )}
          </div>
        )}

        {/* 回收站写失败（配额满等）：删除仍执行了，但快照没留住——必须说出来，
            否则用户以为"删了还能从回收站找回"，实际只能靠云端墓碑。 */}
        {favorites.trashError && (
          <div
            role="alert"
            className="mb-6 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-400 flex flex-wrap items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 min-w-0">{favorites.trashError}</span>
          </div>
        )}

        {/* B15：匿名收藏只活在本机——登录前没有任何同步尝试，状态条恒为 hidden，
            必须在这里把风险说出来，否则用户攒了收藏、清一次缓存才发现全丢了。
            登录后自动同步，这条提示随身份切换消失（不与同步状态条叠加出现）。
            全页唯一一条匿名警告，支持关闭（仅本次会话生效）。 */}
        {showAnonymousNote && (
          <div
            data-testid="anonymous-favorites-note"
            className="mb-6 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-400 flex flex-wrap items-center gap-2"
          >
            <CloudOff className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 min-w-0">{describeAnonymousFavoritesNote()}</span>
            <Link
              href="/auth/signin?callbackUrl=/favorites"
              className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-300"
            >
              <LogIn className="w-3.5 h-3.5" />
              登录同步收藏
            </Link>
            <button
              type="button"
              onClick={() => setAnonymousNoteDismissed(true)}
              aria-label="关闭本次会话的匿名提示"
              className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-amber-700/70 hover:bg-amber-500/15 hover:text-amber-800 dark:text-amber-400/70 dark:hover:text-amber-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* 本地收藏读不出来：写入会被拒绝（为了不覆盖原数据），必须把话说清楚并给出出口 */}
        {favorites.storageBlocked && (
          <div
            role="alert"
            className="mb-6 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p>{favorites.storageBlocked}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs rounded-lg"
                  onClick={() => {
                    const { backedUp } = favorites.resetLocal()
                    setSyncNote(
                      backedUp
                        ? '已把原数据整份留档到本机隔离区，并以空列表重置本地收藏'
                        : '已按空列表重置本地收藏，但原文没能留档（浏览器存储写不进去），原数据可能无法找回',
                    )
                    setSyncStatus(backedUp ? 'info' : 'error')
                  }}
                >
                  先备份原数据，再重置本地收藏
                </Button>
                <Button asChild variant="ghost" size="sm" className="h-7 text-xs rounded-lg">
                  <Link href="/me/data">查看本机隔离区</Link>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 常驻播报区：role=status 容器必须一直挂载、只换文本——条件渲染会让
            部分读屏器漏报「区域与内容同时出现」的更新；视觉提示框另见下，只负责样式 */}
        <div role="status" aria-live="polite" className="sr-only">{syncNote ?? ''}</div>

        {syncNote && (
          <div
            className={`mb-6 p-3 rounded-lg border text-xs flex items-center gap-2 ${
              syncStatus === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                : syncStatus === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400'
                : 'bg-muted border-border text-muted-foreground'
            }`}
          >
            {syncStatus === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : syncStatus === 'error' ? (
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            ) : (
              <Shield className="w-4 h-4 flex-shrink-0" />
            )}
            <span>{syncNote}</span>
          </div>
        )}

        {syncLast && (
          <p className="mb-4 text-xs text-muted-foreground" data-testid="sync-last">
            上次同步：
            {syncLast.at > 0 ? new Date(syncLast.at).toLocaleTimeString('zh-CN', { hour12: false }) : '—'}
            {' · '}
            {syncLast.ok ? `成功（${syncLast.pushed} 条）` : `失败（${syncLast.error ?? '原因未知'}）`}
            {syncLast.remoteRemoved > 0 ? ` · 另一设备删除 ${syncLast.remoteRemoved} 条` : ''}
          </p>
        )}

        {/* 星标插件 Tab：插件星标独立于网站收藏（P1-6），由 Tab 承接而非首屏常驻卡 */}
        {activeView === 'plugins' && (
          <StarredPluginsSection
            onCountChange={(total) => {
              setStarredCount(total)
              setStarredCountLoaded(true)
            }}
          />
        )}
        {/* 我的批注 Tab：直达完整批注页（划线批注按收藏聚合，可搜索可导出） */}
        {activeView === 'annotations' && (
          <section
            aria-label="我的批注"
            className="rounded-xl border border-border/70 bg-card/50 p-6 text-center"
          >
            <p className="text-sm font-medium text-foreground">划线批注汇总</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              在收藏标题 / 简介上划过的线与批注，按收藏聚合，可搜索、可导出 Markdown / JSON。
            </p>
            <Button asChild size="sm" variant="outline" className="mt-3 text-xs">
              <Link href="/me/annotations">前往我的批注页</Link>
            </Button>
          </section>
        )}

        {/* 好久没打开：超过 90 天没有记录到的打开的收藏，给一条回访入口，
            而不是让它们在列表里悄悄变旧（徽标在每张卡的日期旁）。 */}
        {staleById.size > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-0">
              {isLoggedIn
                ? `有 ${staleById.size} 个收藏超过 90 天没打开了（按你的账号记录算），今天翻一个？`
                : `有 ${staleById.size} 个收藏超过 90 天没打开了（按本机记录算），今天翻一个？`}
            </span>
            <Link href="/favorites/stale" className="font-medium underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-300">
              去重温
            </Link>
          </div>
        )}

        {/* 待读分流：结算写已移出区失败时，过期项还留在原处——原因必须说出来 */}
        {favorites.triageSettleError && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
            {favorites.triageSettleError}
          </div>
        )}

        {/* 待读分流：本次打开结算移出的条数，一次可见提示，绝不静默 */}
        {favorites.settledExpiredCount > 0 && !triageBannerDismissed && (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-700 dark:text-sky-400 flex flex-wrap items-center gap-2">
            <span className="flex-1 min-w-0">
              {favorites.settledExpiredCount} 条待读过期，已移到「已移出」，可找回。
            </span>
            <Link href="/favorites/shelved" className="font-medium underline underline-offset-2 hover:text-sky-800 dark:hover:text-sky-300">
              去已移出看看
            </Link>
            <button
              type="button"
              onClick={() => setTriageBannerDismissed(true)}
              className="font-medium underline underline-offset-2"
            >
              知道了
            </button>
          </div>
        )}

        {/* 待读箱：顶部显著入口 + 数量角标。默认视图不变——永久库仍是默认落点，
            待读箱是叠加在上面的状态筛选，不劫持老用户首页。 */}
        {triageSettings.enabled && (triageCounts.inbox > 0 || triageCounts.read > 0 || shelvedCount > 0) && (
          <section aria-label="待读箱" className="rounded-xl border border-border/70 bg-card/50 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Inbox className="h-3.5 w-3.5" />
                待读箱
              </span>
              <span className="text-xs text-muted-foreground">
                {triageCounts.inbox} 条待读 · {triageCounts.dueSoon} 条快到期
                {triageCounts.read > 0 ? ` · ${triageCounts.read} 条已读待定` : ''}
              </span>
              <span className="ml-auto" />
              <Link href="/favorites/shelved" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                已移出 {shelvedCount > 0 ? `(${shelvedCount})` : ''}
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ['all', `全部 ${favorites.items.length}`],
                  ['inbox', `待读箱 ${triageCounts.inbox}`],
                  ['read', `已读 ${triageCounts.read}`],
                  ['permanent', `永久库 ${triageCounts.permanent}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTriageFilter(key)}
                  aria-pressed={triageFilter === key}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    triageFilter === key
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
              <span className="text-[11px] text-muted-foreground">
                新收藏先在待读箱放 {triageSettings.inboxHours} 小时，没打开就移到「已移出」（可找回）；点开一次就算读过（按本机记录算）。
              </span>
            </div>
          </section>
        )}

        {/* 待读分流关着时上面整节隐藏，但已移出区里的收藏还在等找回：
            开关关只冻住待读箱，不该把唯一的找回入口也藏起来。 */}
        {!triageSettings.enabled && shelvedCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/50 px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Inbox className="h-3.5 w-3.5" />
              待读分流已关闭
            </span>
            <span className="ml-auto" />
            <Link href="/favorites/shelved" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              已移出 ({shelvedCount})
            </Link>
          </div>
        )}

        {/* E2EE 金库面板（P1 抽出为组件：导出 / 解密导入，无自有状态） */}
        {(showVaultExport || showVaultImport) && (
        <FavoritesVaultPanels
          mode={showVaultExport ? 'export' : 'import'}
          onClose={() => {
            setShowVaultExport(false)
            setShowVaultImport(false)
          }}
          itemCount={favorites.items.length}
          password={vaultPassword}
          onPasswordChange={setVaultPassword}
          confirmPassword={vaultPasswordConfirm}
          onConfirmPasswordChange={setVaultPasswordConfirm}
          showPassword={showPasswordText}
          onToggleShowPassword={() => setShowPasswordText(!showPasswordText)}
          exporting={vaultLoading}
          onExport={() => void handleExportVault()}
          payload={importVaultPayload}
          onPayloadChange={setImportVaultPayload}
          passphrase={importPassphrase}
          onPassphraseChange={setImportPassphrase}
          onPickFile={() => fileInputRef.current?.click()}
          fileInputRef={fileInputRef}
          onFileChange={handleFileChange}
          importing={vaultLoading}
          onImport={() => void handleImportVault()}
        />
        )}

        {/* 传统明文 JSON 导入面板 */}
        {showImport && (
          <div className="mb-6 space-y-2 p-4 rounded-lg border bg-muted/20">
            <div className="text-xs font-medium text-muted-foreground">导入传统未加密 JSON</div>
            <textarea aria-label="粘贴导出的 JSON 文本"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='粘贴导出的 JSON，如 {"version":1,"items":[...]}'
              className="w-full h-24 rounded-md border bg-background p-2 text-base sm:text-xs font-mono"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleImportPlain} disabled={!importText.trim()}>
                确认导入
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowImport(false)}>
                取消
              </Button>
            </div>
          </div>
        )}

        {/* 公开导航页 Tab：把一个收藏夹发布成 /pub/ 只读页；未登录时区内置灰说明 */}
        {activeView === 'public' && (
          <PublicPageManager
            cloudIdentity={cloudIdentity}
            folders={visibleFolders}
            activeFolder={activeFolder}
            activeFolderCount={activeFolder === 'all' ? favorites.items.length : (folderCounts.get(activeFolder) ?? 0)}
          />
        )}

        {/* 站点收藏 Tab：移动端文件夹下拉 + 桌面双栏（左树右卡）+ 筛选 + 列表（默认视图） */}
        {activeView === 'sites' && (
        <>
        {/* 移动端：顶部文件夹下拉选择器（桌面用左侧树，见下） */}
        {favorites.items.length > 0 && (
          <div className="mb-4 lg:hidden">
            <label htmlFor="favorites-folder-select" className="sr-only">
              选择收藏夹
            </label>
            <select
              id="favorites-folder-select"
              value={activeFolder}
              onChange={(e) => setActiveFolder(e.target.value)}
              className="h-9 w-full rounded-lg border border-border/70 bg-background px-2.5 text-xs text-foreground"
            >
              <option value="all">全部收藏 {favorites.items.length}</option>
              {visibleFolders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name} {folderCounts.get(folder.id) ?? 0}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 桌面双栏工作区：左文件夹树（sticky），右筛选 + 站点卡片 */}
        <div className="lg:flex lg:items-start lg:gap-5">
          {/* 左侧文件夹树（桌面）：竖排结构，选中项高亮 + 计数 + 快捷新建 */}
          {favorites.items.length > 0 && (
            <aside
              aria-label="收藏夹树"
              className="hidden lg:block lg:w-52 lg:shrink-0 lg:sticky lg:top-4"
            >
              <nav className="rounded-xl border border-border/70 bg-card/50 p-2 space-y-0.5">
                <button
                  type="button"
                  onClick={() => setActiveFolder('all')}
                  aria-current={activeFolder === 'all' ? 'true' : undefined}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                    activeFolder === 'all'
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">全部收藏</span>
                  <span className="shrink-0 tabular-nums">{favorites.items.length}</span>
                </button>
                {visibleFolders.map((folder) => {
                  const count = folderCounts.get(folder.id) ?? 0
                  const active = activeFolder === folder.id
                  return (
                    <div key={folder.id} className="group/folder">
                      {editingFolder === folder.id ? (
                        <div className="flex items-center gap-1 px-1 py-1">
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveFolderName(folder.id)
                              if (e.key === 'Escape') setEditingFolder(null)
                            }}
                            aria-label="收藏夹名称"
                            className="h-7 flex-1 text-[11px]"
                            autoFocus
                          />
                          <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => void saveFolderName(folder.id)} aria-label="保存名称">
                            <Check className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div
                          className={`flex items-center gap-1 rounded-lg transition-colors ${
                            active ? 'bg-primary/10' : 'hover:bg-accent'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setActiveFolder(active ? 'all' : folder.id)}
                            aria-current={active ? 'true' : undefined}
                            className={`flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-xs ${
                              active ? 'font-medium text-primary' : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                            <span className="shrink-0 tabular-nums">{count}</span>
                          </button>
                          <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/folder:opacity-100">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 px-0 text-muted-foreground"
                              aria-label={`上移收藏夹 ${folder.name}`}
                              onClick={() => void moveFolder(folder.id, -1)}
                            >
                              <ChevronUp className="h-2.5 w-2.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 px-0 text-muted-foreground"
                              aria-label={`下移收藏夹 ${folder.name}`}
                              onClick={() => void moveFolder(folder.id, 1)}
                            >
                              <ChevronDown className="h-2.5 w-2.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 px-0 text-muted-foreground"
                              aria-label={`重命名收藏夹 ${folder.name}`}
                              onClick={() => {
                                setEditingFolder(folder.id)
                                setEditingName(folder.name)
                              }}
                            >
                              <Pencil className="h-2.5 w-2.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 px-0 text-muted-foreground hover:text-destructive-text"
                              aria-label={`删除收藏夹 ${folder.name}`}
                              onClick={() => void removeFolder(folder.id)}
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </Button>
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
                {/* 新建收藏夹：匿名建本地夹子，登录建云端夹子 */}
                <div className="flex items-center gap-1 border-t border-border/60 pt-2">
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void addFolder()
                    }}
                    placeholder="新建收藏夹"
                    aria-label="新建收藏夹名称"
                    className="h-7 flex-1 text-[11px]"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 px-0 shrink-0"
                    disabled={!newFolderName.trim() || folderBusy}
                    onClick={() => void addFolder()}
                    aria-label="创建收藏夹"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {manageBusy && <p className="px-2 text-[11px] text-muted-foreground">正在同步…</p>}
              </nav>
              {!cloudIdentity && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <LogIn className="h-3 w-3 shrink-0 mt-0.5" />
                  本地收藏夹仅存本机；登录后按名称合并到云端
                </p>
              )}
              {cloudIdentity && (
                <div className="mt-2 space-y-1.5 rounded-lg border border-border/60 p-2">
                  <p className="text-[11px] text-muted-foreground">清空只影响云端收藏；本机缓存会一并清除</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-full border-destructive/30 text-[11px] text-destructive-text hover:bg-destructive/15"
                    disabled={manageBusy}
                    onClick={() => void clearCloud()}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    {confirmClearCloud ? '再次点击确认清空' : '清空云端收藏'}
                  </Button>
                </div>
              )}
            </aside>
          )}

          {/* 右侧主工作区：筛选条 / 批量工具 / 站点卡片（站点收藏 Tab 内容） */}
          <div className="min-w-0 flex-1">

        {/* 智能整理（P1 #6）：只给建议，用户点「采用」后才建夹、才移动——绝不自动应用 */}
        {favorites.items.length > 0 && (
          <SmartCollectionsPanel
            items={favorites.items}
            onCreateFolder={createFolderDirectly}
            onMoveToFolder={assignFolder}
          />
        )}

        {/* 本地筛选条：只在确实有收藏时出现（没有收藏时不需要筛选控件） */}
        {favorites.ready && favorites.items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {/* 搜索方式切换：关键词是本地全文筛选；按意思搜复用中枢语义通道， */}
            {/* 按「意思」而不是字面找回收藏（标题里没有查询词也能命中）。 */}
            <div className="flex items-center rounded-lg border border-border/60 p-0.5" role="group" aria-label="收藏搜索方式">
              <button
                type="button"
                aria-pressed={saveSearchMode === 'keyword'}
                onClick={() => setSaveSearchMode('keyword')}
                className={`h-8 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  saveSearchMode === 'keyword' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                关键词
              </button>
              <button
                type="button"
                aria-pressed={saveSearchMode === 'meaning'}
                onClick={() => setSaveSearchMode('meaning')}
                className={`h-8 rounded-md px-2.5 text-xs font-medium transition-colors ${
                  saveSearchMode === 'meaning' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                按意思搜
              </button>
            </div>
            <div className="relative flex-1 min-w-[160px] sm:min-w-[13rem] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={favoriteQuery}
                onChange={(e) => setFavoriteQuery(e.target.value)}
                placeholder={
                  saveSearchMode === 'meaning'
                    ? '按意思找收藏，比如：想学做菜、旅行攻略'
                    : '在收藏里筛选：标题 / 链接 / 描述'
                }
                aria-label="筛选收藏"
                className="pl-8 h-9 text-sm"
              />
            </div>
            {filterSummary && (
              <span className="text-xs text-muted-foreground font-mono" role="status" aria-live="polite">
                {filterSummary}
              </span>
            )}
            {favoriteQuery && (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 px-2 text-xs"
                onClick={() => setFavoriteQuery('')}
              >
                <X className="w-3.5 h-3.5 mr-1" />
                清除
              </Button>
            )}
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value === 'title' ? 'title' : e.target.value === 'recent' ? 'recent' : 'created')
              }
              aria-label="收藏排序"
              className="h-9 rounded-md border border-border/60 bg-background px-2 text-xs text-muted-foreground"
            >
              <option value="created">最近收藏</option>
              <option value="recent">最近打开</option>
              <option value="title">按标题</option>
            </select>
            <Button
              size="sm"
              variant={batchMode ? 'default' : 'outline'}
              className={`h-9 px-2.5 text-xs rounded-lg ${
                batchMode ? 'bg-primary text-primary-foreground' : 'border-border/60 text-muted-foreground'
              }`}
              onClick={() => {
                setBatchMode(!batchMode)
                setSelectedSiteIds(new Set())
              }}
              title="批量管理（快捷键 M）"
            >
              <Layers className="w-3.5 h-3.5 mr-1" />
              {batchMode ? '退出批量' : '批量管理'}
            </Button>
            {/* 按意思搜的状态条：语义通道的状态必须外显——静默降级成关键词 */}
            {/* 会让用户以为拿到的是语义结果。准备中/暂不可用时本地全文匹配 */}
            {/* 仍在下面，只是不再冒充语义结果。 */}
            {saveSearchMode === 'meaning' && meaningQuery !== '' && (
              <div className="w-full" role="status" aria-live="polite">
                {meaningStatus === 'loading' && (
                  <span className="text-xs text-muted-foreground">正在按意思找…</span>
                )}
                {meaningStatus === 'preparing' && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      正在准备语义搜索（首次使用需下载语义模型，请稍候）——已先按关键词 / 备注匹配。
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => setMeaningRetryToken((n) => n + 1)}
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      重试语义搜索
                    </Button>
                  </div>
                )}
                {meaningStatus === 'unavailable' && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">语义检索暂不可用，已按关键词 / 备注匹配。</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => setMeaningRetryToken((n) => n + 1)}
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      重试语义搜索
                    </Button>
                  </div>
                )}
                {meaningStatus === 'ready' && meaningMatches !== null && (
                  <span className="text-xs text-muted-foreground">{describeMeaningReadyLine(meaningMatches)}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* 批量操作工具栏 */}
        {batchMode && favorites.items.length > 0 && (
          <div ref={batchBarRef} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-primary/30 bg-primary/5 mb-4 shadow-2xs">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs font-medium"
                onClick={handleSelectAll}
                title="全选当前已渲染的收藏（快捷键 Ctrl+A）"
              >
                {selectedSiteIds.size === renderedFavorites.length && renderedFavorites.length > 0 ? (
                  <CheckSquare className="w-4 h-4 mr-1.5 text-primary" />
                ) : (
                  <Square className="w-4 h-4 mr-1.5 text-muted-foreground" />
                )}
                {selectedSiteIds.size === renderedFavorites.length && renderedFavorites.length > 0
                  ? '取消全选'
                  : `全选当前 (${renderedFavorites.length})`}
              </Button>
              <span className="text-xs font-semibold text-primary">
                已选中 {selectedSiteIds.size} 项
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={batchFolderTarget}
                onChange={(e) => setBatchFolderTarget(e.target.value)}
                onKeyDown={(e) => {
                  // Enter 在 select 上原生是「打开下拉」而非确认移动：批量键盘约定
                  // Enter=确认移动（F 聚焦后 ↑↓ 选目标、Enter 确认，全程不用鼠标）。
                  // 取舍：下拉已打开时 Enter 本应是「选定高亮项」，这里也会触发确认
                  // 移动——键盘流（F → ↑↓ → Enter）从不打开下拉，不受影响；鼠标点开
                  // 下拉的用户请点「确认移动」按钮。
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleBatchMoveFolder()
                  }
                }}
                disabled={selectedSiteIds.size === 0 || manageBusy}
                aria-label="选择批量移动目标文件夹"
                className="h-8 rounded-lg border border-border/70 bg-background px-2 text-xs text-foreground"
              >
                <option value="">移至未分组</option>
                {visibleFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    移至: {folder.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={selectedSiteIds.size === 0 || manageBusy}
                onClick={() => void handleBatchMoveFolder()}
                title="确认移动（在移夹下拉框中按 Enter，快捷键 F 聚焦下拉框）"
              >
                确认移动
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={selectedSiteIds.size === 0}
                onClick={handleBatchExportMarkdown}
                title="导出 MD（快捷键 E）"
              >
                导出 MD
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={selectedSiteIds.size < 2 || selectedSiteIds.size > 4}
                onClick={() => router.push(buildCompareHref([...selectedSiteIds]))}
                title={
                  selectedSiteIds.size < 2
                    ? `横向对比需要选 2–4 个收藏（当前已选 ${selectedSiteIds.size} 个）`
                    : selectedSiteIds.size > 4
                      ? `横向对比一次最多 4 个收藏（当前已选 ${selectedSiteIds.size} 个）`
                      : '并排对照选中的 2–4 个收藏'
                }
              >
                横向对比
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={selectedSiteIds.size === 0}
                onClick={handleBatchExportHtml}
                title="导出 HTML（快捷键 Shift+E）"
              >
                导出 HTML
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 min-h-11 text-xs"
                disabled={selectedSiteIds.size === 0}
                title={
                  selectedSiteIds.size === 0
                    ? '请先选中至少 1 个收藏，再打包成链接包'
                    : selectedSiteIds.size > LINK_PACK_MAX_ITEMS
                      ? `已选 ${selectedSiteIds.size} 个，一次最多打包 ${LINK_PACK_MAX_ITEMS} 个，打开后可分包`
                      : '把选中的收藏打包成一页清单链接分享（快捷键 L）'
                }
                onClick={() => setShowLinkPack(true)}
              >
                <Link2 className="w-3.5 h-3.5 mr-1" />
                打包成链接包
              </Button>
              {selectedSiteIds.size === 0 && (
                <span className="text-xs text-muted-foreground">选中收藏后可打包成链接包</span>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs border-destructive/40 text-destructive-text hover:bg-destructive/15"
                disabled={selectedSiteIds.size === 0}
                onClick={() => void handleBatchDelete()}
                title="批量删除选中项（快捷键 Delete，可按 Ctrl+Z 撤销）"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                批量删除
              </Button>
            </div>
          </div>
        )}

        {/* 批量键盘常驻提示：收藏页没有快捷键指南对话框，见设计 §3.5 */}
        {batchMode && favorites.items.length > 0 && (
          <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-xs">M</kbd> 退出</span>
            <span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-xs">Space</kbd> 选</span>
            <span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-xs">Ctrl+A</kbd> 全选</span>
            <span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-xs">E</kbd> 导出</span>
            <span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-xs">F</kbd> 移夹</span>
            <span><kbd className="px-1.5 py-0.5 rounded bg-muted border font-mono text-xs">Del</kbd> 删除</span>
          </p>
        )}

        {!favorites.ready ? (
          <div aria-busy="true" aria-live="polite" aria-label="正在读取本地收藏" className="space-y-4">
            <span className="sr-only">加载中…</span>
            <div className="h-9 w-full max-w-md rounded-xl bg-muted/60 animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border/70 bg-card/50 p-4 space-y-3 animate-pulse"
                >
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-2/3 rounded bg-muted" />
                      <div className="h-3 w-full rounded bg-muted" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-5 w-16 rounded-full bg-muted" />
                    <div className="h-5 w-12 rounded-full bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : favorites.items.length === 0 ? (
          /* 0 收藏破冰空态：三选一快速起步卡片组（导入 / 探索 / 手动新建），
             取代旧的纯文字空态——用户不必抬头找按钮，当前页即可完成第一次有效行动。 */
          <FavoritesQuickStartEmpty
            onImportClick={() => setShowUniversalImport(true)}
            onManualAddClick={() => setShowManualAdd(true)}
          />
        ) : visibleFavorites.length === 0 ? (
          <EmptyState
            icon={Search}
            iconTone="muted"
            title={
              triageFilter === 'inbox'
                ? '待读箱里没有待读的收藏'
                : triageFilter === 'read'
                  ? '没有已读待定的收藏'
                  : triageFilter === 'permanent'
                    ? '没有永久收藏'
                    : activeFolder === 'all'
                      ? saveSearchMode === 'meaning' && favoriteQuery.trim() !== ''
                        ? favoriteMeaningEmptyMessage(favoriteQuery)
                        : favoriteFilterEmptyMessage(favoriteQuery)
                      : '这个收藏夹下还没有站点'
            }
            description={
              activeFolder === 'all' ? (
                saveSearchMode === 'meaning' && favoriteQuery.trim() !== '' ? (
                  <>收藏并没有丢：共 {favorites.items.length} 个都还在本机，只是当前意思没匹配到。换个说法试试，或切回关键词筛选。</>
                ) : (
                  <>收藏并没有丢：共 {favorites.items.length} 个都还在本机，只是当前关键词没匹配到。</>
                )
              ) : (
                <>切换「全部」后可以把任意收藏移动到当前收藏夹。</>
              )
            }
            action={
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => {
                  setFavoriteQuery('')
                  if (activeFolder !== 'all') setActiveFolder('all')
                  if (triageFilter !== 'all') setTriageFilter('all')
                }}
              >
                查看全部收藏
              </Button>
            }
          />
        ) : triageFilter === 'inbox' || triageFilter === 'read' ? (
          <ul className="space-y-2">
            {renderedFavorites.map((f) => (
              <TriageInboxRow
                key={f.siteId}
                item={f}
                settings={triageSettings}
                now={Date.now()}
                onReopen={(siteId) => favorites.recordOpened(siteId)}
                onRenew={(siteId) => {
                  if (favorites.renewInbox(siteId)) {
                    setSyncNote(`已续期「${f.title}」，重新获得完整待读时间`)
                    setSyncStatus('info')
                  }
                }}
                onPromote={(siteId) => {
                  if (favorites.promoteFavorite(siteId)) {
                    setSyncNote(`「${f.title}」已留进永久库，不再倒计时`)
                    setSyncStatus('success')
                  }
                }}
                onShelve={(siteId) => {
                  if (favorites.shelveFavorite(siteId)) {
                    setSyncNote(`已把「${f.title}」移到「已移出」，可在收藏页找回`)
                    setSyncStatus('info')
                  } else {
                    setSyncNote(`移出失败：「${f.title}」还在原处（本机存储写不进去）`)
                    setSyncStatus('error')
                  }
                }}
              />
            ))}
          </ul>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! gap-3.5 sm:gap-4">
            {renderedFavorites.map((f) => (
              <div
                key={f.siteId}
                data-favorite-site-id={f.siteId}
                
                className={cn(
                  'group relative overflow-hidden rounded-xl border border-border/70 hover:border-primary/40 bg-card/85 dark:bg-card/45 backdrop-blur-xs nav-card-glow transition-all duration-200 transform hover:-translate-y-0.5 p-3.5 flex flex-col justify-between',
                  batchMode && 'cursor-pointer select-none',
                  batchMode && selectedSiteIds.has(f.siteId) && 'border-primary ring-1 ring-primary/40 bg-primary/5',
                  favoriteSyncRing(syncSnapshot, f.siteId),
                )}
              >
                {/* 2026-11-22 卡片级同步微点：待同步蓝灰 / 冲突琥珀，与 Header 徽标同源 */}
                <span className="absolute top-2.5 right-2.5 z-20">
                  <FavoriteSyncDot snapshot={syncSnapshot} itemId={f.siteId} onLocateConflict={() => setShowConflictDrawer(true)} />
                </span>
                {/* 批量选择标记 */}
                {batchMode && (
                  <div className="absolute top-2.5 left-2.5 z-20">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleSelect(f.siteId)
                      }}
                      aria-label={`选择 ${f.title}`}
                      className="p-1 rounded-md bg-background/90 border border-border/80 shadow-xs hover:border-primary transition-colors cursor-pointer"
                    >
                      {selectedSiteIds.has(f.siteId) ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                )}
                <a
                  href={safeHref(f.href)}
                  onClick={
                    batchMode
                      ? (e) => {
                          e.preventDefault()
                          handleToggleSelect(f.siteId)
                        }
                      : () => {
                          // 主列表点卡也要记一次打开：此前只有 ⌘K / 重温 / 久未打开
                          // 入口记 lastOpenedAt，直接点卡打开不记，「最近打开」排序
                          // 与「好久没打开」提示都只能按残缺的本机记录算。写本机即可，
                          // 同步写是 localStorage，导航前已落盘；批量模式下点选不是
                          // 打开，不记。失败返回 false 也不拦导航（recordOpened 语义）。
                          favorites.recordOpened(f.siteId)
                        }
                  }
                  onAuxClick={
                    batchMode
                      ? undefined
                      : (e) => {
                          // 中键点击（auxclick，不触发 click）同样是打开：只记中键
                          // （button === 1），右键菜单不记。
                          if (e.button === 1) favorites.recordOpened(f.siteId)
                        }
                  }
                  onKeyDown={
                    batchMode ? (e) => handleFavoriteCardKeyDown(e, f.siteId) : undefined
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn('block min-w-0', batchMode && 'pl-7')}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-10 h-10 rounded-lg p-1.5 bg-muted/50 dark:bg-muted/20 border border-border/50 flex items-center justify-center transition-transform duration-200 group-hover:scale-105 shadow-xs">
                      <SiteFavicon title={f.title} url={f.href} icon={f.icon} className="w-full h-full object-contain rounded-xs" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors truncate pr-8">
                        {f.title}
                      </div>
                      {f.description && (
                        <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mt-1">
                          {f.description}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground font-mono mt-2">
                        {new Date(f.createdAt).toLocaleDateString('zh-CN')}
                        {(() => {
                          const stale = staleById.get(f.siteId)
                          if (!stale) return null
                          return (
                            <span
                              title={describeResurfaced(stale, isLoggedIn)}
                              className="ml-2 inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 font-sans text-[11px] font-medium text-amber-700 dark:text-amber-400"
                            >
                              {staleBadgeLabel(stale.daysSinceOpen)}
                            </span>
                          )
                        })()}
                        {(() => {
                          const hb = hibernatingById.get(f.siteId)
                          if (!hb) return null
                          return (
                            <span
                              title={hb.description}
                              className="ml-2 inline-flex rounded-full bg-slate-500/10 px-2 py-0.5 font-sans text-[11px] font-medium text-slate-700 dark:text-slate-400"
                            >
                              {hibernationBadgeLabel(hb.reason, hb.days)}
                            </span>
                          )
                        })()}
                        {(() => {
                          const status = resolveTriageStatus(f)
                          if (status === 'permanent') return null
                          const msLeft = triageMsLeft(f, triageSettings)
                          return (
                            <span
                              title={describeTriage(f, triageSettings)}
                              className="ml-2 inline-flex rounded-full bg-sky-500/10 px-2 py-0.5 font-sans text-[11px] font-medium text-sky-700 dark:text-sky-400"
                            >
                              {status === 'inbox' ? '待读' : '已读'} · {triageBadgeLabel(msLeft)}
                            </span>
                          )
                        })()}
                        {(() => {
                          const reason = meaningReasonBySiteId.get(f.siteId)
                          if (!reason) return null
                          return (
                            <span className="ml-2 inline-flex rounded-full bg-primary/10 px-2 py-0.5 font-sans text-[11px] font-medium text-primary">
                              {saveMatchReasonLabel(reason)}
                            </span>
                          )
                        })()}
                        {(() => {
                          const ql = quicklinkFromFavorite(f)
                          if (!ql) return null
                          return (
                            <span
                              title={`快捷链接：输入 !${ql.quickPrefix} <关键词> 直达搜索`}
                              className="ml-2 inline-flex rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium text-primary"
                            >
                              !{ql.quickPrefix}
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                </a>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2">
                  <select
                      value={f.folderId ?? ''}
                      onChange={(e) => void assignFolder(f.siteId, e.target.value || null)}
                      aria-label={`移动 ${f.title} 到收藏夹`}
                      className="h-7 max-w-[8.5rem] rounded-md border border-border/60 bg-background px-1.5 text-[11px] text-muted-foreground"
                    >
                      <option value="">未分组</option>
                      {visibleFolders.map((folder) => (
                        <option key={folder.id} value={folder.id}>{folder.name}</option>
                      ))}
                    </select>
                    {noteEditor === f.siteId ? (
                      <span className="flex min-w-0 flex-1 items-center gap-1">
                        <Input
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveNote(f.siteId)
                            if (e.key === 'Escape') setNoteEditor(null)
                          }}
                          placeholder="备注"
                          aria-label="收藏备注"
                          // ≤200 字是云端契约（服务端 zod 同口径）：输入端先拦，
                          // 超长备注曾让整批收藏同步被一条脏数据卡死
                          maxLength={200}
                          className="h-7 text-[11px]"
                          autoFocus
                        />
                        <Button size="sm" variant="ghost" className="h-7 px-1" aria-label="保存备注" onClick={() => void saveNote(f.siteId)}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-1.5 text-[11px] text-muted-foreground"
                        onClick={() => {
                          setNoteEditor(f.siteId)
                          setNoteDraft(f.note ?? '')
                        }}
                      >
                        <Pencil className="mr-1 h-3 w-3" />
                        {f.note ? '改备注' : '备注'}
                      </Button>
                    )}
                    {f.note && noteEditor !== f.siteId && (
                      <span className="basis-full truncate text-[11px] text-muted-foreground">{f.note}</span>
                    )}
                    {tagEditor === f.siteId ? (
                      <span className="flex min-w-0 flex-1 items-center gap-1">
                        <Input
                          value={tagDraft}
                          onChange={(e) => setTagDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveTags(f.siteId)
                            if (e.key === 'Escape') setTagEditor(null)
                          }}
                          placeholder="标签（逗号分隔，最多 8 个）"
                          aria-label="收藏标签"
                          className="h-7 text-[11px]"
                          autoFocus
                        />
                        <Button size="sm" variant="ghost" className="h-7 px-1" aria-label="保存标签" onClick={() => void saveTags(f.siteId)}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-1.5 text-[11px] text-muted-foreground"
                        onClick={() => {
                          setTagEditor(f.siteId)
                          setTagDraft((f.tags ?? []).join(', '))
                        }}
                      >
                        <Tag className="mr-1 h-3 w-3" />
                        {f.tags?.length ? '改标签' : '标签'}
                      </Button>
                    )}
                    {f.tags && f.tags.length > 0 && tagEditor !== f.siteId && (
                      <span className="basis-full flex flex-wrap gap-1">
                        {f.tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/20"
                            onClick={() => setFavoriteQuery(tag)}
                            title={`筛选含「${tag}」的收藏`}
                          >
                            #{tag}
                          </button>
                        ))}
                      </span>
                    )}
                    {quicklinkEditor === f.siteId ? (
                      <span className="flex min-w-0 basis-full flex-col gap-1">
                        <span className="flex min-w-0 flex-1 items-center gap-1">
                          <Input
                            value={quickPrefixDraft}
                            onChange={(e) => setQuickPrefixDraft(e.target.value)}
                            placeholder="前缀，如 gh"
                            aria-label="快捷链接前缀"
                            maxLength={16}
                            className="h-7 w-24 shrink-0 text-[11px] font-mono"
                            autoFocus
                          />
                          <Input
                            value={quickTemplateDraft}
                            onChange={(e) => setQuickTemplateDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveQuicklink(f.siteId)
                              if (e.key === 'Escape') setQuicklinkEditor(null)
                            }}
                            placeholder="模板，如 https://github.com/search?q={q}"
                            aria-label="快捷链接模板"
                            className="h-7 min-w-0 flex-1 text-[11px]"
                          />
                          <Button size="sm" variant="ghost" className="h-7 px-1" aria-label="保存快捷链接" onClick={() => saveQuicklink(f.siteId)}>
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          {(f.quickPrefix || f.templateUrl) && (
                            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-[11px] text-muted-foreground" onClick={() => clearQuicklink(f.siteId)}>
                              清除
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 px-1.5 text-[11px] text-muted-foreground" onClick={() => setQuicklinkEditor(null)}>
                            取消
                          </Button>
                        </span>
                        {quicklinkError && (
                          <span className="text-[11px] text-destructive-text">{quicklinkError}</span>
                        )}
                        {(() => {
                          const conflict = normalizeQuicklinkPrefix(quickPrefixDraft)
                            ? findQuicklinkPrefixConflict(quickPrefixDraft, quicklinkEntries, f.siteId)
                            : null
                          if (!conflict) return null
                          return (
                            <span className="text-[11px] text-amber-700 dark:text-amber-400">
                              {conflict === 'builtin'
                                ? '这个前缀与内置引擎相同，保存后你的快捷链接优先触发。'
                                : '已有另一条收藏用这个前缀，保存后先匹配到的那条优先触发。'}
                            </span>
                          )
                        })()}
                        <span className="text-[11px] text-muted-foreground">
                          模板里恰好一个 {'{q}'}；之后输入 !前缀 &lt;关键词&gt; 直达搜索。本机有效，不会同步到云端。
                        </span>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-1.5 text-[11px] text-muted-foreground"
                        onClick={() => {
                          setQuicklinkEditor(f.siteId)
                          setQuickPrefixDraft(f.quickPrefix ?? '')
                          setQuickTemplateDraft(f.templateUrl ?? '')
                          setQuicklinkError(null)
                        }}
                      >
                        <Zap className="mr-1 h-3 w-3" />
                        {f.quickPrefix ? '改快捷链接' : '快捷链接'}
                      </Button>
                    )}
                    {(() => {
                      // 冬眠按钮：只在永久库上出现（待读箱 / 已读有自己的到期流转）；
                      // 已冬眠的显示「唤醒」，点一次就回到正常列表（同时记一次打开）。
                      const hb = hibernatingById.get(f.siteId)
                      if (hb) {
                        return (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-1.5 text-[11px] text-muted-foreground"
                            title="唤醒：回到正常列表（同时记一次打开）"
                            onClick={() => {
                              if (favorites.wakeFavorite(f.siteId)) {
                                setSyncNote(`已唤醒「${f.title}」，回到正常列表`)
                                setSyncStatus('success')
                              } else {
                                setSyncNote(`唤醒失败：「${f.title}」还在冬眠（本机存储写不进去）`)
                                setSyncStatus('error')
                              }
                            }}
                          >
                            <Sun className="mr-1 h-3 w-3" />
                            唤醒
                          </Button>
                        )
                      }
                      if (resolveTriageStatus(f) !== 'permanent') return null
                      return (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-1.5 text-[11px] text-muted-foreground"
                          title="冬眠：沉到页面底部的冬眠区，不删除，随时能唤醒"
                          onClick={() => {
                            if (favorites.hibernateFavorite(f.siteId)) {
                              setSyncNote(`已把「${f.title}」冬眠，沉到页面底部，随时能唤醒`)
                              setSyncStatus('info')
                            } else {
                              setSyncNote(`冬眠失败：「${f.title}」还在原处（本机存储写不进去）`)
                              setSyncStatus('error')
                            }
                          }}
                        >
                          <Moon className="mr-1 h-3 w-3" />
                          冬眠
                        </Button>
                      )
                    })()}
                </div>
                <div className="absolute top-2 right-2">
                  <FavoriteButton site={f} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 冬眠收藏：只在默认浏览态分区。条目没有删、没有移出，只是沉到这里；点标题打开一次就能唤醒。 */}
        {hibernatingFavorites.length > 0 && (
          <section className="mt-6 rounded-xl border border-border/70 bg-muted/30 p-4" aria-label="冬眠收藏">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Moon className="h-4 w-4 text-slate-500" aria-hidden />
                {hibernationSectionTitle(hibernatingFavorites.length)}
              </h2>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setHibernationOpen((v) => !v)}
                aria-expanded={hibernationOpen}
              >
                {hibernationOpen ? '收起' : `展开看看 (${hibernatingFavorites.length})`}
                {hibernationOpen ? <ChevronUp className="ml-1 h-3.5 w-3.5" /> : <ChevronDown className="ml-1 h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              超过 {hibernationSettings.thresholdDays} 天本机没记录到打开的收藏沉在这里，没有删掉，也能用搜索找到；
              点开一次就能唤醒，回到正常列表。
            </p>
            {renderedFavorites.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">清醒的收藏暂时没有了，都在下面的冬眠区。</p>
            )}
            {hibernationOpen && (
              <>
                <ul className="mt-3 space-y-2">
                  {renderedHibernating.map((f) => {
                    const hb = hibernatingById.get(f.siteId)
                    if (!hb) return null
                    const wake = () => {
                      if (favorites.wakeFavorite(f.siteId)) {
                        setSyncNote(`已唤醒「${f.title}」，回到正常列表`)
                        setSyncStatus('success')
                      } else {
                        setSyncNote(`唤醒失败：「${f.title}」还在冬眠（本机存储写不进去）`)
                        setSyncStatus('error')
                      }
                    }
                    return (
                      <HibernationRow
                        key={f.siteId}
                        item={f}
                        reason={hb.reason}
                        daysSinceOpen={hb.days}
                        description={hb.description}
                        onReopen={() => wake()}
                        onWake={() => wake()}
                      />
                    )
                  })}
                </ul>
                {hibernatingFavorites.length > HIBERNATION_RENDER_LIMIT && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    仅显示前 {HIBERNATION_RENDER_LIMIT} 条，其余用搜索找（搜索不受冬眠分区影响）。
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {/* 渐进渲染的续载：未展示的条目仍在本地，只是不占用首屏 */}
        {awakeFavorites.length > renderedFavorites.length && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              已显示 {renderedFavorites.length} / {awakeFavorites.length}
            </p>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setVisibleCount((n) => n + 60)}>
              加载更多收藏
            </Button>
          </div>
        )}

        <div className="mt-8 text-xs text-muted-foreground">
          {/* 匿名风险提示只在工作区上方保留一条（可关闭），底部只留导航链接，
              不再复读「当前为匿名身份……」——避免同一页出现 3 处重复警告。 */}
          {cloudIdentity && (
            <span>收藏已与云端同步（换设备登录即可看到），本机缓存用于离线与快速打开。</span>
          )}
          <Link href="/tags" className="mx-1 text-primary hover:underline">去标签云看看</Link>
          或
          <Link href="/hot" className="mx-1 text-primary hover:underline">浏览热度榜</Link>
        </div>

          </div>
        </div>
        </>
        )}

        {/* 导出为插件市场清单向导弹窗 */}
        {showPluginExport && (
        <ExportPluginModal
          open={showPluginExport}
          onOpenChange={setShowPluginExport}
          kind="site-pack"
          defaultName="我的精选收藏包"
          defaultDescription={`包含 ${favorites.items.length} 个优质网站的精选收藏包，由山羊胡用户本地一键导出。`}
          defaultTags={['收藏', '网址包', '精选']}
          payload={{
            categories: [
              { title: '精选收藏', description: '用户个人精选网址收藏合集' },
            ],
            sites: favorites.items.map((item) => ({
              url: item.href,
              title: item.title,
              description: item.description || '',
              category: '精选收藏',
              tags: item.note ? [item.note] : ['收藏'],
            })),
          }}
        />
        )}

        {/* 浏览器书签 / Markdown 通用导入向导弹窗 */}
        {showUniversalImport && (
          <UniversalBookmarkModal
            open={showUniversalImport}
            onOpenChange={setShowUniversalImport}
            existingHrefs={new Set(favorites.items.map((f) => f.href))}
            onImportItems={handleImportUniversalItems}
          />
        )}

        {/* 手动新建自定义收藏（0 收藏破冰空态第三卡入口；有收藏时也可复用） */}
        <FavoritesManualAddModal
          open={showManualAdd}
          onOpenChange={setShowManualAdd}
          folders={visibleFolders}
          onAdd={handleManualAdd}
          onCreateFolder={createFolderDirectly}
        />

        {/* 链接包（快照版）生成对话框：多选收藏 → 一页清单分享链接 */}
        {showLinkPack && (
          <LinkPackDialog
            open={showLinkPack}
            items={favorites.items
              .filter((f) => selectedSiteIds.has(f.siteId))
              .map((f) => ({
                siteId: f.siteId,
                title: f.title,
                href: f.href,
                purpose: f.description ?? f.note ?? undefined,
              }))}
            onClose={() => setShowLinkPack(false)}
          />
        )}
      {/* 2026-11-21 冲突裁决抽屉：仅当存在需人工裁决的冲突时渲染 */}
      {showConflictDrawer && syncSnapshot.conflicts.length > 0 ? (
        <ConflictDrawer
          conflicts={syncSnapshot.conflicts}
          onClose={() => setShowConflictDrawer(false)}
          onUnconfirmedChange={setHasUnconfirmedConflict}
          onResolve={(conflictId) => {
            // 真实裁决由 syncEngine.resolve() 处理；当前快照阶段的冲突集合为空，
            // 这里仅关闭抽屉并复位未确认标记
            void conflictId
            setShowConflictDrawer(false)
            setHasUnconfirmedConflict(false)
          }}
        />
      ) : null}
      </div>
      <Footer />
    </Container>
  )
}
