import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/seo/origin'
import { hubGet } from '@/lib/server/hub'
import { MIN_SITES_FOR_CATEGORY_INDEX, MIN_SITES_FOR_TAG_INDEX } from '@/lib/seo/thresholds'
import { descendantSiteCounts } from '@/lib/seo/category-totals'
import { pluginSitemapEntries, authorSitemapEntries, type SitemapPluginRef } from '@/lib/plugins/sitemap'
import {
  categoryEntries,
  collectionEntries,
  countCategorySites,
  sceneEntries,
  siteEntries,
  staticEntries,
  tagEntries,
  type CategoryRef,
  type CollectionRef,
  type SceneRef,
  type SiteRef,
  type TagRef,
} from '@/lib/seo/sitemap-entries'

/**
 * 全站 sitemap：静态页 + 站点 + 达标标签 + 达标分类 + 合集 + 已上架插件。
 *
 * 与上一版的三处差异：
 * 1. 站点必须带 `status=active` —— 不带时会返回 1020 条（含 7 条 broken），
 *    等于主动把 7 个软 404 提交给搜索引擎；
 * 2. 标签走 `/api/tags` 的 `count` 并按 `MIN_SITES_FOR_TAG_INDEX` 过滤——count 是
 *    **存活站点数**（2026-10-21 修了 listTagsWithCounts 的软删除计数污染后，
 *    数量随数据集浮动：当前 dev 库只有「大模型」1 条达标；站点集恢复后分层
 *    自动回填，无写死名单）；
 * 3. `force-dynamic` 改为 `revalidate = 300` —— 前提是 `siteOrigin()` 先读到
 *    环境变量，否则仍会退化成动态渲染（属可接受降级）。
 *    为什么不是 3600：健康巡检会把 active 站标成 broken，而类目详情页按
 *    active 计数直接 404；整份清单缓存 1 小时，就会持续提交已 404 的类目 URL。
 *    站点列表的取数 TTL 同样收到 300s，保证「条目」与「计数」同频（仍有
 *    300s 窗口，但已从小时级降到分钟级）。
 *
 * 中枢不可用时只输出已取到的部分，绝不 500：sitemap 是辅助，不该因一次上游
 * 抖动把整站爬虫体验打穿。
 *
 * 4. 例外（2026-11-11）：五路数据源**全部失败**时改为抛错。实测教训：中枢
 *    抖动期生成的「只剩 10 条静态 URL」降级版会被 ISR 缓存 300s，爬虫在窗口
 *    内抓到会以为全站只剩 10 页；而生成抛错时 ISR 继续供上次的好版本并后台
 *    重试，严格优于把降级版钉死。判据必须精确：四路内容数据（站点/标签/
 *    分类/合集）的取数都返回失败信号才抛；任一路拿到数据（哪怕空数组——
 *    首部署空库是合法状态）都照常输出。插件不计入判据（它是附属清单，
 *    且其加载器把失败吞成空数组，无失败信号可读）。
 */

export const revalidate = 300

const PAGE_SIZE = 100
/** 单次 sitemap 最多收录 5000 个插件，防止异常数据把响应拖到超时 */
const MAX_PAGES = 50
/** 站点分页上限：20 × 1000 = 20000 条，超出属于异常数据，避免无限循环 */
const SITE_LIMIT = 1000
const MAX_SITE_PAGES = 20

/**
 * 插件列表直连中枢，不再通过公开域名自取 /api/hub/plugins：
 * 自取依赖对外 origin 与 route 转发，且 origin 解析失败时整份 sitemap 直接为空。
 */
async function loadPublishedPlugins(): Promise<SitemapPluginRef[]> {
  const rows: SitemapPluginRef[] = []
  let fetched = 0

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE
    const body = await hubGet<{ items?: unknown; total?: unknown }>(
      `/api/plugins?limit=${PAGE_SIZE}&offset=${offset}&sort=updated`,
      3600,
    )
    if (!body) break

    const items = Array.isArray(body.items) ? body.items : []
    fetched += items.length

    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const record = item as { slug?: unknown; ownerKey?: unknown; updatedAt?: unknown; publishedAt?: unknown }
      rows.push({
        slug: typeof record.slug === 'string' ? record.slug : '',
        ownerKey: typeof record.ownerKey === 'string' ? record.ownerKey : null,
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : null,
        publishedAt: typeof record.publishedAt === 'number' ? record.publishedAt : null,
      })
    }

    const total = typeof body.total === 'number' ? body.total : fetched
    if (items.length < PAGE_SIZE || fetched >= total) break
  }

  return rows
}

