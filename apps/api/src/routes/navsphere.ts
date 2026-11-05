/**
 * NavSphere 兼容存储 API
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { StorageDeleteInput, StorageWriteInput } from "@navhub/core";
import { deleteAssetDoc, listAssetDocs, readStoragePath, readStorageVersion, writeStoragePath, StorageVersionConflictError, VideoShrinkError, NavigationShrinkError } from "../storage.ts";
import { canSeeUnpublishedSites } from "./shared.ts";

import type { AppContext } from "../context.ts";

/**
 * `/api/storage` 的请求体上限。
 *
 * 全局 bodyLimit 是 4 MB（见 server.ts），而视频库文档实测已 6.37 MB ——
 * 超过后 Fastify 在**解析阶段**直接返回 413（FST_ERR_CTP_BODY_TOO_LARGE），
 * 前端只看到「保存失败」，既不知道原因也无从处理。
 *
 * 这里按路由放开到 32 MB（`NAVHUB_STORAGE_BODY_LIMIT_MB` 可调，范围 8–256），
 * 并在 75% 处返回可读的 422：容量问题必须显式暴露给运维，而不是伪装成网络错误。
 */
const STORAGE_BODY_LIMIT_MB = (() => {
  const raw = Number(process.env.NAVHUB_STORAGE_BODY_LIMIT_MB);
  if (!Number.isFinite(raw) || raw < 8) return 32;
  return Math.min(Math.floor(raw), 256);
})();
const STORAGE_BODY_LIMIT = STORAGE_BODY_LIMIT_MB * 1024 * 1024;
/** 软上限：留出余量给 JSON 转义、并发写入与临时副本 */
const STORAGE_SOFT_LIMIT = Math.floor(STORAGE_BODY_LIMIT * 0.75);
/** 超过此值打警告（旧的全局上限就是 4MB，8MB 意味着已翻倍） */
const STORAGE_WARN_BYTES = 8 * 1024 * 1024;

