/**
 * 待找（/api/me/wanted）：零结果的出口一 ——「存为待找」。
 *
 * 用户搜不到站时把查询存下来；投稿审核通过（新站变 active）时
 * matchWantedSearches 匹配命中则站内通知一次（见 repository/wanted-searches.ts）。
 *
 * 身份/限流口径仿 custom-sites：读 240/min、写 120/min；匿名 401
 * （匿名走前端 localStorage 只存查询串，不进这张表）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { WANTED_SEARCHES_MAX_OPEN_PER_USER, WANTED_QUERY_MAX_LENGTH } from "@navhub/store";
import { identityTrusted, resolveCanonicalIdentity, requestIdentityOf, userDomainWriteAllowed } from "./shared.ts";
import type { AppContext } from "../context.ts";

const createInput = z.object({
  query: z.string().trim().min(1).max(WANTED_QUERY_MAX_LENGTH),
  correctedQuery: z.string().trim().max(WANTED_QUERY_MAX_LENGTH).optional(),
});

export const wantedSearchRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  function requireIdentity(req: unknown): string | null {
    const identity = requestIdentityOf(req as never);
    if (!identity) return null;
    if (!identityTrusted(ctx, req as never)) return null;
    return identity;
  }

  app.get("/api/me/wanted", { config: { scope: "public", rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (req, reply) => {
    const identity = requireIdentity(req);
    if (!identity) { reply.code(401); return { error: "身份未受信或缺少登录身份" }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const items = await ctx.repo.listWantedSearches(canonical);
    return { ok: true, items };
  });

  app.post("/api/me/wanted", { config: { scope: "public", rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!userDomainWriteAllowed(req as never, "favorites")) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    const identity = requireIdentity(req);
    if (!identity) { reply.code(401); return { error: "身份未受信或缺少登录身份" }; }
    const body = createInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const created = await ctx.repo.createWantedSearch({
      identity: canonical,
      query: body.data.query,
      correctedQuery: body.data.correctedQuery ?? null,
    });
    if (!created) { reply.code(409); return { error: `待找已达上限（${WANTED_SEARCHES_MAX_OPEN_PER_USER} 条），请先删除一些再存` }; }
    reply.code(created.duplicate ? 200 : 201);
    return { ok: true, item: created.item, ...(created.duplicate ? { duplicate: true } : {}) };
  });

  app.delete("/api/me/wanted/:id", { config: { scope: "public", rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!userDomainWriteAllowed(req as never, "favorites")) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    const identity = requireIdentity(req);
    if (!identity) { reply.code(401); return { error: "身份未受信或缺少登录身份" }; }
    const { id } = req.params as { id: string };
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const removed = await ctx.repo.deleteWantedSearch(canonical, id);
    return { ok: true, removed };
  });
};
