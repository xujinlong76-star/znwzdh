import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import type {
  SiteKnowledgeMesh,
  SiteKnowledgeNode,
  SiteKnowledgeEdge,
  SiteDuplicateReport,
  SiteDuplicatePair,
} from "@navhub/core";

/* ------------------------------------------------------------------ *
 * 重复站点检测（评分口径的唯一实现，导出供测试比对参考实现）
 *
 * 为什么单独抽出来：这条路由原本是两层循环，每一对都现场 new URL()、
 * toLowerCase().split(/\s+/) 再建两个 Set。1000 个站点 = 49.95 万对
 * ≈ 上百万次 URL 解析与集合分配，单个请求就能占住 CPU 数秒——而它是
 * scope=public，匿名可反复触发。改成"每个站点的派生键只算一次 + 成对时
 * 先用尺寸上界剪枝"，比较次数仍是平方级但每次只剩几个整数/字符串比较。
 * 评分语义（阈值、取值、配对顺序）与改写前逐字节一致，由测试里的参考
 * 实现对同一批合成数据做等值校验来锁定。
 * ------------------------------------------------------------------ */

/** 参与比对的站点最小字段 */
export interface DuplicateInputSite {
  id: string;
  url: string;
  title: string;
  categoryId: string;
}

/** 命中多少对就停止累积（同域名大库里的 49 万对会把响应撑成几十 MB） */
const MAX_DUPLICATE_PAIRS = 2000;

const DUP_THRESHOLD = 0.75;
const TITLE_WEIGHT = 0.9;

/**
 * 主机名派生键。
 *
 * 区分 null 与空串：原实现里 URL 解析失败会被 catch 吃掉 → 域名分 0；
 * 而 `new URL("file:///x").hostname` 是合法的空串，空串参与 `includes("")`
 * 判断时能拿到 0.8。把两者混为一谈会改变检出结果，所以失败才返回 null。
 */
export function duplicateSiteHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hostSimilarity(a: string | null, b: string | null): number {
  if (a === null || b === null) return 0;
  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.8;
  return 0;
}

/** 标题词集（原实现用 `split(/\s+/)`，保留 "" 元素这一细节以完全等价） */
function titleTokens(title: string): Set<string> {
  return new Set(title.toLowerCase().trim().split(/\s+/));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const t of small) if (large.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * 扫描重复站点配对。`catMap` 是 categoryId → 类目名；类目名缺失时的兜底文案
 * 沿用改写前的口径（reason 用「未分类」，字段用「未知分类」）。
 *
 * @returns pairs（按输入下标字典序，与改写前的遍历顺序一致）与 truncated
 */
export function analyzeDuplicates(
  sites: readonly DuplicateInputSite[],
  catMap: Map<string, string>,
  limit: number = MAX_DUPLICATE_PAIRS,
): { pairs: SiteDuplicatePair[]; truncated: boolean } {
  const catName = (id: string) => catMap.get(id) || "未知分类";
  const catLabel = (id: string) => catMap.get(id) || "未分类";
  const hosts = sites.map((s) => duplicateSiteHost(s.url));
  const titles = sites.map((s) => (s.title ?? "").toLowerCase().trim());
  const tokens = titles.map((t) => titleTokens(t));

  const found: Array<{ i: number; j: number; pair: SiteDuplicatePair }> = [];
  let truncated = false;

  outer: for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const urlSim = hostSimilarity(hosts[i]!, hosts[j]!);
      const ta = tokens[i]!;
      const tb = tokens[j]!;

      // Jaccard 的尺寸上界：交集 ≤ min(|A|,|B|)，并集 ≥ max(|A|,|B|)。
      // 上界乘权重仍不超过域名分时，标题分不可能翻盘，直接省掉这次比对。
      const min = Math.min(ta.size, tb.size);
      const max = Math.max(ta.size, tb.size);
      const titleUpper = min / max;
      let combined = urlSim;
      if (titles[i] === titles[j] || titleUpper * TITLE_WEIGHT > urlSim) {
        const titleSim = titles[i] === titles[j] ? 1.0 : jaccard(ta, tb);
        combined = Math.max(urlSim, titleSim * TITLE_WEIGHT);
      }
      if (combined < DUP_THRESHOLD) continue;

      const a = sites[i]!;
      const b = sites[j]!;
      let recommendation: "merge" | "keep_both" | "archive_b" = "merge";
      let reason = `域名与标题重合度高达 ${(combined * 100).toFixed(0)}%`;
      if (a.categoryId !== b.categoryId) {
        recommendation = "merge";
        reason += `，且分布在不同分类【${catLabel(a.categoryId)}】与【${catLabel(b.categoryId)}】中，建议合并`;
      } else if (urlSim === 1.0) {
        recommendation = "archive_b";
        reason += `，指向同一域名，建议归档备用项`;
      }

      found.push({
        i,
        j,
        pair: {
          idA: a.id,
          titleA: a.title,
          urlA: a.url,
          categoryA: catName(a.categoryId),
          idB: b.id,
          titleB: b.title,
          urlB: b.url,
          categoryB: catName(b.categoryId),
          similarity: Number(combined.toFixed(2)),
          recommendation,
          reason,
        },
      });
      if (found.length >= limit) {
        truncated = true;
        break outer;
      }
    }
  }

  // 域名分与标题分的组合与遍历顺序无关，但输出顺序是用户可见的契约：
  // 恢复成"按原始下标字典序"，与改写前那两层顺序循环逐一相同。
  found.sort((x, y) => x.i - y.i || x.j - y.j);
  return { pairs: found.map((f) => f.pair), truncated };
}

