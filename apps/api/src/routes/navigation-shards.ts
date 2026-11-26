/**
 * 导航分片运维端点（U-386）。
 *
 * 为什么需要这两个端点：分片派生（deriveNavigationShards）以前只有三条间接触发
 * ——写导航后、启动预热、读分片时惰性自愈（见 storage.ts 的 ensureNavigationShardsFresh）。
 * 存量库一旦出现分片缺失/过期（旧版本升级上来、中途删片、派生失败后无人重跑），
 * 没有任何入口能一次性修复；读路径回落也只有日志，没有管理面可见的状态。
 *
 *   - GET  /api/admin/navigation-shards/status    只读现状：data_version、索引版本、
 *     每分类分片的缺失/过期清单、最近一次读路径回落记录；
 *   - POST /api/admin/navigation-shards/backfill  一次性回填：默认 dry-run（只比对、
 *     只报告，不写任何 KV），显式传 { "dryRun": false } 才落库；落库顺序与
 *     ensureNavigationShardsFresh 一致（分片 → index，index 是提交标记，必须最后）。
 *
 * 派生逻辑本身一行不改：回填复用同一个 deriveNavigationShards（public 快照 →
 * 分片集），本文件只是触发入口。脚本入口见 scripts/backfill-navigation-shards.mjs。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { backfillNavigationShards, getNavigationShardStatus } from "../storage.ts";

export const navigationShardRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get(
    "/api/admin/navigation-shards/status",
    { config: { scope: "admin", cache: { maxAge: 0 } } },
    async () => {
      return getNavigationShardStatus(ctx);
    },
  );

  app.post(
    "/api/admin/navigation-shards/backfill",
    { config: { scope: "admin", rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = z
        .object({ dryRun: z.boolean().optional() })
        .safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }
      try {
        // 默认 dry-run：不传 dryRun 或传 true 都只比对不写库；只有显式 false 才落库。
        return await backfillNavigationShards(ctx, { dryRun: body.data.dryRun ?? true });
      } catch (err) {
        reply.code(503);
        return { error: err instanceof Error ? err.message : "回填失败" };
      }
    },
  );
};
