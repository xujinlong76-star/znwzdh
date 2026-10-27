/**
 * NavSphere 兼容存储 API
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { deleteAssetDoc, listAssetDocs, readStoragePath, readStorageVersion, writeStoragePath, StorageVersionConflictError } from "../storage.ts";

import type { AppContext } from "../context.ts";

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
  app.get("/api/storage", { config: { scope: "read", cache: { maxAge: 0, etag: true } } }, async (req, reply) => {
    const path = String((req.query as Record<string, string>)?.path ?? "");
    if (!path) { reply.code(400); return { error: "缺少 path 参数" }; }
    return readStoragePath(ctx, path);
  });

  // 快照写入会按「本次未出现」删除前端托管站点/类目，是一次全量覆盖。
  // 仅管理面（admin）可触发，避免 write 级内容编辑凭据误删整站导航。
  app.put("/api/storage", { config: { scope: "admin" } }, async (req, reply) => {
    const body = z.object({
      path: z.string().min(1),
      content: z.string(),
      message: z.string().optional(),
      /**
       * 乐观并发控制。给出时，中枢会比对当前版本，不一致返回 409。
       *
       * 为什么必须有：整包覆盖写（read-modify-write）在没有版本校验时是
       * last-write-wins —— 两个写入口同时跑，后写的会把先写的整批内容抹掉，
       * 且双方都收到 200。视频库有三个写入口，正是这种模式。
       */
      ifVersion: z.number().int().nonnegative().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    try {
      const result = await writeStoragePath(ctx, body.data.path, body.data.content, {
        ifVersion: body.data.ifVersion,
      });
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "storage.write", target: body.data.path, diff: { note: result.note } });
      return result;
    } catch (err) {
      if (err instanceof StorageVersionConflictError) {
        reply.code(409);
        return { error: "version_conflict", detail: err.message, currentVersion: err.currentVersion };
      }
      reply.code(400);
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
    const body = z.object({ path: z.string().min(1).max(4096) }).safeParse(req.body ?? {});
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
