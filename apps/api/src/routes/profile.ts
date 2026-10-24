/**
 * 个性化画像（可解释偏好）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import {identityTrusted, resolveCanonicalIdentity, requestIdentityOf, userDomainWriteAllowed } from "./shared.ts";
import { invalidateProfileThrottle, refreshUserProfile, resetUserProfile } from "../profile-service.ts";

import type { AppContext } from "../context.ts";

/** 画像聚合窗口：与 profile-service 的 WINDOW_MS 保持一致（30 天） */
const PROFILE_WINDOW_MS = 30 * 86_400_000;
const SIGNAL_KINDS = new Set(["click", "search", "favorite"]);

export const profileRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* --------------------- 个性化画像（「我的偏好」） --------------------- */

  /**
   * 读画像：让终端用户看到「系统据我的行为推断出了什么」——可解释性即信任。
   * `?explain=1` 额外返回窗口内各信号的条数与开关状态，供「为什么是这个结果」展示。
   */
  app.get("/api/profile", async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    if (!rawIdentity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    // 身份合并后旧 id 仍可能发请求：读画像也要落到 canonical，否则返回空画像
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    const profile = await ctx.repo.getUserProfile(identity);
    const query = (req.query ?? {}) as Record<string, unknown>;
    const wantExplain = query.explain === "1" || query.explain === "true";
    if (!wantExplain) return { profile };

    const [settings, counts] = await Promise.all([
      ctx.repo.getUserSettings(identity),
      ctx.repo.signalCounts(identity, Date.now() - PROFILE_WINDOW_MS),
    ]);
    return {
      profile,
      explain: {
        windowDays: Math.round(PROFILE_WINDOW_MS / 86_400_000),
        personalizationEnabled: settings.personalizationEnabled,
        favoriteSignalCutoff: settings.favoriteSignalCutoff,
        signalCounts: counts,
        generatedAt: Date.now(),
      },
    };
  });

  /**
   * 重置画像：清 user_profiles + 该身份的行为事件（画像是从中聚合的）。
   * 收藏夹与搜索历史保留——那是用户自己的数据，不是被推断的偏好。
   */
  app.delete("/api/profile", async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!rawIdentity) { reply.code(400); return { ok: false, error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { ok: false, error: "需要 Bearer token" }; }
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    const result = await resetUserProfile(ctx, identity);
    return { ok: true, ...result };
  });

  /**
   * 清理某一类画像信号（click / search / favorite）并立即重建画像。
   *
   * favorite 的语义是「收藏对偏好的影响」：收藏本身保留，只把水位推进到现在，
   * 早于水位的收藏不再参与 favoriteSiteIds（否则重建时会立刻把它们加回来）。
   */
  app.delete("/api/profile/signals/:kind", async (req, reply) => {
    const kind = String((req.params as { kind?: string }).kind ?? "");
    if (!SIGNAL_KINDS.has(kind)) { reply.code(400); return { ok: false, error: "kind 只支持 click/search/favorite" }; }
    const rawIdentity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!rawIdentity) { reply.code(400); return { ok: false, error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { ok: false, error: "需要 Bearer token" }; }
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);

    let removed = 0;
    if (kind === "click" || kind === "favorite") {
      removed = await ctx.repo.deleteBehaviorEvents(identity, kind);
    } else {
      removed = await ctx.repo.countSearchHistory(identity);
      await ctx.repo.clearSearchHistory(identity);
    }
    if (kind === "favorite") {
      await ctx.repo.updateUserSettings(identity, { favoriteSignalCutoff: Date.now() });
    }

    invalidateProfileThrottle(identity);
    const rebuilt = await refreshUserProfile(ctx, identity);
    return { ok: true, kind, removed, profileRebuilt: rebuilt };
  });

};
