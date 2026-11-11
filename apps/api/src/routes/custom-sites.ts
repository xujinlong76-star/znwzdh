/**
 * 用户自定义站点（终端用户，用户中心「我的站点」）。
 *
 * 与收藏的区别：收藏只能指向目录内已有站点；自定义站点是用户自己的网址，
 * 服务端按账号持久化，登录后跨设备同步。身份/信任/令牌守卫与收藏同口径
 * （见 ./favorites.ts 与 ./shared.ts），不另起一套。
 *
 * URL 安全：只收 http(s) 绝对地址，javascript:/data: 等伪协议在校验层拒绝；
 * 前端渲染时仍要再过 safeHref（纵深防御，与收藏/短剧同规矩）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CUSTOM_SITES_MAX_PER_USER } from "@navhub/store";
import { identityTrusted, resolveCanonicalIdentity, requestIdentityOf, userDomainWriteAllowed } from "./shared.ts";
import type { AppContext } from "../context.ts";

const urlField = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((v) => /^https?:\/\//i.test(v), { message: "只支持 http(s):// 地址" });

const createInput = z.object({
  title: z.string().trim().min(1).max(80),
  url: urlField,
  note: z.string().trim().max(200).nullable().optional(),
});

const patchInput = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    url: urlField.optional(),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => v.title !== undefined || v.url !== undefined || v.note !== undefined, {
    message: "至少要修改 title、url 或 note 之一",
  });

const reorderInput = z.object({
  ids: z.array(z.string().min(1)).min(1).max(CUSTOM_SITES_MAX_PER_USER),
});

export const customSiteRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /** 读口守卫：身份必须可解析且受信（与收藏读口一致） */
  function requireIdentity(req: unknown): string | null {
    const identity = requestIdentityOf(req as never);
    if (!identity) return null;
    if (!identityTrusted(ctx, req as never)) return null;
    return identity;
  }

  app.get("/api/me/custom-sites", { config: { scope: "public", rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (req, reply) => {
    const identity = requireIdentity(req);
    if (!identity) { reply.code(401); return { error: "身份未受信或缺少登录身份" }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const items = await ctx.repo.listCustomSites(canonical);
    return { ok: true, items };
  });

  app.post("/api/me/custom-sites", { config: { scope: "public", rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!userDomainWriteAllowed(req as never, "favorites")) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    const identity = requireIdentity(req);
    if (!identity) { reply.code(401); return { error: "身份未受信或缺少登录身份" }; }
    const body = createInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const created = await ctx.repo.createCustomSite({
      userId: canonical,
      title: body.data.title,
      url: body.data.url,
      note: body.data.note ?? null,
    });
    if (!created) { reply.code(409); return { error: `自定义站点已达上限（${CUSTOM_SITES_MAX_PER_USER} 个）` }; }
    reply.code(201);
    return { ok: true, item: created };
  });

  app.patch("/api/me/custom-sites/:id", { config: { scope: "public", rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!userDomainWriteAllowed(req as never, "favorites")) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    const identity = requireIdentity(req);
    if (!identity) { reply.code(401); return { error: "身份未受信或缺少登录身份" }; }
    const { id } = req.params as { id: string };
    const body = patchInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const updated = await ctx.repo.updateCustomSite(canonical, id, body.data);
    if (!updated) { reply.code(404); return { error: "自定义站点不存在" }; }
    return { ok: true, item: updated };
  });

  app.delete("/api/me/custom-sites/:id", { config: { scope: "public", rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!userDomainWriteAllowed(req as never, "favorites")) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    const identity = requireIdentity(req);
    if (!identity) { reply.code(401); return { error: "身份未受信或缺少登录身份" }; }
    const { id } = req.params as { id: string };
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const removed = await ctx.repo.deleteCustomSite(canonical, id);
    return { ok: true, removed };
  });

  app.post("/api/me/custom-sites/reorder", { config: { scope: "public", rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!userDomainWriteAllowed(req as never, "favorites")) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    const identity = requireIdentity(req);
    if (!identity) { reply.code(401); return { error: "身份未受信或缺少登录身份" }; }
    const body = reorderInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const items = await ctx.repo.reorderCustomSites(canonical, body.data.ids);
    if (!items) { reply.code(400); return { error: "排序列表必须恰好包含全部自定义站点" }; }
    return { ok: true, items };
  });
};
