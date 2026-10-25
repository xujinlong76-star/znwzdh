/**
 * AI 插件工坊的派生逻辑（第五批 A3.2）。
 *
 * 从 ai-plugin-studio-modal.tsx 抽出的三段纯计算——它们原先以 useMemo /
 * 事件处理器内联在 1719 行的弹窗里，既无法单测，也让组件体量虚高：
 *   1. computeManifestDiff —— Diff Inspector 的增删清单（站点按 URL 归一化、
 *      引擎按前缀、标签按集合、版本/名称变更，聚合出 hasChanges）；
 *   2. extractManifestUrls —— 健康体检的探活目标提取（site-pack 取站点、
 *      search-pack 把 {q} 替换成测试词，去重后封顶 30 条）；
 *   3. applyMetaEdits —— 元数据微调表单到清单的合并（空串回落原值、
 *      标签按中英文逗号/空白切分）。
 *
 * 语义必须与弹窗内原实现逐字等价（behavior-preserving 拆分），
 * 由 plugin-studio-derived.test.ts 钉住。
 */
import type { PluginManifest, SearchEngineItem, SearchPackPayload, SitePackPayload } from './plugin-manifest'

export interface ManifestSiteRef {
  title: string
  url: string
  category?: string
}

export interface ManifestDiff {
  hasChanges: boolean
  addedSites: ManifestSiteRef[]
  removedSites: ManifestSiteRef[]
  addedEngines: SearchEngineItem[]
  removedEngines: SearchEngineItem[]
  addedTags: string[]
  removedTags: string[]
  versionChange?: { from: string | undefined; to: string | undefined }
  nameChange?: { from: string | undefined; to: string | undefined }
}

/** 归一化 URL 作为站点身份：trim + 小写（与原实现一致的宽松口径） */
function siteKey(url: string): string {
  return url.trim().toLowerCase()
}

export function computeManifestDiff(
  previous: PluginManifest | null,
  current: PluginManifest | null,
): ManifestDiff | null {
  if (!previous || !current) return null

  const prevSites: ManifestSiteRef[] =
    previous.kind === 'site-pack' ? (previous.payload as SitePackPayload).sites || [] : []
  const currSites: ManifestSiteRef[] =
    current.kind === 'site-pack' ? (current.payload as SitePackPayload).sites || [] : []

  const prevSiteMap = new Map(prevSites.map((s) => [siteKey(s.url), s]))
  const currSiteMap = new Map(currSites.map((s) => [siteKey(s.url), s]))

  const addedSites = currSites.filter((s) => !prevSiteMap.has(siteKey(s.url)))
  const removedSites = prevSites.filter((s) => !currSiteMap.has(siteKey(s.url)))

  const prevEngines =
    previous.kind === 'search-pack' ? (previous.payload as SearchPackPayload).engines || [] : []
  const currEngines =
    current.kind === 'search-pack' ? (current.payload as SearchPackPayload).engines || [] : []
  const prevEngPrefixes = new Set(prevEngines.map((e) => e.prefix))
  const currEngPrefixes = new Set(currEngines.map((e) => e.prefix))
  const addedEngines = currEngines.filter((e) => !prevEngPrefixes.has(e.prefix))
  const removedEngines = prevEngines.filter((e) => !currEngPrefixes.has(e.prefix))

  const prevTags = new Set(previous.tags || [])
  const currTags = new Set(current.tags || [])
  const addedTags = (current.tags || []).filter((t) => !prevTags.has(t))
  const removedTags = (previous.tags || []).filter((t) => !currTags.has(t))

  const versionChange =
    previous.version !== current.version
      ? { from: previous.version, to: current.version }
      : undefined
  const nameChange =
    previous.name !== current.name ? { from: previous.name, to: current.name } : undefined

  const hasChanges = Boolean(
    addedSites.length > 0 ||
      removedSites.length > 0 ||
      addedEngines.length > 0 ||
      removedEngines.length > 0 ||
      addedTags.length > 0 ||
      removedTags.length > 0 ||
      versionChange ||
      nameChange,
  )

  return {
    hasChanges,
    addedSites,
    removedSites,
    addedEngines,
    removedEngines,
    addedTags,
    removedTags,
    versionChange,
    nameChange,
  }
}

/**
 * 提取清单内所有待探活的外部 URL。
 * search-pack 的 searchUrl 含 {q} 占位符，替换成固定测试词后再提取（与原实现一致）；
 * 去重后封顶 30 条（与服务端 check-urls 的单次上限对齐）。
 */
export function extractManifestUrls(manifest: PluginManifest | null): string[] {
  if (!manifest) return []
  const urls: string[] = []
  if (manifest.kind === 'site-pack') {
    const payload = manifest.payload as SitePackPayload
    if (Array.isArray(payload.sites)) {
      for (const s of payload.sites) {
        if (s.url) urls.push(s.url)
      }
    }
  } else if (manifest.kind === 'search-pack') {
    const payload = manifest.payload as SearchPackPayload
    if (Array.isArray(payload.engines)) {
      for (const e of payload.engines) {
        if (e.searchUrl) {
          urls.push(e.searchUrl.replace(/\{q\}/g, 'navhub'))
        }
      }
    }
  }
  return Array.from(new Set(urls)).slice(0, 30)
}

export interface ManifestMetaEdits {
  name: string
  description: string
  author: string
  version: string
  /** 表单原始串：按中英文逗号与空白切分，空片段丢弃 */
  tags: string
}

/**
 * 元数据微调 → 新清单。空字段回落原值（description 例外：显式允许清空，
 * 与原实现一致——只有 name/author/version 有 `|| manifest.x` 兜底）。
 */
export function applyMetaEdits(
  manifest: PluginManifest,
  edits: ManifestMetaEdits,
): PluginManifest {
  return {
    ...manifest,
    name: edits.name.trim() || manifest.name,
    description: edits.description.trim(),
    author: edits.author.trim() || manifest.author,
    version: edits.version.trim() || manifest.version,
    tags: edits.tags
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean),
  }
}