/**
 * 站点分页：**并发取**，不再逐页串行。
 *
 * 实测（2026-10-22，4765 个存活站点）：串行 10 页（每页 500）首访 9.85s、
 * 缓存命中仍要 0.43s —— 缓存住的是中枢响应，省不掉的是一条条 await 的往返。
 * 改成每页 1000（`/api/sites` 的 limit 上限）后只需 5 页，再按 4 路并发取，
 * 首屏与缓存命中的往返次数都明显下降。
 *
 * 停止条件仍以「某页不满」为准：并发批次里遇到第一个短页就丢弃该批次的后续结果，
 * 保证不把空页/越界页拼进 sitemap。取到 MAX_SITE_PAGES × SITE_LIMIT 仍未结束时
 * 截断，防止异常数据把响应拖死。
 */
const SITE_BATCH = 4

/**
 * 返回 null 表示**取数失败**（首page 请求就失败），与「取到空数组」（库里
 * 真没站点）严格区分——sitemap() 靠这个信号判断是否全线失败（文件头第 4 条）。
 */
async function loadActiveSites(): Promise<SiteRef[] | null> {
  const first = await hubGet<SiteRef[]>(
    `/api/sites?status=active&limit=${SITE_LIMIT}&offset=0`,
    300,
  )
  if (first === null) return null
  if (first.length === 0) return []
  if (first.length < SITE_LIMIT) return first

  const out: SiteRef[] = [...first]
  let offset = SITE_LIMIT

  while (offset < SITE_LIMIT * MAX_SITE_PAGES) {
    const batch = await Promise.all(
      Array.from({ length: SITE_BATCH }, (_, i) =>
        hubGet<SiteRef[]>(
          `/api/sites?status=active&limit=${SITE_LIMIT}&offset=${offset + i * SITE_LIMIT}`,
          300,
        ),
      ),
    )

    let done = false
    for (const rows of batch) {
      if (!rows?.length) {
        done = true
        break
      }
      out.push(...rows)
      if (rows.length < SITE_LIMIT) {
        done = true
        break
      }
    }
    if (done) break
    offset += SITE_LIMIT * SITE_BATCH
  }

  return out
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin()
  if (!origin) return []

  // 并行取六路数据；任何一路失败都返回 null，由下面的纯函数自然产出空数组。
  // 场景一路不进下面「全线失败」的判定：场景接口是新增只读面，它的抖动
  // 不该让整张 sitemap 退回上个版本，老四路的防降级判据保持原样。
  const [plugins, sites, tags, categories, collections, scenePayload] = await Promise.all([
    loadPublishedPlugins(),
    loadActiveSites(),
    hubGet<TagRef[]>('/api/tags', 3600),
    hubGet<CategoryRef[]>('/api/categories', 3600),
    hubGet<CollectionRef[]>('/api/collections', 3600),
    hubGet<{ scenes?: SceneRef[] }>('/api/scenes', 3600),
  ])

  // 四路内容数据全线失败：抛错让 ISR 保留上次的好版本（文件头第 4 条），
  // 不把「只有静态页」的降级清单缓存下来冒充全站地图。
  if (sites === null && tags === null && categories === null && collections === null) {
    throw new Error('sitemap: 中枢四路内容数据全部取数失败，保留上次生成的版本')
  }

  return [
    ...staticEntries(origin),
    ...siteEntries(origin, sites ?? []),
    ...tagEntries(origin, tags ?? [], MIN_SITES_FOR_TAG_INDEX),
    // 根页也要进 sitemap：新树里它是一级导航入口，站点数来自子树聚合。
    // 直接把 countCategorySites 的原始计数喂进去，18 个根会全被门槛挡掉。
    ...categoryEntries(
      origin,
      categories ?? [],
      descendantSiteCounts(categories ?? [], countCategorySites(sites ?? [])),
      MIN_SITES_FOR_CATEGORY_INDEX,
    ),
    ...collectionEntries(origin, collections ?? []),
    ...sceneEntries(origin, scenePayload?.scenes ?? []),
    ...pluginSitemapEntries(origin, plugins),
    ...authorSitemapEntries(origin, plugins),
  ]
}
