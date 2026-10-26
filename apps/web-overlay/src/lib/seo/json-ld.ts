/**
 * JSON-LD 结构化数据（纯函数层）。
 *
 * 三条红线，改这里前先读（都有对应单测在 test/json-ld.test.ts 守着）：
 *
 * 1. **不写 SearchAction**：本站没有 `/search` 页面（搜索是首页客户端面板）。
 *    声明一个不存在的搜索端点，Google 可能渲染出点不进去的 sitelinks 搜索框。
 * 2. **不写 aggregateRating / 假 star**：站内没有评价体系；
 *    `liveMetrics.githubStars` 历史上被硬编码污染过（125000/86000），
 *    既渲染又参与 DIY 排序，在数据修复前任何星级数字都不能进结构化数据。
 * 3. **必须经 `jsonLdScript()` 序列化**：站点标题来自数据库（管理员可改），
 *    直接 JSON.stringify 拼进 `<script>`，一个 `</script>` 就能越狱脚本上下文。
 */

export interface Crumb {
  label: string
  /** 站内路径，如 '/sites'；由 absUrl 拼 origin */
  path: string
}

export interface ItemListSite {
  id: string
  title: string
}

export interface PluginRef {
  slug: string
  name: string
  description?: string | null
}

/** ItemList 单页上限：目录页一页 60 条，留一倍余量防误传全量 */
export const MAX_ITEM_LIST = 100

/**
 * origin 归一 + 路径拼接。
 * 保证协议头之外不会出现 `//`（canonical / sitemap 曾因尾斜杠踩过这个坑）。
 */
export function absUrl(origin: string, path: string): string {
  const base = (origin ?? '').trim().replace(/\/+$/, '')
  const p = (path ?? '').trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return p ? `${base}/${p}` : `${base}/`
}

/**
 * WebSite  schema。
 * 刻意不含 potentialAction：见文件头红线 1。
 */
export function webSiteLd(origin: string, name: string, description?: string | null): Record<string, unknown> {
  const cleanName = (name ?? '').trim()
  const cleanDesc = typeof description === 'string' ? description.trim() : ''
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: cleanName || '山羊胡',
    url: absUrl(origin, '/'),
    inLanguage: 'zh-CN',
    ...(cleanDesc ? { description: cleanDesc.slice(0, 300) } : {}),
  }
}

/**
 * Organization schema（首页）。
 *
 * 只声明有事实依据的字段：名称、站点地址、logo。
 * 不写 sameAs（没有核验过的官方社交主页）、不写 address/telephone（导航站没有实体信息）、
 * 不写 aggregateRating（没有评价体系）——编造实体信息同样会触发人工处罚。
 */
export function organizationLd(
  origin: string,
  name: string,
  logoPath = '/icons/icon-512.png',
  description?: string | null,
): Record<string, unknown> {
  const cleanName = (name ?? '').trim()
  const cleanDesc = typeof description === 'string' ? description.trim() : ''
  const logo = (logoPath ?? '').trim() || '/icons/icon-512.png'
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: cleanName || '山羊胡',
    url: absUrl(origin, '/'),
    logo: absUrl(origin, logo),
    ...(cleanDesc ? { description: cleanDesc.slice(0, 300) } : {}),
  }
}

/**
 * BreadcrumbList schema。
 * 过滤空 label / 空 path，position 重新连续编号——
 * Google 要求 position 从 1 开始连续递增，中间断档会被整条丢弃。
 */
export function breadcrumbLd(origin: string, crumbs: Crumb[]): Record<string, unknown> {
  const items = (crumbs ?? [])
    .map((c) => ({ label: (c?.label ?? '').trim(), path: (c?.path ?? '').trim() }))
    .filter((c) => c.label && c.path)
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      item: absUrl(origin, c.path),
    })),
  }
}

