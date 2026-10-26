// Raw types for JSON data (before validation)
export interface VideoStats {
  views?: number
  likes?: number
  coins?: number
  favorites?: number
  danmaku?: number
}

export interface VideoHarvestPolicy {
  enabled: boolean
  keywords: string[]
  syncSiteHotTrends?: boolean
  platforms?: ('bilibili' | 'youtube')[]
  maxItems?: number
  minQualityScore?: number
  minDurationSec?: number
  maxDurationSec?: number
  freshnessHalfLifeDays?: number
  autoReplaceOutdated?: boolean
}

export interface VideoReplacementRecord {
  id: string
  timestamp: number
  categoryId: string
  categoryTitle: string
  subCategoryId?: string
  subCategoryTitle?: string
  oldItem: NavigationSubItem
  newItem: NavigationSubItem
  reason: 'broken' | 'year_outdated' | 'freshness_decay' | 'hot_superseded' | 'manual_replace'
  scoreDiff: number
  trendKeyword?: string
  rolledBack?: boolean
}

export interface VideoConfigRaw {
  type: string
  videoId?: string
  bvid?: string
  aid?: string
  cid?: string
  p?: number
  author?: string
  authorUrl?: string
  durationSec?: number
  publishedAt?: string | number
  harvestedAt?: number
  lastVerifiedAt?: number
  qualityScore?: number
  freshnessScore?: number
  sourceType?: 'manual' | 'auto_trend' | 'auto_topic'
  trendKeyword?: string
  pinned?: boolean
  healthStatus?: 'healthy' | 'outdated' | 'broken'
  stats?: VideoStats
}

export interface NavigationSubItemRaw {
  id: string
  title: string
  href: string
  description?: string
  icon?: string
  useDefaultIcon?: boolean
  enabled: boolean
  videoConfig?: VideoConfigRaw
  /**
   * 站点标签（导航站自己的 taxonomy，与 hub 的 tags 同源）。
   */
  tags?: string[]
}

export interface SiteAction {
  id: string
  label: string
  urlTemplate: string
  placeholder?: string
  icon?: string
}

export interface SiteRelation {
  targetTitle: string
  targetUrl: string
  relationType: 'alternative' | 'ecosystem' | 'upstream' | 'mirror'
  isFreeOrOpenSource?: boolean
  note?: string
}

export interface SiteLiveMetrics {
  githubStars?: number
  latestVersion?: string
  openSource?: boolean
  license?: string
  latencyMs?: number
}

// Validated types (after processing)
export interface NavigationSubItem {
  id: string
  title: string
  href: string
  description?: string
  icon?: string
  useDefaultIcon?: boolean
  enabled: boolean
  tags?: string[]
  actions?: SiteAction[]
  relations?: SiteRelation[]
  liveMetrics?: SiteLiveMetrics
  workspaces?: string[]
  health?: {
    ok?: boolean
    latencyMs?: number | null
    httpStatus?: number | null
    lastCheckedAt?: number | null
  }
  videoConfig?: VideoConfig
}

export interface VideoConfig {
  type: 'bilibili' | 'youtube'
  videoId?: string // simplified ID for youtube or bvid for bilibili
  bvid?: string
  aid?: string
  cid?: string
  p?: number
  author?: string
  authorUrl?: string
  durationSec?: number
  publishedAt?: string | number
  harvestedAt?: number
  lastVerifiedAt?: number
  qualityScore?: number
  freshnessScore?: number
  sourceType?: 'manual' | 'auto_trend' | 'auto_topic'
  trendKeyword?: string
  pinned?: boolean
  healthStatus?: 'healthy' | 'outdated' | 'broken'
  stats?: VideoStats
}

export interface NavigationCategoryRaw {
  id: string
  title: string
  icon?: string
  description?: string
  parentId?: string
  items?: NavigationSubItemRaw[]
  enabled?: boolean
  harvestPolicy?: VideoHarvestPolicy
}

export interface NavigationItemRaw {
  id: string
  title: string
  description?: string
  icon?: string
  items?: NavigationSubItemRaw[]
  subCategories?: NavigationCategoryRaw[]
  enabled?: boolean
  harvestPolicy?: VideoHarvestPolicy
}

export interface NavigationDataRaw {
  navigationItems: NavigationItemRaw[]
  replacementHistory?: VideoReplacementRecord[]
}

export interface NavigationCategory {
  id: string
  title: string
  icon?: string
  description?: string
  parentId?: string
  items?: NavigationSubItem[]
  enabled?: boolean
  harvestPolicy?: VideoHarvestPolicy
}

export interface NavigationItem {
  id: string
  title: string
  description?: string
  icon?: string
  items?: NavigationSubItem[]
  subCategories?: NavigationCategory[]
  enabled?: boolean
  harvestPolicy?: VideoHarvestPolicy
}

export interface NavigationData {
  navigationItems: NavigationItem[]
  replacementHistory?: VideoReplacementRecord[]
}

export interface ResourceItem {
  title: string
  description: string
  icon: string
  url: string
}

export interface ResourceSection {
  id: string
  title: string
  items: ResourceItem[]
}

export interface ResourceData {
  resourceSections: ResourceSection[]
}

// 图标路径解析工具函数
export function resolveIconPath(icon?: string): string | undefined {
  if (!icon) return undefined

  // 预定义的图标映射
  const iconMap: Record<string, string> = {
    'search': '/icons/search.svg',
    'user': '/icons/user.svg',
    'linecons-desktop': '/icons/desktop.svg',
    // 添加更多常见图标的映射
  }

  // 如果是预定义的图标名称，使用映射
  if (iconMap[icon]) {
    return iconMap[icon]
  }

  // 如果是完整的 URL，直接返回
  if (icon.startsWith('http://') || icon.startsWith('https://')) {
    return icon
  }

  // 如果是相对路径，确保以 / 开头
  if (!icon.startsWith('/')) {
    return `/icons/${icon}`
  }

  return icon
}