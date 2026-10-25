// @plugin-manifest:parity-ignore-start
/**
 * NavHub 插件市场契约（Web 客户端运行时镜像）。
 *
 * 事实源：packages/core/src/plugin-manifest.ts —— 两侧除本头部注释外
 * 必须字节级一致（apps/web/test/plugin-manifest-parity.test.ts 守门）。
 */
// @plugin-manifest:parity-ignore-end

export const PLUGIN_MANIFEST_VERSION = 1

export type PluginKind = 'site-pack' | 'workspace-preset' | 'theme' | 'search-pack' | 'bundle'
export const PLUGIN_KINDS: readonly PluginKind[] = ['site-pack', 'workspace-preset', 'theme', 'search-pack', 'bundle']

/**
 * 组合包允许引用的成员类型。
 *
 * 刻意排除 `bundle`（禁止嵌套/环）与 `workspace-preset`（必须由用户显式选择
 * 追加或覆盖，不能让组合包替用户决定工作台布局）。
 */
export type BundleItemKind = 'site-pack' | 'search-pack' | 'theme'
export const BUNDLE_ITEM_KINDS: readonly BundleItemKind[] = ['site-pack', 'search-pack', 'theme']

export type PluginStatus = 'pending' | 'published' | 'rejected' | 'delisted' | 'quarantined'

export const PLUGIN_LIMITS = {
  maxManifestBytes: 256 * 1024,
  maxName: 60,
  maxDescription: 500,
  maxIconChars: 8,
  maxAuthor: 60,
  maxLicense: 40,
  maxHomepage: 300,
  maxTags: 8,
  maxTagChars: 20,
  maxUrlLength: 2048,
  // 2026-10-20 内容扩容：20 个种子网址包里有 8 个恰好顶到 200 个站点的旧上限，
  // 上限本身成了继续加深内容的唯一瓶颈（连"给薄弱分类补几条"都放不下），
  // 因此按「留出约 60% 余量」抬到 320；分类与搜索引擎包同批放宽。
  maxSites: 320,
  maxSiteTitle: 120,
  maxSiteDescription: 300,
  maxSiteTags: 5,
  maxCategories: 24,
  maxCategoryTitle: 60,
  maxCategoryDescription: 120,
  maxBoards: 5,
  maxBoardName: 30,
  maxWidgetsPerBoard: 24,
  maxWidgetTitle: 40,
  maxWidgetConfigBytes: 8 * 1024,
  maxThemeTokens: 30,
  maxSearchEngines: 40,
  maxEngineName: 40,
  maxEnginePrefix: 16,
  maxBundleItems: 12,
  maxBundleSlug: 80,
} as const

export type ThemeAccent = 'violet' | 'emerald' | 'amber' | 'rose'
export const THEME_ACCENTS: readonly ThemeAccent[] = ['violet', 'emerald', 'amber', 'rose']

/** 允许覆盖的颜色变量（HSL 三段式，与 styles/globals.css 的 :root 口径一致） */
export const THEME_COLOR_VARS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
] as const
export type ThemeColorVar = (typeof THEME_COLOR_VARS)[number]

/** 圆角变量（仅 rem 数值，≤2rem） */
export const THEME_RADIUS_VAR = '--radius'

export interface SitePackCategory {
  title: string
  description?: string
  /** 所属一级根的标题；缺省时由权威树按标题反查 */
  parentCategory?: string
}

export interface SitePackSite {
  url: string
  title: string
  description?: string
  /** 引用包内分类或本机已有分类的标题 */
  category?: string
  subCategory?: string
  tags?: string[]
}

export interface SitePackPayload {
  categories?: SitePackCategory[]
  sites: SitePackSite[]
}

export interface WorkspacePresetWidget {
  /** 必须在 WIDGET_REGISTRY 内（注册表在前端，安装时 sanitize 兜底） */
  type: string
  customTitle?: string
  colSpan: number
  rowSpan: number
  config?: Record<string, unknown>
}

export interface WorkspacePresetBoard {
  name: string
  widgets: WorkspacePresetWidget[]
}

export interface WorkspacePresetPayload {
  boards: WorkspacePresetBoard[]
}

export interface ThemePayload {
  accent?: ThemeAccent
  tokens?: Record<string, string>
}

export interface SearchEngineItem {
  name: string
  prefix: string
  searchUrl: string
  icon?: string
  description?: string
}

export interface SearchPackPayload {
  engines: SearchEngineItem[]
}

export interface BundleItem {
  /** 已上架插件的稳定 slug */
  slug: string
  /** 成员类型；服务端会再次校验与真实插件类型一致 */
  kind: BundleItemKind
}

export interface BundlePayload {
  items: BundleItem[]
}

export interface PluginManifest {
  manifestVersion: typeof PLUGIN_MANIFEST_VERSION
  kind: PluginKind
  name: string
  description: string
  icon?: string
  author?: string
  homepage?: string
  license?: string
  version: string
  tags?: string[]
  forkedFrom?: string
  payload: SitePackPayload | WorkspacePresetPayload | ThemePayload | SearchPackPayload | BundlePayload
}

