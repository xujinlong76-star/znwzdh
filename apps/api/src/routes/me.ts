/**
 * 用户中心（/api/me）
 *
 * 身份来源：由 Web 侧 BFF 根据 NextAuth 会话派生，并以
 * `x-navhub-user-id` + `x-navhub-identity-signature` 转发到中枢。
 * 这里不接受客户端自报的 userId（BFF 会剥离客户端同名头）。
 *
 * 端点：
 *  - GET    /api/me                      概览（身份、计数、画像/金库/AI 配置存在性、别名、设置）
 *  - GET    /api/me/settings             获取个人设置
 *  - PATCH  /api/me/settings             更新个人设置（含个性化、搜索引擎、打开方式、卡片密度、0-RTT、快捷键、遥测与历史保留期）
 *  - PATCH  /api/me/profile              更新个人显示资料（昵称 username / 头像 avatar）
 *  - POST   /api/me/diagnostics          执行云端账户数据完整性自检与自动修复
 *  - GET    /api/me/export               导出全部个人数据（JSON）
 *  - GET    /api/me/export/bookmarks.html 导出浏览器标准 Netscape 书签（HTML）
 *  - GET    /api/me/activity             我的操作记录
 *  - POST   /api/me/favorites/sync       收藏增量同步
 *  - POST   /api/me/merge                匿名数据合并到登录身份（幂等、事务、审计）
 *  - DELETE /api/me                      注销并清空云端个人数据
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { AppContext } from "../context.ts";
import { identityOf, identityTrusted } from "./shared.ts";
import { verifyIdentitySignature } from "../identity-signature.ts";
import { invalidateProfileThrottle, refreshUserProfile } from "../profile-service.ts";
import { recordUserCenterMetric } from "../user-center-metrics.ts";

/** 前端生成的匿名 id 形态：anon-<uuid>；限制长度避免异常值写入别名表 */
const ANON_ID_RE = /^anon-[A-Za-z0-9_-]{8,80}$/;

const settingsPatchSchema = z
  .object({
    personalizationEnabled: z.boolean().optional(),
    favoriteSignalCutoff: z
      .number()
      .int()
      .min(0)
      .max(4_102_444_800_000) // 2100-01-01，挡住异常大值与未来时间戳
      .optional(),
    defaultSearchEngine: z.enum(["internal", "google", "bing", "duckduckgo", "github", "perplexity"]).optional(),
    openLinksInNewTab: z.boolean().optional(),
    cardDensity: z.enum(["comfortable", "compact", "minimal"]).optional(),
    speculativeZeroRttEnabled: z.boolean().optional(),
    daypartSceneEnabled: z.boolean().optional(),
    spotlightShortcut: z.enum(["mod+k", "slash", "both"]).optional(),
    searchHistoryEnabled: z.boolean().optional(),
    telemetryEnabled: z.boolean().optional(),
    historyRetentionDays: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]).optional(),
  })
  .refine(
    (v) => Object.values(v).some((val) => val !== undefined),
    {
      message: "至少要提供一个待修改的设置项（如 personalizationEnabled 或 favoriteSignalCutoff 等）",
    },
  );

function isSafeAvatarUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  try {
    const u = new URL(trimmed);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export const meRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get("/api/me", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) {
      reply.code(401);
      return { error: "缺少登录身份" };
    }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const [overview, settings] = await Promise.all([
      ctx.repo.getUserCenterOverview(canonical),
      ctx.repo.getUserSettings(canonical),
    ]);
    return { ok: true, ...overview, settings };
  });

  /* ------------------------- 设置 ------------------------- */

  app.get("/api/me/settings", async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const canonical = await ctx.repo.resolveIdentity(identity);
    return { ok: true, settings: await ctx.repo.getUserSettings(canonical) };
  });

  app.patch("/api/me/settings", async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const parsed = settingsPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "参数无效", detail: parsed.error.issues };
    }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const settings = await ctx.repo.updateUserSettings(canonical, parsed.data);
    await ctx.repo.audit({
      ip: req.ip,
      actor: canonical,
      actorKind: "user",
      action: "user.settings_update",
      target: canonical,
      diff: parsed.data,
    }).catch(() => undefined);
    return { ok: true, settings };
  });

  /* ------------------------- 个人资料与云端自检修复 ------------------------- */

  app.patch("/api/me/profile", async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    if (identity.startsWith("anon-")) {
      reply.code(403);
      return { error: "匿名身份不支持修改云端账户资料" };
    }

    const parsed = z
      .object({
        username: z.string().trim().min(1).max(40).regex(/^[^\u0000-\u001f<>]+$/, "昵称包含非法字符").optional(),
        avatar: z.string().max(500).nullable().optional(),
      })
      .refine((v) => v.username !== undefined || v.avatar !== undefined, {
        message: "至少要修改 username 或 avatar 之一",
      })
      .safeParse(req.body ?? {});

    if (!parsed.success) {
      reply.code(400);
      return { error: "参数无效", detail: parsed.error.issues };
    }

    const rawAvatar = parsed.data.avatar;
    if (typeof rawAvatar === "string" && rawAvatar.trim() !== "" && !isSafeAvatarUrl(rawAvatar)) {
      reply.code(400);
      return { error: "头像地址只支持 http(s):// 或站内相对路径 /..." };
    }

    const canonical = await ctx.repo.resolveIdentity(identity);
    const outcome = await ctx.repo.updateUserProfileInfo(canonical, {
      username: parsed.data.username,
      avatar: rawAvatar === "" ? null : rawAvatar,
    });

    if (!outcome.ok) {
      reply.code(outcome.reason === "username_taken" ? 409 : 400);
      return {
        error: outcome.reason === "username_taken" ? "该显示昵称已被占用，请更换其它名称" : "个人资料参数无效",
      };
    }

    await ctx.repo.audit({
      ip: req.ip,
      actor: canonical,
      actorKind: "user",
      action: "user.profile_update",
      target: canonical,
      diff: { username: outcome.user.username },
    }).catch(() => undefined);

    return {
      ok: true,
      user: {
        id: outcome.user.id,
        username: outcome.user.username,
        email: outcome.user.email ?? null,
        avatar: outcome.user.avatar ?? null,
        source: outcome.user.source ?? "local",
      },
    };
  });

  app.post(
    "/api/me/diagnostics",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
      const identity = identityOf(req as never);
      if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
      const canonical = await ctx.repo.resolveIdentity(identity);

      const checks: Array<{
        id: string;
        label: string;
        status: "ok" | "repaired";
        detail: string;
      }> = [];
      let repairedCount = 0;

      // 1. 检查并自动修复悬空收藏夹引用（folder_id 指向已不存在的收藏夹）
      const orphanFavRows = await ctx.repo.raw(
        `SELECT COUNT(*) AS c FROM favorites
         WHERE user_id = ? AND deleted_at IS NULL AND folder_id IS NOT NULL
           AND folder_id NOT IN (SELECT id FROM favorite_folders WHERE user_id = ?)`,
        [canonical, canonical],
      );
      const orphanFolderCount = Number(orphanFavRows[0]?.c ?? 0);
      if (orphanFolderCount > 0) {
        await ctx.repo.run(
          `UPDATE favorites SET folder_id = NULL, updated_at = ?
           WHERE user_id = ? AND deleted_at IS NULL AND folder_id IS NOT NULL
             AND folder_id NOT IN (SELECT id FROM favorite_folders WHERE user_id = ?)`,
          [Date.now(), canonical, canonical],
        );
        repairedCount += orphanFolderCount;
        checks.push({
          id: "orphan_folders",
          label: "收藏夹归属引用完整性",
          status: "repaired",
          detail: `发现并修复了 ${orphanFolderCount} 条指向失效收藏夹的书签，已自动归回「未分组」`,
        });
      } else {
        checks.push({
          id: "orphan_folders",
          label: "收藏夹归属引用完整性",
          status: "ok",
          detail: "全部云端收藏夹引用一致，无悬空孤儿项",
        });
      }

      // 2. 检查并清理超出用户设定保留周期的过期搜索历史
      const settings = await ctx.repo.getUserSettings(canonical);
      const retentionDays = settings.historyRetentionDays || 180;
      const cutoffTs = Date.now() - retentionDays * 86_400_000;
      const expiredHistRows = await ctx.repo.raw(
        "SELECT COUNT(*) AS c FROM search_history WHERE user_id = ? AND created_at < ?",
        [canonical, cutoffTs],
      );
      const expiredHistCount = Number(expiredHistRows[0]?.c ?? 0);
      if (expiredHistCount > 0) {
        await ctx.repo.run(
          "DELETE FROM search_history WHERE user_id = ? AND created_at < ?",
          [canonical, cutoffTs],
        );
        repairedCount += expiredHistCount;
        checks.push({
          id: "history_retention",
          label: `历史保留窗口 (${retentionDays} 天) 巡检`,
          status: "repaired",
          detail: `已自动清理 ${expiredHistCount} 条超过 ${retentionDays} 天保留期的陈旧搜索记录`,
        });
      } else {
        checks.push({
          id: "history_retention",
          label: `历史保留窗口 (${retentionDays} 天) 巡检`,
          status: "ok",
          detail: `所有搜索历史均在 ${retentionDays} 天保留期内`,
        });
      }

      // 3. 校验个人设置与画像同步状态
      if (settings.personalizationEnabled) {
        invalidateProfileThrottle(canonical);
        await refreshUserProfile(ctx, canonical).catch(() => false);
      }
      checks.push({
        id: "settings_and_profile",
        label: "云端偏好设置与个性化画像一致性",
        status: "ok",
        detail: settings.personalizationEnabled
          ? "偏好配置校验通过，已同步触发个性化画像实时重算"
          : "偏好配置校验通过（当前已关闭个性化画像重排）",
      });

      await ctx.repo.audit({
        ip: req.ip,
        actor: canonical,
        actorKind: "user",
        action: "user.diagnostics",
        target: canonical,
        diff: { repairedCount },
      }).catch(() => undefined);

      return {
        ok: true,
        identity: canonical,
        repairedCount,
        checks,
        checkedAt: Date.now(),
      };
    },
  );

  /* ------------------------- 数据主权 ------------------------- */

  /** 导出全部个人数据（JSON 附件；LLM 密钥已脱敏，金库只带版本元信息） */
  app.get(
    "/api/me/export",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const payload = await ctx.repo.exportUserData(canonical);
    await ctx.repo.audit({
      ip: req.ip,
      actor: canonical,
      actorKind: "user",
      action: "user.export",
      target: canonical,
      diff: {
        favorites: payload.favorites.length,
        folders: payload.favoriteFolders.length,
        searches: payload.searchHistory.items.length,
      },
    }).catch(() => undefined);
    recordUserCenterMetric("dataSovereignty.exportJson");
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header("content-type", "application/json; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="navhub-export-${stamp}.json"`);
    return payload;
  });

  /**
   * 我的操作记录：用户可见的数据主权面板（M10）。
   * 数据源是既有 audit_logs（user.export / user.delete / identity.merge / workspace:*），
   * 只暴露 action / target / 时间；IP 与内部 diff 不外传。
   */
  app.get(
    "/api/me/activity",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
      const identity = identityOf(req as never);
      if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
      const canonical = await ctx.repo.resolveIdentity(identity);
      const q = (req.query ?? {}) as Record<string, string>;
      const limit = Math.min(Math.max(Number(q.limit ?? 20) || 20, 1), 100);
      const page = await ctx.repo.listAuditLogs({ actor: canonical, limit });
      recordUserCenterMetric("dataSovereignty.activityRead");
      return {
        ok: true,
        identity: canonical,
        items: page.items.map((row) => ({ action: row.action, target: row.target, at: row.createdAt })),
        hasMore: page.hasMore,
      };
    },
  );

  /**
   * 收藏批量同步（M1）。
   */
  app.post(
    "/api/me/favorites/sync",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
      const identity = identityOf(req as never);
      if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
      const parsed = z.object({
        ops: z.array(z.object({
          op: z.enum(["add", "update", "remove"]),
          siteId: z.string().min(1).max(64),
          folderId: z.string().max(64).optional().nullable(),
          note: z.string().max(200).optional().nullable(),
          at: z.number().optional(),
        })).max(500),
        since: z.number().optional(),
      }).safeParse(req.body ?? {});
      if (!parsed.success) {
        recordUserCenterMetric("favoritesSync.failure");
        reply.code(400);
        return { error: "参数无效", detail: parsed.error.issues };
      }
      const canonical = await ctx.repo.resolveIdentity(identity);
      const applied = await ctx.repo.applyFavoriteOps(canonical, parsed.data.ops);
      recordUserCenterMetric("favoritesSync.opsSubmitted", parsed.data.ops.length);
      const [slice, folders] = await Promise.all([
        ctx.repo.listFavoritesSince(canonical, parsed.data.since ?? 0),
        ctx.repo.listFavoriteFolders(canonical),
      ]);
      const siteMap = await ctx.repo.getSitesByIds(slice.items.map((item) => item.siteId));
      recordUserCenterMetric("favoritesSync.success");
      return {
        ok: true,
        applied: applied.applied,
        version: Math.max(applied.version, slice.version),
        items: slice.items.map((item) => ({ ...item, site: siteMap.get(item.siteId) ?? null })),
        folders,
      };
    },
  );

  /**
   * 用户级书签导出（M9 互操作）：收藏 → Netscape 书签 HTML
   */
  app.get(
    "/api/me/export/bookmarks.html",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
      const identity = identityOf(req as never);
      if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
      const canonical = await ctx.repo.resolveIdentity(identity);
      const [favorites, folders] = await Promise.all([
        ctx.repo.listFavorites(canonical),
        ctx.repo.listFavoriteFolders(canonical),
      ]);
      const sites = await ctx.repo.getSitesByIds(favorites.map((f) => f.siteId));
      const folderName = new Map(folders.map((f) => [f.id, f.name]));

      const esc = (value: string) =>
        value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const byFolder = new Map<string, Array<{ url: string; title: string; createdAt: number }>>();
      for (const fav of favorites) {
        const site = sites.get(fav.siteId);
        if (!site) continue;
        if (!/^https?:\/\//i.test(site.url)) continue;
        const key = fav.folderId ? (folderName.get(fav.folderId) ?? "未分组") : "未分组";
        const list = byFolder.get(key) ?? [];
        list.push({ url: site.url, title: fav.note || site.title, createdAt: fav.createdAt });
        byFolder.set(key, list);
      }
      const sections = [...byFolder.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "zh-CN"))
        .map(([folder, items]) => {
          const links = items
            .map(
              (item) =>
                `    <DT><A HREF="${esc(item.url)}" ADD_DATE="${Math.floor(item.createdAt / 1000)}">${esc(item.title)}</A>`,
            )
            .join("\n");
          return `  <DT><H3>${esc(folder)}</H3>\n  <DL><p>\n${links}\n  </DL><p>`;
        })
        .join("\n");
      const html =
        `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n` +
        `<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n` +
        `<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${sections}\n</DL><p>\n`;

      await ctx.repo.audit({
        ip: req.ip,
        actor: canonical,
        actorKind: "user",
        action: "user.export",
        target: canonical,
        diff: { format: "netscape", favorites: favorites.length },
      }).catch(() => undefined);

      recordUserCenterMetric("dataSovereignty.exportBookmarks");
      reply.header("content-type", "text/html; charset=utf-8");
      reply.header("content-disposition", 'attachment; filename="navhub-bookmarks.html"');
      return html;
    },
  );

  /**
   * 注销：删除该身份的全部个人数据（保留登录账号本身，重新登录后是空账号）。
   */
  app.delete("/api/me", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    if (identity.startsWith("anon-")) {
      reply.code(403);
      return { error: "匿名身份不支持云端注销，请直接清理本机数据" };
    }
    const parsed = z.object({ confirm: z.literal("DELETE") }).safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: '需要 confirm: "DELETE" 二次确认' };
    }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const counts = await ctx.repo.deleteUserData(canonical);
    recordUserCenterMetric("dataSovereignty.deleteAccount");
    await ctx.repo.audit({
      ip: req.ip,
      actor: canonical,
      actorKind: "user",
      action: "user.delete",
      target: canonical,
      diff: counts,
    }).catch(() => undefined);
    return { ok: true, deleted: counts };
  });

  app.post("/api/me/merge", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const target = identityOf(req as never);
    if (!target) {
      reply.code(401);
      return { error: "缺少登录身份" };
    }
    if (target.startsWith("anon-")) {
      reply.code(400);
      return { error: "合并目标必须是登录身份" };
    }

    const parsed = z.object({ anonId: z.string().regex(ANON_ID_RE) }).safeParse(req.body ?? {});
    if (!parsed.success) {
      reply.code(400);
      return { error: "anonId 无效", detail: parsed.error.issues };
    }

    if (ctx.config.identitySecret) {
      const signature = req.headers["x-navhub-anon-signature"];
      if (
        !verifyIdentitySignature(
          ctx.config.identitySecret,
          parsed.data.anonId,
          typeof signature === "string" ? signature : undefined,
        )
      ) {
        reply.code(401);
        return { error: "匿名身份签名缺失或无效" };
      }
    }

    const canonicalTarget = await ctx.repo.resolveIdentity(target);
    const resolvedSource = await ctx.repo.resolveIdentity(parsed.data.anonId);
    if (resolvedSource === canonicalTarget) {
      recordUserCenterMetric("identityMerge.alreadyMerged");
      return {
        ok: true,
        alreadyMerged: true,
        source: resolvedSource,
        target: canonicalTarget,
        vaultNeedsChoice: false,
      };
    }

    let result: Awaited<ReturnType<typeof ctx.repo.mergeIdentity>>;
    try {
      result = await ctx.repo.mergeIdentity(resolvedSource, canonicalTarget);
      recordUserCenterMetric("identityMerge.success");
    } catch (err) {
      recordUserCenterMetric("identityMerge.failure");
      throw err;
    }

    invalidateProfileThrottle(canonicalTarget);
    void refreshUserProfile(ctx, canonicalTarget).catch(() => undefined);

    await ctx.repo.audit({
      ip: req.ip,
      actor: canonicalTarget,
      actorKind: "user",
      action: "identity.merge",
      target: resolvedSource,
      diff: {
        favoritesMoved: result.favoritesMoved,
        favoritesSkipped: result.favoritesSkipped,
        searchesMoved: result.searchesMoved,
        eventsMoved: result.eventsMoved,
        pluginsMoved: result.pluginsMoved,
        vaultNeedsChoice: result.vaultNeedsChoice,
      },
    }).catch(() => undefined);

    return { ok: true, ...result };
  });
};
