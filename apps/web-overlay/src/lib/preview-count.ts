/**
 * 折叠态预览卡片数（2026-11-21，纯函数，可单测）。
 *
 * 为什么需要它：默认每组固定 6 张卡。6 在 1/2/3/6 列下恰好整行，但在
 * **4 列**下变成 4+2、**5 列**下变成 5+1——「孤儿行」，每行右端留一块豁口。
 * 旧方案是在 globals.css 用 [data-grid-cols="4"] > :nth-child(5) 把多出的卡
 * display:none 藏掉，不干净：SSR 仍输出 6 张（多渲染、多 favicon 请求），
 * 且用户点「展开全部」时那 2 张只是从 hidden 变可见，像「展开却没变化」。
 *
 * 改为数据层直接切片：previewCount = cols × PREVIEW_ROWS，
 * 永远是列数的整倍数，任何列数下都不产生孤儿行。
 */

/** 每个折叠分组默认展示「几个整行」。cols × 2 即两行。 */
export const PREVIEW_ROWS = 2

/**
 * 由列数与行数算出预览张数。
 *
 * 脏输入（0 / 负数 / NaN / Infinity）一律回退到 1，避免把分组清空成 0 张
 * ——「列数读不到」时的正确降级是少显示，不是不显示。
 */
export function previewCountForColumns(cols: number, rows: number = PREVIEW_ROWS): number {
  const safeCols = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 0
  const safeRows = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 1
  if (safeCols <= 0) return 1
  return Math.max(1, safeCols * safeRows)
}