/** 列表卡片 / 安装确认弹窗用的影响摘要（由已校验的 manifest 派生） */
export interface PluginSummary {
  kind: PluginKind
  siteCount: number
  categoryCount: number
  uniqueTagCount: number
  /** 站点主机名（按频次取前 5，预览用） */
  hosts: string[]
  boardCount: number
  widgetCount: number
  widgetTypes: string[]
  accent?: ThemeAccent
  themeTokenCount: number
  engineCount: number
  enginePrefixes: string[]
  bundleItemCount: number
  bundleKinds: BundleItemKind[]
}

export type PluginManifestValidation =
  | { ok: true; manifest: PluginManifest; warnings: string[] }
  | { ok: false; errors: string[] }

export const PLUGIN_MANIFEST_FILE_SUFFIX = '.navhub-plugin.json'

export function pluginKindLabel(kind: PluginKind): string {
  return kind === 'site-pack'
    ? '网址包'
    : kind === 'workspace-preset'
      ? '工作台预设'
      : kind === 'theme'
        ? '主题'
        : kind === 'search-pack'
          ? '搜索引擎包'
          : '组合包'
}

/* ------------------------------------------------------------------ *
 * 校验与清洗
 * ------------------------------------------------------------------ */

const VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/
const WIDGET_TYPE_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/
const HSL_TRIPLE_PATTERN = /^(\d{1,3}(?:\.\d+)?)\s+(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%$/
const RADIUS_PATTERN = /^(\d(?:\.\d{1,2})?)rem$/
const FORBIDDEN_CONFIG_KEYS = ['__proto__', 'constructor', 'prototype']
const INVISIBLE_OR_BIDI_PATTERN = /[\u00AD\u200B\u200C\u202A-\u202E\u2060\u2066-\u2069\uFEFF\uE000-\uF8FF]|(?<!\p{Extended_Pictographic})\u200D|\u200D(?!\p{Extended_Pictographic})/u

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    if (u.username || u.password) return false
    return true
  } catch {
    return false
  }
}

/** 包内去重用的规范化键：协议/主机小写、去 hash、去尾斜杠（保留 query） */
export function normalizePluginUrlKey(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '')
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}${u.search}`
  } catch {
    return url.trim().toLowerCase()
  }
}

function readString(
  value: unknown,
  max: number,
  path: string,
  errors: string[],
  options: { required?: boolean } = {},
): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (options.required) errors.push(`${path} 不能为空`)
    return undefined
  }
  if (typeof value !== 'string') {
    errors.push(`${path} 必须是字符串`)
    return undefined
  }
  const v = value.trim()
  if (!v) {
    if (options.required) errors.push(`${path} 不能为空`)
    return undefined
  }
  if (v.length > max) {
    errors.push(`${path} 超过 ${max} 字符上限`)
    return undefined
  }
  if (INVISIBLE_OR_BIDI_PATTERN.test(v)) {
    errors.push(`${path} 包含高危不可见或双向控制字符（GlassWorm 防护拦截）`)
    return undefined
  }
  return v
}

function readHttpUrl(value: unknown, path: string, errors: string[], required = false): string | undefined {
  const v = readString(value, PLUGIN_LIMITS.maxUrlLength, path, errors, { required })
  if (v === undefined) return undefined
  if (!isAbsoluteHttpUrl(v)) {
    errors.push(`${path} 必须是 http/https 绝对地址`)
    return undefined
  }
  return v
}

function readStringList(
  value: unknown,
  path: string,
  errors: string[],
  maxCount: number,
  maxChars: number,
): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是字符串数组`)
    return undefined
  }
  if (value.length > maxCount) {
    errors.push(`${path} 最多 ${maxCount} 个`)
    return undefined
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') {
      errors.push(`${path} 含非字符串条目`)
      continue
    }
    const v = entry.trim()
    if (!v) continue
    if (v.length > maxChars) {
      errors.push(`${path} 存在超过 ${maxChars} 字符的条目`)
      continue
    }
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out.length > 0 ? out : undefined
}

function readInt(value: unknown, min: number, max: number, path: string, errors: string[]): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    errors.push(`${path} 必须是整数`)
    return undefined
  }
  if (value < min || value > max) {
    errors.push(`${path} 必须在 ${min}..${max} 之间`)
    return undefined
  }
  return value
}

/** 递归净化 config：剥离原型污染键、限制深度/数量/字符串长度，丢弃不可序列化值 */
function sanitizeConfigValue(value: unknown, depth: number): unknown {
  if (depth > 8) return undefined
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((v) => sanitizeConfigValue(v, depth + 1))
      .filter((v) => v !== undefined)
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_CONFIG_KEYS.includes(k)) continue
      const cleaned = sanitizeConfigValue(v, depth + 1)
      if (cleaned !== undefined) out[k] = cleaned
    }
    return out
  }
  if (typeof value === 'string') return value.length > 2000 ? value.slice(0, 2000) : value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean' || value === null) return value
  return undefined
}

function isHslTriple(value: string): boolean {
  const m = HSL_TRIPLE_PATTERN.exec(value)
  if (!m) return false
  const h = Number(m[1])
  const s = Number(m[2])
  const l = Number(m[3])
  return h <= 360 && s <= 100 && l <= 100
}

