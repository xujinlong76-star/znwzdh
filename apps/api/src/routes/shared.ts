import type { AppContext } from "../context.ts";
import type { AuthIdentity } from "../auth.ts";

export function identityOf(req: { query: Record<string, unknown>; body: unknown; headers?: Record<string, string | undefined> }): string | null {
  // 优先 header（避免 anonId 进 URL query 泄漏到日志/referer），query/body 仅兼容旧前端
  const headers = (req as { headers?: Record<string, unknown> }).headers as Record<string, unknown> | undefined;
  const pick = (...names: string[]): string | null => {
    if (!headers) return null;
    for (const n of names) {
      const v = headers[n] ?? headers[n.toLowerCase()] ?? headers[n.toUpperCase()];
      if (typeof v === "string" && v) return v.slice(0, 64);
    }
    return null;
  };
  // 前端实际发送 X-Navhub-Anon-Id（见 web-overlay lib/navhub-api.ts anonHeaders），短名保留兼容
  const hUser = pick("x-navhub-user-id", "x-user-id");
  if (hUser) return hUser;
  const hAnon = pick("x-navhub-anon-id", "x-anon-id");
  if (hAnon) return hAnon;
  const fromQuery = (req.query ?? {}) as Record<string, string>;
  const fromBody = (req.body ?? {}) as Record<string, string>;
  const v = fromQuery.userId ?? fromQuery.anonId ?? fromBody.userId ?? fromBody.anonId ?? null;
  return typeof v === "string" ? v.slice(0, 64) : v;
}

/**
 * identity 路由的最小鉴权收紧（防 IDOR 扩大）。
 * 开放模式（默认）行为完全不变；开启 NAVHUB_AUTH_REQUIRED 后，
 * 纯匿名调用（无有效 Bearer token）会被 401 拒绝——调用方身份不再只由
 * 客户端自报的 userId/anonId 决定。
 */
export function identityAllowed(ctx: AppContext, req: { auth?: { kind?: string } }): boolean {
  if (!ctx.config.authRequired) return true;
  return (req as { auth?: AuthIdentity }).auth?.kind !== "anonymous";
}
