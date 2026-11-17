'use client'

/**
 * 搜索引擎扩展包运行时 (Search-Pack Runtime Engine)
 *
 * 核心设计目标：
 * 1. 语法直达：在全站搜索框支持 `!前缀 关键词`（如 `!gh react`）快速定向检索；
 * 2. 默认开箱即用：内置开发者常用直达引擎（GitHub、npm、MDN、Stack Overflow 等）；
 * 3. 动态扩展：用户从插件市场安装 search-pack 后，清单中的自定义引擎自动注入并持久化。
 */

export interface InstalledSearchEngine {
  id: string
  name: string
  prefix: string
  searchUrl: string
  description?: string
  icon?: string
  pluginSlug?: string
  /**
   * P3-8：内置引擎标识。系统自带的 6 个默认引擎为 true；插件注册的
   * 引擎（registerSearchPackEngines 写入）与用户 quicklink 转来的引擎
   * 均为 false/缺省。以前默认引擎挂着 pluginSlug 'dev-search-arsenal'，
   * 看起来像来自某个插件，与插件引擎无法区分，现已去掉、只认本字段。
   */
  builtin?: boolean
}

export const SEARCH_PACKS_STORAGE_KEY = 'navhub_installed_search_engines_v1'

export const DEFAULT_SEARCH_ENGINES: InstalledSearchEngine[] = [
  {
    id: 'github',
    name: 'GitHub',
    prefix: '!gh',
    searchUrl: 'https://github.com/search?q={q}',
    description: '检索开源项目、代码与 Issue',
    icon: 'https://github.githubassets.com/favicons/favicon.svg',
    builtin: true,
  },
  {
    id: 'npm',
    name: 'npm',
    prefix: '!npm',
    searchUrl: 'https://www.npmjs.com/search?q={q}',
    description: 'JavaScript / TypeScript 依赖包检索',
    icon: 'https://static-production.npmjs.com/b0f1a8318363185cc2ea6a400e32622c.png',
    builtin: true,
  },
  {
    id: 'mdn',
    name: 'MDN Web Docs',
    prefix: '!mdn',
    searchUrl: 'https://developer.mozilla.org/zh-CN/search?q={q}',
    description: '权威 Web 技术规范与 API 参考手册',
    icon: 'https://developer.mozilla.org/favicon-48x48.png',
    builtin: true,
  },
  {
    id: 'stackoverflow',
    name: 'Stack Overflow',
    prefix: '!so',
    searchUrl: 'https://stackoverflow.com/search?q={q}',
    description: '程序员技术问答与疑难方案直达',
    icon: 'https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico',
    builtin: true,
  },
  {
    id: 'devdocs',
    name: 'DevDocs',
    prefix: '!dd',
    searchUrl: 'https://devdocs.io/#q={q}',
    description: '全栈开发文档快速速查',
    icon: 'https://devdocs.io/favicon.ico',
    builtin: true,
  },
  {
    id: 'caniuse',
    name: 'Can I use',
    prefix: '!caniuse',
    searchUrl: 'https://caniuse.com/?search={q}',
    description: '前端现代特性与浏览器兼容性查询',
    icon: 'https://caniuse.com/img/favicon-128.png',
    builtin: true,
  },
]

export function getCustomSearchEngines(): InstalledSearchEngine[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(SEARCH_PACKS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCustomSearchEngines(engines: InstalledSearchEngine[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SEARCH_PACKS_STORAGE_KEY, JSON.stringify(engines))
    window.dispatchEvent(new CustomEvent('navhub_search_engines_changed', { detail: engines }))
  } catch {
    // 忽略存储受限环境
  }
}

/** P3-8：是不是系统自带引擎。只认 builtin 字段，不认 pluginSlug（默认引擎以前挂着假的 pluginSlug）。 */
export function isBuiltinSearchEngine(engine: InstalledSearchEngine): boolean {
  return engine.builtin === true
}

export function getAllSearchEngines(): InstalledSearchEngine[] {
  const custom = getCustomSearchEngines()
  const customPrefixes = new Set(custom.map((e) => e.prefix.toLowerCase()))
  const preservedDefaults = DEFAULT_SEARCH_ENGINES.filter(
    (def) => !customPrefixes.has(def.prefix.toLowerCase())
  ).map((def) => ({ ...def, builtin: true }))
  return [...preservedDefaults, ...custom]
}

/**
 * 注册某个 search-pack 的清单引擎（安装 / 升级时调用）。
 *
 * 覆盖式：先移除该插件此前的注册，再写入最新清单；同前缀的其它插件引擎让位，
 * 避免重复前缀在 `!` 直达时命中歧义。清单已过服务端校验，这里仍做防御性归一化。
 */
export function registerSearchPackEngines(slug: string, engines: unknown): void {
  const list = Array.isArray(engines) ? engines : []
  const normalized: InstalledSearchEngine[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const engine = raw as Record<string, unknown>
    const prefix = typeof engine.prefix === 'string' ? engine.prefix.trim() : ''
    const searchUrl = typeof engine.searchUrl === 'string' ? engine.searchUrl.trim() : ''
    if (!prefix || !searchUrl.includes('{q}')) continue
    normalized.push({
      id: typeof engine.id === 'string' && engine.id.trim() ? engine.id : `${slug}::${prefix}`,
      name: typeof engine.name === 'string' && engine.name.trim() ? engine.name.trim() : prefix,
      prefix,
      searchUrl,
      ...(typeof engine.description === 'string' ? { description: engine.description } : {}),
      ...(typeof engine.icon === 'string' ? { icon: engine.icon } : {}),
      pluginSlug: slug,
    })
  }
  const prefixes = new Set(normalized.map((e) => e.prefix.toLowerCase()))
  const kept = getCustomSearchEngines().filter(
    (e) => e.pluginSlug !== slug && !prefixes.has(e.prefix.toLowerCase())
  )
  saveCustomSearchEngines([...kept, ...normalized])
}

/** 卸载 search-pack 时移除其注册的引擎；内置默认引擎与其它插件不受影响。 */
export function unregisterSearchPackEngines(slug: string): void {
  saveCustomSearchEngines(getCustomSearchEngines().filter((e) => e.pluginSlug !== slug))
}

export interface MatchSearchResult {
  matched: boolean
  prefix?: string
  keyword?: string
  engine?: InstalledSearchEngine
  directUrl?: string
}

export function matchSearchShortcut(
  query: string,
  engines: InstalledSearchEngine[] = getAllSearchEngines()
): MatchSearchResult {
  const trimmed = query.trim()
  if (!trimmed.startsWith('!')) return { matched: false }

  const match = trimmed.match(/^(![a-zA-Z0-9_-]+)(?:\s+(.*))?$/)
  if (!match) return { matched: false }

  const prefix = match[1].toLowerCase()
  const keyword = match[2]?.trim() ?? ''

  const targetEngine = engines.find((e) => e.prefix.toLowerCase() === prefix)
  if (!targetEngine) return { matched: false }

  const directUrl = targetEngine.searchUrl.replace('{q}', encodeURIComponent(keyword))
  return {
    matched: true,
    prefix,
    keyword,
    engine: targetEngine,
    directUrl,
  }
}
