import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/**
 * 注销 × 通知投递队列（数据主权）。
 *
 * 背景：`notification_outbox` 是后加的表，最初没有登记进 `data-inventory.ts`，
 * 于是 `deleteUserData` 的通用删除循环根本不认识它 —— 账号注销后，
 * 行里还留着投递身份、上次错误详情（"Email sender is not configured" 之类）。
 * `data-inventory.test.ts` 会红，但它守的是「有没有登记」，
 * 这条用例守的是「登记之后真的删掉了」。
 *
 * 为什么不合并进 notification-outbox.test.ts：那个文件属于另一个改动批次，
 * 这里只关心注销语义，独立成文件后谁改动过 outbox 的写入逻辑都不影响它。
 *
 * **为什么按「表是否存在」决定跑不跑**：这条守卫要能先落地、后生效。
 * 建表语句在 `migrate.ts` 里随通知功能一起提交；如果守卫硬跑，
 * 表还没进 HEAD 时这条用例会以「no such table」失败 —— 那是环境差异，不是回归。
 * 判据用「表存在」而不是「功能开关」：表存在就说明功能已落地，
 * 此时注销必须删净，没有例外可讲。
 */
describe("注销必须清空通知投递队列", () => {
  let db: Db;
  let repo: Repository;
  const identity = "u1:deletion-test";

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  /** 表是否已随迁移落地（未落地时整组跳过，落地后自动生效） */
  async function outboxReady(): Promise<boolean> {
    const rows = await repo.raw(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notification_outbox'",
    );
    return rows.length > 0;
  }

  it("外渠道通知落到 outbox 后，注销会把它删净", async (ctx) => {
    if (!(await outboxReady())) return ctx.skip();
    await repo.emitNotification({
      identity,
      idempotencyKey: "delivery-1",
      kind: "system",
      title: "欢迎",
      body: "内容",
      // inapp 立刻 pending；email 因为没有发送方配置而 deferred ——
      // 后者正是最容易在注销后残留的那一类
      channels: ["inapp", "email"],
    });

    const before = await repo.raw(
      "SELECT channel, status FROM notification_outbox WHERE identity = ?",
      [identity],
    );
    expect(before).toHaveLength(2);
    expect(before.map((r) => String(r.channel)).sort()).toEqual(["email", "inapp"]);
    expect(before.some((r) => String(r.status) === "deferred")).toBe(true);

    await repo.deleteUserData(identity);

    const after = await repo.raw(
      "SELECT id FROM notification_outbox WHERE identity = ?",
      [identity],
    );
    expect(after, "注销后仍有通知队列残留").toEqual([]);
  });

  it("不会误删其它身份的通知", async (ctx) => {
    if (!(await outboxReady())) return ctx.skip();
    const other = "u2:another";
    await repo.emitNotification({
      identity: other,
      idempotencyKey: "delivery-2",
      kind: "system",
      title: "别人的通知",
      channels: ["inapp"],
    });
    await repo.emitNotification({
      identity,
      idempotencyKey: "delivery-3",
      kind: "system",
      title: "待删的身份",
      channels: ["inapp"],
    });

    await repo.deleteUserData(identity);

    const rows = await repo.raw(
      "SELECT identity FROM notification_outbox WHERE identity IN (?, ?)",
      [identity, other],
    );
    expect(rows.map((r) => String(r.identity))).toEqual([other]);
  });
});
