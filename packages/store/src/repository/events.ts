import type { Repository } from "../repository.ts";
import type {
  AuditLogRecord,
} from "./records.ts";
import {
  rowToAuditLog,
} from "./dialect.ts";

/**
 * 幂等键的可接受形态：有界、只含字母数字与 `-`/`_`。
 * 必须同时限制长度与字符集，否则它会变成 `meta LIKE ?` 预筛里的通配符载体。
 */
export const EVENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 幂等键的作用域是「同一个日桶」：`event_day = floor(created_at / 一天)`。
 *
 * 两处判定必须用同一个日桶（这里算的 `created` 与索引里的 `event_day`），
 * 否则会出现「预筛说重复、唯一索引说可以插」的家务事——预筛按 30 天、
 * 索引按天，跨天的同键事件就会一边拦一边放。
 *
 * 为什么键会过期：永久唯一意味着客户端一旦固定复用一个键，该站点的点击
 * 会被**永远**静默丢掉；有界的键让这类 bug 的破坏半径止于一天。
 * 出箱重放保住 `clientCreatedAt`，所以同一次动作即使隔天才补送，也落在
 * 它发生当天的桶里、仍会被去重。
 */
const EVENT_DAY_MS = 86_400_000;

/** 客户端时间可被接受的范围：往前 90 天、往后 5 分钟（时钟偏移容忍） */
const CLIENT_TS_MIN_LAG_MS = 90 * 24 * 60 * 60 * 1000;
const CLIENT_TS_MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * 记录一条行为事件。
 *
 * 返回 `boolean`：`true` 已插入，`false` 因幂等键命中而跳过。
 * 调用方（`/api/events`）据此决定要不要再走 `bumpVisit` / 在线学习反馈——
 * 端侧出箱会重放同一 `eventId`，而 `visit_count` 是 `ORDER BY` 的次排序键
 * （本机实测 99.8% 站点该列为 0），重复 +1 会以极小分母被放大成错误排名。
 */
export async function recordEvent(
  repo: Repository,
  kind: string,
  payload: {
    siteId?: string;
    query?: string;
    categoryId?: string;
    identity?: string;
    meta?: unknown;
    /** 客户端生成的幂等键（有界、字符集受限）；非法值按「没有键」处理 */
    eventId?: string;
    /** 客户端事件时刻（毫秒）：重放时保住真实点击时间，不被服务端 now() 抹平 */
    clientCreatedAt?: number;
  } = {},
): Promise<boolean> {
  const eventId = typeof payload.eventId === "string" && EVENT_ID_RE.test(payload.eventId) ? payload.eventId : undefined;
  const metaIdentity = typeof payload.meta === "object" && payload.meta !== null
    ? (payload.meta as { identity?: unknown }).identity
    : undefined;
  const identity = payload.identity
    ?? (typeof metaIdentity === "string" ? metaIdentity : undefined)
    ?? null;
  const metaIsPlainObject = payload.meta === undefined
    || (typeof payload.meta === "object" && payload.meta !== null && !Array.isArray(payload.meta));
  const meta = eventId && metaIsPlainObject
    ? { ...(payload.meta as Record<string, unknown> | undefined), eventId }
    : payload.meta;

  const now = Date.now();
  const clientTs = payload.clientCreatedAt;
  const created = typeof clientTs === "number" && Number.isFinite(clientTs)
    && clientTs <= now + CLIENT_TS_MAX_SKEW_MS && clientTs >= now - CLIENT_TS_MIN_LAG_MS
    ? Math.floor(clientTs)
    : now;
  // 日桶：与 event_id 一起进部分唯一索引（见 migrate.ts 的 events_event_id_uniq）。
  // 只在这里算，保证「预筛看到的窗口」和「索引看到的事件日」是同一个数。
  const eventDay = eventId && payload.siteId ? Math.floor(created / EVENT_DAY_MS) : null;

  if (eventId && payload.siteId && eventDay !== null) {
    // 双方言通用的老路子（见 settings.ts:117）：LIKE 预筛 + 应用层解析。
    // 预筛条件把候选集压到「同一站点、同一个日桶内的同类事件」，`events_site_idx` 能吃上；
    // eventId 已过字符集白名单，不会把 `%`/`_` 带进 LIKE 模式。
    let duplicate = false;
    try {
      const rows = await repo.raw(
        "SELECT meta FROM events WHERE kind = ? AND site_id = ? AND created_at >= ? AND created_at < ? AND meta LIKE ? ORDER BY id DESC LIMIT 20",
        [kind, payload.siteId, eventDay * EVENT_DAY_MS, (eventDay + 1) * EVENT_DAY_MS, `%"eventId":"${eventId}"%`],
      );
      for (const row of rows) {
        const raw = row.meta;
        const parsed = typeof raw === "string" && raw
          ? (() => { try { return JSON.parse(raw) as unknown; } catch { return undefined; } })()
          : raw;
        if (parsed && typeof parsed === "object" && (parsed as { eventId?: unknown }).eventId === eventId) {
          duplicate = true;
          break;
        }
      }
    } catch (err) {
      // 读失败 ⇒ 放行插入（与「遥测不阻断主操作」的全仓容错语义一致）：
      // 宁可漏一次去重，也不要因为一次查询异常把整条证据链关掉。
      console.error("[navhub] 事件幂等预筛失败，按首次插入处理:", err);
    }
    if (duplicate) return false;
  }

  try {
    await repo.run(
      "INSERT INTO events (kind, site_id, query, category_id, meta, identity, created_at, event_id, event_day) VALUES (?,?,?,?,?,?,?,?,?)",
      [kind, payload.siteId ?? null, payload.query ?? null, payload.categoryId ?? null,
       meta === undefined ? null : JSON.stringify(meta), identity, created, eventId ?? null, eventDay],
    );
  } catch (err) {
    // 预筛是快速路径，这里是兜底：并发重放（两个请求同时读到「无重复」）或预筛异常放行后，
    // 唯一索引让第二条插入失败。把它翻译成「幂等命中」，其余错误照旧抛给调用方。
    if (eventId && isUniqueViolation(err)) return false;
    throw err;
  }
  return true;
}

