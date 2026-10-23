/**
 * 分类分页的深度边界（纯函数，可单测）。
 *
 * 为什么需要它：分类页第 2 页起把页码换成 `offset = (page - 1) * PAGE_SIZE`
 * 直查 `/api/search`，而中枢对 `offset` 有 1000 的硬上限。页码任意放大时，
 * 17 页之后会收到 400；`hubGet` 把 4xx 也归为 null，页面于是按「中枢抖动」
 * 降级渲染，产出可被索引的 200 空页（`/p/18`、`/p/9999` 实测）。
 *
 * 这个函数只回答「该页是否还可能存在站点」：总数为 0/负数、页码非法、
 * 每页容量非法一律 false；同时不超过中枢 offset 上限（默认 1000），否则
 * 请求本身就非法，不能按「上游抖动」降级。调用方只在**计数可用**时用它
 * 判 404——计数本身取不到时仍要保留降级渲染，不能把上游故障误判成空分类。
 */
export const CATEGORY_PAGE_SEARCH_MAX_OFFSET = 1000

export function categoryPageHasSites(
  page: number,
  total: number,
  pageSize: number,
  maxOffset: number = CATEGORY_PAGE_SEARCH_MAX_OFFSET,
): boolean {
  if (!Number.isSafeInteger(page) || page < 1) return false
  if (!Number.isFinite(total) || total <= 0) return false
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) return false
  if (!Number.isSafeInteger(maxOffset) || maxOffset < 0) return false
  const offset = (page - 1) * pageSize
  return offset <= maxOffset && offset < total
}