function isRadiusValue(value: string): boolean {
  const m = RADIUS_PATTERN.exec(value)
  if (!m) return false
  return Number(m[1]) <= 2
}

function validateSitePackPayload(payload: Record<string, unknown>, errors: string[], warnings: string[]): SitePackPayload {
  const categories: SitePackCategory[] = []
  const rawCategories = payload.categories
  if (rawCategories !== undefined && rawCategories !== null) {
    if (!Array.isArray(rawCategories)) {
      errors.push('payload.categories 必须是数组')
    } else if (rawCategories.length > PLUGIN_LIMITS.maxCategories) {
      errors.push(`payload.categories 最多 ${PLUGIN_LIMITS.maxCategories} 个`)
    } else {
      const seen = new Set<string>()
      for (let i = 0; i < rawCategories.length; i++) {
        const entry = rawCategories[i]
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
          errors.push(`payload.categories[${i}] 必须是对象`)
          continue
        }
        const record = entry as Record<string, unknown>
        const title = readString(record.title, PLUGIN_LIMITS.maxCategoryTitle, `payload.categories[${i}].title`, errors, { required: true })
        if (!title) continue
        const key = title.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        const description = readString(record.description, PLUGIN_LIMITS.maxCategoryDescription, `payload.categories[${i}].description`, errors)
        // 层级字段只做「形状」校验：本文件零依赖（前端有字节级镜像），
        // 与权威树的一致性在仓储层安装时校验（那时才拿得到 registry）。
        const parentCategory = readString(record.parentCategory, PLUGIN_LIMITS.maxCategoryTitle, `payload.categories[${i}].parentCategory`, errors)
        categories.push({
          title,
          ...(description ? { description } : {}),
          ...(parentCategory ? { parentCategory } : {}),
        })
      }
    }
  }

  const sites: SitePackSite[] = []
  const rawSites = payload.sites
  if (!Array.isArray(rawSites)) {
    errors.push('payload.sites 必须是数组')
  } else if (rawSites.length === 0) {
    errors.push('payload.sites 至少需要 1 个站点')
  } else if (rawSites.length > PLUGIN_LIMITS.maxSites) {
    errors.push(`payload.sites 最多 ${PLUGIN_LIMITS.maxSites} 个`)
  } else {
    const seenUrls = new Set<string>()
    let duplicates = 0
    for (let i = 0; i < rawSites.length; i++) {
      const entry = rawSites[i]
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`payload.sites[${i}] 必须是对象`)
        continue
      }
      const record = entry as Record<string, unknown>
      const url = readHttpUrl(record.url, `payload.sites[${i}].url`, errors, true)
      const title = readString(record.title, PLUGIN_LIMITS.maxSiteTitle, `payload.sites[${i}].title`, errors, { required: true })
      if (!url || !title) continue
      const urlKey = normalizePluginUrlKey(url)
      if (seenUrls.has(urlKey)) {
        duplicates++
        continue
      }
      seenUrls.add(urlKey)
      const site: SitePackSite = { url, title }
      const description = readString(record.description, PLUGIN_LIMITS.maxSiteDescription, `payload.sites[${i}].description`, errors)
      if (description) site.description = description
      const category = readString(record.category, PLUGIN_LIMITS.maxCategoryTitle, `payload.sites[${i}].category`, errors)
      if (category) site.category = category
      const subCategory = readString(record.subCategory, PLUGIN_LIMITS.maxCategoryTitle, `payload.sites[${i}].subCategory`, errors)
      if (subCategory) site.subCategory = subCategory
      const tags = readStringList(record.tags, `payload.sites[${i}].tags`, errors, PLUGIN_LIMITS.maxSiteTags, PLUGIN_LIMITS.maxTagChars)
      if (tags) site.tags = tags
      sites.push(site)
    }
    if (duplicates > 0) warnings.push(`包内重复 URL 已去重：${duplicates} 条`)
  }

  return categories.length > 0 ? { categories, sites } : { sites }
}