/**
 * 唯一约束冲突的跨方言识别。
 *
 * SQLite（better-sqlite3）给 `SQLITE_CONSTRAINT_UNIQUE`（表达式/主键冲突会是
 * `SQLITE_CONSTRAINT_PRIMARYKEY`），PG 给 SQLSTATE `23505`；libsql 只带文本。
 * 其余错误必须原样抛出——把「表不存在」也当成重复，会静默吞掉整条证据链。
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = String((err as { code?: unknown }).code ?? "");
  if (code === "23505" || code === "SQLITE_CONSTRAINT_UNIQUE") return true;
  // better-sqlite3 在某些构建上只给通用码 + 文本；PG 的驱动也可能只带 message。
  const message = String((err as { message?: unknown }).message ?? "");
  return code === "SQLITE_CONSTRAINT" && /UNIQUE constraint failed/i.test(message);
}

export async function audit(repo: Repository, entry: { actor: string; actorKind?: string; action: string; target?: string; diff?: unknown; ip?: string }): Promise<void> {
  try {
    await repo.run(
      "INSERT INTO audit_logs (actor, actor_kind, action, target, diff, ip, created_at) VALUES (?,?,?,?,?,?,?)",
      [entry.actor, entry.actorKind ?? "user", entry.action, entry.target ?? null,
       entry.diff === undefined ? null : JSON.stringify(entry.diff), entry.ip ?? null, Date.now()],
    );
  } catch (err) {
    console.error("[navhub] 审计写入失败（主操作结果不受影响）:", err);
  }
}

/**
 * 按身份的访问历史（T23）：events kind=click 就是按身份的站点浏览流水，
 * 此前只有画像摘要（visitedSiteIds 50 个）在消费它——数据已在采集，
 * 这里把它作为用户自己的数据暴露出来（数据主权：看得到才谈得上清理）。
 */
export interface VisitItem {
  id: number;
  siteId: string;
  at: number;
}

