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

/** 从 /api/home/navigation 的返回里找短剧分类并摊平其站点（去重、剔除已失效/已停用）。 */
export function collectDramaSites(navigationItems: unknown): DramaSite[] {
  const cats = Array.isArray(navigationItems) ? (navigationItems as DramaCategoryLike[]) : []
  const drama = cats.find((c) => c?.id === 'duanju' || c?.title === '短剧')
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
