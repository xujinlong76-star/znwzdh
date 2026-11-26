/**
 * MCP 处理器共享设施。
 *
 * 各域处理器（sites / catalog / algorithms ...）统一以 (deps, args, tc) 为签名：
 * deps 注入 AppContext 与两个跨域辅助（幂等、向量索引），args 为原始入参，
 * tc 为调用身份。这样每个域文件都是纯函数集合，不再各自持有闭包，
 * 便于按域阅读与独立测试，同时对外 `createHandlers(ctx)` 的产物完全不变。
 */
import { createHash } from "node:crypto";
import { hashSiteId } from "@navhub/store";
import { siteEmbeddingText } from "@navhub/ai";
import type { McpHostContext } from "../host-context.ts";
import type { ToolContext } from "../tools.ts";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** 所有工具处理器的统一签名。 */
export type Handler = (deps: HandlerDeps, args: unknown, tc: ToolContext) => Promise<ToolResult>;

export interface IdempotencyOptions<T> {
  /** 可选的网络/embedding 前置准备：在事务外执行，且已命中缓存时跳过。 */
  prepare?: () => Promise<void>;
  /** 向量索引等提交后副作用；重放时也执行，用于补偿上次提交后的中断。 */
  afterCommit?: (result: T) => Promise<void>;
}

export interface HandlerDeps {
  ctx: McpHostContext;
  /**
   * 幂等键处理：命中则直接返回上次结果。
   * 这是防止 Agent 重试导致重复入库的关键 —— Agent 重试是常态，不是异常。
   *
   * 传进来的 key 会被 bind() 加上「工具名 + 调用身份」作用域，处理器不必自己拼；
   * 理由见 qualifyIdempotencyKey()。
   */
  withIdempotency: <T>(
    key: string | undefined,
    compute: () => Promise<T>,
    options?: IdempotencyOptions<T>,
  ) => Promise<ToolResult>;
  /** 写库后补建向量索引；模型不可用时静默跳过（不该让写操作失败）。 */
  indexSite: (id: string, title: string, description: string | null, url: string) => Promise<void>;
}

/**
 * 个人数据工具的归属校验：数据范围 = 令牌归属人（tc.ownerIdentity），不是调用方传参。
 *
 * 为什么单列：只要还有一个 handler 用入参当身份，「持 write 令牌即可改写任意人
 * 的个人数据」就是全仓的通用漏洞，而不是某个工具的单点问题。
 * 实例级 / 静态引导令牌（ownerIdentity 为 null）一律拒绝——它们是给站点管理用的。
 */
export function requireOwnerIdentity(tc: ToolContext): string {
  if (!tc.ownerIdentity) {
    throw new Error("此工具要求用户级个人令牌（api_tokens.owner_identity）；实例级令牌无法读写个人数据");
  }
  return tc.ownerIdentity;
}

