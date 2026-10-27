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

/**
 * 视频章节。
 *
 * 历史问题：类型只有上游旧结构的 `timeSec`，而视频中心 / AI 摘要 / 采集器实际写入的是
 * `id + startTime + endTime + summary`。两套字段并存但类型只认其中一套，
 * 于是「按 timeSec 读 AI 生成的章节」拿到 undefined —— 章节跳转与代码对照静默失效，
 * 而 `ignoreBuildErrors: true` 让 tsc 从不报警。
 *
 * 现在声明为两套字段的超集。**读取方必须归一化**：`chapter.timeSec ?? chapter.startTime`。
 */
export interface VideoChapter {
  /** 旧上游结构的起始秒（与 startTime 同义） */
  timeSec?: number
  /** 章节 id（AI 生成 / 采集器写入） */
  id?: string
  /** 起始秒（AI 生成 / 采集器写入，与 timeSec 同义） */
  startTime?: number
  endTime?: number
  duration?: number
  title: string
  summary?: string
  codeSnippet?: string
  codeLanguage?: string
  keyPoints?: string[]
}

/** 章节起始秒的统一读取口径（timeSec 与 startTime 两套字段并存，见 VideoChapter） */
export function chapterStartSec(chapter: VideoChapter): number {
  return chapter.timeSec ?? chapter.startTime ?? 0
}

export interface VideoMirrorSource {
  platform: 'bilibili' | 'youtube' | 'custom'
  id: string
  href: string
  title?: string
  author?: string
}

export interface VideoDanmakuItem {
  id: string
  timeSec: number
  text: string
  color?: string
  isPitfallWarning?: boolean
  codeSnippet?: string
  author?: string
}

export interface VideoTranscriptItem {
  id: string
  startSec: number
  endSec: number
  text: string
  translation?: string
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
  healthStatus?: 'healthy' | 'outdated' | 'broken' | 'unverified'
  stats?: VideoStats
  chapters?: VideoChapter[]
  mirrors?: VideoMirrorSource[]
  danmaku?: VideoDanmakuItem[]
  transcript?: VideoTranscriptItem[]
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
  healthStatus?: 'healthy' | 'outdated' | 'broken' | 'unverified'
  stats?: VideoStats
  chapters?: VideoChapter[]
  mirrors?: VideoMirrorSource[]
  danmaku?: VideoDanmakuItem[]
  transcript?: VideoTranscriptItem[]
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