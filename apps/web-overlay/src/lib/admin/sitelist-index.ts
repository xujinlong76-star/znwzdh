/**
 * 站点列表（/admin/sitelist）的分类归属索引与筛选。
 *
 * 从页面组件里抽出来的原因是一条实测的性能缺陷：原实现有两个函数
 *
 *     getSiteCategory(siteId)     // 遍历所有分类 × 子分类 × items 做 some()
 *     getSiteSubCategory(siteId)  // 同上
 *
 * 而它们在**每次渲染的每一行**上被调用 4 次（筛选 2 次 + 表格 2 个单元格各一次
 * getSiteCategoryInfo）。500 站点 / 20 分类 / 每分类 30 项的规模下，单次渲染就是
 * 120 万级比较；搜索框每敲一个字符都触发一轮，输入明显掉帧。
 *
 * 改成「一次遍历建索引 + O(1) 查表」后，建索引的成本只随分类树规模增长，
 * 与站点数量无关。筛选逻辑同时被抽成纯函数，可以脱离 React 钉住语义。
 *
 * 语义必须与原实现逐字等价（用 `none` 表示「无子分类」这类约定尤其容易改坏）：
 *   - 搜索：name / url / description 任一包含关键词，大小写不敏感
 *   - 分类：'all' 不限，否则要求 id 相等
 *   - 子分类：'all' 不限；'none' 只匹配「挂在主分类下」；否则要求 id 相等
 */

export interface SiteCategoryLike {
  id: string
  title: string
  items?: Array<{ id: string }>
  subCategories?: Array<{
    id: string
    title: string
    items?: Array<{ id: string }>
  }>
}

export interface SiteCategoryIndex {
  /** siteId -> 所属分类 id（挂在主分类或任一子分类下都算） */
  categoryOf: Map<string, string>
  /** siteId -> 所属子分类 id；挂在主分类下时为 ''（不是 undefined） */
  subCategoryOf: Map<string, string>
  /** siteId -> 展示用的分类/子分类名称 */
  infoOf: Map<string, { categoryName: string; subCategoryName: string }>
}

export const EMPTY_SITE_CATEGORY_INDEX: SiteCategoryIndex = {
  categoryOf: new Map(),
  subCategoryOf: new Map(),
  infoOf: new Map(),
}

/**
 * 建索引。同一站点在多处出现时**先出现的胜出**——与原实现「找到就 return」一致。
 */
export function buildSiteCategoryIndex(categories: SiteCategoryLike[]): SiteCategoryIndex {
  const categoryOf = new Map<string, string>()
  const subCategoryOf = new Map<string, string>()
  const infoOf = new Map<string, { categoryName: string; subCategoryName: string }>()

  for (const category of categories) {
    // 主分类 items：归属本分类，子分类为空串
    for (const item of category.items ?? []) {
      if (!item?.id || categoryOf.has(item.id)) continue
      categoryOf.set(item.id, category.id)
      subCategoryOf.set(item.id, '')
      infoOf.set(item.id, { categoryName: category.title, subCategoryName: '' })
    }
    // 子分类 items：归属父分类，子分类为该子分类
    for (const sub of category.subCategories ?? []) {
      for (const item of sub.items ?? []) {
        if (!item?.id || categoryOf.has(item.id)) continue
        categoryOf.set(item.id, category.id)
        subCategoryOf.set(item.id, sub.id)
        infoOf.set(item.id, { categoryName: category.title, subCategoryName: sub.title })
      }
    }
  }

  return { categoryOf, subCategoryOf, infoOf }
}

export interface SiteFilterInput {
  id: string
  name: string
  url: string
  description?: string
}

export interface SiteFilterState {
  /** 原始输入；内部 trim + 小写化 */
  query: string
  /** 'all' 或分类 id */
  categoryFilter: string
  /** 'all' / 'none' / 子分类 id */
  subCategoryFilter: string
}

/**
 * 预计算每个站点的搜索串（name/url/description 连接后整体小写化一次）。
 *
 * 筛选热路径的剩余开销：原实现每次查询对每个站点的 3 个字段逐个 toLowerCase
 * （500 站点 × 每敲一个字符 = 1500 次字符串分配）。站点集合只在拉取/保存后变化，
 * 把小写化结果缓存成 siteId -> haystack，按键时只做 includes。
 *
 * 连接符用 NUL：name/url/description 理论上可含换行，查询词不可能含 NUL，
 * 用 \0 连接保证「跨字段拼接出假命中」不可能发生（与逐字段语义严格等价）。
 */
export function buildSiteHaystacks<T extends SiteFilterInput>(sites: T[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const site of sites) {
    map.set(
      site.id,
      `${site.name}\u0000${site.url}\u0000${site.description ?? ''}`.toLowerCase(),
    )
  }
  return map
}

/**
 * 按索引筛选站点。
 *
 * 返回 boolean 而不是三态：原实现里 `matchesSearch` 在 description 缺失时可能是
 * `undefined`（`a || b || undefined`），filter 把它当 falsy，结果与 false 等价。
 * 这里显式收敛成 boolean，避免调用方误把 undefined 当成「没筛选过」。
 *
 * ⚠️ 缺省值必须与原来的查找函数一致：那两个函数在**找不到时返回空串**（不是
 * undefined）。因此「未归类站点」会被 `none` 子分类筛选命中，也会被
 * `categoryFilter === ''` 命中。改用 `?? ''` 而不是直接比较 undefined。
 */
export function filterSitesByIndex<T extends SiteFilterInput>(
  sites: T[],
  state: SiteFilterState,
  index: SiteCategoryIndex,
  haystacks?: Map<string, string>,
): T[] {
  const query = state.query.trim().toLowerCase()
  const hasQuery = query.length > 0
  const { categoryFilter, subCategoryFilter } = state

  return sites.filter((site) => {
    if (hasQuery) {
      const precomputed = haystacks?.get(site.id)
      if (precomputed !== undefined) {
        if (!precomputed.includes(query)) return false
      } else {
        const haystack = [site.name, site.url, site.description]
        const hit = haystack.some(
          (value) => typeof value === 'string' && value.toLowerCase().includes(query),
        )
        if (!hit) return false
      }
    }

    if (categoryFilter !== 'all' && (index.categoryOf.get(site.id) ?? '') !== categoryFilter) {
      return false
    }

    if (subCategoryFilter !== 'all') {
      // 找不到时按空串处理：原 getSiteSubCategory 的缺省就是 ''
      const sub = index.subCategoryOf.get(site.id) ?? ''
      if (subCategoryFilter === 'none') {
        if (sub !== '') return false
      } else if (sub !== subCategoryFilter) {
        return false
      }
    }

    return true
  })
}

/** 单站点查询的便捷封装（表格单元格用；索引未命中时回落空值，不抛错） */
export function siteCategoryInfo(
  index: SiteCategoryIndex,
  siteId: string,
): { categoryName: string; subCategoryName: string } {
  return index.infoOf.get(siteId) ?? { categoryName: '', subCategoryName: '' }
}
