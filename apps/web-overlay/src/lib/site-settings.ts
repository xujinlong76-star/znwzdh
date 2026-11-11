import type { SiteConfig } from '@/types/site'

/**
 * 站点设置的唯一口径。
 *
 * 两条约束决定了这个文件的形态：
 * 1. `@/types/site` 属于 vendor 底座（scripts/vendor-web.mjs 每次从上游 tarball
 *    重新落盘），不能在那里加字段——新字段只能在本文件用交叉类型扩展。
 * 2. 中枢把 site.json 当无 schema 的 KV 整坨存（apps/api/src/storage.ts 的
 *    writeSiteConfig），少一个键就是少一个键，没有任何兜底。所以**写侧必须合并**、
 *    **读侧必须归一化**，否则一次全量覆盖就把别的工具写入的键抹掉了。
 *
 * 模块边界（2026-11-07 首屏预算整改）：
 * 本文件是**客户端安全**的——不含任何校验库依赖。zod 那部分（表单/写侧 schema）
 * 全部住在 `@/lib/site-settings.schema`。
 *
 * 之所以要这道分界：首页 / 热榜 / 合集 / 分类板 / 详情页 / 搜索结果这六个客户端岛，
 * 只从这里取 `externalLinkRelAttr` 这类纯函数，而它们原先与 `siteSettingsPatchSchema`
 * 同处一个模块，`import { z } from "zod"` 在模块顶层求值、无法被摇掉，实测把
 * **103 KB 的 zod 拖进了每一条路由的首屏**（chunk 2f8pg5_guvkgu.js）。拆开后
 * 客户端一个 import 都不用改，zod 自动退回服务端与后台表单。
 *
 * 因此约束是：**本文件不得 import zod（含间接 import）**。校验逻辑请放 schema 模块。
 */

/** 中枢存储路径（与 layout / api/site / metadata 共用同一常量） */
export const SITE_CONTENT_PATH = 'src/navsphere/content/site.json'

/** 首页可被后台编排/开关的板块键（顺序与开关共用同一组键名） */
export const HOME_SECTION_KEYS = ['aiFinder', 'dramaCinema', 'onboarding'] as const
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number]

/** 全站功能开关的键名（features 段） */
export const FEATURE_KEYS = [...HOME_SECTION_KEYS, 'heroDeck', 'xiaomaomao'] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]

export interface SiteSettingsExtra {
  basic: {
    /** 分享卡大图（1200×630）。缺省时用 /og-default.png */
    ogImage?: string
    /** 标语/副标题：首页主标题下的展示文案。与 description（SEO）分离，缺省回退 description */
    tagline?: string
  }
  /** 全站公告：开关 + 文案 + 可选链接 + 可选定时窗口（epoch ms，缺省 = 不限时） */
  announcement: {
    enabled: boolean
    text: string
    linkUrl?: string
    linkLabel?: string
    startAt?: number
    endAt?: number
  }
  /** 功能开关：缺省全开。关掉的板块前端不渲染（个人隐藏在此之上再叠加） */
  features: Record<FeatureKey, boolean>
  /** 首页编排：可控板块的展示顺序（缺失/脏值回退 HOME_SECTION_KEYS 默认序） */
  home: {
    order: HomeSectionKey[]
  }
  appearance: {
    /** 品牌主色，进 PWA manifest 的 theme_color */
    themeColor?: string
    /** iOS「添加到主屏幕」图标；缺省用内置 180×180 图 */
    appleTouchIcon?: string
    /** 仅接受同 kind 上传、通过尺寸校验的站内 PNG；空值回退内置图 */
    pwaIcon192?: string
    pwaIcon512?: string
    pwaMaskable512?: string
  }
  navigation: {
    /**
     * 收录站点外链的权重传递策略（SEO，2026-11-07）。
     * 缺省 nofollow：导航卡/分类板/详情/排行/合集/搜索结果的外链默认不导权重，
     * 避免上千条 dofollow 外链持续稀释本站权重。后台可切 dofollow 显式传递。
     */
    externalLinkRel?: 'nofollow' | 'dofollow'
  }
  footer?: {
    text?: string
    icp?: string
  }
}

