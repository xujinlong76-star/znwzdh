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
    pluginSlug: 'dev-search-arsenal',
  },
  {
    id: 'npm',
    name: 'npm',
    prefix: '!npm',
    searchUrl: 'https://www.npmjs.com/search?q={q}',
    description: 'JavaScript / TypeScript 依赖包检索',
    icon: 'https://static-production.npmjs.com/b0f1a8318363185cc2ea6a400e32622c.png',
    pluginSlug: 'dev-search-arsenal',
  },
  {
    id: 'mdn',
    name: 'MDN Web Docs',
    prefix: '!mdn',
    searchUrl: 'https://developer.mozilla.org/zh-CN/search?q={q}',
    description: '权威 Web 技术规范与 API 参考手册',
    icon: 'https://developer.mozilla.org/favicon-48x48.png',
    pluginSlug: 'dev-search-arsenal',
  },
  {
    id: 'stackoverflow',
    name: 'Stack Overflow',
    prefix: '!so',
    searchUrl: 'https://stackoverflow.com/search?q={q}',
    description: '程序员技术问答与疑难方案直达',
    icon: 'https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico',
    pluginSlug: 'dev-search-arsenal',
  },
  {
    id: 'devdocs',
    name: 'DevDocs',
    prefix: '!dd',
    searchUrl: 'https://devdocs.io/#q={q}',
    description: '全栈开发文档快速速查',
    icon: 'https://devdocs.io/favicon.ico',
    pluginSlug: 'dev-search-arsenal',
  },
  {
    id: 'caniuse',
    name: 'Can I use',
    prefix: '!caniuse',
    searchUrl: 'https://caniuse.com/?search={q}',
    description: '前端现代特性与浏览器兼容性查询',
    icon: 'https://caniuse.com/img/favicon-128.png',
    pluginSlug: 'dev-search-arsenal',
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

export function getAllSearchEngines(): InstalledSearchEngine[] {
  const custom = getCustomSearchEngines()
  const customPrefixes = new Set(custom.map((e) => e.prefix.toLowerCase()))
  const preservedDefaults = DEFAULT_SEARCH_ENGINES.filter(
    (def) => !customPrefixes.has(def.prefix.toLowerCase())
  )
  return [...preservedDefaults, ...custom]
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
