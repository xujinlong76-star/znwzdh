/**
 * 审计日志查询与合规导出路由 (Audit Log & Compliance Export Routes)
 *
 * 提供按行为、调用主体、时间分页检索操作审计记录，以及合规安全归档导出。
 */
import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import { parsePagination } from "./shared.ts";

export const auditRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------------------------------------------------ *
   * 审计日志检索与统计 (Audit Logs Query)
   * ------------------------------------------------------------------ */

  /**
   * 分页检索审计日志并聚合高频行为列表
   */
  app.get(
    "/api/admin/audit",
    { config: { scope: "admin", cache: { maxAge: 0 } } },
    async (req) => {
      const q = (req.query ?? {}) as Record<string, string>;
      const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
      // Keyset 游标（M12）：`?cursor=` 走 WHERE id > (?) 谓词，不再 OFFSET；
      // nextCursor 随页返回，无下一页时为 null。无效游标由全局错误处理器
      // 映射成 400 INVALID_CURSOR。
      const cursor = typeof q.cursor === "string" && q.cursor ? q.cursor : undefined;

      const [page, actions] = await Promise.all([
        ctx.repo.listAuditLogs({
          limit,
          offset,
          action: q.action || undefined,
          actor: q.actor || undefined,
          cursor,
        }),
        ctx.repo.listAuditActions(50),
      ]);

      return { ...page, limit, offset, actions };
    }
  );

  /**
   * 导出审计日志为 JSON 附件格式（供安全归档或等保合规审查使用）
   */
  app.get(
    "/api/admin/audit/export",
    { config: { scope: "admin" } },
    async (req, reply) => {
      const q = (req.query ?? {}) as Record<string, string>;
      const { limit } = parsePagination(req.query, { defaultLimit: 1000, maxLimit: 5000 });
      // 导出同样支持 keyset 游标（M12）：`?cursor=` 续取，不再靠 offset。
      const cursor = typeof q.cursor === "string" && q.cursor ? q.cursor : undefined;

      const data = await ctx.repo.listAuditLogs({
        limit,
        offset: 0,
        action: q.action || undefined,
        actor: q.actor || undefined,
        cursor,
      });

      reply.header(
        "content-disposition",
        `attachment; filename="navhub-audit-${Date.now()}.json"`
      );

      // 2026-11-06 深扫 P2-2：导出上限 5000 条但旧响应只给 hasMore，调用方
      // 无法判断「这份归档是否完整」，也没法续传。补 truncated / nextOffset /
      // totalHint 三个字段（纯新增，不破坏既有消费方）；合规归档必须能察觉截断。
      const truncated = Boolean(data.hasMore);
      return {
        exportedAt: Date.now(),
        hasMore: data.hasMore,
        truncated,
        nextOffset: truncated ? data.items.length : null,
        nextCursor: data.nextCursor ?? null,
        count: data.items.length,
        limit,
        items: data.items,
        ...(truncated
          ? {
              notice:
                data.nextCursor != null
                  ? `导出已截断（上限 ${limit} 条）：请用 /api/admin/audit/export?cursor=${data.nextCursor} 续取，或缩小 action/actor 过滤条件`
                  : `导出已截断（上限 ${limit} 条）：请用 /api/admin/audit?offset=${data.items.length} 续取，或缩小 action/actor 过滤条件`,
            }
          : {}),
      };
    }
  );
};
