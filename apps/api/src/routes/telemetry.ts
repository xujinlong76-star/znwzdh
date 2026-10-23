/**
 * 统计与事件上报（画像/LinUCB 闭环）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import type { RetrievalChannel } from "@navhub/core";
import { refreshUserProfile } from "../profile-service.ts";
import { identityTrusted, identityOf, resolveCanonicalIdentity } from "./shared.ts";

import { z } from "zod";
import type { AppContext } from "../context.ts";

export const telemetryRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------------ 统计 ------------------------------ */

  app.get("/api/stats", { config: { scope: "read" } }, async () => ctx.repo.stats());

  /**
   * 事件上报（前端点击/收藏等行为）。
   * kind 白名单：防止脏 kind 污染画像聚合与统计。
   * click 事件联动 visit_count（热度排序的原始信号）。
   */
  const EVENT_KINDS = [
    "click", "favorite", "unfavorite", "impression", "dismiss",
    // 插件市场漏斗（浏览 → 安装点击 → 安装成功/卸载在服务端路由补记）
    "plugin_view", "plugin_install_click", "plugin_uninstall_click", "plugin_share",
  ] as const;

  app.post("/api/events", async (req, reply) => {
    const body = z.object({
      kind: z.enum(EVENT_KINDS),
      siteId: z.string().optional(),
      query: z.string().optional(),
      categoryId: z.string().optional(),
      /** 插件事件归属（plugin_view / plugin_install_click / plugin_uninstall_click / plugin_share） */
      pluginSlug: z.string().max(80).optional(),
      channel: z.enum(["exact", "fts", "pinyin", "semantic", "personal"]).optional(),
      dwellSeconds: z.number().min(0).max(3600).optional(),
      interactionType: z.enum(["click", "copy", "bounce"]).optional(),
      /** 身份标识（登录 userId 或匿名 anonId），用于归属画像聚合 */
      userId: z.string().max(64).optional(),
      anonId: z.string().max(64).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const rawIdentity = identityOf(req as never);
    if (rawIdentity && !identityTrusted(ctx, req as never)) {
      reply.code(401);
      return { error: "需要 Bearer token" };
    }
    const identity = rawIdentity ? await resolveCanonicalIdentity(ctx, rawIdentity) : null;
    let telemetryEnabled = true;
    if (identity) {
      const settings = await ctx.repo.getUserSettings(identity).catch(() => null);
      if (settings && settings.telemetryEnabled === false) {
        telemetryEnabled = false;
      }
    }

    const recordedIdentity = telemetryEnabled ? identity : null;

    // 遥测事件不阻断主操作（与其余 recordEvent 调用点保持一致的容错语义）
    await ctx.repo.recordEvent(body.data.kind, {
      siteId: body.data.siteId,
      query: body.data.query,
      categoryId: body.data.categoryId,
      meta: recordedIdentity || body.data.pluginSlug
        ? { ...(recordedIdentity ? { identity: recordedIdentity } : {}), ...(body.data.pluginSlug ? { slug: body.data.pluginSlug } : {}) }
        : undefined,
    }).catch(() => undefined);
    if (body.data.kind === "click" && body.data.siteId) {
      await ctx.repo.bumpVisit(body.data.siteId).catch(() => undefined);
    }
    // 在线强化学习闭环：若带有搜索词，实时反馈更新 Discounted-LinUCB 通道权重
    if (body.data.query && (body.data.kind === "click" || body.data.kind === "favorite" || body.data.kind === "dismiss")) {
      const targetChannel: RetrievalChannel = body.data.channel ?? "exact";
      const explicitReward =
        body.data.kind === "favorite" ? 2.0 : body.data.kind === "dismiss" ? -0.5 : undefined;
      ctx.search.recordFeedback(targetChannel, body.data.query, {
        reward: explicitReward,
        dwellSeconds: body.data.dwellSeconds,
        interactionType: body.data.interactionType,
      });
    }
    // 行为变化 -> 刷新个性化画像（节流 60s，失败静默）
    if (recordedIdentity && (body.data.kind === "click" || body.data.kind === "favorite" || body.data.kind === "unfavorite")) {
      void refreshUserProfile(ctx, recordedIdentity);
    }
    return { ok: true };
  });

  /* ---------------------------- Web Vitals ---------------------------- */

  const VITAL_NAMES = ["LCP", "INP", "CLS", "TTFB", "FCP"] as const;

  app.post("/api/vitals", { config: { scope: "public" } }, async (req, reply) => {
    const body = z.object({
      name: z.enum(VITAL_NAMES),
      value: z.number().finite().min(0).max(600_000),
      rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
      path: z.string().max(200).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }
    await ctx.repo.recordEvent("vitals", { meta: body.data }).catch(() => undefined);
    reply.code(204);
    return null;
  });
};