function validateWorkspacePresetPayload(payload: Record<string, unknown>, errors: string[]): WorkspacePresetPayload {
  const boards: WorkspacePresetBoard[] = []
  const rawBoards = payload.boards
  if (!Array.isArray(rawBoards)) {
    errors.push('payload.boards 必须是数组')
    return { boards }
  }
  if (rawBoards.length === 0) {
    errors.push('payload.boards 至少需要 1 个看板')
    return { boards }
  }
  if (rawBoards.length > PLUGIN_LIMITS.maxBoards) {
    errors.push(`payload.boards 最多 ${PLUGIN_LIMITS.maxBoards} 个`)
    return { boards }
  }
  for (let b = 0; b < rawBoards.length; b++) {
    const entry = rawBoards[b]
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`payload.boards[${b}] 必须是对象`)
      continue
    }
    const record = entry as Record<string, unknown>
    const name = readString(record.name, PLUGIN_LIMITS.maxBoardName, `payload.boards[${b}].name`, errors, { required: true })
    const rawWidgets = record.widgets
    if (!Array.isArray(rawWidgets)) {
      errors.push(`payload.boards[${b}].widgets 必须是数组`)
      continue
    }
    if (rawWidgets.length === 0) {
      errors.push(`payload.boards[${b}].widgets 至少需要 1 个模块`)
      continue
    }
    if (rawWidgets.length > PLUGIN_LIMITS.maxWidgetsPerBoard) {
      errors.push(`payload.boards[${b}].widgets 最多 ${PLUGIN_LIMITS.maxWidgetsPerBoard} 个`)
      continue
    }
    const widgets: WorkspacePresetWidget[] = []
    for (let w = 0; w < rawWidgets.length; w++) {
      const wentry = rawWidgets[w]
      const wpath = `payload.boards[${b}].widgets[${w}]`
      if (wentry === null || typeof wentry !== 'object' || Array.isArray(wentry)) {
        errors.push(`${wpath} 必须是对象`)
        continue
      }
      const wrecord = wentry as Record<string, unknown>
      const type = readString(wrecord.type, 40, `${wpath}.type`, errors, { required: true })
      if (type && !WIDGET_TYPE_PATTERN.test(type)) {
        errors.push(`${wpath}.type 格式不合法（小写字母/数字/连字符）`)
        continue
      }
      const colSpan = readInt(wrecord.colSpan, 1, 12, `${wpath}.colSpan`, errors)
      const rowSpan = readInt(wrecord.rowSpan, 1, 6, `${wpath}.rowSpan`, errors)
      if (!type || colSpan === undefined || rowSpan === undefined) continue
      const widget: WorkspacePresetWidget = { type, colSpan, rowSpan }
      const customTitle = readString(wrecord.customTitle, PLUGIN_LIMITS.maxWidgetTitle, `${wpath}.customTitle`, errors)
      if (customTitle) widget.customTitle = customTitle
      if (wrecord.config !== undefined && wrecord.config !== null) {
        if (typeof wrecord.config !== 'object' || Array.isArray(wrecord.config)) {
          errors.push(`${wpath}.config 必须是对象`)
        } else {
          const cleaned = sanitizeConfigValue(wrecord.config, 0)
          const serialized = JSON.stringify(cleaned)
          if (typeof serialized === 'string' && serialized.length > PLUGIN_LIMITS.maxWidgetConfigBytes) {
            errors.push(`${wpath}.config 超过 ${Math.round(PLUGIN_LIMITS.maxWidgetConfigBytes / 1024)}KB 上限`)
          } else if (cleaned && typeof cleaned === 'object') {
            widget.config = cleaned as Record<string, unknown>
          }
        }
      }
      widgets.push(widget)
    }
    if (name) boards.push({ name, widgets })
  }
  return { boards }
}

function validateThemePayload(payload: Record<string, unknown>, errors: string[]): ThemePayload {
  const out: ThemePayload = {}
  let entries = 0
  if (payload.accent !== undefined && payload.accent !== null) {
    const accent = payload.accent
    if (typeof accent === 'string' && (THEME_ACCENTS as readonly string[]).includes(accent)) {
      out.accent = accent as ThemeAccent
      entries++
    } else {
      errors.push(`payload.accent 必须是 ${THEME_ACCENTS.join(' / ')} 之一`)
    }
  }
  if (payload.tokens !== undefined && payload.tokens !== null) {
    if (typeof payload.tokens !== 'object' || Array.isArray(payload.tokens)) {
      errors.push('payload.tokens 必须是对象')
    } else {
      const raw = payload.tokens as Record<string, unknown>
      const keys = Object.keys(raw)
      if (keys.length > PLUGIN_LIMITS.maxThemeTokens) {
        errors.push(`payload.tokens 最多 ${PLUGIN_LIMITS.maxThemeTokens} 个变量`)
      } else {
        const tokens: Record<string, string> = {}
        for (const key of keys) {
          const value = raw[key]
          if (typeof value !== 'string') {
            errors.push(`payload.tokens.${key} 必须是字符串`)
            continue
          }
          const v = value.trim()
          if (key === THEME_RADIUS_VAR) {
            if (!isRadiusValue(v)) {
              errors.push(`payload.tokens.${key} 必须是 0..2rem 的数值（如 0.75rem）`)
              continue
            }
          } else if ((THEME_COLOR_VARS as readonly string[]).includes(key)) {
            if (!isHslTriple(v)) {
              errors.push(`payload.tokens.${key} 必须是 HSL 三段式（如 262 83% 58%）`)
              continue
            }
          } else {
            errors.push(`payload.tokens 不支持变量 ${key}`)
            continue
          }
          tokens[key] = v
          entries++
        }
        if (Object.keys(tokens).length > 0) out.tokens = tokens
      }
    }
  }
  if (entries === 0 && errors.length === 0) {
    errors.push('payload 至少需要 accent 或 tokens 之一')
  }
  return out
}

