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
  const row = (
    await repo.raw(
      "SELECT id FROM notifications WHERE identity = ? AND kind = ? AND created_at >= ? LIMIT 1",
      [identity, kind, Date.now() - withinMs],
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
