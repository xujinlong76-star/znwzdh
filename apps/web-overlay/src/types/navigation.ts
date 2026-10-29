export type VideoPlatformType = 'bilibili' | 'youtube' | 'douyin' | 'kuaishou' | 'xigua' | 'xiaohongshu' | 'tencent' | 'youku' | 'vimeo' | 'ted' | 'dailymotion' | 'peertube' | 'custom'
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
  platforms?: VideoPlatformType[]
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
  platform: VideoPlatformType
  id: string
  /**
   * 播放地址。**可选**：`resolveAvailableMirrors()` 从不填它 —— 播放器用
   * `platform` + `sourceId` 现拼 URL（见 video-player-page 的 sourceId 读取）。
   * 声明成必填会逼调用方造一个假 URL，那正是「类型与实现长期分叉」的来源。
   */
  href?: string
  /** 平台内的稿件 ID（B 站 BV / YouTube 11 位）。线路探测与播放源都读它 */
  sourceId?: string
  /** 线路展示名，如「Bilibili 主线路」 */
  label?: string
  /** 切换优先级，0 最高；缺失按 10 处理 */
  priority?: number
  /** 是否直链流（非平台播放器） */
  isDirectStream?: boolean
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
  /** 连续探测失败次数：达到阈值才允许自动删除（见 video-deadlink-sweeper） */
  failStreak?: number
  /**
   * 章节树 / 字幕 / 测验是否由模板合成（而非视频真实内容）。
   * 为 true 时 UI 必须标注「示例大纲（非视频原字幕）」，不得呈现为 AI 提炼的真实内容。
   */
  synthetic?: boolean
  qualityScore?: number
  freshnessScore?: number
  sourceType?: 'manual' | 'auto_trend' | 'auto_topic' | 'webhook'
  trendKeyword?: string
  pinned?: boolean
  healthStatus?: 'healthy' | 'outdated' | 'broken' | 'unverified'
  stats?: VideoStats
  chapters?: VideoChapter[]
  mirrors?: VideoMirrorSource[]
  danmaku?: VideoDanmakuItem[]
  transcript?: VideoTranscriptItem[]
  seoSlug?: string
  seoTitle?: string
  seoDescription?: string
  seoKeywords?: string[]
  indexable?: boolean
  lastIndexedAt?: number
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
  /**
   * 服务端预签的图片代理地址（icon 直链被防盗链拦截时的降级 URL）。
   *
   * 客户端不能自己签：`node:crypto` 一旦进客户端组件图，Turbopack 会把
   * buffer/crypto 垫片整包打进去（实测 +476KB），签名密钥也会落进 bundle。
   * 由服务端页面渲染时签好，随数据 props 下发。
   */
  mediaProxyIconUrl?: string
  videoConfig?: VideoConfig
}

export interface VideoConfig {
  /**
   * `custom` 用于无法归到 B 站/YouTube 的来源（webhook 直投、手工录入的第三方链接）。
   * 之前这里只有两个值，而 `video-deadlink-sweeper` 里写着 `config.type || 'custom'` ——
   * 那个兜底分支在类型上永远不可达，等于「非 B 站/YouTube 的内容无处可放」。
   */
  type: VideoPlatformType
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
  sourceType?: 'manual' | 'auto_trend' | 'auto_topic' | 'webhook'
  trendKeyword?: string
  pinned?: boolean
  healthStatus?: 'healthy' | 'outdated' | 'broken' | 'unverified'
  /** 连续探测失败次数：达到阈值才允许自动删除（见 video-deadlink-sweeper） */
  failStreak?: number
  /**
   * 章节树 / 字幕 / 测验是否由模板合成（而非视频真实内容）。
   * 为 true 时 UI 必须标注「示例大纲（非视频原字幕）」，不得呈现为 AI 提炼的真实内容。
   */
  synthetic?: boolean
  stats?: VideoStats
  chapters?: VideoChapter[]
  mirrors?: VideoMirrorSource[]
  danmaku?: VideoDanmakuItem[]
  transcript?: VideoTranscriptItem[]
  seoSlug?: string
  seoTitle?: string
  seoDescription?: string
  seoKeywords?: string[]
  indexable?: boolean
  lastIndexedAt?: number
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