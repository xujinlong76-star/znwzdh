/**
 * 参数化快捷链接（Quicklinks）：用户自建的 search-pack 引擎。
 *
 * 设计（与 P1 ⌘K 万能栏同一轮定稿）：
 *  - 不再造第三套引擎：Quicklink = 挂在收藏上的 search-pack 引擎，
 *    宿主是收藏不是插件包，复用 `{q}` 语法与 `InstalledSearchEngine` 形态。
 *  - 纯函数、零 React、零存储 IO：校验 / 代入 / 匹配全是可单测的纯函数，
 *    读本地收藏与写 localStorage 留给 hooks / 组件层。
 *  - 占位符只认 `{q}`，恰好一个；编码整段参数一次 `encodeURIComponent`，
 *    禁用 `encodeURI`（v1 只有单个 `{q}`，不做多参数）。
 *  - 安全闸是创建时 + 打开时双重：创建时 `validateQuicklink` 全量校验，
 *    打开时 `resolveQuicklinkUrl` 再过一次 `safeHref` / `isSafeHttpUrl`。
 *  - 云端同步不带模板（FavoriteSyncOp 与服务端 zod 只有
 *    siteId/folderId/note/tags）：v1 本地 only，换设备会丢模板。
 */

import { isSafeHttpUrl, safeHref } from './safe-url'
import { INVISIBLE_OR_BIDI_PATTERN } from './plugins/plugin-manifest'
import {
  DEFAULT_SEARCH_ENGINES,
  type InstalledSearchEngine,
} from './plugins/search-pack-runtime'

/** 模板 URL 长度上限（字符） */
export const QUICKLINK_MAX_TEMPLATE_LENGTH = 2048

/** 搜索参数长度上限（trim 后字符数）：超长拒绝并 toast，不静默截断 */
export const QUICKLINK_MAX_ARG_LENGTH = 500

/** 前缀归一后必须匹配：1–15 个小写字母 / 数字 / _ / - */
export const QUICKLINK_PREFIX_PATTERN = /^[a-z0-9_-]{1,15}$/

/** C0 控制字符与 DEL：合法 URL 里不该出现（创建时与打开时复用同一导出） */
export const QUICKLINK_CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** 内置引擎前缀（OMNI_ENGINES + search-pack 内置 6 个的并集）：用户前缀撞上它们时创建时警告，触发时用户优先 */
export const BUILTIN_QUICKLINK_PREFIXES: readonly string[] = [
  'g',
  'google',
  'gh',
  'github',
  'npm',
  'bing',
  'mdn',
  'baidu',
  'bd',
  'so',
  'dd',
  'caniuse',
]

export interface QuicklinkEntry {
  siteId: string
  title: string
  href: string
  icon?: string
  /** 归一后：小写、不含 `!` */
  quickPrefix: string
  /** 含恰好一个 `{q}` 的绝对 http(s) URL */
  templateUrl: string
}

export type QuicklinkValidateReason =
  | 'empty-prefix'
  | 'bad-prefix'
  | 'missing-placeholder'
  | 'multiple-placeholders'
  | 'placeholder-in-origin'
  | 'unsafe-url'
  | 'too-long'
  | 'control-chars'

export type QuicklinkValidateResult =
  | { ok: true; prefix: string; templateUrl: string }
  | { ok: false; reason: QuicklinkValidateReason; message: string }

/** 前缀归一：trim → 去首个 `!` → 小写 */
export function normalizeQuicklinkPrefix(raw: string): string {
  const trimmed = (typeof raw === 'string' ? raw : '').trim()
  const withoutBang = trimmed.startsWith('!') ? trimmed.slice(1) : trimmed
  return withoutBang.toLowerCase()
}

function countPlaceholders(templateUrl: string): number {
  return (templateUrl.match(/\{q\}/g) ?? []).length
}

