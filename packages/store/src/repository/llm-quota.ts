/**
 * LLM 配额的**原子预留**（升级改造方案 P0-3）。
 *
 * 修的是「先查后写」这一族成本事故：额度闸门过去只做两步——`sumLlmUsage` 读窗口用量，
 * 再在 JS 里和上限比较。两步之间有一个 await 窗口，并发请求会**同时**看到「还没超」，
 * 于是全部放行。上限 5 的档位实际能放出去几十个调用，花的是运维者那把 key。
 * 单请求视角完全正确，所以单元测试（串行）永远发现不了它——必须把「判定 + 占位」
 * 压进同一个事务。
 *
 * 口径：
 *   - 预留行代表「已经答应给某次调用、但还没落账的额度」；调用结束后 `settle` 删行，
 *     真实用量以 `llm_usage` 为准（预留不参与成本统计，避免双记）；
 *   - `source` 沿用 `llm_usage` 的口径（`user` = 用户自带 key，不计入系统档），
 *     用文本而不是布尔列：PG 是 BOOLEAN、SQLite 是 0/1，两侧比较写法不同，
 *     而这一列的语义正好就是「谁的钱」。
 *   - 预留**必须**带 TTL：进程被 kill、SSE 半路断开、异常没走 finally，都会留下
 *     再也不会结算的行。过期行由下一次 `reserve` 顺手清掉（不新增任务类型，
 *     免得为一个内部护栏去动 cron 的白名单与守卫面）。
 *
 * 并发正确性的来源：
 *   - SQLite：`withTransaction` 走 `BEGIN IMMEDIATE`，写锁覆盖整个「读合计 → 插行」；
 *   - PostgreSQL：同一进程由事务写锁串行化；**跨进程**（多副本部署）额外用
 *     `pg_advisory_xact_lock` 把所有预留串到同一把锁上——事务里只有两条聚合与一次
 *     插入，锁持有时间是毫秒级，而 LLM 调用本身是秒级，不构成瓶颈。
 */
import type { Repository } from "../repository.ts";
import { randomUUID } from "node:crypto";

/** 预留行的对外形态（字段命名与 llm_usage 的驼峰口径一致） */
export interface LlmQuotaReservationRecord {
  id: string;
  /** NULL = 无归属流量（与 llm_usage.identity 的三态口径相同） */
  identity: string | null;
  /** user / system / env / default：user 不占系统档 */
  source: string;
  reservedCalls: number;
  reservedTokens: number;
  expiresAt: number;
  createdAt: number;
}

export interface LlmQuotaReservationTotals {
  calls: number;
  tokens: number;
  /** 最早一条的到期时间：被预留挡住时，Retry-After 应该看它而不是 24h */
  earliestExpiry: number | null;
}

/** 一个需要对照的上限档 */
export interface LlmQuotaTier {
  /** 档名，仅用于回传拒绝原因（identity / anonymous / system） */
  scope: string;
  /** 该档的身份口径：字符串=该身份，null=identity IS NULL，undefined=全量 */
  identity?: string | null;
  /** 系统档：只数非用户自带 key 的消耗 */
  excludeUserSource?: boolean;
  /** 0 = 该维度不启用 */
  maxCalls: number;
  maxTokens: number;
}

export interface ReserveLlmQuotaInput {
  identity: string | null;
  /** 本次调用的密钥来源（未知时按最保守的 "system" 申报） */
  source: string;
  reservedCalls: number;
  reservedTokens: number;
  /** 用量窗口长度（毫秒），与 llm_usage 侧一致 */
  windowMs: number;
  /** 预留存活时长（毫秒）：到点没结算就自动回收 */
  ttlMs: number;
  tiers: LlmQuotaTier[];
  now?: number;
}

export interface LlmQuotaBlock {
  scope: string;
  metric: "calls" | "tokens";
  limit: number;
  /** 窗口内「已落账 + 已预留」的合计（拒绝时给的就是这个数） */
  used: number;
  retryAfterMs: number;
  /** 拒绝是预留造成的还是真实用量造成的：观测上要知道闸门有没有在吃并发 */
  blockedBy: "usage" | "reservation" | "both";
}

export type ReserveLlmQuotaResult =
  | { ok: true; reservation: LlmQuotaReservationRecord }
  | { ok: false; blocked: LlmQuotaBlock };

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 与 llm_usage 的写入侧同一道裁剪：身份串不带上限的话，索引会被长串撑大 */
function clampIdentity(identity: string | null | undefined): string | null {
  if (typeof identity !== "string" || identity.length === 0) return null;
  return identity.slice(0, 64);
}

function clampPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/**
 * 窗口内未过期预留的合计。
 *
 * 只数 `expires_at > now` 的行：过期预留已经是「不会有人再来结算」的死行，
 * 把它们算进已用额度等于让一次崩溃永久吃掉额度，直到 24h 窗口滚过去。
 */
