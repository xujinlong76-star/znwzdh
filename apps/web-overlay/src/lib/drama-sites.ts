/**
 * 首页短剧影院的站点收集口径（A10）。
 *
 * 分类列表里 broken（巡检确认失效）的站保留展示并标失效——那是「暂时不可用」
 * 的如实告知；但首页的海报横滑与热播榜是**推荐位**，把已确认失效的站摆上榜
 * 等于明知是坏站还推荐给用户。所以这里在收集阶段就剔除 status==='broken'，
 * 与 API 侧 rank/copilot 只推 active 的口径一致。enabled=false 一并剔除
 * （与 filterNavigationData 一致，运营者在链接巡检页隐藏的站也不该上榜）。
 */

export interface DramaSiteLike {
  id?: string
  title?: string
  href?: string
  description?: string
  enabled?: boolean
  status?: string
}

export interface DramaCategoryLike {
  id?: string
  slug?: string | null
  title?: string
  items?: DramaSiteLike[]
  subCategories?: Array<{ items?: DramaSiteLike[] }>
}

export interface DramaSite {
  id: string
  title: string
  href: string
  description?: string
}

const DRAMA_CATEGORY_REFS = new Set([
  'duanju',
  'short-drama',
  'short-drama-free',
  'short-drama-platform',
  'reg-short-drama',
  'reg-short-drama-free',
  'reg-short-drama-platform',
])

/** 判断 slug / id 是否属于短剧专区或其子分类 */
export function isDramaCategoryRef(ref: string | null | undefined): boolean {
  const norm = (ref ?? '').trim().toLowerCase()
  return Boolean(norm && DRAMA_CATEGORY_REFS.has(norm))
}

/** 从 /api/home/navigation 的返回里找短剧分类并摊平其站点（去重、剔除已失效/已停用）。 */
export function collectDramaSites(navigationItems: unknown): DramaSite[] {
  const cats = Array.isArray(navigationItems) ? (navigationItems as DramaCategoryLike[]) : []
  const drama = cats.find(
    (c) => c?.id === 'duanju' || c?.id === 'reg-short-drama' || c?.slug === 'short-drama' || c?.title === '短剧',
  )
  if (!drama) return []
  const flat: DramaSite[] = []
  const seen = new Set<string>()
  const push = (items: DramaSiteLike[] | undefined) => {
    for (const it of items || []) {
      if (!it?.id || !it.title || !it.href) continue
      if (it.enabled === false || it.status === 'broken') continue
      if (seen.has(it.id)) continue
      seen.add(it.id)
      flat.push({ id: it.id, title: it.title, href: it.href, description: it.description })
    }
  }
  push(drama.items)
  for (const sub of drama.subCategories || []) push(sub.items)
  return flat
}

/**
 * 数某分类下分类页可见的站点数（首页横幅文案用，与分类页口径对齐）。
 *
 * 分类页经 filterNavigationData 只滤掉 enabled=false 的站，broken 的站仍保留
 * 并标失效，所以这里只剔除 enabled=false、不剔 broken；递归数所有带 href 的
 * 节点（items/subCategories 任意嵌套）。找不到分类返回 null，调用方不显示
 * 数字——绝不拿写死数字或 0 顶替，数字漂移就该没有数字而不是错数字。
 */
export function countCategorySites(
  navigationItems: unknown,
  categoryId: string,
  categoryTitle?: string,
): number | null {
  const cats = Array.isArray(navigationItems) ? (navigationItems as DramaCategoryLike[]) : []
  const cat = cats.find(
    (c) => c?.id === categoryId || (categoryTitle !== undefined && c?.title === categoryTitle),
  )
  if (!cat) return null
  let n = 0
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (!node || typeof node !== 'object') return
    const item = node as DramaSiteLike & { items?: unknown; subCategories?: unknown }
    if (typeof item.href === 'string' && item.href.length > 0) {
      if (item.enabled !== false) n += 1
      return
    }
    walk(item.items)
    walk(item.subCategories)
  }
  walk(cat.items)
  walk(cat.subCategories)
  return n
}