export function makeWithIdempotency(ctx: McpHostContext): HandlerDeps["withIdempotency"] {
  return async function withIdempotency<T>(
    key: string | undefined,
    compute: () => Promise<T>,
    options?: IdempotencyOptions<T>,
  ): Promise<ToolResult> {
    const afterCommit = async (result: T): Promise<void> => {
      if (!options?.afterCommit) return;
      try {
        await options.afterCommit(result);
      } catch {
        // 业务记录与幂等响应已经提交，索引故障不能让成功写入变成失败。重放会再次
        // 调用 afterCommit，因此可补偿进程在 COMMIT 后、索引完成前退出的窗口。
      }
    };

    if (!key) {
      await options?.prepare?.();
      const result = await compute();
      await afterCommit(result);
      return ok(result);
    }

    const readResponse = async (): Promise<string | null> => {
      const existing = await ctx.repo.raw("SELECT response FROM idempotency WHERE key = ?", [key]);
      const response = existing[0]?.response;
      return typeof response === "string" && response.length > 0 ? response : null;
    };
    const replay = async (response: string): Promise<ToolResult> => {
      const result = JSON.parse(response) as T;
      await afterCommit(result);
      return ok({ replayed: true, result });
    };

    // 普通重放先在事务外命中缓存，避免再次执行 enrich/LLM 等网络准备。这里只是
    // 快速路径；真正的并发正确性仍由下面事务内的第二次查重保证。
    const cached = await readResponse();
    if (cached) return replay(cached);

    // enrich 可能等待外部网络数秒，绝不能占着 SQLite 的 BEGIN IMMEDIATE。
    await options?.prepare?.();

    /**
     * 事务内只保留查重、业务 DB 写入与幂等响应落库。
     *
     * SQLite 的 BEGIN IMMEDIATE 已串行化所有写者；PG 额外用事务级 advisory lock
     * 串行化同一个 key（跨进程也有效）。compute 抛错时整个事务回滚，因此不会
     * 留下“站点已建但幂等响应缺失”的半状态，重试可以重新完整执行。
     */
    const outcome = await ctx.repo.withTransaction(async () => {
      await ctx.repo.acquireAdvisoryXactLock(key);
      // prepare 期间可能已有同键请求提交，必须再查一次，不能只信事务外快照。
      const existing = await readResponse();
      if (existing) return { replayed: true as const, result: JSON.parse(existing) as T };

      const result = await compute();
      await ctx.repo.run(
        "INSERT INTO idempotency (key, response, created_at) VALUES (?,?,?) ON CONFLICT (key) DO UPDATE SET response = excluded.response, created_at = excluded.created_at",
        [key, JSON.stringify(result) ?? "null", Date.now()],
      );
      return { replayed: false as const, result };
    });

    // embedding/vector/plugin index 只在 COMMIT 后执行，回滚不会留下“库里有站点、
    // 向量库已有记录”的残留，也不会让长网络请求阻塞 SQLite 写锁。
    await afterCommit(outcome.result);
    return outcome.replayed
      ? ok({ replayed: true, result: outcome.result })
      : ok(outcome.result);
  };
}

export function makeIndexSite(ctx: McpHostContext): HandlerDeps["indexSite"] {
  return async function indexSite(id, title, description, url) {
    if (!ctx.embedding) return;
    try {
      const vec = await ctx.embedding.encode(siteEmbeddingText({ title, description, url }));
      await ctx.vectors.upsert([{ key: hashSiteId(id), siteId: id, vector: vec }]);
      await ctx.repo.saveEmbedding(id, ctx.config.embedding.model, vec);
    } catch {
      // 模型不可用不该让写操作失败
    }
  };
}

/**
 * 幂等键的作用域化。`idempotency.key` 是**全库唯一主键**，而调用方给的键只是一个短字符串，
 * 裸键落库会产生两类真事故：
 *  - 跨工具串味：同一个 Agent 用 key="sync-1" 调过 delete_site 后再用同一键调 create_site，
 *    会命中 delete 的旧结果 —— 返回 replayed:true、站点根本没建，而 Agent 以为建好了。
 *  - 跨身份覆盖：另一个 token 只要复用（或猜到）同一个键，就能读到别人那次调用的返回内容，
 *    并让自己的写操作被静默跳过。
 * 键是任意用户文本、身份名里也有 `:`，所以不拼分隔符，直接哈希成 64 位十六进制
 * （顺带不再把调用方原文与 token 名存进幂等表）。
 */
export function qualifyIdempotencyKey(toolName: string, actor: string, key: string): string {
  return createHash("sha256").update(JSON.stringify([toolName, actor, key])).digest("hex");
}

/** 把 `(deps, args, tc)` 处理器绑定为对外 `(args, tc)`，保留每个键的精确类型。 */
export type Bound<T extends Record<string, Handler>> = {
  [K in keyof T]: (args: unknown, tc: ToolContext) => Promise<ToolResult>;
};

export function bind<T extends Record<string, Handler>>(handlers: T, deps: HandlerDeps): Bound<T> {
  const src = handlers as Record<string, Handler>;
  const out: Record<string, (args: unknown, tc: ToolContext) => Promise<ToolResult>> = {};
  for (const key of Object.keys(src)) {
    out[key] = (args, tc) => {
      // 只在真正带键时改写：无键的分支不应该多一次哈希
      const scoped: HandlerDeps = {
        ...deps,
        withIdempotency: (rawKey, compute, options) =>
          rawKey
            ? deps.withIdempotency(qualifyIdempotencyKey(key, tc.actor, rawKey), compute, options)
            : deps.withIdempotency(rawKey, compute, options),
      };
      return src[key]!(scoped, args, tc);
    };
  }
  return out as Bound<T>;
}
