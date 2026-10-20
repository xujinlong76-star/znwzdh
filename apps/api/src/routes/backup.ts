import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import {
  exportNetscapeBookmarks,
  exportNavHubBackup,
  validateNavHubBackup,
  type NavHubColdBackup,
} from "@navhub/core";

export const backupRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 导出标准 Netscape 书签 HTML (可导入 Chrome, Firefox, Safari, Edge)
   */
  app.get("/api/export/bookmarks.html", { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (_req, reply) => {
    const [categories, sites] = await Promise.all([
      ctx.repo.listCategories(),
      ctx.repo.listSites(),
    ]);

    const activeSites = sites.filter((s) => s.enabled !== false);
    const html = exportNetscapeBookmarks(categories, activeSites);

    reply.header("Content-Type", "text/html; charset=utf-8");
    reply.header("Content-Disposition", 'attachment; filename="navhub-bookmarks.html"');
    return html;
  });

  /**
   * 导出全量冷备数据包 (.nhbak.json)
   *
   * 冷备包含 disabled 站点等未发布数据，且对应恢复接口是 admin；下载也必须
   * 是 admin，避免匿名请求把「未启用/待上线」站点整体导出。书签 HTML 仍是
   * 面向普通用户的 public 导出，但只包含 enabled 站点。
   */
  app.get("/api/export/backup.json", { config: { scope: "admin", rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (_req, reply) => {
    const [categories, sites] = await Promise.all([
      ctx.repo.listCategories(),
      ctx.repo.listSites(),
    ]);

    const json = exportNavHubBackup(categories, sites);

    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="navhub-backup-${Date.now()}.nhbak.json"`);
    return json;
  });

  /**
   * 校验并还原冷备灾备数据包
   */
  app.post("/api/backup/restore", { config: { scope: "admin" } }, async (req, reply) => {
    const body = req.body as any;
    const jsonStr = typeof body === "string" ? body : JSON.stringify(body);
    const validation = validateNavHubBackup(jsonStr);

    if (!validation.valid || !validation.backup) {
      reply.code(400);
      return {
        error: "INVALID_BACKUP",
        message: validation.error || "无效的备份文件",
      };
    }

    const { categories, sites } = validation.backup;
    let restoredCategories = 0;
    let restoredSites = 0;

    // 幂等式恢复分类
    const existingCats = await ctx.repo.listCategories();
    const existingCatTitles = new Set(existingCats.map((c) => c.title));

    for (const cat of categories) {
      if (!existingCatTitles.has(cat.title)) {
        await ctx.repo.createCategory({
          id: cat.id,
          title: cat.title,
          description: cat.description || null,
          sort: cat.sort || 0,
        });
        restoredCategories++;
        existingCatTitles.add(cat.title);
      }
    }

    // 幂等式恢复站点
    const updatedCats = await ctx.repo.listCategories();
    const defaultCatId = updatedCats[0]?.id || "default";
    const existingSites = await ctx.repo.listSites();
    const existingUrls = new Set(existingSites.map((s) => s.url.replace(/\/+$/, "").toLowerCase()));

    for (const site of sites) {
      const norm = (site.url || "").replace(/\/+$/, "").toLowerCase();
      if (norm && !existingUrls.has(norm)) {
        await ctx.repo.createSite({
          title: site.title,
          url: site.url,
          description: site.description || "",
          categoryId: site.categoryId || defaultCatId,
          tags: site.tags || [],
          iconKey: site.icon || null,
        });
        restoredSites++;
        existingUrls.add(norm);
      }
    }

    return {
      ok: true,
      message: `成功恢复 ${restoredCategories} 个分类与 ${restoredSites} 个站点`,
      restored: {
        categories: restoredCategories,
        sites: restoredSites,
      },
    };
  });
};