export const navsphereRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------- NavSphere 兼容存储 API ------------------- */
  /**
   * 这两个端点就是「不修改前端 69 处调用点」的全部秘密。
   *
   * NavSphere 的 getFileContent(path) / commitFile(path, content) 只要改成打这里，
   * 整个后台（增删改查、拖拽排序、投稿审核）就自动落到真实数据库上。
   * path 沿用它的原值（如 src/navsphere/content/navigation.json），前端连常量都不用改。
   */
  app.get(
    "/api/storage",
    {
      config: { scope: "read", cache: { maxAge: 0, etag: true } },
      preHandler: async (req, reply) => {
        // Zero-Cost 304 预拦截短路：针对 navigation.json 检查客户端 If-None-Match
        const q = (req.query ?? {}) as Record<string, string>;
        const p = String(q.path ?? "");
        if (p !== "src/navsphere/content/navigation.json" && p !== "navigation.json") {
          return;
        }
        const clientEtag = req.headers["if-none-match"];
        if (!clientEtag) return;

        const currentVersion = await ctx.repo.readNavDataVersion();
        if (currentVersion === null) return;

        const expectedEtag = `W/"v${currentVersion}"`;
        if (clientEtag === expectedEtag || clientEtag === `"v${currentVersion}"`) {
          reply.code(304).header("etag", expectedEtag).send();
          return reply;
        }
      },
    },
    async (req, reply) => {
      const q = (req.query ?? {}) as Record<string, string>;
      const path = String(q.path ?? "");
      if (!path) { reply.code(400); return { error: "缺少 path 参数" }; }
      // 只有 navigation.json 的 ETag 认版本号，其余文档不该为它付一次点查；
      // 读到的版本顺手交给 readStoragePath 复用，命中路径只剩这一次点查。
      const isNavPath = path === "src/navsphere/content/navigation.json" || path === "navigation.json";
      const currentVersion = isNavPath ? await ctx.repo.readNavDataVersion() : null;
      if (currentVersion !== null && isNavPath) {
        reply.header("etag", `W/"v${currentVersion}"`);
      }
    /**
     * 读可见性（P1-6）：导航快照的**原始**投影包含停用类目、停用站点以及
     * pending/archived 记录 —— 那是后台改写面的数据源，不是公开数据面。
     *
     * 这里按调用方身份收敛视图，而不是收紧整条路由的 scope：前台 SSR、
     * NavSphere 后台写回都走同一个 `GET /api/storage?path=navigation.json`，
     * 把路由改成 admin 会把公开站点的首屏一并打断。写回需要原始快照，
     * 所以只有「能看未发布内容」的调用方拿 raw；其余一律拿 public 投影。
     * `?view=public` 是显式声明（管理员也可用它核对匿名视角），不可用
     * `view=raw` 提权 —— 原始视图只看身份，不看请求参数。
     */
    const view = q.view === "public" || !canSeeUnpublishedSites(ctx, req as never) ? "public" : "raw";
    return readStoragePath(ctx, path, {
      view,
      ...(isNavPath ? { navVersion: currentVersion } : {}),
    });
  });

  // 快照写入会按「本次未出现」删除前端托管站点/类目，是一次全量覆盖。
  // 仅管理面（admin）可触发，避免 write 级内容编辑凭据误删整站导航。
  //
  // bodyLimit 必须按路由覆盖：全局是 4MB，而视频库这类整包文档已经超过它。
  app.put("/api/storage", { config: { scope: "admin" }, bodyLimit: STORAGE_BODY_LIMIT }, async (req, reply) => {
    // 乐观并发控制：ifVersion 给出时会比对当前版本，不一致返回 409。
    // 整包覆盖写没有版本校验就是 last-write-wins，视频库三个写入口会互相抹掉。
    const body = StorageWriteInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    /**
     * 体积守卫：先于写入判定，返回可读的 422。
     *
     * 不依赖 bodyLimit 的 413，是因为 Fastify 的 413 在解析层抛出、不带业务语义，
     * 前端无法区分「文档太大」与「网络中断」；而这里能给出实际体积与处置建议。
     */
    const contentBytes = Buffer.byteLength(body.data.content, "utf8");
    if (contentBytes > STORAGE_SOFT_LIMIT) {
      reply.code(422);
      return {
        error: "content_too_large",
        detail:
          `内容 ${(contentBytes / 1024 / 1024).toFixed(2)}MB 超过软上限 ` +
          `${(STORAGE_SOFT_LIMIT / 1024 / 1024).toFixed(0)}MB（硬上限 ${STORAGE_BODY_LIMIT_MB}MB）。` +
          `请归档历史条目、拆分文档，或调大 NAVHUB_STORAGE_BODY_LIMIT_MB。`,
        bytes: contentBytes,
        softLimitBytes: STORAGE_SOFT_LIMIT,
        hardLimitBytes: STORAGE_BODY_LIMIT,
      };
    }
    if (contentBytes > STORAGE_WARN_BYTES) {
      req.log.warn(
        { path: body.data.path, bytes: contentBytes },
        "[storage] 单次写入超过 8MB：整包序列化与影子表同步开销显著，建议尽快分片",
      );
    }

    /**
     * 整包文档缩水保护的二阶段确认（升级方案 P2）。
     *
     * 覆盖 videos.json（视频条目）与 navigation.json（导航站点）：写入库内 80% 以下
     * 依然默认拒绝，{@link NavigationShrinkError} 与 {@link VideoShrinkError} 各自给出
     * 可照抄的重试参数。第一段 confirmLargeDeletion 表明操作者知道这是删除，
     * 第二段 expectedCount 必须等于本次真实条数，确认框过期后拿旧数字来点是放不过去的。
     * 两种情形都进审计：被拦下的尝试（可能是客户端 bug，也可能是误操作前兆）
     * 与确认放行（这是一次真实的批量删除，事后要能查到是谁干的）。
     */
    // navigation.json 与 videos.json 都是整包覆盖写，共用同一套二阶段确认；
    // 审计动作按文档分开记，排查时不用再从 target 里猜类型。
    const isNavigationWrite = /(^|\/)navigation\.json$/.test(body.data.path);
    try {
      const result = await writeStoragePath(ctx, body.data.path, body.data.content, {
        ifVersion: body.data.ifVersion,
        confirmLargeDeletion: body.data.confirmLargeDeletion,
        expectedCount: body.data.expectedCount,
        onLargeDeletionConfirmed: async (verdict) => {
          await ctx.repo.audit({
            ip: req.ip,
            actor: req.auth.actor,
            actorKind: req.auth.kind,
            action: isNavigationWrite ? "storage.navigation.large_deletion" : "storage.videos.large_deletion",
            target: body.data.path,
            diff: {
              existingCount: verdict.existingCount,
              incomingCount: verdict.incomingCount,
              minimumAllowed: verdict.minimumAllowed,
              declaredExpectedCount: verdict.declaredExpectedCount ?? verdict.incomingCount,
            },
          });
        },
      });
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "storage.write", target: body.data.path, diff: { note: result.note } });
      return result;
    } catch (err) {
      if (err instanceof StorageVersionConflictError) {
        reply.code(409);
        return { error: "version_conflict", detail: err.message, currentVersion: err.currentVersion };
      }
      if (err instanceof VideoShrinkError || err instanceof NavigationShrinkError) {
        await ctx.repo
          .audit({
            ip: req.ip,
            actor: req.auth.actor,
            actorKind: req.auth.kind,
            action: err instanceof NavigationShrinkError ? "storage.navigation.shrink_blocked" : "storage.videos.shrink_blocked",
            target: body.data.path,
            diff: { code: err.code, ...err.verdict },
          })
          .catch(() => undefined);
        reply.code(409);
        return {
          error: err.code,
          detail: err.message,
          existingCount: err.verdict.existingCount,
          incomingCount: err.verdict.incomingCount,
          minimumAllowed: err.verdict.minimumAllowed,
          // 直接告诉客户端「重试要带什么」，否则前端只能自己猜一个数字，
          // 而猜错的数字正好会触发 mismatch——确认流程会变成第二次失败。
          retryWith: {
            confirmLargeDeletion: true,
            expectedCount: err.verdict.incomingCount,
          },
        };
      }
      reply.code((err as { statusCode?: number })?.statusCode ?? 400);
      return { error: "写入失败", detail: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * 读取内容版本号（乐观并发写的前置查询）。
   *
   * scope 用 read 而不是 admin：写前读版本属于读取操作，且不含任何内容数据；
   * 真正的写门槛仍在 PUT 的 admin scope 上。
   */
  app.get("/api/storage/version", { config: { scope: "read", cache: { maxAge: 0 } } }, async (req, reply) => {
    const path = String((req.query as Record<string, string>)?.path ?? "");
    if (!path) { reply.code(400); return { error: "缺少 path 参数" }; }
    return { path, version: await readStorageVersion(ctx, path) };
  });

  /**
   * 品牌资产清单（管理端）。
   *
   * 只列上传目录下的文档，不暴露任意 KV 键；`limit` 有上限，避免把 jobs 表里的
   * 内容文档全都当成资产扫一遍。前端据此标记「未被 site-config 引用」的孤儿图。
   */
  app.get("/api/storage/list", { config: { scope: "admin" } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const raw = Number(q.limit);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 1000) : 500;
    const assets = await listAssetDocs(ctx, limit);
    return { assets, limit };
  });

  /**
   * 删除品牌资产文档。
   *
   * 为什么用 POST body 而不是 `DELETE /api/storage?path=`：路径里有 `/`，放 query
   * 需要双重编码，代理层一改编码就会静默删错对象。删除范围由
   * `deleteAssetDoc` 的命名白名单收死，非资产路径一律 400。
   */
  app.delete("/api/storage", { config: { scope: "admin" } }, async (req, reply) => {
    const body = StorageDeleteInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    try {
      const result = await deleteAssetDoc(ctx, body.data.path);
      if (!result.deleted) {
        reply.code(404);
        return { error: "资产不存在或已被删除", path: body.data.path };
      }
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "storage.delete", target: body.data.path });
      return { ok: true, path: body.data.path };
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode ?? 400;
      reply.code(status);
      return { error: "删除失败", detail: err instanceof Error ? err.message : String(err) };
    }
  });

};
