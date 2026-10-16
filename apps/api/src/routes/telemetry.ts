/**
 * 统计与事件上报（画像/LinUCB 闭环）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import type { RetrievalChannel } from "@navhub/core";
import { refreshUserProfile, resetUserProfile } from "../profile-service.ts";

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
  const EVENT_KINDS = ["click", "favorite", "unfavorite", "impression", "dismiss"] as const;

  app.post("/api/events", async (req, reply) => {
    const body = z.object({
      kind: z.enum(EVENT_KINDS),
      siteId: z.string().optional(),
      query: z.string().optional(),
      categoryId: z.string().optional(),
      channel: z.enum(["exact", "fts", "pinyin", "semantic", "personal"]).optional(),
      dwellSeconds: z.number().min(0).max(3600).optional(),
      interactionType: z.enum(["click", "copy", "bounce"]).optional(),
      /** 身份标识（登录 userId 或匿名 anonId），用于归属画像聚合 */
      userId: z.string().max(64).optional(),
      anonId: z.string().max(64).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const identity = body.data.userId ?? body.data.anonId ?? null;
    // 遥测事件不阻断主操作（与其余 recordEvent 调用点保持一致的容错语义）
    await ctx.repo.recordEvent(body.data.kind, {
      siteId: body.data.siteId,
      query: body.data.query,
      categoryId: body.data.categoryId,
      meta: identity ? { identity } : undefined,
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
    if (identity && (body.data.kind === "click" || body.data.kind === "favorite" || body.data.kind === "unfavorite")) {
      void refreshUserProfile(ctx, identity);
    }
    return { ok: true };
  });

};
