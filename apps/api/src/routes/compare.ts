/**
 * 跨站对照（GET /api/compare?siteIds=a,b,c，Batch 4 Phase 1 第 1 项）。
 *
 * 只比调用者本人的收藏：身份口径抄 /api/ask（askIdentityOf +
 * requireAskIdentity，匿名一律 401）；任一 id 不在本人可比收藏里
 * （不存在、他人收藏、pending/archived 指向）→ 整单通用 404，
 * 同码同 body，不点名是哪个 id，不返回部分结果。
 *
 * 取数：一次 listFavorites + 一次 getSitesByIds，内存求交后统一判定，
 * 不逐 id 查库（避免时序/分支泄漏存在性）。
 *
 * 维度组装走 core 的纯函数 buildSiteComparison（与 MCP compare_sites 共用）：
 * 7 维 × 每格 { value, source, verified, verifiedAt }，缺失标“未验证”，不排名、不打分。
 * 价格数值格（P2-2）由 site_prices 一次批量取数后传入组装。
 *
 * 缓存：private, max-age=60 + etag；Vary 含全部身份头（防串用户）；
 * 401/404/400 由 server.ts 的 onSend hook 强制 no-store。
 */
import type { FastifyPluginAsync } from "fastify";
import { buildSiteComparison, CompareSitesInput } from "@navhub/core";
import type { AppContext } from "../context.ts";
import { sendError } from "../error-envelope.ts";
import { requireAskIdentity } from "./ask.ts";

/** 与 /api/search 的 SEARCH_VARY 同款：响应因人而异，必须逐身份头分缓存键。 */
const COMPARE_VARY = ["x-navhub-anon-id", "x-user-id", "x-navhub-user-id", "authorization", "cookie"];

export const compareRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get(
    "/api/compare",
    {
      config: {
        scope: "public",
        rateLimit: { max: 120, timeWindow: "1 minute" },
        cache: { maxAge: 60, etag: true, vary: COMPARE_VARY },
      },
    },
    async (req, reply) => {
      const identity = await requireAskIdentity(ctx, req, reply);
      if (!identity) {
        return sendError(reply, 401, "UNAUTHORIZED", "横向对比只对登录用户开放，请先登录后再查看。");
      }

      // 查询串逗号切分、trim、去重后喂 schema（schema 只收数组，不做 transform）。
      const raw = (req.query as Record<string, unknown> | undefined)?.siteIds;
      const ids = typeof raw === "string" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];
      const parsed = CompareSitesInput.safeParse({ siteIds: [...new Set(ids)] });
      if (!parsed.success) {
        return sendError(reply, 400, "BAD_REQUEST", "请勾选 2–4 个已收藏站点进行对比。");
      }
      const siteIds = parsed.data.siteIds;

      const favorites = await ctx.repo.listFavorites(identity);
      const favBySite = new Map(favorites.map((f) => [f.siteId, f]));
      const sites = await ctx.repo.getSitesByIds(siteIds);
      // 统一判定：可比集合 = 本人收藏 ∩ 站点存在 ∩ 非 pending/archived。
      // pending/archived 站点不在导航可见集合内，不可比；broken 站点仍可比
      // （“是否还在维护”正是要对照的维度，巡检失败由 maintenance 格如实呈现）。
      const comparable = siteIds.every((id) => {
        const site = sites.get(id);
        return Boolean(
          favBySite.get(id) && site && site.status !== "pending" && site.status !== "archived",
        );
      });
      if (!comparable) {
        return sendError(reply, 404, "NOT_FOUND", "其中有站点不在你的收藏里，或已不在可对比状态。");
      }

      // 第三次取数（P2-2 价格数值）：一次批量取价格记录，按 siteId 传进组装。
      const prices = await ctx.repo.getSitePricesBySiteIds(identity, siteIds);

      const items = buildSiteComparison(
        siteIds.map((id) => {
          const site = sites.get(id)!;
          const fav = favBySite.get(id)!;
          return {
            site,
            favorite: { siteId: id, note: fav.note, tags: fav.tags, updatedAt: fav.updatedAt },
            price: prices.get(id) ?? null,
          };
        }),
      );
      return { ok: true, items };
    },
  );
};