export type SiteSettings = SiteConfig & SiteSettingsExtra

/** 表单每个 tab 提交的“部分更新”形状（字段级 null = 显式清空） */
export type SiteSettingsPatch = {
  basic?: Partial<Omit<SiteSettings['basic'], 'ogImage' | 'tagline'>> & { ogImage?: string | null; tagline?: string | null }
  announcement?: Partial<{
    enabled: boolean
    text: string | null
    linkUrl: string | null
    linkLabel: string | null
    startAt: number | null
    endAt: number | null
  }>
  features?: Partial<Record<FeatureKey, boolean>>
  home?: { order?: HomeSectionKey[] }
  appearance?: Partial<Omit<SiteSettings['appearance'], 'logo' | 'favicon' | 'appleTouchIcon' | PwaAssetKind | 'themeColor'>> & {
    logo?: string | null
    favicon?: string | null
    appleTouchIcon?: string | null
    pwaIcon192?: string | null
    pwaIcon512?: string | null
    pwaMaskable512?: string | null
    themeColor?: string | null
  }
  navigation?: Partial<SiteSettings['navigation']>
  footer?: { text?: string | null; icp?: string | null }
}

/* ------------------------------------------------------------------ *
 * 值域规则（纯正则，读写两侧共用）
 * ------------------------------------------------------------------ */

/**
 * 图片/图标类字段允许的形态：绝对 http(s) 或站内相对路径。
 *
 * 这里刻意不放开 `data:` 与 `javascript:`：值会直接落进 `<img src>`、
 * `<link rel=icon>` 与 metadata.icons，`javascript:` 在 link href 上是可执行的；
 * `data:` 则是把几百 KB 的图塞进整坨站点配置里，每次首页渲染都跟着走一遍。
 * 上传走 /api/site/asset，落地后仍然是个站内相对 URL。
 *
 * 导出给 `@/lib/site-settings.schema` 复用，保证「写侧校验」与「读侧归一化」
 * 用的是同一条规则——两处各写一份正则迟早会漂移。
 */
export const ASSET_RE = /^(https?:\/\/[^\s]+|\/[^\s]*)$/i

export type PwaAssetKind = 'pwaIcon192' | 'pwaIcon512' | 'pwaMaskable512'

/**
 * PWA 图标的落地命名规则：与上传端内容寻址命名一致。
 *
 * 不接受外链、任意站内图、跨 kind、query 或 hash。读写两侧共用本函数，
 * 保证「表单放行的值」与「读侧愿意采信的值」完全重合。
 */
export function pwaAssetPattern(kind: PwaAssetKind): RegExp {
  return new RegExp(`^/api/site/asset/${kind}-[0-9a-f]{10}\\.png$`)
}

/* ------------------------------------------------------------------ *
 * 归一化（读侧）
 * ------------------------------------------------------------------ */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.replace(CONTROL_CHARS, '').trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

function asset(value: unknown): string | undefined {
  const raw = text(value, 500)
  if (!raw) return undefined
  return ASSET_RE.test(raw) ? raw : undefined
}

/**
 * PWA 图标读侧归一化：等价于「trim → 长度 ≤ 500 → 命中该 kind 的上传命名」。
 *
 * 原先走 `pwaAssetField(kind).safeParse()`，把 zod 拽进了读侧（进而拽进 RSC 与
 * 客户端）。这里换成直白的正则判定，语义逐条对齐，代价是零依赖。
 */
function pwaAsset(value: unknown, kind: PwaAssetKind): string {
  if (typeof value !== 'string') return ''
  const raw = value.trim()
  if (!raw || raw.length > 500) return ''
  return pwaAssetPattern(kind).test(raw) ? raw : ''
}

/**
 * 把库里拿到的原始 JSON 收敛成可用形状，**任何情况下都不抛**。
 *
 * 读侧不做这件事的后果实测过：历史 `kv:site-config` 里存在上游基线的
 * `theme: "auto"`，表单的 z.enum 直接失败，整个 /admin/site 永久打不开。
 * 这里只认白名单，脏值折叠成默认值，页面继续可编辑。
 */