function validateSearchPackPayload(payload: Record<string, unknown>, errors: string[]): SearchPackPayload {
  const engines: SearchEngineItem[] = []
  const rawEngines = payload.engines
  if (!Array.isArray(rawEngines)) {
    errors.push('payload.engines 必须是数组')
    return { engines }
  }
  if (rawEngines.length === 0) {
    errors.push('payload.engines 至少需要 1 个搜索引擎')
    return { engines }
  }
  if (rawEngines.length > PLUGIN_LIMITS.maxSearchEngines) {
    errors.push(`payload.engines 最多 ${PLUGIN_LIMITS.maxSearchEngines} 个`)
    return { engines }
  }
  const prefixSet = new Set<string>()
  for (let i = 0; i < rawEngines.length; i++) {
    const entry = rawEngines[i]
    const path = `payload.engines[${i}]`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${path} 必须是对象`)
      continue
    }
    const record = entry as Record<string, unknown>
    const name = readString(record.name, PLUGIN_LIMITS.maxEngineName, `${path}.name`, errors, { required: true })
    const prefix = readString(record.prefix, PLUGIN_LIMITS.maxEnginePrefix, `${path}.prefix`, errors, { required: true })
    if (prefix) {
      if (!/^![a-zA-Z0-9_-]{1,15}$/.test(prefix)) {
        errors.push(`${path}.prefix 必须以叹号开头后接英文字母/数字/下划线（如 !gh、!npm、!mdn）`)
      } else if (prefixSet.has(prefix.toLowerCase())) {
        errors.push(`${path}.prefix 前缀重复：${prefix}`)
      } else {
        prefixSet.add(prefix.toLowerCase())
      }
    }
    const searchUrl = readHttpUrl(record.searchUrl, `${path}.searchUrl`, errors, true)
    if (searchUrl && !searchUrl.includes('{q}')) {
      errors.push(`${path}.searchUrl 必须包含 {q} 查询占位符`)
    }
    const icon = readString(record.icon, PLUGIN_LIMITS.maxIconChars, `${path}.icon`, errors)
    const description = readString(record.description, 120, `${path}.description`, errors)

    if (name && prefix && searchUrl) {
      const item: SearchEngineItem = { name, prefix, searchUrl }
      if (icon) item.icon = icon
      if (description) item.description = description
      engines.push(item)
    }
  }
  return { engines }
}

function validateBundlePayload(payload: Record<string, unknown>, errors: string[]): BundlePayload {
  const items: BundleItem[] = []
  const rawItems = payload.items
  if (!Array.isArray(rawItems)) {
    errors.push('payload.items 必须是数组')
    return { items }
  }
  if (rawItems.length === 0) {
    errors.push('payload.items 至少需要 1 个成员插件')
    return { items }
  }
  if (rawItems.length > PLUGIN_LIMITS.maxBundleItems) {
    errors.push(`payload.items 最多 ${PLUGIN_LIMITS.maxBundleItems} 个成员插件`)
    return { items }
  }
  const seen = new Set<string>()
  for (let i = 0; i < rawItems.length; i++) {
    const entry = rawItems[i]
    const path = `payload.items[${i}]`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${path} 必须是对象`)
      continue
    }
    const record = entry as Record<string, unknown>
    const slug = readString(record.slug, PLUGIN_LIMITS.maxBundleSlug, `${path}.slug`, errors, { required: true })
    const kind = readString(record.kind, 40, `${path}.kind`, errors, { required: true })
    if (slug && /[\s/\\?#]/.test(slug)) {
      errors.push(`${path}.slug 不能包含空白或 / \\ ? # 字符`)
    }
    if (kind && !(BUNDLE_ITEM_KINDS as readonly string[]).includes(kind)) {
      errors.push(`${path}.kind 必须是 ${BUNDLE_ITEM_KINDS.join(' / ')} 之一（禁止嵌套组合包或工作台预设）`)
    }
    if (!slug || !kind || !(BUNDLE_ITEM_KINDS as readonly string[]).includes(kind)) continue
    const key = slug.toLowerCase()
    if (seen.has(key)) {
      errors.push(`${path}.slug 重复：${slug}`)
      continue
    }
    seen.add(key)
    items.push({ slug, kind: kind as BundleItemKind })
  }
  return { items }
}

