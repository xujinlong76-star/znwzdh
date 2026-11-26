/**
 * 热词冷启动回落（U-367）：无行为数据时的 curated 兜底。
 *
 * 切换条件（与 packages/core/src/rest-responses.ts 的 HotwordSource 注释同源，
 * 两处必须同改）：
 *   1. 行为榜单（suggestableTopQueries，180 天、≥2 身份 / ≥2 行、排除零结果词）
 *      非空 → 用行为榜单，source="behavioral"；
 *   2. 行为榜单为空且读侧未失败 → 本函数回落站内类目数据，source="curated"；
 *   3. 读侧失败（degraded）→ 调用方不调本函数：失败不是冷启动，仍为空 +
 *      suggestionsDegraded 标记；
 *   4. 目录本身也空（无标签 / 无存活站点）→ 本函数回 []，前端整块不渲染，不编造。
 *
 * 回落源：存活站点数最多的标签名（listTagsWithCounts，minCount=1：只算
 * deleted_at IS NULL / enabled / status='active' 的站点）。不新发明榜单、
 * 不编计数：标签名即站内真实类目词，且搜索的 termBranches 有标签分支，
 * 每个回落词都保证召回其标注站点（点选不会落进另一个零结果页）。
 *
 * 不新增往返：本函数只在已有的 /api/search/hotwords 与 runSearch 零结果
 * 分支内、行为榜单为空时多做一次同库读；浏览器侧仍是一次 GET，无新增请求。
 */
import type { Repository } from "@navhub/store";
import type { HotwordSource } from "@navhub/core";

export type { HotwordSource };

export async function curatedHotwords(
  repo: Repository,
  opts: { exclude?: ReadonlySet<string>; limit?: number } = {},
): Promise<string[]> {
  const limit = Math.max(1, Math.min(30, Math.trunc(opts.limit ?? 8)));
  const exclude = opts.exclude ?? new Set<string>();
  // listTagsWithCounts 已按 count DESC、name ASC 排好：站内最常见的类目词在前。
  const tags = await repo.listTagsWithCounts(1);
  const words: string[] = [];
  for (const tag of tags) {
    const name = tag.name.trim();
    if (!name || exclude.has(name) || words.includes(name)) continue;
    words.push(name);
    if (words.length >= limit) break;
  }
  return words;
}
