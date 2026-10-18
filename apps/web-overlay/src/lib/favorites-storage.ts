/**
 * 收藏列表的本地读写规则：**「读不出来」和「没有数据」是两件事**。
 *
 * 真实缺陷（`hooks/useFavorites.ts` 与 `lib/modular/workbench-bridge.ts` 都中过同一个坑）：
 *
 *     const parsed = JSON.parse(raw)
 *     return Array.isArray(parsed) ? parsed : []      // ← 读失败 = 空收藏
 *
 * 这个「空」随后会参与写入（`unshift` 新条目后 `setItem` 回去），于是
 * **用户原有的收藏会被「只有新一条」的列表整个覆盖掉**。坏数据的来源很平常：
 * 写入中断留下的半截 JSON、被浏览器扩展或别的脚本改写过、早期版本写下的旧结构。
 *
 * 所以解析函数返回 `{ items, corrupt }`：`corrupt` 明确表示「存储里有东西但读不出来」。
 * 调用方据此**拒绝覆盖**，并给用户一个「先备份、再重置」的出口 ——
 * 而不是把读失败伪装成「你没有收藏」然后照写不误。
 *
 * 这里只做纯字符串处理，真正的存储 IO 留在调用方：规则可以直接钉进测试。
 */

/** 本地收藏的存储键。与历史实现保持一致，不能改（改了等于把老用户的收藏丢掉）。 */
export const FAVORITES_STORAGE_KEY = 'navhub.favorites.v1'

export interface FavoritesParseResult<T> {
  items: T[]
  /** 存储里有原始数据，但解析不出来（坏 JSON / 结构不是数组） */
  corrupt: boolean
}

/**
 * 解析本地收藏的原始字符串。
 * 只有「真的没有数据」（null / undefined / 空串）才算空收藏；
 * 有数据但读不出来时 `corrupt: true`，且 `items` 为空 —— 调用方必须把它当异常处理。
 */
export function parseFavorites<T>(raw: string | null | undefined): FavoritesParseResult<T> {
  if (raw === null || raw === undefined || raw === '') {
    return { items: [], corrupt: false }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 半截写入 / 被外部改写：读不出来就是读不出来，不伪造成空收藏
    return { items: [], corrupt: true }
  }
  if (!Array.isArray(parsed)) return { items: [], corrupt: true }
  return { items: parsed as T[], corrupt: false }
}

/** 备份键带上时间戳：连续损坏时不会互相覆盖掉更早的那份 */
export function corruptBackupKey(now: number): string {
  return `${FAVORITES_STORAGE_KEY}.corrupt.${now}`
}

/** 给用户看的原因说明。拒绝写入时必须能把话说清楚，而不是点了没反应。 */
export function describeCorruptFavorites(): string {
  return '本地收藏数据读不出来（可能写入中断，或被其他程序改写）。为避免覆盖掉原数据，已暂停保存收藏改动 —— 原数据仍在浏览器里，可以先备份再重置。'
}
