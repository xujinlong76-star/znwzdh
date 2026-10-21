/**
 * 路由共享辅助设施 (Route Shared Toolkit)
 *
 * 聚合跨路由域通用的响应构造、Query 参数归一化、身份提取与流式通信辅助，
 * 消除各路由样板代码，保障全站状态码与响应体格式的高度一致性。
 */
import type { FastifyReply } from "fastify";
import type { AppContext } from "../context.ts";

/* ------------------------------------------------------------------ *
 * HTTP 统一响应助手 (Unified HTTP Responders)
 * ------------------------------------------------------------------ */

/**
 * 404 资源不存在
 */
export function notFound(reply: FastifyReply, message = "资源不存在"): { error: string } {
  reply.code(404);
  return { error: message };
}

/**
 * 400 参数无效 / 请求错误
 */
export function badRequest(
  reply: FastifyReply,
  message = "参数无效",
  detail?: unknown
): { error: string; detail?: unknown } {
  reply.code(400);
  return detail !== undefined ? { error: message, detail } : { error: message };
}

/**
 * 409 状态冲突（如重复命名或已存在）
 */
export function conflict<T extends Record<string, unknown>>(
  reply: FastifyReply,
  message = "资源冲突",
  extra?: T
): { error: string } & Partial<T> {
  reply.code(409);
  return { error: message, ...(extra ?? {}) } as { error: string } & Partial<T>;
}

/**
 * 403 权限不足
 */
export function forbidden(reply: FastifyReply, message = "权限不足"): { error: string } {
  reply.code(403);
  return { error: message };
}

/**
 * 401 未授权
 */
export function unauthorized(reply: FastifyReply, message = "未授权"): { error: string } {
  reply.code(401);
  return { error: message };
}

/**
 * 201 资源创建成功
 */
export function created<T>(reply: FastifyReply, data: T): T {
  reply.code(201);
  return data;
}

/* ------------------------------------------------------------------ *
 * 请求参数归一化提取 (Query Parameter Normalizers)
 * ------------------------------------------------------------------ */

export interface PaginationOptions {
  defaultLimit?: number;
  minLimit?: number;
  maxLimit?: number;
}

/**
 * 安全解析分页参数（自动边界防御与范围钳位）
 */
export function parsePagination(
  query: unknown,
  options: PaginationOptions = {}
): { limit: number; offset: number } {
  const q = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
  const defaultLimit = options.defaultLimit ?? 50;
  const minLimit = options.minLimit ?? 1;
  const maxLimit = options.maxLimit ?? 200;

  const rawLimit = Number(q.limit);
  const limit = Math.min(
    Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? Math.trunc(rawLimit) : defaultLimit, minLimit),
    maxLimit
  );

  const rawOffset = Number(q.offset);
  const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0);

  return { limit, offset };
}

/**
 * 安全解析单个整数参数（有限性 + 取整 + 上下限钳位）。
 *
 * 专治 `Math.min(Number(x) || d, max)` 这一族写法的两个漏网之鱼：
 *  - 负数：`Number("-5") || 20 === -5`（真值不触发回退），负数进 SQL 的
 *    `LIMIT ?` 在 SQLite 里表示「不限制」→ 全表扫描；
 *  - NaN：`Math.max(1, NaN)` 仍是 NaN，绑定进 SQL 同样不受限。
 */
export function parseIntParam(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  const base = Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.min(Math.max(base, min), max);
}

/**
 * 安全解析时间跨度参数（天数 / 小时数钳位）
 */
export function parseTimeWindow(
  query: unknown,
  key = "days",
  fallback = 30,
  min = 1,
  max = 365
): number {
  const q = (query && typeof query === "object" ? query : {}) as Record<string, unknown>;
  const raw = Number(q[key]);
  return Math.min(Math.max(Number.isFinite(raw) && raw > 0 ? raw : fallback, min), max);
}

/* ------------------------------------------------------------------ *
 * 流式通道与日志助手 (Streaming & Audit Utilities)
 * ------------------------------------------------------------------ */

/**
 * 初始化 SSE 长连接推流报头（避免重复编写 5 行底层 header）
 */
export function setupSseStream(reply: FastifyReply): void {
  if (typeof reply.hijack === "function") {
    reply.hijack();
  }
  reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.raw.flushHeaders?.();
}

/**
 * 安全审计容错写入：审计日志写入异常时不阻断主业务响应
 */
export async function auditSafely(
  repo: { audit: (entry: any) => Promise<void> },
  entry: any
): Promise<void> {
  try {
    await repo.audit(entry);
  } catch (err) {
    console.error("[navhub] 审计写入失败（主操作结果不受影响）:", err);
  }
}

/* ------------------------------------------------------------------ *
 * 领域业务辅助 (Domain Helpers)
 * ------------------------------------------------------------------ */

/**
 * site.id -> 数值投稿编号，与前端（Next 侧）的 hashNumericId 规则必须一致。
 * 算法：djb2 变体（((hash<<5)-hash)+ch），与 apps/web 的 hashNumericId 相同。
 */
export function submissionNumber(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

/**
 * 从请求提取终端用户身份标示（Header 优先，Query/Body 兼容回退）
 */
export function identityOf(req: {
  query: Record<string, unknown>;
  body: unknown;
  headers?: Record<string, string | undefined>;
}): string | null {
  const headers = (req as { headers?: Record<string, unknown> }).headers as
    | Record<string, unknown>
    | undefined;

  const pick = (...names: string[]): string | null => {
    if (!headers) return null;
    for (const n of names) {
      const v = headers[n] ?? headers[n.toLowerCase()] ?? headers[n.toUpperCase()];
      if (typeof v === "string" && v) return v.slice(0, 64);
    }
    return null;
  };

  const hUser = pick("x-navhub-user-id", "x-user-id");
  if (hUser) return hUser;
  const hAnon = pick("x-navhub-anon-id", "x-anon-id");
  if (hAnon) return hAnon;

  const fromQuery = (req.query ?? {}) as Record<string, string>;
  const fromBody = (req.body ?? {}) as Record<string, string>;
  // identity 是插件域对终端用户身份的字段名（安装/评价/上架）。它必须参与这里
  // 的身份解析，否则「只带 identity」的请求对签名 hook 恒为 null → 签名整段跳过，
  // 而插件路由随后仍会把 body.identity 当作真实身份使用（可冒充任意用户）。
  const v =
    fromQuery.userId ?? fromQuery.anonId ?? fromQuery.identity ??
    fromBody.userId ?? fromBody.anonId ?? fromBody.identity ?? null;
  return typeof v === "string" ? v.slice(0, 64) : v;
}

/**
 * identity 路由的最小鉴权收紧（防 IDOR 扩大）
 */
export function identityAllowed(ctx: AppContext, req: { auth?: { kind?: string } }): boolean {
  if (!ctx.config.authRequired) return true;
  return (req as { auth?: { kind?: string } }).auth?.kind !== "anonymous";
}