/** `{q}` 在 origin 里的位置：`scheme`（协议段）/ `authority`（域名/端口段）/ null（不在 origin 里） */
function placeholderOriginLocation(templateUrl: string): 'scheme' | 'authority' | null {
  const placeholderIndex = templateUrl.indexOf('{q}')
  if (placeholderIndex === -1) return null
  const schemeEnd = templateUrl.indexOf('://')
  if (schemeEnd === -1) return null
  if (placeholderIndex < schemeEnd) return 'scheme'
  const authority = templateUrl.slice(schemeEnd + 3)
  const authorityEnd = authority.search(/[/#?]/)
  const authorityLength = authorityEnd === -1 ? authority.length : authorityEnd
  return placeholderIndex - (schemeEnd + 3) < authorityLength ? 'authority' : null
}

/**
 * 创建时校验（安全闸第一重）。
 *
 * 顺序即优先级：空前缀 → 坏前缀 → 控制字符 → 超长 → 缺/多占位符 →
 * 占位符在 origin 里 → 探针替换后不是安全 http(s) URL。
 */
export function validateQuicklink(input: { prefix: string; templateUrl: string }): QuicklinkValidateResult {
  const prefix = normalizeQuicklinkPrefix(typeof input.prefix === 'string' ? input.prefix : '')
  if (!prefix) {
    return { ok: false, reason: 'empty-prefix', message: '请填写快捷前缀，如 gh' }
  }
  if (!QUICKLINK_PREFIX_PATTERN.test(prefix)) {
    return {
      ok: false,
      reason: 'bad-prefix',
      message: '前缀只能用 1–15 个小写字母、数字、_ 或 -，不能含空格与中文',
    }
  }
  const templateUrl = (typeof input.templateUrl === 'string' ? input.templateUrl : '').trim()
  if (QUICKLINK_CONTROL_CHARS.test(templateUrl) || INVISIBLE_OR_BIDI_PATTERN.test(templateUrl)) {
    return { ok: false, reason: 'control-chars', message: '模板含控制字符或不可见/双向控制字符，已拒绝' }
  }
  if (templateUrl.length > QUICKLINK_MAX_TEMPLATE_LENGTH) {
    return { ok: false, reason: 'too-long', message: `模板超过 ${QUICKLINK_MAX_TEMPLATE_LENGTH} 字符上限` }
  }
  const placeholders = countPlaceholders(templateUrl)
  if (placeholders === 0) {
    return { ok: false, reason: 'missing-placeholder', message: '模板里必须恰好有一个 {q} 占位符' }
  }
  if (placeholders > 1) {
    return { ok: false, reason: 'multiple-placeholders', message: '模板里只能有一个 {q} 占位符' }
  }
  // `{q}` 必须在 origin 之后（pathname/search/hash 内）：`https://{q}.example.com/`
  // 会让用户输入决定打开哪个域名，是开放重定向，必须拒绝。
  const originLocation = placeholderOriginLocation(templateUrl)
  if (originLocation === 'scheme') {
    return { ok: false, reason: 'placeholder-in-origin', message: '{q} 不能出现在协议里' }
  }
  if (originLocation === 'authority') {
    return { ok: false, reason: 'placeholder-in-origin', message: '{q} 不能出现在域名里，只能在路径或参数里' }
  }
  // 探针替换后必须是绝对 http(s) URL、无 userinfo：javascript: / data: /
  // 带 userinfo / 相对路径都在这里出局。
  const probe = templateUrl.replaceAll('{q}', '__probe__')
  if (!isSafeHttpUrl(probe)) {
    return { ok: false, reason: 'unsafe-url', message: '模板必须是绝对 http(s) 地址，且不能带用户名密码' }
  }
  return { ok: true, prefix, templateUrl }
}

/**
 * 收藏 → Quicklink：两个字段缺任一 → null；模板非法（创建时校验不过）
 * → null。调用方拿到的 entry 一定是创建时校验通过的形态。
 */
export function quicklinkFromFavorite(fav: {
  siteId: string
  title: string
  href: string
  icon?: string
  quickPrefix?: string
  templateUrl?: string
}): QuicklinkEntry | null {
  if (typeof fav.quickPrefix !== 'string' || typeof fav.templateUrl !== 'string') return null
  if (!fav.quickPrefix.trim() || !fav.templateUrl.trim()) return null
  const checked = validateQuicklink({ prefix: fav.quickPrefix, templateUrl: fav.templateUrl })
  if (!checked.ok) return null
  return {
    siteId: fav.siteId,
    title: fav.title,
    href: fav.href,
    icon: fav.icon,
    quickPrefix: checked.prefix,
    templateUrl: checked.templateUrl,
  }
}

/** 落地页：`{q}` → 空串；模板非法 → null */
export function landingUrl(templateUrl: string): string | null {
  return resolveQuicklinkUrl(templateUrl, '')
}

/**
 * 打开时代入（安全闸第二重）：整段参数一次 `encodeURIComponent`；
 * 超 500 字符、模板占位符不是恰好一个、`{q}` 在 origin 里、代入后不是
 * 安全 http(s) URL → null，调用方 toast、不开页。纵深防御：代入后的完整
 * URL 再验一次控制字符 / 不可见·双向控制字符与 2048 字符上限。
 */
export function resolveQuicklinkUrl(templateUrl: string, arg: string): string | null {
  const template = (typeof templateUrl === 'string' ? templateUrl : '').trim()
  if (countPlaceholders(template) !== 1) return null
  // 打开时同样拦 `{q}` 在 origin 里：代入后是合法 URL，但域名由用户输入
  // 决定（`https://{q}.example.com/` + `x` → `https://x.example.com/`），
  // 只靠 isSafeHttpUrl 拦不住。
  if (placeholderOriginLocation(template) !== null) return null
  const normalizedArg = (typeof arg === 'string' ? arg : '').trim()
  if (normalizedArg.length > QUICKLINK_MAX_ARG_LENGTH) return null
  const finalUrl = template.replaceAll('{q}', encodeURIComponent(normalizedArg))
  // 纵深防御（打开时再验一次，不依赖创建时校验）：代入后的完整 URL 同样
  // 不能含控制字符 / 不可见·双向控制字符，也不能超过 2048 字符——编码会
  // 把 500 字符的参数撑到 1500 字符，模板本身再长就可能越界。
  if (finalUrl.length > QUICKLINK_MAX_TEMPLATE_LENGTH) return null
  if (QUICKLINK_CONTROL_CHARS.test(finalUrl) || INVISIBLE_OR_BIDI_PATTERN.test(finalUrl)) return null
  if (!isSafeHttpUrl(finalUrl)) return null
  return safeHref(finalUrl, '') || null
}

export interface QuicklinkCommandMatch {
  entry: QuicklinkEntry
  /** trim 后的参数（`!gh` 无参时为空串，走落地页） */
  arg: string
  /**
   * 代入后的打开地址；前缀命中但代入失败（参数超 500 字符 / 模板已不安全）
   * 时为 null——调用方应 toast 而不是静默走正常搜索。
   */
  url: string | null
}

/**
 * 触发匹配：接受 `!gh react` 与 `gh react` 两种；`!gh`（无参数）命中落地页；
 * 裸 `gh`（无 `!`、无参数）不触发；`!unknown x` / 拼错前缀不触发；
 * `@gh react` 不走这里（保持 parseOmniCommand 现状）。
 * 前缀精确匹配，不做模糊 / 拼音容错；大小写不敏感。
 */
export function matchQuicklinkCommand(
  raw: string,
  entries: readonly QuicklinkEntry[],
): QuicklinkCommandMatch | null {
  const trimmed = (typeof raw === 'string' ? raw : '').trim()
  if (!trimmed) return null
  let prefixRaw: string
  let arg: string
  if (trimmed.startsWith('!')) {
    const match = trimmed.match(/^!([A-Za-z0-9_-]+)(?:\s+(.*))?$/)
    if (!match) return null
    prefixRaw = match[1]!
    arg = (match[2] ?? '').trim()
  } else {
    // 裸前缀必须带参数：`gh react` 命中，裸 `gh` 不触发、走正常搜索
    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s+(.+)$/)
    if (!match) return null
    prefixRaw = match[1]!
    arg = match[2]!.trim()
  }
  const entry = entries.find((e) => e.quickPrefix === prefixRaw.toLowerCase())
  if (!entry) return null
  return { entry, arg, url: resolveQuicklinkUrl(entry.templateUrl, arg) }
}

/** v1 可选：前缀联想——输入的前缀开头能对上哪些 quicklink（空输入返回 []） */
export function matchQuicklinkPrefix(query: string, entries: readonly QuicklinkEntry[]): QuicklinkEntry[] {
  const q = normalizeQuicklinkPrefix(query)
  if (!q) return []
  return entries.filter((e) => e.quickPrefix.startsWith(q))
}

/**
 * Quicklink → search-pack 引擎（prefix 补 `!`）。
 *
 * 同前缀覆盖内置：返回「quicklink 在前 + base 里同前缀被剔除的其余引擎」，
 * 调用方直接把它当 `matchSearchShortcut(query, engines)` 的 engines 用，
 * 用户 quicklink 自然优先于内置引擎。base 默认只含 6 个内置引擎；
 * 要带上用户安装的 search-pack 引擎时，调用方传 `getAllSearchEngines()`。
 */
export function toSearchEngines(
  entries: readonly QuicklinkEntry[],
  base: readonly InstalledSearchEngine[] = DEFAULT_SEARCH_ENGINES,
): InstalledSearchEngine[] {
  const converted: InstalledSearchEngine[] = entries.map((e) => ({
    id: `quicklink:${e.siteId}`,
    name: e.title,
    prefix: `!${e.quickPrefix}`,
    searchUrl: e.templateUrl,
  }))
  const taken = new Set(converted.map((e) => e.prefix.toLowerCase()))
  return [...converted, ...base.filter((e) => !taken.has(e.prefix.toLowerCase()))]
}

/** 前缀是不是撞上内置引擎（创建时警告用；触发时用户优先） */
export function isBuiltinQuicklinkPrefix(prefix: string): boolean {
  return BUILTIN_QUICKLINK_PREFIXES.includes(normalizeQuicklinkPrefix(prefix))
}

export type QuicklinkPrefixConflict = 'builtin' | 'duplicate' | null

/**
 * 创建时冲突检查：先看内置引擎，再看其它收藏已用的前缀。
 * 返回非 null 时调用方只警告、不拦截（用户优先是已定规则）。
 */
export function findQuicklinkPrefixConflict(
  prefix: string,
  entries: readonly QuicklinkEntry[],
  excludeSiteId?: string,
): QuicklinkPrefixConflict {
  const normalized = normalizeQuicklinkPrefix(prefix)
  if (!normalized) return null
  if (isBuiltinQuicklinkPrefix(normalized)) return 'builtin'
  if (entries.some((e) => e.siteId !== excludeSiteId && e.quickPrefix === normalized)) return 'duplicate'
  return null
}
