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
 * 分面过滤参数预算 (Facet Filter Budget)
 * ------------------------------------------------------------------ */

/** facets 允许的键数上限（一次分面过滤的维度本来就不该有几十个） */
export const FACET_MAX_KEYS = 20;
/** 单个 facets 键允许的值个数上限（与 /api/search schema 里数组的 .max(200) 同口径） */
export const FACET_MAX_VALUES_PER_KEY = 200;

/**
 * 归一化客户端传来的 `facets`（对象或 JSON 字符串），并强制预算。
 *
 * 为什么必须在路由层做，而不是交给存储层：
 *  - `facets` 是**公开读接口**上的自由 JSON。`filterSiteIdsByFacets` 会按「键数」
 *    发查询、按「每键值数」拼 `IN (?,...)`。没有预算时，一条 ~10KB 的查询串就能
 *    放大成上千次绑定参数与整表扫，参数总数还会超 SQLite/PG 的语句级上限 → 500。
 *  - 旧实现把「解析失败」静默当成「没传 filters」：客户端以为自己在按 pricing 筛选，
 *    实际拿到的是**未过滤的全量列表**。错误输入必须回 400，不能回错数据。
 *
 * @returns `error` 非空时调用方直接回 400；否则 `facets` 已去空、去重、转小写
 */
