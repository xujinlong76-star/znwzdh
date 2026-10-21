/**
 * 索引门槛：低于这个站点数的分类 / 标签一律不进 sitemap，页面侧同步 noindex。
 *
 * 依据是实测分布：594 个分类里 489 个 0 站点（单指针口径）、1080 个标签里
 * 877 个 <3 站点。为这些聚合页建页面会产生成片薄内容。
 */
export const MIN_SITES_FOR_INDEX = 5

/** sitemap 单条分页上限：`/api/sites` 的 limit 上限是 1000。 */
export const SITE_PAGE_SIZE = 500
