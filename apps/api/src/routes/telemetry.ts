/**
 * 统计与事件上报（画像/LinUCB 闭环）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import type { RetrievalChannel } from "@navhub/core";
import { refreshUserProfile } from "../profile-service.ts";
import { identityTrusted, requestIdentityOf, resolveCanonicalIdentity } from "./shared.ts";

import { z } from "zod";
import type { AppContext } from "../context.ts";

export const telemetryRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------------ 统计 ------------------------------ */

  app.get("/api/stats", { config: { scope: "read" } }, async () => ctx.repo.stats());

  /**
   * 事件上报（前端点击/收藏等行为）。
   * kind 白名单：防止脏 kind 污染画像聚合与统计 —— 这里就是事件字典的唯一真相源，
   * 客户端的联合类型必须与之逐字一致（守卫测试两侧同断言）。
   * click 事件联动 visit_count（热度排序的原始信号）。
   *
   * vault_*（首页 DIY 云端金库面）：此前这条链路零埋点 —— 实测 events 791 行里
   * kind LIKE '%vault%'|'%diy%'|'%backup%'|'%conflict%'|'%p2p%' 命中 0 行、
   * user_vault_sync 0 行，所以「有没有人真的在用云端金库」「有多少人撞到 VAULT_CLEARED」
   * 都无从回答。分支不拆成多个 kind（同一行为在不同版本叫法不一致会让漏斗对不齐），
   * 而是 kind + outcome + code 三段：outcome 是有界枚举（成败本身），
   * code 是原因码（长度受限，禁止塞内容/密码/条数）。
   */
  const EVENT_KINDS = [
    "click", "favorite", "unfavorite", "impression", "dismiss",
    // 插件市场漏斗（浏览 → 安装点击 → 安装成功/卸载在服务端路由补记）
    "plugin_view", "plugin_install_click", "plugin_uninstall_click", "plugin_share",
    // 云端金库漏斗：对表（分母）/ 推送 / 拉取解密 / 永久删除
    "vault_status", "vault_sync", "vault_pull", "vault_delete",
    // 登录后「本机偏好 → 云端」交接：只在交接被尝试时上报，
    // 云端已有行的正常运行不发消息（否则分母会被每次页面加载灌满）。
    "settings_handoff",
    /**
     * 点击投递的失败/修复面（低基数、只在「差点丢了」时发）：
     * click 成功送达本身就是事件，不需要再报一次；这个 kind 只记
     * 入队（failed/enqueued）、补送成功（success/drained）、按同意删除（deleted/consent_off）。
     * 有了它，「点击 → 落库」的分母才不再只能靠 visit_count 为 0 反推。
     */
    "click_delivery",
  ] as const;

  /** outcome 词表（有界）：每条分支的成败，与各 kind 组合后仍能一笔画出漏斗 */
  const EVENT_OUTCOMES = [
    "success", "failed", "conflict", "empty", "deleted", "absent", "no_identity",
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
      /** 结果名次（1 起）：点击归因需要位置，才能区分「第一命中」与「翻到第五个才点」 */
      position: z.number().int().min(1).max(200).optional(),
      dwellSeconds: z.number().min(0).max(3600).optional(),
      interactionType: z.enum(["click", "copy", "bounce"]).optional(),
      /**
       * 点击来源：搜索结果与 AI 回复里的引用是两种不同的行为。
       * 没有这个字段，「引用点击率」的分子与普通站点点击混在一起，永远算不出来。
       */
      source: z.enum(["search", "copilot_citation"]).optional(),
      /** 业务分支结果（vault_* 必带；其余 kind 可选） */
      outcome: z.enum(EVENT_OUTCOMES).optional(),
      /** 原因码：conflict 的成因、HTTP 状态、失败类别。长度受限，不是内容字段 */
      code: z.string().max(32).optional(),
      /** 身份标识（登录 userId 或匿名 anonId），用于归属画像聚合 */
      userId: z.string().max(64).optional(),
      anonId: z.string().max(64).optional(),
      /**
       * 客户端幂等键：端侧「点击出箱」会在回到线上后重放同一条证据，
       * 没有这个键，重放就会给 `visit_count` 多加 1（该列本机实测 99.8% 为 0，
       * 是排序的次键，重复计数会被小分母放大成错误排名）。
       * 字符集与长度必须受限：它会被拼进 `meta LIKE ?` 的匹配模式。
       */
      eventId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
      /** 客户端事件时刻（毫秒）：重放时保住真实点击时间，不被服务端 now() 抹平 */
      clientCreatedAt: z.number().int().positive().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const rawIdentity = requestIdentityOf(req as never);
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

    const meta =
      recordedIdentity || body.data.pluginSlug || body.data.outcome || body.data.code || body.data.position !== undefined || body.data.source
        ? {
            ...(recordedIdentity ? { identity: recordedIdentity } : {}),
            ...(body.data.pluginSlug ? { slug: body.data.pluginSlug } : {}),
            ...(body.data.outcome ? { outcome: body.data.outcome } : {}),
            ...(body.data.code ? { code: body.data.code } : {}),
            ...(body.data.position !== undefined ? { position: body.data.position } : {}),
            ...(body.data.source ? { source: body.data.source } : {}),
          }
        : undefined;
    // 遥测事件不阻断主操作（与其余 recordEvent 调用点保持一致的容错语义）
    // `false` = 幂等键命中（端侧出箱重放）；此时后面的三个副作用一个都不能再走。
    // 读失败时 store 放行插入并返回 true，故 `.catch` 的 undefined 也按「已插入」处理。
    const inserted = await ctx.repo
      .recordEvent(body.data.kind, {
        siteId: body.data.siteId,
        query: body.data.query,
        categoryId: body.data.categoryId,
        meta,
        eventId: body.data.eventId,
        clientCreatedAt: body.data.clientCreatedAt,
      })
      .catch(() => undefined);
    const replayed = inserted === false;
    if (!replayed && body.data.kind === "click" && body.data.siteId) {
      await ctx.repo.bumpVisit(body.data.siteId).catch(() => undefined);
    }
    // 在线强化学习闭环：若带有搜索词，实时反馈更新 Discounted-LinUCB 通道权重
    if (!replayed && body.data.query && (body.data.kind === "click" || body.data.kind === "favorite" || body.data.kind === "dismiss")) {
      const targetChannel: RetrievalChannel = body.data.channel ?? "exact";
      const explicitReward =
        body.data.kind === "favorite" ? 2.0 : body.data.kind === "dismiss" ? -0.5 : undefined;
      ctx.search.recordFeedback(targetChannel, body.data.query, {
        reward: explicitReward,
        dwellSeconds: body.data.dwellSeconds,
        interactionType: body.data.interactionType,
      });
    }
    // 行为变化 -> 刷新个性化画像（节流 60s，失败静默）；重放不再刷一次
    if (!replayed && recordedIdentity && (body.data.kind === "click" || body.data.kind === "favorite" || body.data.kind === "unfavorite")) {
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
