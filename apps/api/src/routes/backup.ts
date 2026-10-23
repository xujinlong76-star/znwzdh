import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import {
  exportNetscapeBookmarks,
  exportNavHubBackup,
  validateNavHubBackup,
} from "@navhub/core";

/**
 * 书签导出单次最多带多少站点。
 *
 * 存在的意义是"别把整库读进内存"这一层保护，而不是分页语义：
 * repo.listSites() 的默认 limit=100 曾让书签/冷备静默只含前 100 条，
 * 用户拿到的是**不完整备份**却看不出任何异常。导出必须显式走全量通道
 * （listAllSites），上限给到实际导航库不可能触及的量级，并且只在
 * 匿名可触发的书签导出上设限；admin 冷备不设限（见下）。
 */
const EXPORT_MAX_SITES = Math.max(100, Number(process.env.NAVHUB_EXPORT_MAX_SITES || 20_000));

/**
 * 单次恢复的条目上限。
 *
 * 4MB bodyLimit 只能限制字节数，拦不住“十万条超短记录”这种形状；恢复是
 * admin 触发的全量写事务，一旦在中途被 OOM/超时打断，回滚成本同样高。
 * 上限按实际导航库量级给足余量（导出端 EXPORT_MAX_SITES 是 2 万）。
 */
const RESTORE_MAX_CATEGORIES = 2_000;
const RESTORE_MAX_SITES = 50_000;

export const backupRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 导出标准 Netscape 书签 HTML (可导入 Chrome, Firefox, Safari, Edge)
   */
  app.get("/api/export/bookmarks.html", { config: { scope: "public", rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (_req, reply) => {
    const [categories, sites] = await Promise.all([
      ctx.repo.listCategories(),
      ctx.repo.listAllSites(EXPORT_MAX_SITES),
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
      // 冷备必须全量：少一条就是恢复时真的少一条。admin 作用域 + 限流已经
      // 把访问面收得很小，这里不设上限（宁可在极端大库上慢，也不要静默缺数据）。
      ctx.repo.listAllSites(),
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
    if (categories.length > RESTORE_MAX_CATEGORIES || sites.length > RESTORE_MAX_SITES) {
      reply.code(413);
      return {
        error: "BACKUP_TOO_LARGE",
        message: `备份条目过多：分类 ${categories.length}/${RESTORE_MAX_CATEGORIES}，站点 ${sites.length}/${RESTORE_MAX_SITES}`,
      };
    }

    let restoredCategories = 0;
    let restoredSites = 0;

    /**
     * 全量恢复必须是一个事务：旧实现逐条 createCategory/createSite，第 N 条撞唯一索引
     * 或校验失败时，前 N-1 条已经落库，调用方拿到 500 却留下一半新数据——
     * “重试一次”会把剩余部分补上，看起来像成功，但缺失/重复已经无法自动判定。
     * 现在任一条失败即整体回滚，返回 409 让调用方修好备份后重试。
     */
    try {
      await ctx.repo.withTransaction(async () => {
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
        const validCatIds = new Set(updatedCats.map((c) => c.id));
        const catTitleToId = new Map(updatedCats.map((c) => [c.title, c.id]));
        const oldIdToNewId = new Map<string, string>();
        for (const cat of categories) {
          const matched = catTitleToId.get(cat.title);
          if (matched) oldIdToNewId.set(cat.id, matched);
        }

        const existingSites = await ctx.repo.raw("SELECT url FROM sites WHERE deleted_at IS NULL");
        const existingUrls = new Set(
          existingSites.map((s) => String(s.url ?? "").replace(/\/+$/, "").toLowerCase()),
        );

        for (const site of sites) {
          if (!site.url || !/^https?:\/\//i.test(site.url)) continue;
          const norm = (site.url || "").replace(/\/+$/, "").toLowerCase();
          if (norm && !existingUrls.has(norm)) {
            let targetCatId = defaultCatId;
            if (site.categoryId) {
              if (validCatIds.has(site.categoryId)) {
                targetCatId = site.categoryId;
              } else if (oldIdToNewId.has(site.categoryId)) {
                targetCatId = oldIdToNewId.get(site.categoryId)!;
              }
            }
            await ctx.repo.createSite({
              title: site.title,
              url: site.url,
              description: site.description || "",
              categoryId: targetCatId,
              tags: site.tags || [],
              iconKey: site.icon || null,
            });
            restoredSites++;
            existingUrls.add(norm);
          }
        }
      });
    } catch (err) {
      req.log.error({ err }, "备份恢复失败，事务已回滚");
      reply.code(409);
      return {
        error: "RESTORE_FAILED",
        message: "备份恢复失败，已整体回滚；请修正备份内容后重试",
      };
    }

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "backup.restore",
      target: "backup",
      diff: {
        categories: restoredCategories,
        sites: restoredSites,
      },
    });

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
