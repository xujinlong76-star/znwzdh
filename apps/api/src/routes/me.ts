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
 *  - GET    /api/me/plugins              聚合当前用户的已安装插件、星标插件与已发表插件评价
 *  - POST   /api/me/import               合并式导入备份：收藏夹/收藏去重复用，搜索历史按上限分批并申报截断
 *  - POST   /api/me/prune                按域精细化清理云端个人数据（历史/事件画像/金库/CRDT/AI配置）
 *  - GET    /api/me/export               导出全部个人数据（JSON）
 *  - GET    /api/me/export/bookmarks.html 导出浏览器标准 Netscape 书签（HTML）
 *  - GET    /api/me/activity             我的操作记录
 *  - POST   /api/me/favorites/sync       收藏增量同步
 *  - POST   /api/me/merge                匿名数据合并到登录身份（幂等、事务、审计）
 *  - DELETE /api/me                      注销并清空云端个人数据
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createHash } from "node:crypto";
import { generateToken, hashToken, tokenPrefixOf } from "../auth.ts";

import { EXPORT_FAVORITES_LIMIT, EXPORT_HISTORY_LIMIT, EXPORT_SCHEMA_VERSION } from "@navhub/store";

import type { AppContext } from "../context.ts";
import { identityOf, identityTrusted } from "./shared.ts";
import { verifyIdentitySignature } from "../identity-signature.ts";
import { invalidateProfileThrottle, refreshUserProfile } from "../profile-service.ts";
import { recordUserCenterMetric } from "../user-center-metrics.ts";

/** 前端生成的匿名 id 形态：anon-<uuid>；限制长度避免异常值写入别名表 */
const ANON_ID_RE = /^anon-[A-Za-z0-9_-]{8,80}$/;

/**
 * 单次导入的搜索历史上限：历史是逐条写入的，条数直接放大请求耗时。
 * 超出部分不会被偷偷丢掉——接口回传 searchesTruncated 与续导用的 nextHistoryOffset，
 * 界面按它回填 offset 再导一次，剩下的条目是真的能导完的。
 */
