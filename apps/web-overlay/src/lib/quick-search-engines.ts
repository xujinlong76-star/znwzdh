/**
 * 快捷搜索（quick-search 小卡）的引擎表与自定义引擎。
 *
 * 为什么单独抽一层：引擎 URL 是拼出来的外跳地址，错一个字符就把用户送错站；
 * 自定义引擎又是用户手填的输入，必须经过同一套校验。纯函数放这里，组件只负责
 * 渲染与本机持久化，测试可以直接测这一层。
 *
 * 内置引擎口径：
 * - 通用搜索放前面（Google / 百度 / 必应 / 搜狗 / 知乎），开发类放后面
 *   （GitHub / npm / MDN）——导航站的读者首先是普通用户，不是只有开发者。
 * - 知乎用站内搜索 `type=content`，搜问题与文章；微信文章是搜狗的独占信源，
 *   走搜狗网页搜索即可覆盖到 `weixin.sogou.com` 的结果页。
 */

import { isSafeHttpUrl } from '@/lib/safe-url'

export interface SearchEngine {
  id: string
  name: string
  icon: string
  buildUrl: (q: string) => string
}

export const BUILTIN_SEARCH_ENGINES: Record<string, SearchEngine> = {
  google: {
    id: 'google',
    name: 'Google',
    icon: '🔍',
    buildUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  baidu: {
    id: 'baidu',
    name: '百度',
    icon: '🔎',
    buildUrl: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
  },
  bing: {
    id: 'bing',
    name: 'Bing',
    icon: '🌐',
    buildUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  },
  sogou: {
    id: 'sogou',
    name: '搜狗',
    icon: '🐶',
    buildUrl: (q) => `https://www.sogou.com/web?query=${encodeURIComponent(q)}`,
  },
  zhihu: {
    id: 'zhihu',
    name: '知乎',
    icon: '💡',
    buildUrl: (q) => `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(q)}`,
  },
  github: {
    id: 'github',
    name: 'GitHub',
    icon: '🐙',
    buildUrl: (q) => `https://github.com/search?q=${encodeURIComponent(q)}`,
  },
  npm: {
    id: 'npm',
    name: 'npm',
    icon: '📦',
    buildUrl: (q) => `https://www.npmjs.com/search?q=${encodeURIComponent(q)}`,
  },
  mdn: {
    id: 'mdn',
    name: 'MDN',
    icon: '📚',
    buildUrl: (q) => `https://developer.mozilla.org/zh-CN/search?q=${encodeURIComponent(q)}`,
  },
}

/** 自定义引擎在页签里占的 id，与内置引擎 id 互不重叠 */
export const CUSTOM_ENGINE_ID = 'custom'

/** 选中的引擎（内置 id 或 'custom'），只存本机 */
export const QUICK_SEARCH_ENGINE_KEY = 'navhub_quick_search_engine'

/** 自定义引擎（{ name, template } 的 JSON），只存本机 */
export const QUICK_SEARCH_CUSTOM_ENGINE_KEY = 'navhub_quick_search_custom_engine'

export interface CustomSearchEngine {
  name: string
  /** 搜索地址模板，必须含一个 %s 占位，如 https://example.com/search?q=%s */
  template: string
}

/**
 * 自定义模板是否可用：必须含 %s、必须以 https:// 开头、代入探测词后仍是
 * 无 userinfo 的合法 https 地址。http 不放行——搜索词走明文会泄漏查询内容；
 * javascript:/data: 与带 userinfo 的钓鱼串由 isSafeHttpUrl 一并挡掉。
 */
export function isValidCustomEngineTemplate(template: string): boolean {
  const t = template.trim()
  if (!t.includes('%s')) return false
  if (!t.startsWith('https://')) return false
  return isSafeHttpUrl(t.split('%s').join('test'))
}

/** 从 localStorage 里读出的原始串解析成自定义引擎，脏数据一律当不存在 */
export function parseCustomEngine(raw: string | null): CustomSearchEngine | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const { name, template } = parsed as Record<string, unknown>
    if (typeof name !== 'string' || typeof template !== 'string') return null
    const cleanName = name.trim()
    if (!cleanName || cleanName.length > 12) return null
    if (!isValidCustomEngineTemplate(template)) return null
    return { name: cleanName, template: template.trim() }
  } catch {
    return null
  }
}

/** 把查询词填进模板：%s 出现几次就替换几次，查询词做编码 */
export function buildCustomEngineUrl(template: string, q: string): string {
  return template.split('%s').join(encodeURIComponent(q))
}

/**
 * 本机存的选择优先于卡片配置的默认引擎；两者都不可用时回 Google。
 * stored === 'custom' 只有在自定义引擎真实存在时才算数，否则视为过期选择。
 */
export function resolveSelectedEngineId(args: {
  stored: string | null
  configured: string
  hasCustom: boolean
}): string {
  const { stored, configured, hasCustom } = args
  if (stored === CUSTOM_ENGINE_ID && hasCustom) return CUSTOM_ENGINE_ID
  if (stored !== null && Object.prototype.hasOwnProperty.call(BUILTIN_SEARCH_ENGINES, stored)) {
    return stored
  }
  if (Object.prototype.hasOwnProperty.call(BUILTIN_SEARCH_ENGINES, configured)) {
    return configured
  }
  return 'google'
}