export async function sumLlmQuotaReservations(
  repo: Repository,
  options: { identity?: string | null; excludeUserSource?: boolean; now?: number },
): Promise<LlmQuotaReservationTotals> {
  const now = options.now ?? Date.now();
  const args: unknown[] = [now];
  let sql =
    "SELECT COALESCE(SUM(reserved_calls), 0) AS calls, COALESCE(SUM(reserved_tokens), 0) AS tokens, " +
    "MIN(expires_at) AS earliest_expiry FROM llm_quota_reservations WHERE expires_at > ?";
  if (options.identity !== undefined) {
    if (options.identity === null) sql += " AND identity IS NULL";
    else {
      sql += " AND identity = ?";
      args.push(clampIdentity(options.identity));
    }
  }
  if (options.excludeUserSource) sql += " AND source <> 'user'";
  const rows = await repo.raw(sql, args);
  const row = rows[0] ?? {};
  const earliest = num(row.earliest_expiry);
  return {
    calls: num(row.calls),
    tokens: num(row.tokens),
    earliestExpiry: earliest > 0 ? earliest : null,
  };
}

/**
 * 「已用 + 已预留 vs 上限」的原子判定与占位。
 *
 * 整个函数体跑在一个事务里：SQLite 靠 BEGIN IMMEDIATE 拿到写锁，PG 额外拿
 * 跨进程的 advisory 事务锁。任何一步抛错都回滚，不会留下半截预留。
 *
 * 判定顺序与历史上的 `checkLlmQuota` 保持一致（identity → anonymous → system），
 * 命中即拒：给用户的提示要说「哪一档到顶」，多档同时超限时按第一个命中的档报。
 */
export async function reserveLlmQuota(
  repo: Repository,
  input: ReserveLlmQuotaInput,
): Promise<ReserveLlmQuotaResult> {
  const now = input.now ?? Date.now();
  const windowMs = clampPositive(input.windowMs, 24 * 60 * 60 * 1000);
  const ttlMs = clampPositive(input.ttlMs, 5 * 60 * 1000);
  const identity = clampIdentity(input.identity);
  const source = (typeof input.source === "string" && input.source ? input.source : "system").slice(0, 32);
  const reservedCalls = clampPositive(input.reservedCalls, 1);
  const reservedTokens = Number.isFinite(input.reservedTokens) && input.reservedTokens > 0
    ? Math.floor(input.reservedTokens)
    : 0;
  const since = now - windowMs;

  return repo.withTransaction(async () => {
    // 跨进程串行化（多副本 PG 部署）；SQLite 已由写锁保证
    if (repo.db.dialect === "pg" && repo.db.pg) {
      // 只有 pg_advisory_xact_lock(bigint) 和 (int,int) 两个重载：hashtext 返回 int4，
      // 靠隐式 int4→int8 提升到单参 bigint 版本。写成两参形式反而要自己拆键，且换了
      // PG 版本的整型规则就会静默改锁语义。事务锁不做手动释放——它随事务结束自动交出。
      await repo.db.pg.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["navhub:llm-quota"]);
    }

    // 顺手回收过期死行：没有清理任务也能自愈，且不会把表撑大
    await repo.run("DELETE FROM llm_quota_reservations WHERE expires_at <= ?", [now]);

    // 一行预留要同时服务所有档，所以预留量按「各档剩余空间的最小值」夹一次：
    // 否则一个「上限比预估值还小」的档（token 上限 60、预估 1500 是老配置的常见形态）
    // 会让第一次调用就被**自己的预估**挡住 —— 闸门从「拦并发」退化成「拦死」。
    let holdCalls = reservedCalls;
    let holdTokens = reservedTokens;

    for (const tier of input.tiers) {
      // 系统档（excludeUserSource）不约束用户自带 key 的调用：这次消耗根本不落进
      // 那个池子，拿它的占用去拒这次请求就是「别人花光了预算，你连自己的 key 都不能用」。
      // API 侧的 buildTiers 同样按 source 生成档位，这里是第二道：原语必须自洽，
      // 不能依赖调用方记得过滤。
      if (tier.excludeUserSource && source === "user") continue;
      const maxCalls = Number.isFinite(tier.maxCalls) && tier.maxCalls > 0 ? Math.floor(tier.maxCalls) : 0;
      const maxTokens = Number.isFinite(tier.maxTokens) && tier.maxTokens > 0 ? Math.floor(tier.maxTokens) : 0;
      if (maxCalls === 0 && maxTokens === 0) continue;

      const [usage, reserved] = await Promise.all([
        repo.sumLlmUsage({
          since,
          until: now,
          identity: tier.identity,
          excludeUserSource: tier.excludeUserSource,
        }),
        sumLlmQuotaReservations(repo, {
          identity: tier.identity,
          excludeUserSource: tier.excludeUserSource,
          now,
        }),
      ]);

      const usedCalls = usage.calls + reserved.calls;
      const usedTokens = usage.tokens + reserved.tokens;

      // 腾出空间的时间：真实用量要等窗口滚过（最早一条 + 24h），
      // 预留只要等它自己的 TTL 到期。取两者较早的，才是诚实的 Retry-After。
      const usageFreeAt = usage.firstAt && usage.firstAt > since ? usage.firstAt + windowMs : null;
      const reservationFreeAt = reserved.earliestExpiry;
      const candidates = [usageFreeAt, reservationFreeAt].filter((t): t is number => typeof t === "number" && t > 0);
      const freeAt = candidates.length > 0 ? Math.min(...candidates) : now + windowMs;
      const retryAfterMs = Math.max(0, freeAt - now);
      const blockedBy: LlmQuotaBlock["blockedBy"] =
        reserved.calls > 0 || reserved.tokens > 0
          ? usage.calls > 0 || usage.tokens > 0
            ? "both"
            : "reservation"
          : "usage";

      if (maxCalls > 0 && usedCalls + holdCalls > maxCalls) {
        return {
          ok: false,
          blocked: { scope: tier.scope, metric: "calls", limit: maxCalls, used: usedCalls, retryAfterMs, blockedBy },
        };
      }
      // token 档只在「真实用量 + 在途预留」吃满上限时拒；本次自己的预估不参与这条判据，
      // 它只通过下面的 holdTokens 收窄，影响后续并发请求能不能挤进来。
      if (maxTokens > 0 && usedTokens >= maxTokens) {
        return {
          ok: false,
          blocked: { scope: tier.scope, metric: "tokens", limit: maxTokens, used: usedTokens, retryAfterMs, blockedBy },
        };
      }

      if (maxCalls > 0) holdCalls = Math.min(holdCalls, maxCalls - usedCalls);
      if (maxTokens > 0) holdTokens = Math.min(holdTokens, maxTokens - usedTokens);
    }

    const record: LlmQuotaReservationRecord = {
      id: randomUUID(),
      identity,
      source,
      reservedCalls: Math.max(0, holdCalls),
      reservedTokens: Math.max(0, holdTokens),
      expiresAt: now + ttlMs,
      createdAt: now,
    };
    await repo.run(
      "INSERT INTO llm_quota_reservations (id, identity, source, reserved_calls, reserved_tokens, expires_at, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        record.id,
        record.identity,
        record.source,
        record.reservedCalls,
        record.reservedTokens,
        record.expiresAt,
        record.createdAt,
      ],
    );
    return { ok: true, reservation: record };
  });
}