export function validateAndCleanPluginManifest(input: unknown): PluginManifestValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['插件清单必须是一个 JSON 对象'] }
  }
  const raw = input as Record<string, unknown>

  let serialized: string | undefined
  try {
    serialized = JSON.stringify(raw)
  } catch {
    return { ok: false, errors: ['插件清单包含无法序列化的内容（循环引用等）'] }
  }
  if (typeof serialized !== 'string') {
    return { ok: false, errors: ['插件清单无法序列化'] }
  }
  if (serialized.length > PLUGIN_LIMITS.maxManifestBytes) {
    return {
      ok: false,
      errors: [`插件包超过 ${Math.round(PLUGIN_LIMITS.maxManifestBytes / 1024)}KB 上限`],
    }
  }

  if (raw.manifestVersion !== PLUGIN_MANIFEST_VERSION) {
    errors.push(`manifestVersion 必须为 ${PLUGIN_MANIFEST_VERSION}`)
  }

  const kind = raw.kind
  if (typeof kind !== 'string' || !(PLUGIN_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, errors: [...errors, `kind 必须是 ${PLUGIN_KINDS.join(' / ')} 之一`] }
  }

  const name = readString(raw.name, PLUGIN_LIMITS.maxName, 'name', errors, { required: true })
  const version = readString(raw.version, 20, 'version', errors, { required: true })
  if (version && !VERSION_PATTERN.test(version)) {
    errors.push('version 必须是 x.y.z 格式（如 1.0.0）')
  }
  const description = readString(raw.description, PLUGIN_LIMITS.maxDescription, 'description', errors) ?? ''
  let icon: string | undefined
  if (typeof raw.icon === 'string' && raw.icon.trim().includes('://')) {
    errors.push('icon 只能是 emoji 或短文本（禁止远程图片地址）')
  } else {
    icon = readString(raw.icon, PLUGIN_LIMITS.maxIconChars, 'icon', errors)
  }
  const author = readString(raw.author, PLUGIN_LIMITS.maxAuthor, 'author', errors)
  const homepage = raw.homepage === undefined || raw.homepage === null
    ? undefined
    : readHttpUrl(raw.homepage, 'homepage', errors)
  const license = readString(raw.license, PLUGIN_LIMITS.maxLicense, 'license', errors)
  const tags = readStringList(raw.tags, 'tags', errors, PLUGIN_LIMITS.maxTags, PLUGIN_LIMITS.maxTagChars)
  const forkedFrom = readString(raw.forkedFrom, 80, 'forkedFrom', errors)

  if (raw.payload === null || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) {
    errors.push('payload 必须是对象')
    return { ok: false, errors }
  }
  const payloadRecord = raw.payload as Record<string, unknown>

  let payload: SitePackPayload | WorkspacePresetPayload | ThemePayload | SearchPackPayload | BundlePayload
  if (kind === 'site-pack') {
    payload = validateSitePackPayload(payloadRecord, errors, warnings)
  } else if (kind === 'workspace-preset') {
    payload = validateWorkspacePresetPayload(payloadRecord, errors)
  } else if (kind === 'theme') {
    payload = validateThemePayload(payloadRecord, errors)
  } else if (kind === 'search-pack') {
    payload = validateSearchPackPayload(payloadRecord, errors)
  } else {
    payload = validateBundlePayload(payloadRecord, errors)
  }

  if (errors.length > 0) return { ok: false, errors }

  const manifest: PluginManifest = {
    manifestVersion: PLUGIN_MANIFEST_VERSION,
    kind: kind as PluginKind,
    name: name as string,
    description,
    version: version as string,
    payload,
  }
  if (icon) manifest.icon = icon
  if (author) manifest.author = author
  if (homepage) manifest.homepage = homepage
  if (license) manifest.license = license
  if (tags) manifest.tags = tags
  if (forkedFrom) manifest.forkedFrom = forkedFrom

  return { ok: true, manifest, warnings }
}

/** 从 JSON 文本解析并校验（文件导入/粘贴入口用） */
export function parsePluginManifestJson(text: string): PluginManifestValidation {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['不是合法的 JSON 文本'] }
  }
  return validateAndCleanPluginManifest(parsed)
}

/* ------------------------------------------------------------------ *
 * 摘要（列表卡片 / 安装确认）与版本比较
 * ------------------------------------------------------------------ */

export function summarizePluginManifest(manifest: PluginManifest): PluginSummary {
  const summary: PluginSummary = {
    kind: manifest.kind,
    siteCount: 0,
    categoryCount: 0,
    uniqueTagCount: 0,
    hosts: [],
    boardCount: 0,
    widgetCount: 0,
    widgetTypes: [],
    themeTokenCount: 0,
    engineCount: 0,
    enginePrefixes: [],
    bundleItemCount: 0,
    bundleKinds: [],
  }
  const tags = new Set<string>()
  for (const tag of manifest.tags ?? []) tags.add(tag.toLowerCase())

  if (manifest.kind === 'site-pack') {
    const payload = manifest.payload as SitePackPayload
    summary.siteCount = payload.sites.length
    summary.categoryCount = payload.categories?.length ?? 0
    const hostCounts = new Map<string, number>()
    for (const site of payload.sites) {
      for (const tag of site.tags ?? []) tags.add(tag.toLowerCase())
      try {
        const host = new URL(site.url).host.toLowerCase()
        hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1)
      } catch {
        // 已校验过的 URL 不会走到这里；防御性忽略
      }
    }
    summary.hosts = [...hostCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([host]) => host)
  } else if (manifest.kind === 'workspace-preset') {
    const payload = manifest.payload as WorkspacePresetPayload
    summary.boardCount = payload.boards.length
    const types = new Set<string>()
    let widgetCount = 0
    for (const board of payload.boards) {
      widgetCount += board.widgets.length
      for (const widget of board.widgets) types.add(widget.type)
    }
    summary.widgetCount = widgetCount
    summary.widgetTypes = [...types].slice(0, 12)
  } else if (manifest.kind === 'theme') {
    const payload = manifest.payload as ThemePayload
    summary.accent = payload.accent
    summary.themeTokenCount = payload.tokens ? Object.keys(payload.tokens).length : 0
  } else if (manifest.kind === 'search-pack') {
    const payload = manifest.payload as SearchPackPayload
    summary.engineCount = payload.engines?.length ?? 0
    summary.enginePrefixes = (payload.engines ?? []).map((e) => e.prefix)
  } else {
    const payload = manifest.payload as BundlePayload
    summary.bundleItemCount = payload.items?.length ?? 0
    summary.bundleKinds = [...new Set((payload.items ?? []).map((item) => item.kind))]
  }
  summary.uniqueTagCount = tags.size
  return summary
}

