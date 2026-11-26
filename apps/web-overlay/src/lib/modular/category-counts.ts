/**
 * 首屏「这个分类有多少站点」的唯一算式（纯函数，可单测）。
 *
 * 为什么要有这个文件：同一个分类在首屏出现过两套数字——吸顶快捷直达轨与分类区块头
 * 把导航树里看得见的条目相加（口径 = 树：启用且 status ∈ {active, broken}），
 * 而站内目录带的数字取自中枢 `/api/categories/counts`（口径 = active 且子树聚合，
 * 不含坏链）。两个平面各自都对，但并排显示就是「AI 工具 215」与「AI 工具 332」
 * 同时出现在一屏，用户只能理解成数字不可信。
 *
 * 规则：首屏只有一个平面——卡片来自树，数字也来自树，做到「数出来等于划得到」。
 * 中枢计数继续只管它真正负责的那件事：收录页的 404 门槛（目录带用它的 ≥ 阈值筛链接，
 * 避免链到一个已经不存在的分类页）。
 */
export interface CountableCategory {
  items?: unknown[] | null;
  subCategories?: Array<{ items?: unknown[] | null }> | null;
}

/** 一个分类的可见站点数 = 直接挂在分类下的条目 + 各子分类的条目 */
export function countCategorySites(category: CountableCategory | undefined): number {
  if (!category) return 0;
  const direct = category.items?.length ?? 0;
  let nested = 0;
  for (const sub of category.subCategories ?? []) nested += sub.items?.length ?? 0;
  return direct + nested;
}

/**
 * 首页 SEO 描述（meta description / JSON-LD 共用）的计数：与首屏 pills /
 * 区块头同口径的树计数（见本文件头注释的定稿规则：首屏只有一个平面）。
 *
 * 为什么不能用中枢 `/api/categories/counts`：它是 active 口径（SQL 只计
 * `status = 'active'`，见 packages/store/src/repository/categories.ts），
 * 巡检标 broken 的站会被减掉（2026-11-26 实测：树 388 站 − broken 50 =
 * active 338）；而首页照常渲染这 50 站（带「检测异常」徽标），描述写 338
 * 就与页面实际内容差 50，搜索用户点进来数出来对不上。根分类同样：中枢有
 * 20 个根，树里有站点的只有 14 个（其余 6 个是 0 站点的空根），描述写 20
 * 个大类与首页实际呈现的 14 组不符。
 *
 * 规则：只计树里有站点的根（`countCategorySites > 0`），总数 = 各根树计数之和。
 * 输入是 `getProcessedData` 之后、已按 `enabled` 过滤的导航树，与 pills 的
 * `treeSiteCounts` 同源（`navigation-content.tsx`），做到「数出来等于划得到」。
 * 树取不到（总数 0）时调用方应退回旧的中枢计数链路，再取不到退回后台原文案，
 * 绝不编数字。
 */
export function homeSeoTreeCounts(
  categories: readonly CountableCategory[] | undefined | null,
): { totalSites: number; rootCount: number } {
  let totalSites = 0;
  let rootCount = 0;
  for (const category of categories ?? []) {
    const n = countCategorySites(category);
    if (n <= 0) continue;
    rootCount += 1;
    totalSites += n;
  }
  return { totalSites, rootCount };
}

/**
 * 截断态分区高度估算（P1-7）：懒挂载占位块应与真实截断渲染等高，否则滚动/锚点跳动。
 *
 * 旧公式按 min(count, 6) 封顶（最多 2 行、288px），与真实截断高度（每组 4 张卡、
 * 多子组可达数千 px）脱节。本函数按真实截断态算：每组只取 min(组内条目, limit) 张卡，
 * 3 列排布，行高 120px，另计分区头 48px 与每组头 36px；上限 3200px、下限 140px。
 * limit <= 0 表示不限制（全量渲染），此时仍按全量计但受上限钳制。
 */
export function estimateTruncatedSectionHeight(
  category: CountableCategory | undefined,
  limit: number,
): number {
  if (!category) return 140;
  const cap = Number.isFinite(limit) && limit > 0 ? limit : Number.POSITIVE_INFINITY;
  const groups: number[] = [];
  const direct = category.items?.length ?? 0;
  if (direct > 0) groups.push(direct);
  for (const sub of category.subCategories ?? []) {
    const n = sub.items?.length ?? 0;
    if (n > 0) groups.push(n);
  }
  if (groups.length === 0) return 140;
  let truncatedCards = 0;
  for (const n of groups) truncatedCards += Math.min(n, cap);
  const rows = Math.max(1, Math.ceil(truncatedCards / 3));
  const height = 48 + rows * 120 + groups.length * 36;
  return Math.min(3200, Math.max(140, height));
}
