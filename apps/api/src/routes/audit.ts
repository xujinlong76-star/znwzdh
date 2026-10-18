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

      const [page, actions] = await Promise.all([
        ctx.repo.listAuditLogs({
          limit,
          offset,
          action: q.action || undefined,
          actor: q.actor || undefined,
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

      const data = await ctx.repo.listAuditLogs({
        limit,
        offset: 0,
        action: q.action || undefined,
        actor: q.actor || undefined,
      });

      reply.header(
        "content-disposition",
        `attachment; filename="navhub-audit-${Date.now()}.json"`
      );

      return {
        exportedAt: Date.now(),
        hasMore: data.hasMore,
        count: data.items.length,
        items: data.items,
      };
    }
  );
};