/** 语义化版本比较（数值段）：a>b 返回 1，a<b 返回 -1，相等返回 0 */
export function comparePluginVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/* ------------------------------------------------------------------ *
 * 版本升级差异对比 (Plugin Version Upgrade Diff)
 * ------------------------------------------------------------------ */

export interface PluginDiffSiteChange {
  url: string
  title: string
  category?: string
  status: 'added' | 'removed' | 'modified' | 'unchanged'
  changes?: string[]
}

export interface PluginDiffThemeTokenChange {
  token: string
  oldValue?: string
  newValue?: string
  status: 'added' | 'removed' | 'modified'
}

export interface PluginDiffResult {
  kind: PluginKind
  versionFrom: string
  versionTo: string
  versionCompared: number
  hasChanges: boolean
  nameChanged: boolean
  descriptionChanged: boolean
  oldName?: string
  newName?: string
  // site-pack
  siteChanges?: PluginDiffSiteChange[]
  sitesAddedCount: number
  sitesRemovedCount: number
  sitesModifiedCount: number
  sitesUnchangedCount: number
  categoriesAdded: string[]
  // workspace-preset
  boardsAdded: string[]
  boardsRemoved: string[]
  widgetsAddedCount: number
  widgetsRemovedCount: number
  // theme
  accentChanged: boolean
  oldAccent?: ThemeAccent
  newAccent?: ThemeAccent
  tokenChanges?: PluginDiffThemeTokenChange[]
  tokensAddedCount: number
  tokensRemovedCount: number
  tokensModifiedCount: number
  // search-pack
  enginesAdded: string[]
  enginesRemoved: string[]
  // bundle
  bundleItemsAdded: string[]
  bundleItemsRemoved: string[]
}