export async function listVisitsPage(
  repo: Repository,
  identity: string,
  limit: number,
  offset: number,
): Promise<{ items: VisitItem[]; hasMore: boolean }> {
  const capped = Math.min(Math.max(limit, 1), 50);
  const rows = await repo.raw(
    "SELECT id, site_id, created_at FROM events WHERE identity = ? AND kind = 'click' AND site_id IS NOT NULL ORDER BY id DESC LIMIT ? OFFSET ?",
    [identity, capped + 1, Math.max(0, offset)],
  );
  const hasMore = rows.length > capped;
  const items = (hasMore ? rows.slice(0, capped) : rows).map((r) => ({
    id: Number(r.id ?? 0),
    siteId: String(r.site_id),
    at: Number(r.created_at ?? 0),
  }));
  return { items, hasMore };
}

export async function countVisits(repo: Repository, identity: string): Promise<number> {
  const row = (
    await repo.raw("SELECT COUNT(*) AS c FROM events WHERE identity = ? AND kind = 'click' AND site_id IS NOT NULL", [identity])
  )[0];
  return Number(row?.c ?? 0);
}

export async function listAuditLogs(repo: Repository, filter: {
    limit?: number;
    offset?: number;
    action?: string;
    actor?: string;
  } = {}): Promise<{ items: AuditLogRecord[]; hasMore: boolean }> {
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (filter.action) { wheres.push("action = ?"); params.push(filter.action); }
  if (filter.actor) { wheres.push("actor = ?"); params.push(filter.actor); }
  const where = wheres.length ? " WHERE " + wheres.join(" AND ") : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(0, filter.offset ?? 0);
  params.push(limit + 1, offset);
  const rows = await repo.raw(
    `SELECT * FROM audit_logs${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    params,
  );
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { items: page.map(rowToAuditLog), hasMore };
}

export async function listAuditActions(repo: Repository, limit = 50): Promise<string[]> {
  const rows = await repo.raw(
    "SELECT action, MAX(id) AS newest FROM audit_logs GROUP BY action ORDER BY newest DESC LIMIT ?",
    [limit],
  );
  return rows.map((r) => String(r.action));
}

/** copilot 事件读取窗口最多回溯的行数：管理端要的是比率，不是全表扫描 */
export const COPILOT_EVENT_READ_CAP = 5000;

/**
 * 「放弃前等待时长」分位数取样上限：只从 copilot_cancel 的 waited_ms 里取，
 * 与 COPILOT_EVENT_READ_CAP 分开，避免把整窗口的行数当成样本量。
 */
const WAIT_SAMPLE_CAP = 1000;

export interface CopilotEventSummary {
  windowDays: number;
  scanned: number;
  truncated: boolean;
  asks: number;
  cancels: number;
  /** cancels / (asks + cancels)，保留 3 位小数；无样本时为 null */
  cancelRate: number | null;
  /** 停止键落在调模型之前还是之后——pre_llm 多说明用户等不到首字 */
  cancelStage: { pre_llm: number; llm: number };
  /** 放弃前等待时长（ms），来自 copilot_cancel 的 waited_ms */
  waitMs: { p50: number | null; p95: number | null; max: number | null };
  /** 兜底应答占比（meta.degraded 非空即未经大模型） */
  degraded: number;
  degradedBy: Array<{ reason: string; count: number }>;
  quotaLimited: number;
  thinkingBy: Array<{ thinking: string; count: number }>;
  /** 本窗口 copilot 回答里「参考来源」的总条数（分母） */
  citations: number;
  /** 来源为 copilot_citation 的 click 事件数（分子） */
  citationClicks: number;
  /** citationClicks / citations，保留 3 位小数；无引用样本时为 null */
  citationClickRate: number | null;
}

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function tallyTop(counter: Map<string, number>, limit: number): Array<{ key: string; count: number }> {
  return [...counter.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

/**
 * copilot 遥测的读取侧：把 events 里 kind=copilot / copilot_cancel 的两行
 * 折成管理端能直接展示的比率。meta 是 JSON 文本，跨方言（SQLite / PostgreSQL）
 * 不做 JSON 抽取，统一取回后在内存里解析——读取窗口本身已按 COPILOT_EVENT_READ_CAP 封顶。
 */
export async function copilotEventSummary(
  repo: Repository,
  days: number,
): Promise<CopilotEventSummary> {
  const windowDays = Math.min(Math.max(Math.round(days) || 1, 1), 90);
  const since = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const rows = await repo.raw(
    "SELECT kind, meta FROM events WHERE kind IN ('copilot', 'copilot_cancel') AND created_at >= ? ORDER BY id DESC LIMIT ?",
    [since, COPILOT_EVENT_READ_CAP + 1],
  );
  const truncated = rows.length > COPILOT_EVENT_READ_CAP;
  const scanned = truncated ? rows.slice(0, COPILOT_EVENT_READ_CAP) : rows;

  let asks = 0;
  let cancels = 0;
  const cancelStage = { pre_llm: 0, llm: 0 };
  let degraded = 0;
  let quotaLimited = 0;
  let citations = 0;
  const degradedBy = new Map<string, number>();
  const thinkingBy = new Map<string, number>();
  const waits: number[] = [];

  for (const row of scanned) {
    const kind = String(row.kind ?? "");
    let meta: Record<string, unknown> = {};
    const rawMeta = row.meta;
    if (typeof rawMeta === "string" && rawMeta) {
      try {
        const parsed = JSON.parse(rawMeta);
        if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
      } catch {
        // 历史脏行：解析失败只说明这一行没有维度，不该让整块面板 500
      }
    } else if (rawMeta && typeof rawMeta === "object") {
      meta = rawMeta as Record<string, unknown>;
    }

    const thinking = meta.thinking == null ? "unknown" : String(meta.thinking);
    thinkingBy.set(thinking, (thinkingBy.get(thinking) ?? 0) + 1);
    if (meta.quota_limited === true) quotaLimited += 1;

    if (kind === "copilot_cancel") {
      cancels += 1;
      const stage = String(meta.stage ?? "");
      if (stage === "pre_llm" || stage === "llm") cancelStage[stage] += 1;
      const waited = Number(meta.waited_ms);
      if (Number.isFinite(waited) && waited >= 0) waits.push(waited);
      continue;
    }

    asks += 1;
    const cited = Number(meta.citations);
    if (Number.isFinite(cited) && cited > 0) citations += cited;
    const reason = meta.degraded;
    if (reason != null && reason !== "" && reason !== "null") {
      degraded += 1;
      const key = String(reason);
      degradedBy.set(key, (degradedBy.get(key) ?? 0) + 1);
    }
  }

  /**
   * 引用点击（分子）：kind=click 且 meta.source=copilot_citation。
   * 与上面同一条「取回内存解析」的路子：like 只是把窗口内的点击先缩到候选集，
   * 真正的判定在解析后的 source 字段上（meta 里出现这个子串的脏行不会被误计）。
   */
  const clickRows = await repo.raw(
    "SELECT meta FROM events WHERE kind = 'click' AND created_at >= ? AND meta LIKE ? ORDER BY id DESC LIMIT ?",
    [since, "%copilot_citation%", COPILOT_EVENT_READ_CAP],
  );
  let citationClicks = 0;
  for (const row of clickRows) {
    const rawMeta = row.meta;
    if (typeof rawMeta !== "string" || !rawMeta) continue;
    try {
      const parsed = JSON.parse(rawMeta);
      if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).source === "copilot_citation") {
        citationClicks += 1;
      }
    } catch {
      // 脏行跳过：读数宁少不假
    }
  }

  const total = asks + cancels;
  waits.sort((a, b) => a - b);
  const waitSample = waits.slice(0, WAIT_SAMPLE_CAP);

  return {
    windowDays,
    scanned: scanned.length,
    truncated,
    asks,
    cancels,
    cancelRate: total > 0 ? Math.round((cancels / total) * 1000) / 1000 : null,
    cancelStage,
    waitMs: {
      p50: percentile(waitSample, 0.5),
      p95: percentile(waitSample, 0.95),
      max: waitSample.length ? (waitSample[waitSample.length - 1] ?? null) : null,
    },
    degraded,
    degradedBy: tallyTop(degradedBy, 8).map(({ key, count }) => ({ reason: key, count })),
    quotaLimited,
    thinkingBy: tallyTop(thinkingBy, 5).map(({ key, count }) => ({ thinking: key, count })),
    citations,
    citationClicks,
    citationClickRate: citations > 0 ? Math.round((citationClicks / citations) * 1000) / 1000 : null,
  };
}
