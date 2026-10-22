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
import type { AppContext } from "@navhub/api";
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

export interface HandlerDeps {
  ctx: AppContext;
  /**
   * 幂等键处理：命中则直接返回上次结果。
   * 这是防止 Agent 重试导致重复入库的关键 —— Agent 重试是常态，不是异常。
   *
   * 传进来的 key 会被 bind() 加上「工具名 + 调用身份」作用域，处理器不必自己拼；
   * 理由见 qualifyIdempotencyKey()。
   */
  withIdempotency: (key: string | undefined, compute: () => Promise<unknown>) => Promise<ToolResult>;
  /** 写库后补建向量索引；模型不可用时静默跳过（不该让写操作失败）。 */
  indexSite: (id: string, title: string, description: string | null, url: string) => Promise<void>;
}

export function makeWithIdempotency(ctx: AppContext): HandlerDeps["withIdempotency"] {
  return async function withIdempotency(key, compute) {
    if (!key) return ok(await compute());
    const db = ctx.db;
    if (db.dialect === "sqlite" && db.sqlite) {
      const existing = db.sqlite.prepare("SELECT response FROM idempotency WHERE key = ?").get(key) as { response: string } | undefined;
      if (existing?.response) return ok({ replayed: true, result: JSON.parse(existing.response) });
    } else if (db.dialect === "pg" && db.pg) {
      const { rows } = await db.pg.query("SELECT response FROM idempotency WHERE key = $1", [key]);
      const row = rows[0] as { response: string } | undefined;
      if (row?.response) return ok({ replayed: true, result: JSON.parse(row.response) });
    }
    const result = await compute();
    if (db.dialect === "sqlite" && db.sqlite) {
      db.sqlite.prepare("INSERT OR REPLACE INTO idempotency (key, response, created_at) VALUES (?,?,?)")
        .run(key, JSON.stringify(result), Date.now());
    } else if (db.dialect === "pg" && db.pg) {
      await db.pg.query(
        "INSERT INTO idempotency (key, response, created_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET response = $2, created_at = $3",
        [key, JSON.stringify(result), Date.now()]
      );
    }
    return ok(result);
  };
}

export function makeIndexSite(ctx: AppContext): HandlerDeps["indexSite"] {
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
        withIdempotency: (rawKey, compute) =>
          rawKey ? deps.withIdempotency(qualifyIdempotencyKey(key, tc.actor, rawKey), compute) : deps.withIdempotency(rawKey, compute),
      };
      return src[key]!(scoped, args, tc);
    };
  }
  return out as Bound<T>;
}