/**
 * 结算一条预留：删行即完成，真实数字由 `llm_usage` 说话。
 *
 * 为什么不留「结算后的预留行」：那样每条预留都要参与聚合，额度判定的读路径
 * 变成「用量 + 已结算预留 + 在途预留」三份账，而前两份是同一件事的双记。
 */
export async function settleLlmQuotaReservation(repo: Repository, id: string | null | undefined): Promise<boolean> {
  if (typeof id !== "string" || !id) return false;
  const deleted = await repo.runCount("DELETE FROM llm_quota_reservations WHERE id = ?", [id]);
  return deleted > 0;
}

/** 主动回收过期预留（retention/巡检可用）；返回删除条数 */
export async function pruneLlmQuotaReservations(repo: Repository, before: number): Promise<number> {
  return repo.runCount("DELETE FROM llm_quota_reservations WHERE expires_at <= ?", [
    Number.isFinite(before) ? Math.floor(before) : Date.now(),
  ]);
}

/** 在途预留明细（观测面板 / 排障用；上限 200 条防止把面板拖垮） */
export async function listLlmQuotaReservations(repo: Repository, limit = 50): Promise<LlmQuotaReservationRecord[]> {
  const cap = Math.min(Math.max(Math.floor(limit) || 50, 1), 200);
  const rows = await repo.raw(
    "SELECT id, identity, source, reserved_calls, reserved_tokens, expires_at, created_at " +
      "FROM llm_quota_reservations ORDER BY created_at DESC LIMIT ?",
    [cap],
  );
  return rows.map((r) => ({
    id: String(r.id),
    identity: r.identity ? String(r.identity) : null,
    source: String(r.source ?? "system"),
    reservedCalls: num(r.reserved_calls),
    reservedTokens: num(r.reserved_tokens),
    expiresAt: num(r.expires_at),
    createdAt: num(r.created_at),
  }));
}

/** 全局在途预留合计（metrics 用，不带身份过滤） */
export async function sumAllLlmQuotaReservations(
  repo: Repository,
  options?: { now?: number },
): Promise<{ active: number; calls: number; tokens: number }> {
  const now = options?.now ?? Date.now();
  const rows = await repo.raw(
    "SELECT COUNT(*) AS active, COALESCE(SUM(reserved_calls), 0) AS calls, COALESCE(SUM(reserved_tokens), 0) AS tokens " +
      "FROM llm_quota_reservations WHERE expires_at > ?",
    [now],
  );
  const row = rows[0] ?? {};
  return { active: num(row.active), calls: num(row.calls), tokens: num(row.tokens) };
}