const HISTORY_IMPORT_CAP = 200;

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

  // 协商缓存（T18）：maxAge=0 + etag = 「private, no-cache」+ ETag/304。
  // 概览是多表聚合（计数/设置/别名），被 /me、/me/account、/me/settings 复用；
  // 304 让设置页反复切换时省掉整次聚合与传输。private 语义由框架保证（不进共享代理）。
  app.get(
    "/api/me",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" }, cache: { maxAge: 0, etag: true } } },
    async (req, reply) => {
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
        // 邮箱绑定（T3）：null = 解绑。当前部署不内置邮件服务，不做验证回执——
        // 唯一性仍要保证（库里有部分唯一索引，先查后写给出 409 而不是裸撞索引）。
        email: z.email().nullable().optional(),
      })
      .refine((v) => v.username !== undefined || v.avatar !== undefined || v.email !== undefined, {
        message: "至少要修改 username、avatar 或 email 之一",
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
      email: parsed.data.email,
    });

    if (!outcome.ok) {
      reply.code(outcome.reason === "username_taken" || outcome.reason === "email_taken" ? 409 : 400);
      return {
        error:
          outcome.reason === "username_taken"
            ? "该显示昵称已被占用，请更换其它名称"
            : outcome.reason === "email_taken"
              ? "该邮箱已绑定其他账号"
              : "个人资料参数无效",
      };
    }

    await ctx.repo.audit({
      ip: req.ip,
      actor: canonical,
      actorKind: "user",
      action: "user.profile_update",
      target: canonical,
      diff: { username: outcome.user.username, emailChanged: parsed.data.email !== undefined },
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

  /* ------------------------- 我的插件、星标与评价聚合 ------------------------- */

  app.get(
    "/api/me/plugins",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
      const identity = identityOf(req as never);
      if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
      const canonical = await ctx.repo.resolveIdentity(identity);

      const [installs, starRows, reviewRows] = await Promise.all([
        ctx.repo.listPluginInstallsByIdentity(canonical),
        ctx.repo.raw(
          `SELECT s.plugin_id, p.slug, p.name, p.description, s.created_at
           FROM plugin_stars s
           LEFT JOIN plugins p ON p.id = s.plugin_id
           WHERE s.identity = ?
           ORDER BY s.created_at DESC`,
          [canonical],
        ),
        ctx.repo.raw(
          `SELECT r.id, r.plugin_id, p.slug AS plugin_slug, p.name AS plugin_name,
                  r.rating, r.title, r.content, r.installed_version, r.status, r.created_at, r.updated_at
           FROM plugin_reviews r
           LEFT JOIN plugins p ON p.id = r.plugin_id
           WHERE r.identity = ?
           ORDER BY r.created_at DESC
           LIMIT 200`,
          [canonical],
        ),
      ]);

      return {
        ok: true,
        identity: canonical,
        installed: installs.map((item) => ({
          pluginId: item.install.pluginId,
          slug: item.plugin.slug,
          name: item.plugin.name,
          description: item.plugin.description ?? "",
          version: item.install.version,
          installedAt: item.install.installedAt,
        })),
        starred: starRows.map((row) => ({
          pluginId: String(row.plugin_id),
          slug: row.slug == null ? null : String(row.slug),
          name: row.name == null ? String(row.plugin_id) : String(row.name),
          description: row.description == null ? "" : String(row.description),
          category: null,
          starredAt: Number(row.created_at ?? 0),
        })),
        reviews: reviewRows.map((row) => ({
          id: String(row.id),
          pluginId: String(row.plugin_id),
          pluginSlug: row.plugin_slug == null ? null : String(row.plugin_slug),
          pluginName: row.plugin_name == null ? String(row.plugin_id) : String(row.plugin_name),
          rating: Number(row.rating ?? 5),
          title: row.title == null ? null : String(row.title),
          content: row.content == null ? null : String(row.content),
          installedVersion: String(row.installed_version ?? ""),
          status: String(row.status ?? "visible"),
          createdAt: Number(row.created_at ?? 0),
          updatedAt: Number(row.updated_at ?? 0),
        })),
      };
    },
  );

  /* ------------------------- 数据主权：导出、导入恢复、按域清理与注销 ------------------------- */

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
   * 从导出的 JSON 备份恢复个人数据（解决「有导出无导入」的核心痛点）。
   * 幂等合并：同名收藏夹自动复用、已有收藏跳过不覆盖、偏好设置合并写回、搜索历史去重导入。
   * 返回的是「实际恢复了多少」，不是「备份里有多少」：跳过、截断、设置校验失败都要回传。
   */
  app.post(
    "/api/me/import",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
      const identity = identityOf(req as never);
      if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
      const canonical = await ctx.repo.resolveIdentity(identity);

      // 上限必须 ≥ 导出侧能产出的条数：否则用户拿一份合法备份来恢复，
      // 会因为某一个数组超长而整份被拒（收藏、收藏夹、偏好全都没导进来）。
      // 体积另有 4MB bodyLimit 兜底，这里的条数只用于拦「十万条超短记录」那种形状。
      const schema = z.object({
        // 导出格式版本：备份比当前服务新时，明确告知而不是抛 zod 报错堆
        schemaVersion: z.number().int().min(1).optional(),
        favoriteFolders: z
          .array(
            z.object({
              id: z.string().min(1).max(64).optional(),
              name: z.string().trim().min(1).max(40),
            }),
          )
          .max(1000)
          .optional(),
        favorites: z
          .array(
            z.object({
              siteId: z.string().min(1).max(64),
              folderId: z.string().max(64).nullable().optional(),
              note: z.string().max(200).nullable().optional(),
              tags: z.array(z.string().max(24)).max(8).nullable().optional(),
            }),
          )
          // 与导出侧截断上限同源（T2）：超两万条的合法导出备份不再整份 400
          .max(EXPORT_FAVORITES_LIMIT)
          .optional(),
        pluginStars: z
          .array(
            z.object({
              slug: z.string().trim().min(1).max(160),
              starredAt: z.number().optional(),
            }),
          )
          .max(5000)
          .optional(),
        pluginReviews: z
          .array(
            z.object({
              slug: z.string().trim().min(1).max(160),
              rating: z.number().int().min(1).max(5),
              title: z.string().max(100).nullable().optional(),
              content: z.string().max(1000).nullable().optional(),
            }),
          )
          .max(1000)
          .optional(),
        searchHistory: z
          .union([
            z.object({
              items: z
                .array(
                  z.object({
                    query: z.string().trim().min(1).max(200),
                    resultCount: z.number().int().min(0).optional(),
                  }),
                )
                .max(EXPORT_HISTORY_LIMIT)
                .optional(),
              // 导出侧写下的「这份备份的历史本身就被截断过」标记，恢复时必须如实带出
              truncated: z.boolean().optional(),
            }),
            z
              .array(
                z.object({
                  query: z.string().trim().min(1).max(200),
                  resultCount: z.number().int().min(0).optional(),
                }),
              )
              .max(EXPORT_HISTORY_LIMIT),
          ])
          .optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
        // 分批续导的窗口起点：界面用响应里的 nextHistoryOffset 回填，
        // 这样「再导一次」推进的是剩下的条目，而不是永远重复同一批。
        searchHistoryOffset: z.number().int().min(0).max(1_000_000).optional(),
      });

      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const tooBig = parsed.error.issues.filter((i) => i.code === "too_big");
        reply.code(400);
        return {
          error: tooBig.length
            ? `备份里有字段超出单次可接受的最大条数：${tooBig.map((i) => i.path.join(".") || "(root)").join("、")}`
            : "导入的备份 JSON 格式无效",
          detail: parsed.error.issues,
        };
      }

      // 备份比当前服务新：明确拒绝并告知行动（升级），而不是按 zod 报错堆崩一脸
      const backupVersion = parsed.data.schemaVersion ?? 1;
      if (backupVersion > EXPORT_SCHEMA_VERSION) {
        reply.code(400);
        return {
          error: `备份格式版本较新（v${backupVersion}），当前服务只支持 v${EXPORT_SCHEMA_VERSION}；请先升级 NavHub 再导入这份备份。`,
        };
      }

      let foldersImported = 0;
      let favoritesImported = 0;
      let favoritesSkipped = 0;
      let favoritesSkippedMissingSite = 0;
      let searchesImported = 0;
      let searchesSkippedDuplicate = 0;
      let searchesTruncated = 0;
      let nextHistoryOffset: number | null = null;
      let settingsError: string | null = null;
      let settingsRestored = false;

      // 1. 恢复收藏夹（按名称去重并建立旧 folderId -> 新/现存 folderId 映射）
      const existingFolders = await ctx.repo.listFavoriteFolders(canonical);
      const folderByName = new Map(existingFolders.map((f) => [f.name.trim().toLowerCase(), f.id]));
      const folderIdMap = new Map<string, string>();
      for (const f of existingFolders) folderIdMap.set(f.id, f.id);

      for (const incomingFolder of parsed.data.favoriteFolders ?? []) {
        const key = incomingFolder.name.trim().toLowerCase();
        let targetFolderId = folderByName.get(key);
        if (!targetFolderId) {
          const created = await ctx.repo.createFavoriteFolder(canonical, incomingFolder.name.trim());
          targetFolderId = created.id;
          folderByName.set(key, targetFolderId);
          foldersImported += 1;
        }
        if (incomingFolder.id) {
          folderIdMap.set(incomingFolder.id, targetFolderId);
        }
      }

      // 2. 恢复收藏（仅导入数据库中存在的合法站点 ID，防止悬空外键）
      const incomingFavs = parsed.data.favorites ?? [];
      if (incomingFavs.length > 0) {
        const siteIds = [...new Set(incomingFavs.map((f) => f.siteId))];
        const validSites = await ctx.repo.getSitesByIds(siteIds);
        for (const fav of incomingFavs) {
          if (!validSites.has(fav.siteId)) {
            // 「站点已不在库里」和「你已经收藏过了」是两件事，混成一个数用户没法判断
            favoritesSkipped += 1;
            favoritesSkippedMissingSite += 1;
            continue;
          }
          const mappedFolderId = fav.folderId ? (folderIdMap.get(fav.folderId) ?? null) : null;
          const res = await ctx.repo.addFavorite({
            userId: canonical,
            siteId: fav.siteId,
            folderId: mappedFolderId,
            note: fav.note ?? null,
            tags: fav.tags ?? null,
          });
          if (res.existed) favoritesSkipped += 1;
          else favoritesImported += 1;
        }
      }

      // 3. 恢复搜索历史（跳过已存在的相同搜索词）
      const rawHistoryList = Array.isArray(parsed.data.searchHistory)
        ? parsed.data.searchHistory
        : (parsed.data.searchHistory?.items ?? []);
      // 导出侧写下的截断标记：备份本身就不全，恢复回来的更不可能是「全部历史」
      const backupHistoryTruncated =
        !Array.isArray(parsed.data.searchHistory) && Boolean(parsed.data.searchHistory?.truncated);
      if (rawHistoryList.length > 0) {
        // 逐条写入，成本随条数线性涨：单次最多恢复 HISTORY_IMPORT_CAP 条，
        // 但被截断的条数必须回传，不能让用户以为「备份里的一整份历史都回来了」。
        // 窗口起点由请求侧的 offset 决定：界面按 nextHistoryOffset 续导，
        // 「再导一次」才是真能推进的动作，而不是永远重复同一批。
        const windowStart = Math.min(parsed.data.searchHistoryOffset ?? 0, rawHistoryList.length);
        const batch = rawHistoryList.slice(windowStart, windowStart + HISTORY_IMPORT_CAP);
        const windowEnd = windowStart + HISTORY_IMPORT_CAP;
        searchesTruncated = Math.max(0, rawHistoryList.length - windowEnd);
        // 去重集合要覆盖到导出上限的规模：只看最近 200 条会让老账号重复写入同一条历史
        const existingHist = await ctx.repo.listSearchHistory(canonical, EXPORT_HISTORY_LIMIT);
        const existingQueries = new Set(existingHist.map((h) => h.query.trim().toLowerCase()));
        for (const item of batch) {
          const q = item.query.trim();
          if (!q || existingQueries.has(q.toLowerCase())) {
            searchesSkippedDuplicate += 1;
            continue;
          }
          await ctx.repo.recordSearch(canonical, q, Number(item.resultCount ?? 0));
          existingQueries.add(q.toLowerCase());
          searchesImported += 1;
        }
        if (searchesTruncated > 0) nextHistoryOffset = windowEnd;
      }

      // 4. 恢复个人设置
      if (parsed.data.settings && typeof parsed.data.settings === "object") {
        const candidate = settingsPatchSchema.safeParse(parsed.data.settings);
        if (candidate.success) {
          await ctx.repo.updateUserSettings(canonical, candidate.data);
          settingsRestored = true;
        } else {
          settingsError = candidate.error.issues[0]?.message ?? "设置字段不符合当前格式";
        }
      }

      // 5. 恢复插件星标与评价（T2 导入导出对称化）：导出了就必须能恢复。
      // 重放语义与正常用户动作一致——star 走幂等插入并守恒 star_count，
      // 评价要求「已安装该插件」的既有门禁（未安装 = 如实跳过，不绕过门禁）。
      let starsImported = 0;
      let starsSkippedDuplicate = 0;
      let starsSkippedMissing = 0;
      for (const star of parsed.data.pluginStars ?? []) {
        const state = await ctx.repo.isPluginStarredBySlug(star.slug, canonical);
        if (state === null) {
          starsSkippedMissing += 1;
          continue;
        }
        if (state) {
          starsSkippedDuplicate += 1;
          continue;
        }
        await ctx.repo.starPlugin(star.slug, canonical);
        starsImported += 1;
      }

      let reviewsImported = 0;
      let reviewsSkippedMissing = 0;
      let reviewsSkippedNotInstalled = 0;
      let reviewsSkippedInvalid = 0;
      for (const review of parsed.data.pluginReviews ?? []) {
        try {
          await ctx.repo.createPluginReview(review.slug, canonical, {
            rating: review.rating,
            title: review.title ?? null,
            content: review.content ?? null,
          });
          reviewsImported += 1;
        } catch (err) {
          const message = String((err as Error)?.message ?? "");
          if (message.includes("不存在")) reviewsSkippedMissing += 1;
          else if (message.includes("已安装")) reviewsSkippedNotInstalled += 1;
          else reviewsSkippedInvalid += 1;
        }
      }

      await ctx.repo.audit({
        ip: req.ip,
        actor: canonical,
        actorKind: "user",
        action: "user.import",
        target: canonical,
        diff: {
          foldersImported,
          favoritesImported,
          favoritesSkipped,
          favoritesSkippedMissingSite,
          searchesImported,
          searchesSkippedDuplicate,
          searchesTruncated,
          settingsRestored,
          settingsError,
          starsImported,
          reviewsImported,
        },
      }).catch(() => undefined);

      return {
        ok: true,
        identity: canonical,
        foldersImported,
        favoritesImported,
        favoritesSkipped,
        favoritesSkippedMissingSite,
        searchesImported,
        /** 本次窗口里「账户中已存在同一条历史」被跳过的条数：0 条导入到底是为什么，界面要能说清 */
        searchesSkippedDuplicate,
        searchesTruncated,
        settingsRestored,
        settingsError,
        /** 备份文件在导出时就已经截断过历史（上限见 EXPORT_HISTORY_LIMIT） */
        backupHistoryTruncated,
        historyExportLimit: EXPORT_HISTORY_LIMIT,
        /** 前端要按这个数告诉用户「再多分几次导入」，别把它写死在界面里 */
        historyImportCap: HISTORY_IMPORT_CAP,
        /** 续导这一批时该用的 offset；为 null 表示备份里的历史已经导完 */
        nextHistoryOffset,
        /** 插件星标重放（T2）：三种结果分开计数，别让用户猜「为什么少了几个」 */
        starsImported,
        starsSkippedDuplicate,
        starsSkippedMissing,
        /** 插件评价重放（T2）：未安装的插件按既有门禁跳过 */
        reviewsImported,
        reviewsSkippedMissing,
        reviewsSkippedNotInstalled,
        reviewsSkippedInvalid,
        /** 导出端也带上收藏截断口径，界面提示「备份不止这些」 */
        favoritesExportLimit: EXPORT_FAVORITES_LIMIT,
      };
    },
  );

  /**
   * 按域精细化清理云端个人数据（告别「只能整号删除」的一刀切痛点）。
   */
  app.post(
    "/api/me/prune",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
      const identity = identityOf(req as never);
      if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
      const canonical = await ctx.repo.resolveIdentity(identity);

      const schema = z.object({
        domains: z
          .array(z.enum(["search_history", "events_profile", "vault", "crdt", "llm_config"]))
          .min(1)
          .max(5),
      });

      const parsed = schema.safeParse(req.body ?? {});
      if (!parsed.success) {
        reply.code(400);
        return { error: "请选择至少一个要清理的数据域", detail: parsed.error.issues };
      }

      const pruned: Record<string, number> = {};
      for (const domain of parsed.data.domains) {
        if (domain === "search_history") {
          pruned.search_history = await ctx.repo.runCount(
            "DELETE FROM search_history WHERE user_id = ?",
            [canonical],
          );
        } else if (domain === "events_profile") {
          const evCount = await ctx.repo.runCount("DELETE FROM events WHERE identity = ?", [canonical]);
          const pfCount = await ctx.repo.runCount("DELETE FROM user_profiles WHERE user_id = ?", [canonical]);
          pruned.events_profile = evCount + pfCount;
          invalidateProfileThrottle(canonical);
        } else if (domain === "vault") {
          pruned.vault = await ctx.repo.runCount(
            "DELETE FROM user_vault_sync WHERE user_id = ?",
            [canonical],
          );
        } else if (domain === "crdt") {
          pruned.crdt = await ctx.repo.runCount(
            "DELETE FROM user_vault_sync WHERE user_id = ?",
            ["crdt:" + canonical],
          );
        } else if (domain === "llm_config") {
          pruned.llm_config = await ctx.repo.runCount(
            "DELETE FROM user_llm_configs WHERE identity = ?",
            [canonical],
          );
        }
      }

      await ctx.repo.audit({
        ip: req.ip,
        actor: canonical,
        actorKind: "user",
        action: "user.prune",
        target: canonical,
        diff: pruned,
      }).catch(() => undefined);

      return { ok: true, identity: canonical, pruned };
    },
  );

  /**
   * 我的操作记录：用户可见的数据主权面板（M10）。
   * 数据源是既有 audit_logs（user.export / user.delete / identity.merge / workspace:*），
   * 只暴露 action / target / 时间；IP 与内部 diff 不外传。
   */
  /**
   * 访问历史（T23）：events kind=click 按身份分页，附带站点展示信息。
   * 清理入口复用既有 DELETE /api/profile/signals/click（按信号类型清，
   * 收藏与搜索历史不动）。数据本就在采集——这里只是把它交还给用户。
   */
  app.get(
    "/api/me/visits",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
      const identity = identityOf(req as never);
      if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
      const canonical = await ctx.repo.resolveIdentity(identity);
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(50).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        })
        .safeParse(req.query ?? {});
      const limit = query.success ? (query.data.limit ?? 20) : 20;
      const offset = query.success ? (query.data.offset ?? 0) : 0;
      const [page, total] = await Promise.all([
        ctx.repo.listVisitsPage(canonical, limit, offset),
        ctx.repo.countVisits(canonical),
      ]);
      const siteMap = await ctx.repo.getSitesByIds([...new Set(page.items.map((v) => v.siteId))]);
      return {
        ok: true,
        total,
        hasMore: page.hasMore,
        nextOffset: offset + page.items.length,
        items: page.items.map((v) => {
          const site = siteMap.get(v.siteId) ?? null;
          return {
            id: v.id,
            siteId: v.siteId,
            at: v.at,
            site: site ? { id: site.id, title: site.title, url: site.url, description: site.description ?? null } : null,
          };
        }),
      };
    },
  );

  /* --------------------------- 会话治理（T8） --------------------------- */

  /**
   * 会话活跃登记 + 吊销核对（BFF 每次代理 /api/me/* 时调用一次）。
   * sid 原文不出 Web 侧：库里只落 sha256。无行 = 旧会话（fail-open 未吊销），
   * revoked 非空 = 用户已踢出，BFF 负责把后续请求打成 401。
   */
  app.post(
    "/api/me/sessions/check",
    { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
      const identity = identityOf(req as never);
      if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
      const body = z
        .object({
          sid: z.string().min(8).max(128),
          userAgent: z.string().max(300).nullable().optional(),
          expiresAt: z.number().int().positive().optional(),
        })
        .safeParse(req.body ?? {});
      if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
      const canonical = await ctx.repo.resolveIdentity(identity);
      const sidHash = createHash("sha256").update(body.data.sid).digest("hex");
      // 过期时间缺失时给 7 天兜底：老客户端不带 expiresAt 也不至于把行写成永不过期
      const expiresAt = body.data.expiresAt ?? Date.now() + 7 * 86_400_000;
      await ctx.repo.upsertSessionActivity({
        token: sidHash,
        userId: canonical,
        userAgent: body.data.userAgent ?? null,
        expiresAt,
      });
      const revoked = await ctx.repo.isSessionRevoked(sidHash);
      return { ok: true, revoked };
    },
  );

  /* --------------------- 用户级 API 令牌（T20） --------------------- */

  /**
   * 自建个人令牌：扩展 / Raycast / MCP 等外部客户端第一次可以持「自己的」凭据
   * 读写（v1 只读）自己的用户域数据——收藏/历史/画像/金库在路由层把 owner
   * 令牌解析为该用户身份（requestIdentityOf），自称头不可能覆盖真实凭据。
   * 明文只在创建响应里出现一次，库里只有 sha256。
   */
  app.post("/api/me/tokens", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    if (identity.startsWith("anon-")) { reply.code(403); return { error: "匿名身份不支持创建 API 令牌" }; }
    const body = z
      .object({ name: z.string().trim().min(1).max(40) })
      .safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const count = (await ctx.repo.listApiTokensByOwner(canonical)).length;
    if (count >= 10) { reply.code(409); return { error: "个人令牌数量已达上限（10 条），请先吊销不用的令牌" }; }
    const raw = generateToken();
    const record = await ctx.repo.createApiToken({
      name: body.data.name,
      tokenHash: hashToken(raw),
      // v1 只读：写自己的用户域数据需要 write scope，自建通道暂不发（详见 T20 方案）
      scopes: "read",
      tokenPrefix: tokenPrefixOf(raw),
      ownerIdentity: canonical,
    });
    await ctx.repo.audit({
      ip: req.ip,
      actor: canonical,
      actorKind: "user",
      action: "user.token_create",
      target: record.id,
      diff: { name: record.name, scopes: record.scopes },
    }).catch(() => undefined);
    return { ok: true, token: raw, record };
  });

  app.get("/api/me/tokens", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const tokens = await ctx.repo.listApiTokensByOwner(canonical);
    return {
      ok: true,
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        scopes: t.scopes,
        tokenPrefix: t.tokenPrefix,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
        lastUsedAt: t.lastUsedAt,
      })),
    };
  });

  app.delete("/api/me/tokens/:id", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const id = String((req.params as { id: string }).id || "");
    if (!id || id.length > 64) { reply.code(400); return { error: "id 无效" }; }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const revoked = await ctx.repo.revokeApiTokenByOwner(canonical, id);
    if (!revoked) { reply.code(404); return { error: "令牌不存在或已吊销" }; }
    await ctx.repo.audit({
      ip: req.ip,
      actor: canonical,
      actorKind: "user",
      action: "user.token_revoke",
      target: id,
      diff: {},
    }).catch(() => undefined);
    return { ok: true };
  });

  /* --------------------------- 站内通知（T13） --------------------------- */

  /** 通知列表：默认含已读；?unread=1 只看未读。附带未读数供面板角标。 */
  app.get("/api/me/notifications", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        unread: z.coerce.boolean().optional(),
      })
      .safeParse(req.query ?? {});
    const limit = query.success ? (query.data.limit ?? 20) : 20;
    const offset = query.success ? (query.data.offset ?? 0) : 0;
    const unreadOnly = Boolean(query.success && query.data.unread);
    const [page, unread] = await Promise.all([
      ctx.repo.listNotificationsPage(canonical, limit, offset, unreadOnly),
      ctx.repo.countUnreadNotifications(canonical),
    ]);
    return {
      ok: true,
      unread,
      hasMore: page.hasMore,
      nextOffset: offset + page.items.length,
      items: page.items,
    };
  });

  /** 单条已读：幂等（已读的再标一次不计入返回值） */
  app.post("/api/me/notifications/:id/read", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const id = String((req.params as { id: string }).id || "");
    if (!id || id.length > 64) { reply.code(400); return { error: "id 无效" }; }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const marked = await ctx.repo.markNotificationRead(canonical, id);
    return { ok: true, marked };
  });

  /** 全部已读 */
  app.post("/api/me/notifications/read-all", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const marked = await ctx.repo.markAllNotificationsRead(canonical);
    return { ok: true, marked };
  });

  /** 设备列表：未吊销且未过期的会话（库里只有 sidHash，展示端不需要知道原文） */
  app.get("/api/me/sessions", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const devices = await ctx.repo.listSessionDevices(canonical);
    return { ok: true, devices };
  });

  /** 踢出设备：按 sidHash，跨用户无效 404 */
  app.delete("/api/me/sessions/:id", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
    const id = String((req.params as { id: string }).id || "");
    if (!/^[a-f0-9]{64}$/.test(id)) { reply.code(400); return { error: "会话 id 无效" }; }
    const canonical = await ctx.repo.resolveIdentity(identity);
    const removed = await ctx.repo.revokeSessionDevice(canonical, id);
    if (!removed) { reply.code(404); return { error: "会话不存在或已吊销" }; }
    await ctx.repo.audit({
      ip: req.ip,
      actor: canonical,
      actorKind: "user",
      action: "user.session_revoke",
      target: canonical,
      diff: { session: id.slice(0, 12) },
    }).catch(() => undefined);
    return { ok: true };
  });

  /**
   * LLM 用量自查（T21）：当前身份 24h 滚动窗口内的调用次数与 token，
   * 连同该身份档位的上限一起返回——「今天还剩多少」此前只在 429 时才可见。
   * 只读聚合，不产生新用量；上限来自 config（与环境变量同源）。
   */
  app.get(
    "/api/me/llm-usage",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "身份未受信：需要 Bearer token 或有效的身份签名" }; }
      const identity = identityOf(req as never);
      if (!identity) { reply.code(401); return { error: "缺少登录身份" }; }
      const canonical = await ctx.repo.resolveIdentity(identity);
      const WINDOW_MS = 24 * 60 * 60 * 1000;
      const since = Date.now() - WINDOW_MS;
      const used = await ctx.repo.sumLlmUsage({ since, identity: canonical });
      const limits = ctx.config.llmQuota;
      return {
        ok: true,
        windowMs: WINDOW_MS,
        calls: used.calls,
        tokens: used.tokens,
        limits: {
          calls: limits.identityDailyCalls,
          tokens: limits.identityDailyTokens,
        },
      };
    },
  );

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
          tags: z.array(z.string().max(24)).max(8).optional().nullable(),
          // 结构上限放宽到 2000：note 是用户内容，单条超长不允许让整批 400——
          // 那会让同步链路被一条脏数据永久卡死（客户端重试永远撞同一个错误）。
          // 业务上限 200 在下方逐条截断并计数回传。siteId/folderId 属结构字段
          // （客户端 bug 才会超限），保持整批 400 的严格口径。
          note: z.string().max(2000).optional().nullable(),
          at: z.number().optional(),
        })).max(500),
        since: z.number().optional(),
      }).safeParse(req.body ?? {});
      if (!parsed.success) {
        recordUserCenterMetric("favoritesSync.failure");
        reply.code(400);
        return { error: "参数无效", detail: parsed.error.issues };
      }
      // T19：满批（500 ops）说明客户端在分片提交——大账号同步行为的关键观测点，
      // 此前该指标定义了从未发射。
      if (parsed.data.ops.length >= 500) {
        recordUserCenterMetric("favoritesSync.sharded");
      }
      const canonical = await ctx.repo.resolveIdentity(identity);
      const NOTE_MAX = 200;
      let truncatedNotes = 0;
      const ops = parsed.data.ops.map((op) => {
        if (typeof op.note === "string" && op.note.length > NOTE_MAX) {
          truncatedNotes += 1;
          return { ...op, note: op.note.slice(0, NOTE_MAX) };
        }
        return op;
      });
      let applied: { applied: number; version: number };
      let slice: Awaited<ReturnType<typeof ctx.repo.listFavoritesSince>>;
      let folders: Awaited<ReturnType<typeof ctx.repo.listFavoriteFolders>>;
      let siteMap: Map<string, unknown>;
      try {
        applied = await ctx.repo.applyFavoriteOps(canonical, ops);
        recordUserCenterMetric("favoritesSync.opsSubmitted", parsed.data.ops.length);
        [slice, folders] = await Promise.all([
          ctx.repo.listFavoritesSince(canonical, parsed.data.since ?? 0),
          ctx.repo.listFavoriteFolders(canonical),
        ]);
        siteMap = await ctx.repo.getSitesByIds(slice.items.map((item) => item.siteId));
      } catch (err) {
        // 瞬时故障（锁竞争 / 磁盘忙）与 400 的参数错误不同：客户端重试是有意义的。
        // 失败同时落一条审计——进程内计数重启清零，持久存储里只有这里能追溯。
        recordUserCenterMetric("favoritesSync.failureRetryable");
        await ctx.repo.audit({
          ip: req.ip,
          actor: canonical,
          actorKind: "user",
          action: "user.sync_failed",
          target: canonical,
          diff: { ops: parsed.data.ops.length, error: String((err as Error)?.message ?? "unknown") },
        }).catch(() => undefined);
        // 站内通知（T13）：同步失败告知用户。中枢抖动会连续失败——60 分钟去重窗口内不重发
        try {
          const recent = await ctx.repo.hasRecentNotification(canonical, "sync_failed", 60 * 60_000);
          if (!recent) {
            await ctx.repo.createNotification({
              identity: canonical,
              kind: "sync_failed",
              title: "收藏同步失败",
              body: "本机收藏暂时没能同步到云端（网络或服务波动）。你的收藏仍安全保存在本机，稍后会自动重试；也可打开收藏页手动重试。",
            });
          }
        } catch { /* 通知是增强信息，不改变失败语义 */ }
        throw err;
      }
      recordUserCenterMetric("favoritesSync.success");
      return {
        ok: true,
        applied: applied.applied,
        version: Math.max(applied.version, slice.version),
        items: slice.items.map((item) => ({ ...item, site: siteMap.get(item.siteId) ?? null })),
        folders,
        truncatedNotes,
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
      const byFolder = new Map<string, Array<{ url: string; title: string; createdAt: number; tags?: string[] | null }>>();
      for (const fav of favorites) {
        const site = sites.get(fav.siteId);
        if (!site) continue;
        if (!/^https?:\/\//i.test(site.url)) continue;
        const key = fav.folderId ? (folderName.get(fav.folderId) ?? "未分组") : "未分组";
        const list = byFolder.get(key) ?? [];
        list.push({ url: site.url, title: fav.note || site.title, createdAt: fav.createdAt, tags: fav.tags });
        byFolder.set(key, list);
      }
      const sections = [...byFolder.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "zh-CN"))
        .map(([folder, items]) => {
          const links = items
            .map(
              (item) =>
                `    <DT><A HREF="${esc(item.url)}" ADD_DATE="${Math.floor(item.createdAt / 1000)}"${item.tags?.length ? ` TAGS="${esc(item.tags.join(","))}"` : ""}>${esc(item.title)}</A>`,
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
