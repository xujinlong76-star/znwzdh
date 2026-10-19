import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import type {
  SiteKnowledgeMesh,
  SiteKnowledgeNode,
  SiteKnowledgeEdge,
  SiteDuplicateReport,
  SiteDuplicatePair,
} from "@navhub/core";

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

      const duplicatePairs: SiteDuplicatePair[] = [];

      // 智能双重比对：URL 归一化 + 标题模糊相似度 + 描述重合
      for (let i = 0; i < sites.length; i++) {
        for (let j = i + 1; j < sites.length; j++) {
          const a = sites[i];
          const b = sites[j];
          if (!a || !b) continue;

          // 1. URL 规范化比对
          let urlSimilarity = 0;
          try {
            const hostA = new URL(a.url).hostname.replace(/^www\./, "");
            const hostB = new URL(b.url).hostname.replace(/^www\./, "");
            if (hostA === hostB) {
              urlSimilarity = 1.0;
            } else if (hostA.includes(hostB) || hostB.includes(hostA)) {
              urlSimilarity = 0.8;
            }
          } catch {
            // fallback
          }

          // 2. 标题规范化相似度 (Jaccard on bigrams/words)
          const titleA = a.title.toLowerCase().trim();
          const titleB = b.title.toLowerCase().trim();
          let titleSimilarity = 0;
          if (titleA === titleB) {
            titleSimilarity = 1.0;
          } else {
            const setA = new Set(titleA.split(/\s+/));
            const setB = new Set(titleB.split(/\s+/));
            const intersection = [...setA].filter((x) => setB.has(x)).length;
            const union = new Set([...setA, ...setB]).size;
            titleSimilarity = union > 0 ? intersection / union : 0;
          }

          // 综合相似度打分
          const combined = Math.max(urlSimilarity, titleSimilarity * 0.9);

          if (combined >= 0.75) {
            let recommendation: "merge" | "keep_both" | "archive_b" = "merge";
            let reason = `域名与标题重合度高达 ${(combined * 100).toFixed(0)}%`;

            if (a.categoryId !== b.categoryId) {
              recommendation = "merge";
              reason += `，且分布在不同分类【${catMap.get(a.categoryId) || "未分类"}】与【${catMap.get(b.categoryId) || "未分类"}】中，建议合并`;
            } else if (urlSimilarity === 1.0) {
              recommendation = "archive_b";
              reason += `，指向同一域名，建议归档备用项`;
            }

            duplicatePairs.push({
              idA: a.id,
              titleA: a.title,
              urlA: a.url,
              categoryA: catMap.get(a.categoryId) || "未知分类",
              idB: b.id,
              titleB: b.title,
              urlB: b.url,
              categoryB: catMap.get(b.categoryId) || "未知分类",
              similarity: Number(combined.toFixed(2)),
              recommendation,
              reason,
            });
          }
        }
      }

      const report: SiteDuplicateReport = {
        scannedCount: sites.length,
        duplicatePairs,
        potentialSavings: duplicatePairs.length,
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
