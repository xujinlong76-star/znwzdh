/**
 * 审计日志查询与合规导出
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";

import type { AppContext } from "../context.ts";

export const auditRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------ 审计日志 ------------------------ */
  /**
   * 谁在什么时候改了什么——与鉴权配套的可见性闭环。
   * 分页参数与 /api/search 一致（limit + offset + hasMore），
   * action/actor 过滤用于「只看 token 调用」「只看删除」这类排查。
   */
  app.get("/api/admin/audit", { config: { scope: "read", cache: { maxAge: 0 } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const offset = Math.max(0, Number(q.offset) || 0);
    const [page, actions] = await Promise.all([
      ctx.repo.listAuditLogs({ limit, offset, action: q.action || undefined, actor: q.actor || undefined }),
      ctx.repo.listAuditActions(50),
    ]);
    return { ...page, limit, offset, actions };
  });

  /** 导出审计日志为 JSON 格式（供安全归档或合规审查） */
  app.get("/api/admin/audit/export", { config: { scope: "admin" } }, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Math.max(Number(q.limit) || 1000, 1), 5000);
    const data = await ctx.repo.listAuditLogs({ limit, offset: 0, action: q.action || undefined, actor: q.actor || undefined });
    reply.header("content-disposition", `attachment; filename="navhub-audit-${Date.now()}.json"`);
    return {
      exportedAt: Date.now(),
      hasMore: data.hasMore,
      count: data.items.length,
      items: data.items,
    };
  });
};