export function normalizeSettings(raw: unknown): SiteSettings {
  const src = (raw ?? {}) as Record<string, unknown>
  const basic = (src.basic ?? {}) as Record<string, unknown>
  const appearance = (src.appearance ?? {}) as Record<string, unknown>
  const navigation = (src.navigation ?? {}) as Record<string, unknown>
  const footer = (src.footer ?? {}) as Record<string, unknown>

  const theme = appearance.theme
  const linkTarget = navigation.linkTarget
  const externalLinkRel = navigation.externalLinkRel === 'dofollow' ? 'dofollow' : 'nofollow'
  const ogImage = asset(basic.ogImage)
  const themeColor = typeof appearance.themeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(appearance.themeColor.trim())
    ? appearance.themeColor.trim().toLowerCase()
    : undefined
  const footerText = text(footer.text, 200)
  const footerIcp = text(footer.icp, 60)
  const tagline = text(basic.tagline, 120)

  const announcementSrc = (src.announcement ?? {}) as Record<string, unknown>
  const announcementText = text(announcementSrc.text, 200)
  const announcementLink = asset(announcementSrc.linkUrl)
  const announcementLabel = text(announcementSrc.linkLabel, 30)
  const epoch = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 4_102_444_800_000 ? Math.floor(v) : undefined
  const announcementStart = epoch(announcementSrc.startAt)
  const announcementEnd = epoch(announcementSrc.endAt)

  const featuresSrc = (src.features ?? {}) as Record<string, unknown>
  const features = {} as Record<FeatureKey, boolean>
  for (const key of FEATURE_KEYS) {
    // 只有显式 false 才关：缺失/脏值一律按开处理，避免脏数据把首页板块误杀
    features[key] = featuresSrc[key] !== false
  }

  const homeSrc = (src.home ?? {}) as Record<string, unknown>
  const rawOrder = Array.isArray(homeSrc.order) ? homeSrc.order : []
  const seen = new Set<HomeSectionKey>()
  const order: HomeSectionKey[] = []
  for (const item of rawOrder) {
    if ((HOME_SECTION_KEYS as readonly string[]).includes(item as string) && !seen.has(item as HomeSectionKey)) {
      seen.add(item as HomeSectionKey)
      order.push(item as HomeSectionKey)
    }
  }
  for (const key of HOME_SECTION_KEYS) if (!seen.has(key)) order.push(key)

  return {
    basic: {
      title: text(basic.title, 120) ?? '',
      description: text(basic.description, 500) ?? '',
      keywords: text(basic.keywords, 300) ?? '',
      ...(ogImage ? { ogImage } : {}),
      ...(tagline ? { tagline } : {}),
    },
    announcement: {
      enabled: announcementSrc.enabled === true && !!announcementText,
      text: announcementText ?? '',
      ...(announcementLink ? { linkUrl: announcementLink } : {}),
      ...(announcementLabel ? { linkLabel: announcementLabel } : {}),
      ...(announcementStart ? { startAt: announcementStart } : {}),
      ...(announcementEnd ? { endAt: announcementEnd } : {}),
    },
    features,
    home: { order },
    appearance: {
      logo: asset(appearance.logo) ?? '',
      favicon: asset(appearance.favicon) ?? '',
      appleTouchIcon: asset(appearance.appleTouchIcon) ?? '',
      pwaIcon192: pwaAsset(appearance.pwaIcon192, 'pwaIcon192'),
      pwaIcon512: pwaAsset(appearance.pwaIcon512, 'pwaIcon512'),
      pwaMaskable512: pwaAsset(appearance.pwaMaskable512, 'pwaMaskable512'),
      theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system',
      ...(themeColor ? { themeColor } : {}),
    },
    navigation: {
      linkTarget: linkTarget === '_self' ? '_self' : '_blank',
      externalLinkRel,
    },
    ...(footerText || footerIcp ? { footer: { ...(footerText ? { text: footerText } : {}), ...(footerIcp ? { icp: footerIcp } : {}) } } : {}),
    // 保留本文件不认识的对象键：mergeSettings 负责落库，读侧不该丢别人的数据
    ...unknownSections(src),
  } as SiteSettings
}