/**
 * 一级根页的 ItemList：列的是**子分类页**，不是站点。
 *
 * 根页正文确实是子树站点的并集，但它的结构身份是目录：把站点喂进 ItemList
 * 等于让爬虫以为这一页是终点，215 个叶子页反而少一条被发现的入口。
 * `itemListLd` 的 URL 模板写死 `/site/{id}`，所以这里单独一份。
 */
export function categoryItemListLd(
  origin: string,
  categories: Array<{ slug: string; title: string }>,
  name = '子分类',
): Record<string, unknown> {
  const items = (categories ?? [])
    .map((c) => ({ slug: (c?.slug ?? '').trim(), title: (c?.title ?? '').trim() }))
    .filter((c) => c.slug && c.title)
    .slice(0, MAX_ITEM_LIST)
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.title,
      url: absUrl(origin, `/category/${encodeURIComponent(c.slug)}`),
    })),
  }
}

/**
 * ItemList schema（目录页用）。
 * URL 走 `/site/{id}`，与 sitemap-entries.siteEntries 同一编码规则。
 */
export function itemListLd(origin: string, sites: ItemListSite[], name = '站点目录'): Record<string, unknown> {
  const items = (sites ?? [])
    .map((s) => ({ id: (s?.id ?? '').trim(), title: (s?.title ?? '').trim() }))
    .filter((s) => s.id && s.title)
    .slice(0, MAX_ITEM_LIST)
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: s.title,
      url: absUrl(origin, `/site/${encodeURIComponent(s.id)}`),
    })),
  }
}

/**
 * 序列化为可安全内插进 `<script>` 的字符串。
 *
 * `</script>` 会提前关闭脚本上下文（XSS），U+2028/2029 在 JS 里是行终止符
 * （历史上让一批 JSON 解析器炸过），统一转成 unicode 转义；
 * JSON.parse 回来与原文一致，结构化数据语义不变。
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * 插件详情页的 SoftwareApplication。
 *
 * 刻意只给 name/description/applicationCategory/url 四个字段：
 * - **不加 aggregateRating / ratingValue / reviewCount**：插件有真实
 *   `ratingAvg`/`reviewCount` 字段，但样本量小、且人工处罚风险高，
 *   宁可没有富结果也不赌（方案 Phase 4 红线）。
 * - **不加 offers**：插件全部 MIT 免费，但"免费"不等于要声明交易信息。
 * - applicationCategory 取 'WebApplication'：插件装进的是一个 Web 应用，
 *   这是 schema.org 标准值里最接近的一个（site-pack 偏数据包，
 *   按插件市场列表惯例归入 WebApplication，语义略宽但不虚构）。
 */
export function softwareApplicationLd(origin: string, plugin: PluginRef): Record<string, unknown> {
  const name = (plugin?.name ?? '').trim()
  const slug = (plugin?.slug ?? '').trim()
  const desc = typeof plugin?.description === 'string' ? plugin.description.trim() : ''
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: name || '山羊胡插件',
    ...(desc ? { description: desc.slice(0, 300) } : {}),
    applicationCategory: 'WebApplication',
    ...(slug ? { url: absUrl(origin, `/marketplace/${encodeURIComponent(slug)}`) } : {}),
  }
}

/**
 * 插件作者公开主页的 ProfilePage。
 *
 * 只声明页面上真实存在的 Person 名称与主页地址；作者是哈希 key 背后的
 * 匿名主体，没有可核验的 sameAs / 头像 / 社交主页，一律不编造。
 */
export function profilePageLd(
  origin: string,
  input: { name: string; path: string; description?: string | null },
): Record<string, unknown> {
  const name = (input?.name ?? '').trim()
  const path = (input?.path ?? '').trim()
  const desc = typeof input?.description === 'string' ? input.description.trim() : ''
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    inLanguage: 'zh-CN',
    mainEntity: {
      '@type': 'Person',
      name: name || '山羊胡插件作者',
      ...(path ? { url: absUrl(origin, path) } : {}),
      ...(desc ? { description: desc.slice(0, 300) } : {}),
    },
  }
}
