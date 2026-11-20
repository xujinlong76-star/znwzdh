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

/**
 * 静默同步可合并的身份字段：与 board 的 overlayPatched 同款五字段
 *（starred / starCount / installed / installedVersion / installCount）。
 * 只有这五个字段依赖浏览器匿名身份，其余字段服务端 SSR 已给全。
 */
export interface PluginIdentityFields {
  slug: string
  starred?: boolean
  starCount?: number
  installed?: boolean
  installedVersion?: string | null
  installCount?: number
}

/**
 * 静默同步合并：只把取回页里同 slug 条目的身份字段写回既有列表，
 * 不替换列表、不改顺序、不丢条目、不改总数以外的任何字段。
 *
 * 为什么不用替换（2026-11-20 插件市场 #418 实测）：
 * SSR 给默认视图种了全量（77 项、83 张卡）；挂载后静默重取只取 24 项，
 * 替换语义把列表闪成 24 项（83→30 张卡），且与大树水合抢跑时 React
 * 抛 #418（/marketplace 冷加载约 59% 命中；仅全量列表视图出现，
 * 筛选/星标/首页/详情/已安装/分类页 0 命中）。合并后列表不再增删，
 * 只刷新身份态，水合无 DOM 增删可撞。
 */
export function mergeSilentSync<T extends PluginIdentityFields>(prev: T[], fresh: T[]): T[] {
  if (fresh.length === 0) return prev
  const bySlug = new Map(fresh.map((p) => [p.slug, p]))
  let changed = false
  const next = prev.map((p) => {
    const f = bySlug.get(p.slug)
    if (!f) return p
    changed = true
    return {
      ...p,
      starred: f.starred,
      starCount: f.starCount,
      installed: f.installed,
      installedVersion: f.installedVersion,
      installCount: f.installCount,
    }
  })
  return changed ? next : prev
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
    /**
     * 静默同步的合并策略：提供时，静默成功用合并代替替换。
     * 只用于挂载后补身份态（board）；筛选/排序/搜索仍走替换。
     */
    silentMerge?: (prev: T[], fresh: T[]) => T[]
  },
): MarketplaceListSnapshot<T> {
  if (opts.failed) {
    // 追加 / 静默失败：保持原样（旧列表 + 横幅，不闪空态、不丢总数）
    if (opts.append || opts.silent) return prev
    // 首屏失败：不写空兜底，立失败态（已有列表也不清空——失败态接管列表区）
    return { ...prev, loadFailed: true }
  }
  if (opts.silent && opts.silentMerge) {
    // 静默同步：只合并身份字段，不替换列表（见 mergeSilentSync）。
    return { items: opts.silentMerge(prev.items, res.items), total: res.total, loadFailed: false }
  }
  return {
    items: opts.append ? [...prev.items, ...res.items] : res.items,
    total: opts.append
      ? (opts.mergeAppendTotal?.(prev.total, res.total) ?? res.total)
      : res.total,
    loadFailed: false,
  }
}
