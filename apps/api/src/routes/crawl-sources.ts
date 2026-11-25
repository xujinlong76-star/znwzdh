/**
 * 采集来源注册表管理接口（/api/admin/crawl-sources）。
 *
 * 独立成插件而不是并进 crawl-operations.ts：后者包含大量尚未接线的审核/
 * 金标路由，整只注册会把未完成的端点一起暴露。这里只开放管理台已调用的
 * 四个端点；四条 config.scope 声明同时是 hub 网关策略的生成来源。
 */
import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppContext } from "../context.ts";

/** DB 用 snake_case，管理台契约用 camelCase（与前端 Source 类型逐项对齐）。 */
function mapCrawlSource(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    url: String(row.url),
    kind: String(row.kind) as "sitemap" | "rss" | "page",
    enabled: Boolean(row.enabled),
    priority: Number(row.priority ?? 0),
    intervalMs: Number(row.interval_ms ?? 3_600_000),
    nextRunAt: Number(row.next_run_at ?? 0),
    lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at),
    lastStatus: row.last_status == null ? null : String(row.last_status),
    lastError: row.last_error == null ? null : String(row.last_error),
  };
}

const CRAWL_SOURCE_COLUMNS = "id,url,kind,enabled,priority,interval_ms,next_run_at,last_run_at,last_status,last_error";
const CRAWL_SOURCE_KINDS = ["sitemap", "rss", "page"] as const;
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60_000;

export const crawlSourcesRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get("/api/admin/crawl-sources", { config: { scope: "admin", cache: { maxAge: 0 } } }, async (req, reply) => {
    const parsed = z.object({
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }).safeParse(req.query ?? {});
    if (!parsed.success) { reply.code(400); return { ok: false, error: "采集来源列表参数无效" }; }
    const rows = await ctx.repo.raw(
      `SELECT ${CRAWL_SOURCE_COLUMNS} FROM crawl_sources ORDER BY priority DESC, id ASC LIMIT ?`,
      [parsed.data.limit],
    );
    return { ok: true, items: rows.map(mapCrawlSource) };
  });

  app.post("/api/admin/crawl-sources", { config: { scope: "admin", rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({
      url: z.string().trim().url().max(2000),
      kind: z.enum(CRAWL_SOURCE_KINDS).default("sitemap"),
      priority: z.number().int().min(-100).max(100).default(0),
      intervalMs: z.number().int().min(60_000).max(MAX_INTERVAL_MS).default(3_600_000),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { ok: false, error: "采集来源数据格式无效", details: body.error.issues }; }
    const duplicate = await ctx.repo.raw("SELECT id FROM crawl_sources WHERE url = ? LIMIT 1", [body.data.url]);
    if (duplicate.length) { reply.code(409); return { ok: false, error: "该采集来源 URL 已登记" }; }
    const id = randomUUID(), now = Date.now();
    await ctx.repo.run(
      "INSERT INTO crawl_sources (id,url,kind,enabled,priority,interval_ms,next_run_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [id, body.data.url, body.data.kind, 1, body.data.priority, body.data.intervalMs, now, now, now],
    );
    await ctx.repo.audit({
      ip: req.ip, actor: String(req.auth?.actor ?? "admin"), actorKind: String(req.auth?.kind ?? "session"),
      action: "crawl.source.create", target: id, diff: { url: body.data.url, kind: body.data.kind },
    });
    return {
      ok: true,
      item: mapCrawlSource({
        id, url: body.data.url, kind: body.data.kind, enabled: 1, priority: body.data.priority,
        interval_ms: body.data.intervalMs, next_run_at: now, last_run_at: null, last_status: null, last_error: null,
      }),
    };
  });

  app.patch("/api/admin/crawl-sources/:id", { config: { scope: "admin", rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const params = z.object({ id: z.string().min(1).max(128) }).safeParse(req.params ?? {});
    if (!params.success) { reply.code(400); return { ok: false, error: "采集来源 ID 无效" }; }
    const body = z.object({
      url: z.string().trim().url().max(2000).optional(),
      kind: z.enum(CRAWL_SOURCE_KINDS).optional(),
      enabled: z.boolean().optional(),
      priority: z.number().int().min(-100).max(100).optional(),
      intervalMs: z.number().int().min(60_000).max(MAX_INTERVAL_MS).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { ok: false, error: "采集来源数据格式无效", details: body.error.issues }; }
    const existing = await ctx.repo.raw("SELECT id FROM crawl_sources WHERE id = ? LIMIT 1", [params.data.id]);
    if (!existing.length) { reply.code(404); return { ok: false, error: "采集来源不存在" }; }
    const patch = body.data;
    if (patch.url !== undefined) {
      const clash = await ctx.repo.raw("SELECT id FROM crawl_sources WHERE url = ? AND id <> ? LIMIT 1", [patch.url, params.data.id]);
      if (clash.length) { reply.code(409); return { ok: false, error: "该采集来源 URL 已登记" }; }
    }
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.url !== undefined) { sets.push("url = ?"); values.push(patch.url); }
    if (patch.kind !== undefined) { sets.push("kind = ?"); values.push(patch.kind); }
    if (patch.enabled !== undefined) { sets.push("enabled = ?"); values.push(patch.enabled ? 1 : 0); }
    if (patch.priority !== undefined) { sets.push("priority = ?"); values.push(patch.priority); }
    if (patch.intervalMs !== undefined) { sets.push("interval_ms = ?"); values.push(patch.intervalMs); }
    if (!sets.length) { reply.code(400); return { ok: false, error: "没有需要更新的字段" }; }
    sets.push("updated_at = ?");
    values.push(Date.now(), params.data.id);
    await ctx.repo.run(`UPDATE crawl_sources SET ${sets.join(", ")} WHERE id = ?`, values);
    const rows = await ctx.repo.raw(`SELECT ${CRAWL_SOURCE_COLUMNS} FROM crawl_sources WHERE id = ?`, [params.data.id]);
    await ctx.repo.audit({
      ip: req.ip, actor: String(req.auth?.actor ?? "admin"), actorKind: String(req.auth?.kind ?? "session"),
      action: "crawl.source.update", target: params.data.id, diff: patch,
    });
    return { ok: true, item: mapCrawlSource(rows[0] as Record<string, unknown>) };
  });

  app.delete("/api/admin/crawl-sources/:id", { config: { scope: "admin", rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const params = z.object({ id: z.string().min(1).max(128) }).safeParse(req.params ?? {});
    if (!params.success) { reply.code(400); return { ok: false, error: "采集来源 ID 无效" }; }
    const existing = await ctx.repo.raw("SELECT id FROM crawl_sources WHERE id = ? LIMIT 1", [params.data.id]);
    if (!existing.length) { reply.code(404); return { ok: false, error: "采集来源不存在" }; }
    await ctx.repo.run("DELETE FROM crawl_sources WHERE id = ?", [params.data.id]);
    await ctx.repo.audit({
      ip: req.ip, actor: String(req.auth?.actor ?? "admin"), actorKind: String(req.auth?.kind ?? "session"),
      action: "crawl.source.delete", target: params.data.id,
    });
    return { ok: true };
  });
};