/** 对比两个插件清单，计算升级变更差异 */
export function diffPluginManifests(base: PluginManifest, target: PluginManifest): PluginDiffResult {
  const versionCompared = comparePluginVersions(target.version, base.version)
  const nameChanged = base.name !== target.name
  const descriptionChanged = base.description !== target.description
  const kind = target.kind

  const result: PluginDiffResult = {
    kind,
    versionFrom: base.version,
    versionTo: target.version,
    versionCompared,
    hasChanges: false,
    nameChanged,
    descriptionChanged,
    oldName: nameChanged ? base.name : undefined,
    newName: nameChanged ? target.name : undefined,
    sitesAddedCount: 0,
    sitesRemovedCount: 0,
    sitesModifiedCount: 0,
    sitesUnchangedCount: 0,
    categoriesAdded: [],
    boardsAdded: [],
    boardsRemoved: [],
    widgetsAddedCount: 0,
    widgetsRemovedCount: 0,
    accentChanged: false,
    tokensAddedCount: 0,
    tokensRemovedCount: 0,
    tokensModifiedCount: 0,
    enginesAdded: [],
    enginesRemoved: [],
    bundleItemsAdded: [],
    bundleItemsRemoved: [],
  }

  if (nameChanged || descriptionChanged || base.version !== target.version || base.kind !== target.kind) {
    result.hasChanges = true
  }

  if (kind === 'site-pack' && base.kind === 'site-pack') {
    const basePayload = base.payload as SitePackPayload
    const targetPayload = target.payload as SitePackPayload
    const siteChanges: PluginDiffSiteChange[] = []

    const baseMap = new Map<string, SitePackSite>()
    for (const site of basePayload.sites) {
      baseMap.set(normalizePluginUrlKey(site.url), site)
    }

    const targetMap = new Map<string, SitePackSite>()
    for (const site of targetPayload.sites) {
      targetMap.set(normalizePluginUrlKey(site.url), site)
    }

    // 检查 target 中的站点（新增 或 变更/未变）
    for (const [key, tSite] of targetMap.entries()) {
      const bSite = baseMap.get(key)
      if (!bSite) {
        siteChanges.push({
          url: tSite.url,
          title: tSite.title,
          category: tSite.category,
          status: 'added',
        })
        result.sitesAddedCount++
        result.hasChanges = true
      } else {
        const changes: string[] = []
        if (bSite.title !== tSite.title) changes.push(`标题变更为「${tSite.title}」`)
        if ((bSite.category ?? '') !== (tSite.category ?? '')) changes.push(`分类变更为「${tSite.category ?? '无'}」`)
        if ((bSite.description ?? '') !== (tSite.description ?? '')) changes.push('描述更新')
        if (JSON.stringify(bSite.tags ?? []) !== JSON.stringify(tSite.tags ?? [])) changes.push('标签变动')

        if (changes.length > 0) {
          siteChanges.push({
            url: tSite.url,
            title: tSite.title,
            category: tSite.category,
            status: 'modified',
            changes,
          })
          result.sitesModifiedCount++
          result.hasChanges = true
        } else {
          siteChanges.push({
            url: tSite.url,
            title: tSite.title,
            category: tSite.category,
            status: 'unchanged',
          })
          result.sitesUnchangedCount++
        }
      }
    }

    // 检查 base 中被移除的站点
    for (const [key, bSite] of baseMap.entries()) {
      if (!targetMap.has(key)) {
        siteChanges.push({
          url: bSite.url,
          title: bSite.title,
          category: bSite.category,
          status: 'removed',
        })
        result.sitesRemovedCount++
        result.hasChanges = true
      }
    }

    // 分类变更
    const baseCats = new Set((basePayload.categories ?? []).map((c) => c.title.toLowerCase()))
    for (const cat of targetPayload.categories ?? []) {
      if (!baseCats.has(cat.title.toLowerCase())) {
        result.categoriesAdded.push(cat.title)
        result.hasChanges = true
      }
    }

    result.siteChanges = siteChanges
  } else if (kind === 'workspace-preset' && base.kind === 'workspace-preset') {
    const basePayload = base.payload as WorkspacePresetPayload
    const targetPayload = target.payload as WorkspacePresetPayload

    const baseBoardNames = new Set(basePayload.boards.map((b) => b.name))
    const targetBoardNames = new Set(targetPayload.boards.map((b) => b.name))

    for (const b of targetPayload.boards) {
      if (!baseBoardNames.has(b.name)) {
        result.boardsAdded.push(b.name)
        result.hasChanges = true
      }
    }
    for (const b of basePayload.boards) {
      if (!targetBoardNames.has(b.name)) {
        result.boardsRemoved.push(b.name)
        result.hasChanges = true
      }
    }

    const baseWidgetCount = basePayload.boards.reduce((acc, b) => acc + b.widgets.length, 0)
    const targetWidgetCount = targetPayload.boards.reduce((acc, b) => acc + b.widgets.length, 0)
    if (targetWidgetCount > baseWidgetCount) {
      result.widgetsAddedCount = targetWidgetCount - baseWidgetCount
      result.hasChanges = true
    } else if (targetWidgetCount < baseWidgetCount) {
      result.widgetsRemovedCount = baseWidgetCount - targetWidgetCount
      result.hasChanges = true
    }
  } else if (kind === 'theme' && base.kind === 'theme') {
    const basePayload = base.payload as ThemePayload
    const targetPayload = target.payload as ThemePayload

    if (basePayload.accent !== targetPayload.accent) {
      result.accentChanged = true
      result.oldAccent = basePayload.accent
      result.newAccent = targetPayload.accent
      result.hasChanges = true
    }

    const baseTokens = basePayload.tokens ?? {}
    const targetTokens = targetPayload.tokens ?? {}
    const tokenChanges: PluginDiffThemeTokenChange[] = []

    for (const [key, tVal] of Object.entries(targetTokens)) {
      if (!(key in baseTokens)) {
        tokenChanges.push({ token: key, newValue: tVal, status: 'added' })
        result.tokensAddedCount++
        result.hasChanges = true
      } else if (baseTokens[key] !== tVal) {
        tokenChanges.push({ token: key, oldValue: baseTokens[key], newValue: tVal, status: 'modified' })
        result.tokensModifiedCount++
        result.hasChanges = true
      }
    }

    for (const [key, bVal] of Object.entries(baseTokens)) {
      if (!(key in targetTokens)) {
        tokenChanges.push({ token: key, oldValue: bVal, status: 'removed' })
        result.tokensRemovedCount++
        result.hasChanges = true
      }
    }

    result.tokenChanges = tokenChanges
  } else if (kind === 'search-pack' && base.kind === 'search-pack') {
    const basePayload = base.payload as SearchPackPayload
    const targetPayload = target.payload as SearchPackPayload
    const basePrefixes = new Set((basePayload.engines ?? []).map((e) => e.prefix))
    const targetPrefixes = new Set((targetPayload.engines ?? []).map((e) => e.prefix))

    for (const e of targetPayload.engines ?? []) {
      if (!basePrefixes.has(e.prefix)) {
        result.enginesAdded.push(e.name || e.prefix)
        result.hasChanges = true
      }
    }
    for (const e of basePayload.engines ?? []) {
      if (!targetPrefixes.has(e.prefix)) {
        result.enginesRemoved.push(e.name || e.prefix)
        result.hasChanges = true
      }
    }
  } else if (kind === 'bundle' && base.kind === 'bundle') {
    const basePayload = base.payload as BundlePayload
    const targetPayload = target.payload as BundlePayload
    const baseItems = new Map((basePayload.items ?? []).map((item) => [item.slug, item.kind]))
    const targetItems = new Map((targetPayload.items ?? []).map((item) => [item.slug, item.kind]))

    for (const [slug, itemKind] of targetItems) {
      const previousKind = baseItems.get(slug)
      if (previousKind !== itemKind) {
        result.bundleItemsAdded.push(slug)
        if (previousKind) result.bundleItemsRemoved.push(slug)
        result.hasChanges = true
      }
    }
    for (const slug of baseItems.keys()) {
      if (!targetItems.has(slug)) {
        result.bundleItemsRemoved.push(slug)
        result.hasChanges = true
      }
    }
  }

  return result
}

