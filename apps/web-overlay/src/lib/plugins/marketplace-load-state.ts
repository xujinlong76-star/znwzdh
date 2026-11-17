/**
 * 插件市场三页共用的列表取数状态机（P1-2：失败 ≠ 空）。
 *
 * 取数层（navhub-api 的 degrade()）失败时返回空兜底 { items: [], total: 0 }
 * 并调 onDegraded；调用方如果无条件把兜底写进 state，失败就会被渲染成
 * 「你还没有星标任何插件」「你尚未安装任何插件」这类空态断言。
 * 写 state 只许走这里：失败时不写兜底——首屏失败改立 loadFailed，由失败态
 * 接管列表区；追加 / 静默失败保持原样（旧列表 + 横幅，不闪空态）。
 * 纯函数，可单测；board 与 mine 共用同一语义（installed 是整页重载、无追
 * 加 / 静默模式，同规则内联在 loadData 的 failed 守卫里）。
 */
export interface MarketplaceListSnapshot<T> {
  items: T[]
  total: number
  /** 首屏（非追加、非静默）取数失败：列表区渲染失败态，不渲染空态断言 */
  loadFailed: boolean
}

export function applyMarketplaceListLoad<T>(
  prev: MarketplaceListSnapshot<T>,
  res: { items: T[]; total: number },
  opts: {
    failed: boolean
    append: boolean
    silent: boolean
    /** 追加成功时 total 的合并策略；默认取服务端 total。mine 用 Math.max 防总数回落。 */
    mergeAppendTotal?: (prevTotal: number, nextTotal: number) => number
  },
): MarketplaceListSnapshot<T> {
  if (opts.failed) {
    // 追加 / 静默失败：保持原样（旧列表 + 横幅，不闪空态、不丢总数）
    if (opts.append || opts.silent) return prev
    // 首屏失败：不写空兜底，立失败态（已有列表也不清空——失败态接管列表区）
    return { ...prev, loadFailed: true }
  }
  return {
    items: opts.append ? [...prev.items, ...res.items] : res.items,
    total: opts.append
      ? (opts.mergeAppendTotal?.(prev.total, res.total) ?? res.total)
      : res.total,
    loadFailed: false,
  }
}