/** 本模块未建模、但可能由其它工具写入的顶层键 */
function unknownSections(src: Record<string, unknown>): Record<string, unknown> {
  const known = new Set(['basic', 'appearance', 'navigation', 'footer', 'announcement', 'features', 'home'])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(src)) if (!known.has(k)) out[k] = v
  return out
}

/* ------------------------------------------------------------------ *
 * 合并（写侧）
 * ------------------------------------------------------------------ */

/**
 * 部分更新：`undefined` = 本次没动，`null` 或 `''` = 显式清空该设置。
 *
 * 为什么必须有这一步：中枢的 writeSiteConfig 是整坨覆盖，而 /admin/site
 * 是分 tab 保存的。没有合并，第一次只存「导航设置」就会把 basic/appearance
 * 全清掉；也没有合并，未来任何新增 tab 都会互相抹数据。
 */
export function mergeSettings(current: unknown, patch: SiteSettingsPatch): SiteSettings {
  const base = normalizeSettings(current)
  const merged: Record<string, unknown> = { ...base }

  for (const section of ['basic', 'appearance', 'navigation', 'footer', 'announcement', 'features', 'home'] as const) {
    const incoming = patch[section]
    if (!incoming) continue
    const sectionBase = base[section]
    const before: Record<string, unknown> =
      sectionBase && typeof sectionBase === 'object' ? { ...(sectionBase as Record<string, unknown>) } : {}
    for (const [key, value] of Object.entries(incoming)) {
      if (value === undefined) continue
      if (value === null || value === '') delete before[key]
      else before[key] = value
    }
    merged[section] = before
  }

  return normalizeSettings(merged)
}

/** 至少要有一个「本次要动的字段」，否则等于让管理员点了一次空保存 */
export function hasPatchContent(patch: SiteSettingsPatch): boolean {
  return (['basic', 'appearance', 'navigation', 'footer', 'announcement', 'features', 'home'] as const).some((section) => {
    const value = patch[section]
    return !!value && Object.values(value).some((v) => v !== undefined)
  })
}

/* ------------------------------------------------------------------ *
 * 展示层辅助：配置缺席时必须有兜底，否则首页渲染期抛错
 * ------------------------------------------------------------------ */

export const BRAND_FALLBACK = '山羊胡'

/** 公告是否应在当前时刻展示：开关开、有文案、且落在定时窗口内（窗口缺省 = 不限时） */
export function isAnnouncementVisible(
  settings: Pick<SiteSettings, 'announcement'> | null | undefined,
  now: number = Date.now(),
): boolean {
  const a = settings?.announcement
  if (!a?.enabled || !a.text) return false
  if (typeof a.startAt === 'number' && now < a.startAt) return false
  if (typeof a.endAt === 'number' && now >= a.endAt) return false
  return true
}

/**
 * 收录站点外链的 rel 属性（SEO，2026-11-07）。
 *
 * 唯一口径：dofollow 显式传递权重，其余一切值（含缺省/脏值）都收敛到 nofollow。
 * noopener noreferrer 始终保留——它们关的是 window.opener 与 Referer 泄露，
 * 与权重传递无关，任何档位都不能省。纯函数、无服务端依赖，RSC 与客户端岛共用。
 */
export function externalLinkRelAttr(value: unknown): string {
  return value === 'dofollow' ? 'noopener noreferrer' : 'nofollow noopener noreferrer'
}

/** 站点默认主题 → next-themes 的 defaultTheme（用户手动选过就以用户为准） */
export function resolveDefaultTheme(settings: Pick<SiteSettings, 'appearance'> | null | undefined): 'light' | 'dark' | 'system' {
  const theme = settings?.appearance?.theme
  return theme === 'light' || theme === 'dark' ? theme : 'system'
}