export const graphRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 全景知识拓扑星图：生成包含站点、分类、标签及其引力关系的星图 Mesh
   */
  app.get("/api/graph/mesh", { config: { scope: "public" } }, async (req, reply) => {
    try {
      const sites = await ctx.repo.listSites({ limit: 1000 });
      const categories = await ctx.repo.listCategories();

      const nodes: SiteKnowledgeNode[] = [];
      const edges: SiteKnowledgeEdge[] = [];
      const nodeIds = new Set<string>();

      // 1. 分类节点（核心天体）
      const categoryMap = new Map<string, string>();
      for (const cat of categories) {
        const catNodeId = `cat_${cat.id}`;
        const catTitle = (cat as any).title || (cat as any).name || cat.id;
        categoryMap.set(cat.id, catTitle);
        if (!nodeIds.has(catNodeId)) {
          nodeIds.add(catNodeId);
          nodes.push({
            id: catNodeId,
            name: catTitle,
            type: "category",
            val: 18,
            color: "#6366f1", // Indigo
          });
        }
      }

      // 2. 站点节点与关系边
      const tagSet = new Set<string>();
      for (const site of sites) {
        const siteNodeId = `site_${site.id}`;
        if (!nodeIds.has(siteNodeId)) {
          nodeIds.add(siteNodeId);
          const clickCount = Number((site as any).clickCount) || 0;
          nodes.push({
            id: siteNodeId,
            name: site.title,
            type: "site",
            url: site.url,
            categoryId: site.categoryId,
            val: Math.max(8, Math.min(16, clickCount + 8)),
            color: "#06b6d4", // Cyan
          });
        }

        // 站点与分类的所属边
        if (site.categoryId && categoryMap.has(site.categoryId)) {
          edges.push({
            source: siteNodeId,
            target: `cat_${site.categoryId}`,
            relation: "belongs_to",
            weight: 2,
          });
        }

        // 标签收集
        if (Array.isArray(site.tags)) {
          for (const tag of site.tags) {
            if (!tag) continue;
            tagSet.add(tag);
            const tagNodeId = `tag_${tag}`;
            edges.push({
              source: siteNodeId,
              target: tagNodeId,
              relation: "has_tag",
              weight: 1,
            });
          }
        }
      }

      // 3. 标签节点（卫星天体）
      for (const tag of tagSet) {
        const tagNodeId = `tag_${tag}`;
        if (!nodeIds.has(tagNodeId)) {
          nodeIds.add(tagNodeId);
          nodes.push({
            id: tagNodeId,
            name: tag,
            type: "tag",
            val: 6,
            color: "#ec4899", // Pink
          });
        }
      }

      // 4. 统计汇总
      const mesh: SiteKnowledgeMesh = {
        nodes,
        edges,
        stats: {
          totalNodes: nodes.length,
          totalEdges: edges.length,
          categoryCount: categories.length,
          siteCount: sites.length,
        },
      };

      return mesh;
    } catch (err: any) {
      app.log.error(err, "Failed to build knowledge mesh");
      reply.code(500);
      return {
        error: "INTERNAL_ERROR",
        message: "Failed to build knowledge star mesh",
      };
    }
  });

  /**
   * 跨分类雷同站点查重与冗余分析
   */
  app.get("/api/sites/duplicates", { config: { scope: "public" } }, async (req, reply) => {
    try {
      const sites = await ctx.repo.listSites({ limit: 1000 });
      const categories = await ctx.repo.listCategories();
      const catMap = new Map<string, string>(
        categories.map((c) => [c.id, (c as any).title || (c as any).name || c.id])
      );

      // 比对逻辑抽到 analyzeDuplicates（导出的纯函数）：便于用参考实现做等值
      // 回归测试，也让"每对重新解析 URL / 重建词集"这一层成本被彻底消掉。
      const { pairs: duplicatePairs, truncated } = analyzeDuplicates(sites, catMap);

      const report: SiteDuplicateReport = {
        scannedCount: sites.length,
        duplicatePairs,
        potentialSavings: duplicatePairs.length,
        truncated,
      };

      return report;
    } catch (err: any) {
      app.log.error(err, "Failed to scan site duplicates");
      reply.code(500);
      return {
        error: "INTERNAL_ERROR",
        message: "Failed to scan site duplicates",
      };
    }
  });
};
