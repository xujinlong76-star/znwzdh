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
