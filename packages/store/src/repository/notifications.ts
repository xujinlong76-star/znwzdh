import { createHash } from "node:crypto";
import type { Repository } from "../repository.ts";

/**
 * 站内通知（T13）：轻量的用户消息。触发源克制（同步失败 / 备份超期），
 * 写入端负责自己的降噪（hasRecentNotification 去重窗口）。
 */
export interface NotificationRecord {
  id: string;
  identity: string;
  kind: string;
  title: string;
  body: string | null;
  readAt: number | null;
  createdAt: number;
}

export type NotificationChannel = "inapp" | "email" | "push";
export type NotificationDeliveryStatus = "pending" | "delivered" | "deferred" | "failed";

export interface EmitNotificationInput {
  identity: string;
  idempotencyKey: string;
  kind: string;
  title: string;
  body?: string | null;
  channels?: NotificationChannel[];
}

/** 管理员状态摘要：不暴露 title/body、幂等键或外部配置。 */
export interface NotificationDeliverySummary {
  id: string;
  identity: string;
  channel: NotificationChannel;
  kind: string;
  status: NotificationDeliveryStatus;
  /** 已记录的失败次数；成功投递不递增。 */
  attempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  createdAt: number;
  deliveredAt: number | null;
}

export interface ListNotificationDeliveriesOptions {
  status?: NotificationDeliveryStatus;
  limit?: number;
  offset?: number;
}

export interface RelayNotificationsResult {
  delivered: number;
  /** 本轮已记录的失败尝试数（含待重试及耗尽三次的失败）。 */
  failed: number;
}

const DELIVERY_STATUSES: NotificationDeliveryStatus[] = ["pending", "delivered", "deferred", "failed"];
const CHANNEL_ERRORS = {
  email: "Email sender is not configured",
  push: "Push sender is not configured",
} as const;
const DELIVERY_ERROR = "In-app notification delivery failed";
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 60_000;

function deliveryLimit(limit: number | undefined): number {
  return limit == null || !Number.isFinite(limit) ? 50 : Math.min(100, Math.max(1, Math.trunc(limit)));
}

/**
 * 仅入队，与调用方的业务事务共同提交/回滚。调用方不得在 title/body 中放入 secrets。
 * 相同 identity/key/channel 首次写入胜出；返回包含已存在行在内的确定性 ids。
 */
export async function emitNotification(
  repo: Repository,
  input: EmitNotificationInput,
): Promise<{ ids: string[] }> {
  if (!input.identity?.trim() || !input.idempotencyKey?.trim()) {
    throw new Error("Notification identity and idempotencyKey are required");
  }
  const channels = [...new Set<NotificationChannel>(input.channels ?? ["inapp"])];
  if (channels.some((channel) => channel !== "inapp" && channel !== "email" && channel !== "push")) {
    throw new Error("Unsupported notification channel");
  }
  return repo.withTransaction(async () => {
    const now = Date.now();
    const ids: string[] = [];
    for (const channel of channels) {
      // 元组编码避免简单拼接造成 identity/key 边界碰撞；幂等键本身不落库。
      const id = createHash("sha256")
        .update(JSON.stringify([input.identity, input.idempotencyKey, channel]))
        .digest("hex");
      const inapp = channel === "inapp";
      await repo.run(
        "INSERT INTO notification_outbox " +
          "(id, identity, channel, kind, title, body, status, attempts, next_attempt_at, last_error, created_at, delivered_at) " +
          "VALUES (?,?,?,?,?,?,?,0,?,?,?,NULL) ON CONFLICT(id) DO NOTHING",
        [id, input.identity, channel, input.kind, input.title, input.body ?? null,
          inapp ? "pending" : "deferred", inapp ? now : null,
          inapp ? null : CHANNEL_ERRORS[channel], now],
      );
      ids.push(id);
    }
    return { ids };
  });
}

/**
 * JobRunner 顶层调用（不得包在业务事务内）；每条独立领取、投递、提交，不做外部 I/O。
 * 失败事务先完全回滚，再另开事务记录退避；原始异常可能含参数/凭据，故仅存固定错误。
 */
