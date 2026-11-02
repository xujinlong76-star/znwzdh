import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import type { NotificationEmailSender } from "../src/repository/notifications.ts";

/**
 * 通知 email 渠道投递回归。
 *
 * 此前 email 行入队即 `deferred` 且 `relayNotifications` 只投递 inapp，
 * email/push 永远不投递（静默失败）。本测试锁定：注入 emailSender 后，
 * email 行被真实发送、outbox 状态置为 delivered；发送失败则退避重试。
 */
describe("通知 email 渠道投递", () => {
  let db: Db;
  let repo: Repository;
  const sent: Array<{ to: string; subject: string }> = [];

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  async function seedUser(email: string) {
    const result = await repo.createUserWithPassword({
      username: email.split("@")[0],
      email,
      password: "S3cret-Passw0rd!",
    });
    if (!result.ok) throw new Error("seed user failed");
    return result.user.id;
  }

  it("注入 emailSender 后 email 行被真实发送并标记 delivered", async () => {
    const userId = await seedUser("notify@example.com");
    await repo.emitNotification({
      identity: userId,
      idempotencyKey: "sync-failed-1",
      kind: "sync_failed",
      title: "同步失败提醒",
      body: "你的收藏同步失败了",
      channels: ["email"],
    });

    sent.length = 0;
    const sender: NotificationEmailSender = {
      send: async (input) => {
        sent.push({ to: input.to, subject: input.subject });
        return { ok: true };
      },
    };
    const result = await repo.relayNotifications(50, sender);
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);
    expect(sent[0].to).toBe("notify@example.com");
    expect(sent[0].subject).toBe("同步失败提醒");

    const row = (
      await repo.raw("SELECT status, delivered_at FROM notification_outbox WHERE channel = 'email' LIMIT 1")
    )[0];
    expect(String(row.status)).toBe("delivered");
    expect(row.delivered_at).not.toBeNull();
  });

  it("email 发送失败时退避重试，不误标 delivered", async () => {
    const userId = await seedUser("notify2@example.com");
    await repo.emitNotification({
      identity: userId,
      idempotencyKey: "sync-failed-2",
      kind: "sync_failed",
      title: "同步失败提醒",
      body: "body",
      channels: ["email"],
    });

    const failing: NotificationEmailSender = {
      send: async () => ({ ok: false, error: "SMTP 投递失败" }),
    };
    const result = await repo.relayNotifications(50, failing);
    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(1);

    const row = (
      await repo.raw("SELECT status, attempts FROM notification_outbox WHERE channel = 'email' AND identity = ? LIMIT 1", [userId])
    )[0];
    expect(String(row.status)).toBe("deferred");
    expect(Number(row.attempts)).toBe(1);
  });

  it("未注入 emailSender 时 email 行保持 deferred（不误投递）", async () => {
    const userId = await seedUser("notify3@example.com");
    await repo.emitNotification({
      identity: userId,
      idempotencyKey: "sync-failed-3",
      kind: "sync_failed",
      title: "t",
      body: "b",
      channels: ["email"],
    });
    const result = await repo.relayNotifications(50);
    expect(result.delivered).toBe(0);
    const row = (
      await repo.raw("SELECT status FROM notification_outbox WHERE channel = 'email' AND identity = ? LIMIT 1", [userId])
    )[0];
    expect(String(row.status)).toBe("deferred");
  });
});
