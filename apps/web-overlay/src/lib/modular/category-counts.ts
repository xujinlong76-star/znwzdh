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
  subCategories?: Array<{ items?: unknown[] | null; totalCount?: number }> | null;
  /**
   * 显式站点总数（首页 flight 分片的索引占位用，见 lib/modular/category-index.ts）。
   * 仅当分类没有任何已加载的条目时才采用：已加载的分类以 items 实测为准，
   * 避免总数与实际条目脱节。数据管线不写该字段，真实分类上它恒为 undefined。
   */
  totalCount?: number;
}

/**
 * 一个分类的可见站点数 = 直接挂在分类下的条目 + 各子分类的条目。
 *
 * 索引占位（首页 flight 分片，见 lib/modular/category-index.ts）：
 * 没有任何已加载条目时以 totalCount 为准——占位的直接条目数
 * （总数 - 各子分类数）无法从 items 读出，必须用总数本身。
 * 已加载的分类恒以 items 实测为准（数据管线不写 totalCount）。
 */
export function countCategorySites(category: CountableCategory | undefined): number {
  if (!category) return 0;
  const direct = category.items?.length ?? 0;
  let nested = 0;
  for (const sub of category.subCategories ?? []) {
    nested += sub.items?.length ?? 0;
  }
  // 没有任何已加载条目：索引占位，直接返回显式总数。
  if (direct === 0 && nested === 0 && typeof category.totalCount === 'number') {
    return category.totalCount;
  }
  // 混合态（不应出现，仅防御）：子分类只有 totalCount 时按它补齐。
  let total = direct + nested;
  for (const sub of category.subCategories ?? []) {
    if (!Array.isArray(sub.items) && typeof sub.totalCount === 'number') {
      total += sub.totalCount;
    }
  }
  return total;
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
  if (direct > 0) {
    groups.push(direct);
  } else if (typeof category.totalCount === 'number' && category.totalCount > 0) {
    // 索引占位：直接条目数 = 总数 - 各子分类数（总数含直接条目）。
    const subTotal = (category.subCategories ?? []).reduce(
      (acc, sub) => acc + (typeof sub.totalCount === 'number' ? sub.totalCount : (sub.items?.length ?? 0)),
      0,
    );
    const directCount = category.totalCount - subTotal;
    if (directCount > 0) groups.push(directCount);
  }
  for (const sub of category.subCategories ?? []) {
    const n = sub.items?.length ?? (typeof sub.totalCount === 'number' ? sub.totalCount : 0);
    if (n > 0) groups.push(n);
  }
  if (groups.length === 0) return 140;
  let truncatedCards = 0;
  for (const n of groups) truncatedCards += Math.min(n, cap);
  const rows = Math.max(1, Math.ceil(truncatedCards / 3));
  const height = 48 + rows * 120 + groups.length * 36;
  return Math.min(3200, Math.max(140, height));
}