export async function relayNotifications(repo: Repository, limit = 50): Promise<RelayNotificationsResult> {
  const capped = deliveryLimit(limit);
  const cutoff = Date.now();
  const seen: string[] = [];
  const result: RelayNotificationsResult = { delivered: 0, failed: 0 };
  const lock = repo.db.dialect === "pg" ? " FOR UPDATE SKIP LOCKED" : "";

  for (let index = 0; index < capped; index++) {
    let claimed: { id: string; attempts: number; nextAttemptAt: number } | undefined;
    try {
      const id = await repo.withTransaction(async () => {
        // SQLite 的事务层可能重试 BUSY；每次重新领取，不能沿用上次的 claimed。
        claimed = undefined;
        const exclusion = seen.length ? ` AND id NOT IN (${seen.map(() => "?").join(",")})` : "";
        const row = (await repo.raw(
          "SELECT id, identity, kind, title, body, attempts, next_attempt_at, created_at FROM notification_outbox " +
            "WHERE status = 'pending' AND channel = 'inapp' AND attempts < ? AND next_attempt_at <= ?" +
            exclusion + " ORDER BY next_attempt_at, created_at, id LIMIT 1" + lock,
          [MAX_ATTEMPTS, cutoff, ...seen],
        ))[0];
        if (!row) return null;
        claimed = { id: String(row.id), attempts: Number(row.attempts), nextAttemptAt: Number(row.next_attempt_at) };
        try {
          await repo.run(
            "INSERT INTO notifications (id, identity, kind, title, body, read_at, created_at) " +
              "VALUES (?,?,?,?,?,NULL,?) ON CONFLICT(id) DO NOTHING",
            [claimed.id, row.identity, row.kind, row.title, row.body, Number(row.created_at)],
          );
          await repo.run(
            "UPDATE notification_outbox SET status = 'delivered', delivered_at = ?, next_attempt_at = NULL, " +
              "last_error = NULL WHERE id = ?",
            [Date.now(), claimed.id],
          );
        } catch {
          // 不在 PG aborted transaction 内执行恢复 SQL，也不让 SQLite 的 BUSY 自动重试
          // 将同一投递失败行在一轮内重复消费。异常原文不向状态列表泄露。
          throw new Error(DELIVERY_ERROR);
        }
        return claimed.id;
      });
      if (id === null) break;
      seen.push(id);
      result.delivered++;
    } catch (error) {
      // 领取/连接失败不归罪于某条通知；交由 JobRunner 处理基础设施故障。
      if (!claimed) throw error;
      seen.push(claimed.id);
      const attempts = claimed.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      const changed = await repo.withTransaction(() => repo.runCount(
        "UPDATE notification_outbox SET attempts = ?, status = ?, next_attempt_at = ?, last_error = ? " +
          "WHERE id = ? AND status = 'pending' AND attempts = ? AND next_attempt_at = ?",
        [attempts, exhausted ? "failed" : "pending",
          exhausted ? null : Date.now() + RETRY_DELAY_MS * 2 ** (attempts - 1), DELIVERY_ERROR,
          claimed!.id, claimed!.attempts, claimed!.nextAttemptAt],
      ));
      // 回滚释放锁后别的实例可能已投递/记录失败；CAS 不得覆盖其结果或双计数。
      result.failed += changed;
    }
  }
  return result;
}

/** 仅供管理员调用；鉴权由调用层负责，仓储不读取外部发送器配置。 */
export async function listNotificationDeliveries(
  repo: Repository,
  options: ListNotificationDeliveriesOptions = {},
): Promise<{ items: NotificationDeliverySummary[]; hasMore: boolean }> {
  if (options.status !== undefined && !DELIVERY_STATUSES.includes(options.status)) {
    throw new Error("Unsupported notification delivery status");
  }
  const limit = deliveryLimit(options.limit);
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.trunc(options.offset!)) : 0;
  const rows = await repo.raw(
    "SELECT id, identity, channel, kind, status, attempts, next_attempt_at, last_error, created_at, delivered_at " +
      "FROM notification_outbox" + (options.status === undefined ? "" : " WHERE status = ?") +
      " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    [...(options.status === undefined ? [] : [options.status]), limit + 1, offset],
  );
  return {
    hasMore: rows.length > limit,
    items: rows.slice(0, limit).map((row) => ({
      id: String(row.id),
      identity: String(row.identity),
      channel: row.channel as NotificationChannel,
      kind: String(row.kind),
      status: row.status as NotificationDeliveryStatus,
      attempts: Number(row.attempts),
      nextAttemptAt: row.next_attempt_at == null ? null : Number(row.next_attempt_at),
      lastError: row.last_error == null ? null : String(row.last_error),
      createdAt: Number(row.created_at),
      deliveredAt: row.delivered_at == null ? null : Number(row.delivered_at),
    })),
  };
}