export function clampFacets(input: unknown): { facets?: Record<string, string[]>; error?: string } {
  if (input === undefined || input === null) return {};
  let source: unknown = input;
  if (typeof source === "string") {
    const trimmed = source.trim();
    if (!trimmed) return {};
    try {
      source = JSON.parse(trimmed);
    } catch {
      return { error: "facets 必须是合法的 JSON 对象" };
    }
  }
  if (Array.isArray(source) || typeof source !== "object" || source === null) {
    return { error: "facets 必须是 { 键: 值或值数组 } 形态的对象" };
  }
  const entries = Object.entries(source as Record<string, unknown>);
  if (entries.length > FACET_MAX_KEYS) {
    return { error: `facets 最多 ${FACET_MAX_KEYS} 个键，收到 ${entries.length} 个` };
  }
  const facets: Record<string, string[]> = {};
  for (const [key, rawValue] of entries) {
    if (!key.trim()) continue;
    const rawValues = Array.isArray(rawValue) ? rawValue : [rawValue];
    const values: string[] = [];
    for (const v of rawValues) {
      // 只接受纯量：以前 `String(v)` 会把 null 变成 'null'、把 {a:1} 变成
      // '[object Object]' 一起绑进 SQL；静默丢弃同样糟（客户端以为在筛选，
      // 条件其实已经消失）。两种都回 400，让调用方立刻知道自己的写法错了。
      if (typeof v !== "string" && typeof v !== "number") {
        return { error: `facets.${key} 的值必须是字符串或数字` };
      }
      const normalized = String(v).trim().toLowerCase();
      if (normalized) values.push(normalized);
    }
    if (values.length > FACET_MAX_VALUES_PER_KEY) {
      return { error: `facets.${key} 最多 ${FACET_MAX_VALUES_PER_KEY} 个值，收到 ${values.length} 个` };
    }
    if (values.length > 0) facets[key.trim().toLowerCase()] = [...new Set(values)];
  }
  return { facets };
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
/**
 * 安全解码路径参数。
 *
 * Fastify 已对 `:param` 做过一次 URL 解码；路由里再 `decodeURIComponent` 一次
 * 是为了兼容「客户端把 slug 编了两遍」的历史调用。但畸形输入（例如 `%`）会让
 * decodeURIComponent 抛 URIError，冒到框架层变成 500——一个本该是 404 的
 * 非法 slug 被记进错误率指标，还会污染告警。这里失败时回退原文，
 * 让后续查库自然走到 404。
 */
export function safeDecodeParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

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

/**
 * 「调用方自称的终端用户身份」是否可信——两轴鉴权里的第二轴。
 *
 * 第一轴（`identityAllowed` / Bearer token）只回答「调用方是不是持票人」。
 * 但有两类合法调用方天生没有票：
 *   - 开放模式（`authRequired=false`，个人/NAS 默认）；
 *   - 公共站的匿名访客——Web 侧 `/api/hub/*` 代理会给他们的身份打 HMAC 签名
 *     （见 `server.ts` 的 preValidation hook，配了 `NAVHUB_IDENTITY_SECRET` 才生效）。
 * 只按第一轴收紧，会把这两类调用方的终端用户功能整片砍掉。
 *
 * 第二轴：**配了签名密钥 = 能走到路由的身份都已通过签名校验**（hook 用的是同一个
 * `identityOf`，签名不匹配在 preValidation 就 401 了）。于是本函数为真当且仅当：
 * 开放模式 / 持票 / 身份已被签名绑定。
 *
 * 依赖的硬不变量：调用方**只能**用 `identityOf`（或其委托者 `extractPluginIdentity`）
 * 取身份。若某条路由另开一个入口读 body 里的身份字段，签名覆盖不到它，这里就退化成
 * 无条件放行——插件域曾经正是那种情况（见 `identity-plugin-impersonation.test.ts`）。
 *
 * 反例：不要用它替换「写进程级共享状态」这类路由的闸门（`POST /api/tools/synthesize`、
 * `POST /api/p2p/signal`），那些要求的确实是持票。
 */
/**
 * 请求的**有效**身份（T20）：用户级令牌的 owner 优先，其次既有自称链路。
 *
 * 为什么不改 identityOf：签名 hook 在 preValidation 阶段用 identityOf 判定
 * 「要不要验签」——把 owner 混进去会让无签名的令牌请求被误判为需要验签。
 * 这里只在**业务取数**时使用（签名校验之后），时序红线与 resolveCanonicalIdentity 相同。
 */
export function requestIdentityOf(req: { auth?: { ownerIdentity?: string | null } }): string | null {
  const owner = (req as { auth?: { ownerIdentity?: string | null } }).auth?.ownerIdentity;
  if (owner) return owner;
  return identityOf(req as never);
}

/**
 * 用户域写路径守卫（T20）：会话/BFF 流程不受影响（无 owner 恒放行，闸门仍由
 * identityTrusted + 签名承担）；个人令牌写自己的数据必须持 write scope——
 * 自建令牌 v1 只发 read，让「误把令牌贴进不可信环境」的爆炸半径停在只读。
 */
export function userDomainWriteAllowed(req: { auth?: { kind?: string; scopes?: string[]; ownerIdentity?: string | null } }): boolean {
  const auth = (req as { auth?: { kind?: string; scopes?: string[]; ownerIdentity?: string | null } }).auth;
  if (!auth?.ownerIdentity) return true;
  const scopes = auth.scopes ?? [];
  return scopes.includes("write") || scopes.includes("admin");
}

export function identityTrusted(ctx: AppContext, req: { auth?: { kind?: string } }): boolean {
  if (ctx.config.identitySecret) return true;
  return identityAllowed(ctx, req);
}

/**
 * 把「调用方自称的身份」解析成身份合并之后的 canonical 身份。
 *
 * 为什么必须在每个用户域路由里都做：身份合并（`identity_aliases`）之后，旧 id 仍然
 * 是一枚**合法且已签名**的身份——扩展、MCP、没刷新的旧标签页都会继续用它发请求。
 * 如果只有 `/api/me*` 解析别名，这些写入就会落在旧 id 上变成孤儿行：`/me` 概览看不到、
 * 导出与注销也覆盖不到（用户以为数据没了，其实还在库里）。
 *
 * 时序红线：本函数只能在签名校验**之后**调用。签名对象是 `identityOf` 截断 64 字符的
 * **原始**身份，若在 preValidation 之前改写身份，签名校验必然失败（见 `identity-signature.ts`）。
 * 因此这里只影响「用哪个 id 读写仓储」，不参与任何签名计算。
 *
 * 未配置别名表 / 查不到别名时原样返回，语义等同旧行为（无别名即自身）。
 */
export async function resolveCanonicalIdentity(ctx: AppContext, identity: string): Promise<string> {
  if (!identity) return identity;
  try {
    return await ctx.repo.resolveIdentity(identity);
  } catch {
    // 解析失败不阻断请求：退回原始身份，最坏结果与改造前一致（可能产生孤儿行），
    // 但不会因为一次别名表抖动让整个用户域 500。
    return identity;
  }
}

/**
 * 「这个调用方算不算管理员」——比直接读 `req.auth.scopes` 严一档。
 *
 * 坑在挂载方式：`server.ts` 的 onRequest 先无条件把 `req.auth` 复制成
 * `ANONYMOUS_IDENTITY`（scopes 天生是全量的 read,write,admin），随后只在
 * 「带了有效 token」时才覆写 scopes。于是**鉴权开着但没票**的调用方，在
 * `scope:"public"` 路由上提前 return，手里依然攥着 `["read","write","admin"]`，
 * 只有 `kind` 诚实地写着 `"anonymous"`。任何 `scopes.includes("admin")` 的判定
 * 都会被它放行——已上架门禁（未发布插件全文可见）、AI 审核（可替任意插件跳审上架）
 * 都吃过这一口。
 *
 * 口径：开放模式（`authRequired=false`）按设计「操作者即管理员、无凭据」，
 * 保持历史行为不变；开了鉴权就只认非匿名调用方的 scope。
 * 根治应在 hook 里把无票分支的 scopes 清空（`server.ts` 是热区，此处只做本地修复
 * 并把根因写进审计报告）。
 */
export function isAdminScope(ctx: AppContext, req: { auth?: { kind?: string; scopes?: string[] } }): boolean {
  const auth = (req as { auth?: { kind?: string; scopes?: string[] } }).auth;
  if (!auth?.scopes?.includes("admin")) return false;
  if (ctx.config.authRequired && auth.kind === "anonymous") return false;
  return true;
}