/**
 * 中枢「全量列表」的分块取数（站点目录用，也可给其它需要整表的爬虫面复用）。
 *
 * 为什么要有这个文件：`/api/sites` 的 limit 上限是 1000，而目录页需要整份 active
 * 列表来算总页数与末页链接。此前 `loadSitesPage()` 写死「取两块 1000」，站点数一旦
 * 超过 2000 就**静默截断**——末页链接、总收录数、canonical 归一全都基于一个被砍掉
 * 的集合，而且没有任何地方会报警。这里把「取完」变成显式契约：
 *
 * - 一块不满 `limit` 就说明到底了，立刻停（当前 51 个站点只要 1 次请求，比原来还少）；
 * - 最多 `maxChunks` 块；触顶且最后一块是满的 → `truncated = true`，由调用方决定
 *   怎么把「不完整」如实告诉用户，而不是假装这就是全部；
 * - 任一块请求失败 → `failed = true` 并停止：降级渲染已取到的部分（爬虫面不能因为
 *   上游抖动开天窗），但同样算不完整，不能对外宣称「共收录 N 个」；
 * - 按 id 去重：offset 分页在两次请求之间被写入插队时会吐出重复行，
 *   重复项会让「共收录 N 个」直接虚高。
 *
 * 已知残留：`/api/sites` 的排序是 `sort ASC, weight DESC`，`sort` 相同的行为并列，
 * 极端情况下块边界可能漏掉一两条。去重挡得住重复，挡得住虚高，挡不住偶发漏项——
 * 目录是 60s 一刷的爬虫面，不为这个概率改中枢排序契约。
 */

/** 中枢单次请求的上限（与 apps/api 里 `limit` 的钳制值同源） */
export const DEFAULT_CHUNK_LIMIT = 1000

/**
 * 分块硬上限：默认 10 × 1000 = 1 万站点。
 *
 * 这不是「性能预算」而是「失控预算」——没有上限的话，一次中枢排序异常或
 * status 过滤失效就能让目录页把整表拉进内存。触顶后如实报告 truncated，
 * 让人来看数据，而不是让页面去适配无限数据。
 */
export const DEFAULT_MAX_CHUNKS = 10

export type PagedCatalog<T> = {
  /** 已取到并按 id 去重后的条目，保持中枢返回顺序 */
  items: T[]
  /** 取到 maxChunks 块且最后一块是满的：后面还有没取到的数据 */
  truncated: boolean
  /** 某一块请求失败（null）：取数中断，已取部分不可当作全量 */
  failed: boolean
}

/**
 * 逐块取数的回调：返回 `null` 表示这一块的请求失败（与「取到空数组＝到底」区分开）。
 * 这正是 `hubGet()` 的语义，所以调用方直接把 hubGet 包一层传进来。
 */
export type FetchChunk<T> = (offset: number, limit: number) => Promise<T[] | null>

export async function fetchPagedCatalog<T extends { id: string }>(
  fetchChunk: FetchChunk<T>,
  options: { chunkLimit?: number; maxChunks?: number } = {},
): Promise<PagedCatalog<T>> {
  const chunkLimit = options.chunkLimit ?? DEFAULT_CHUNK_LIMIT
  const maxChunks = Math.max(1, options.maxChunks ?? DEFAULT_MAX_CHUNKS)

  const items: T[] = []
  const seen = new Set<string>()
  let truncated = false
  let failed = false
  let reachedEnd = false

  for (let chunk = 0; chunk < maxChunks; chunk++) {
    const offset = chunk * chunkLimit
    const batch = await fetchChunk(offset, chunkLimit)
    if (batch === null) {
      failed = true
      break
    }
    for (const row of batch) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      items.push(row)
    }
    if (batch.length < chunkLimit) {
      reachedEnd = true
      break
    }
    // 最后一块正好取满：无法区分「恰好到底」与「还有下一页」，
    // 如实记 truncated（宁可少说一句，不可多吹一句）。
    if (chunk === maxChunks - 1) truncated = true
  }

  return { items, truncated: truncated && !reachedEnd, failed }
}