export async function createNotification(
  repo: Repository,
  input: { identity: string; kind: string; title: string; body?: string | null },
): Promise<NotificationRecord> {
  const id = globalThis.crypto?.randomUUID?.() ?? `ntf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = Date.now();
  await repo.run(
    "INSERT INTO notifications (id, identity, kind, title, body, read_at, created_at) VALUES (?,?,?,?,?,NULL,?)",
    [id, input.identity, input.kind, input.title, input.body ?? null, now],
  );
  return { id, identity: input.identity, kind: input.kind, title: input.title, body: input.body ?? null, readAt: null, createdAt: now };
}

/** 去重窗口：同身份同 kind 在 withinMs 内已有过通知 → true（触发源据此跳过） */
export async function hasRecentNotification(
  repo: Repository,
  identity: string,
  kind: string,
  withinMs: number,
): Promise<boolean> {
  // outbox 也要看：已 emit、尚未 relay 的提醒同样算「提醒过」。
  // 只看 notifications 会在投递延迟跨过时间桶时重复打扰（emit 幂等键按桶生成，
  // 跨桶后旧键失效，去重窗口必须由这里兜住）。
  const cutoff = Date.now() - withinMs;
  const row = (
    await repo.raw(
      "SELECT id FROM notifications WHERE identity = ? AND kind = ? AND created_at >= ? " +
        "UNION ALL " +
        "SELECT id FROM notification_outbox WHERE identity = ? AND kind = ? AND created_at >= ? LIMIT 1",
      [identity, kind, cutoff, identity, kind, cutoff],
    )
  )[0];
  return Boolean(row);
}

export async function listNotificationsPage(
  repo: Repository,
  identity: string,
  limit: number,
  offset: number,
  unreadOnly: boolean,
): Promise<{ items: NotificationRecord[]; hasMore: boolean }> {
  const capped = Math.min(Math.max(limit, 1), 50);
  const where = unreadOnly ? " WHERE identity = ? AND read_at IS NULL" : " WHERE identity = ?";
  const rows = await repo.raw(
    "SELECT id, identity, kind, title, body, read_at, created_at FROM notifications" +
      where +
      " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
    [identity, capped + 1, Math.max(0, offset)],
  );
  const hasMore = rows.length > capped;
  const items = (hasMore ? rows.slice(0, capped) : rows).map((r) => ({
    id: String(r.id),
    identity: String(r.identity),
    kind: String(r.kind),
    title: String(r.title),
    body: r.body == null ? null : String(r.body),
    readAt: r.read_at == null ? null : Number(r.read_at),
    createdAt: Number(r.created_at ?? 0),
  }));
  return { items, hasMore };
}

export async function countUnreadNotifications(repo: Repository, identity: string): Promise<number> {
  const row = (
    await repo.raw("SELECT COUNT(*) AS c FROM notifications WHERE identity = ? AND read_at IS NULL", [identity])
  )[0];
  return Number(row?.c ?? 0);
}

export async function markNotificationRead(repo: Repository, identity: string, id: string): Promise<boolean> {
  const changes = await repo.runCount(
    "UPDATE notifications SET read_at = ? WHERE id = ? AND identity = ? AND read_at IS NULL",
    [Date.now(), id, identity],
  );
  return changes > 0;
}

export async function markAllNotificationsRead(repo: Repository, identity: string): Promise<number> {
  return repo.runCount(
    "UPDATE notifications SET read_at = ? WHERE identity = ? AND read_at IS NULL",
    [Date.now(), identity],
  );
}
