/**
 * MCP HTTP 出口两道门：per-token 配额（429）+ 读工具审计。
 *
 * 契约见 docs/arch/mcp-egress-security-gates-adr-2026-11-28.md（Accepted / 双签）。
 * 第三道门（只读可吊销 token）靠鉴权层 + 默认 scopes 实现，见 http-server.ts。
 *
 * 设计约束（来自 ADR 双签裁定）：
 *  - 配额计数器落共享存储 system_states，单条原子 UPSERT 递增，多实例天然安全；
 *    不用进程内 Map（多实例放大 N 倍，等于门白装）。
 *  - 审计复用 repo.audit()（fail-open），diff 只记元数据，绝不写 params / 返回值
 *    （否则 export_sites 的 4823 条会被抄进审计表）。
 *  - 门只识别「工具调用」：initialize / tools/list / ping / SSE GET 一律不计数。
 */
import { createHash } from "node:crypto";
import { TOOL_DEFS } from "../../../packages/mcp/src/tools.ts";

/** 两道门所需的最小仓储面——用结构类型，避免 egress-gates 反向依赖 AppContext。 */
export interface EgressRepo {
  raw(sqlText: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
  audit(entry: {
    actor: string;
    actorKind?: string;
    action: string;
    target?: string;
    diff?: unknown;
    ip?: string;
  }): Promise<void>;
}

export interface EgressGatesOptions {
  repo: EgressRepo;
  /** ToolContext.actor（静态 token = opts.actor，表内 = "mcp:"+name） */
  actor: string;
  /** 固定窗口毫秒数，默认 60s */
  windowMs?: number;
  /** 窗口内允许的工具调用次数，默认 120；配到 0 = 显式熔断（禁用所有新调用） */
  limit?: number;
  /** 客户端 IP（仅落审计元数据） */
  ip?: string;
}

export interface EgressGateResult {
  allowed: boolean;
  /** 距窗口结束的秒数，>=1，写进 Retry-After */
  retryAfterSeconds: number;
  /** 本窗口剩余可用次数，>=0 */
  quotaRemaining: number;
}

export const DEFAULT_WINDOW_MS = 60_000;
export const DEFAULT_LIMIT = 120;
export const MCP_QUOTA_EXCEEDED = -32029;

/**
 * 原子递增配额计数并返回当前值。key = mcp:quota:<sha256actor>:<窗口起点ms>。
 * value 存纯数字文本（配额专用，不复用 getSystemState 的 JSON 语义），
 * 单条 UPSERT 的 CAST(value AS INTEGER)+1 在 SQLite / PG 双方言都成立（已实测）。
 */
async function bumpQuota(repo: EgressRepo, key: string, now: number): Promise<number> {
  const rows = await repo.raw(
    "INSERT INTO system_states (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET " +
      "value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = excluded.updated_at " +
      "RETURNING value",
    [key, "1", now],
  );
  const raw = rows[0]?.value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 执行一次工具调用的出口门：先配额，后审计，再放行分发。
 * 配额存储异常 fail-open（DB 不可用时写操作同样进行不了，与 audit 同口径），
 * 但记 console.error，绝不静默吞。
 */
export async function enforceEgressGates(
  opts: EgressGatesOptions,
  toolName: string,
): Promise<EgressGateResult> {
  const started = Date.now();
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const actorHash = createHash("sha256").update(opts.actor).digest("hex");
  const windowStart = Math.floor(started / windowMs) * windowMs;
  const key = `mcp:quota:${actorHash}:${windowStart}`;

  let count: number;
  try {
    count = await bumpQuota(opts.repo, key, started);
  } catch (err) {
    // ADR-0010 §4 必须项：这是「双边写都失败 + 读正常」场景的唯一信号。
    // 日志侧须对稳定标记 EGRESS_WRITE_FAIL gate=quota 做告警（与 JobRunner 同通道）。
    // 结构化字段便于日志系统精确匹配，不打印任何 token / params。
    console.error("[navhub-mcp][EGRESS_WRITE_FAIL] gate=quota actorHash=" + actorHash + " tool=" + toolName, err);
    count = 1;
  }

  const quotaRemaining = Math.max(0, limit - count);
  const allowed = limit > 0 && count <= limit;
  // 固定窗口：最坏情况 2 倍突发，Retry-After 用距窗口结束的剩余秒数（≥1）
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - started) / 1000));

  // 门二：审计（fail-open，audit() 内部已 catch）。只记元数据，不写 params / 返回值。
  const def = TOOL_DEFS.find((t) => t.name === toolName);
  try {
    await opts.repo.audit({
      actor: opts.actor,
      actorKind: "mcp",
      action: "mcp.tool.call",
      target: toolName,
      diff: {
        count: 1,
        scope: def?.scope ?? "read",
        mutating: def?.mutating ?? false,
        tookMs: Date.now() - started,
        quotaRemaining,
      },
      ip: opts.ip,
    });
  } catch (err) {
    // ADR-0010 §4 必须项：与 quota 侧同一告警通道。
    // 注意 repo.audit() 内部 fail-open（events.ts:150-152 自行 console.error 吞错），
    // 此 catch 仅在 audit 主动抛错时触发；常规写失败由 audit 内部的 console.error
    // 记录——运维告警需同时覆盖两处（详见回执检测边界说明）。
    console.error("[navhub-mcp][EGRESS_WRITE_FAIL] gate=audit actorHash=" + actorHash + " tool=" + toolName, err);
  }

  return { allowed, retryAfterSeconds, quotaRemaining };
}

/**
 * 从 JSON-RPC body（单条或批量）提取全部 tools/call 的工具名。
 * 非 tools/call（initialize / tools/list / ping / 响应消息）返回空数组 → 不计数。
 */
export function toolCallNames(body: unknown): string[] {
  const messages = Array.isArray(body) ? body : [body];
  const names: string[] = [];
  for (const m of messages) {
    if (typeof m !== "object" || m === null) continue;
    const msg = m as { method?: unknown; params?: unknown };
    if (msg.method !== "tools/call") continue;
    const params = msg.params as { name?: unknown } | undefined;
    if (params && typeof params.name === "string") names.push(params.name);
  }
  return names;
}
