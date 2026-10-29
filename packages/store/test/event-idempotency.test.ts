/**
 * 事件幂等键与客户端时间（run100）。
 *
 * 钉的真实缺陷：端侧「点击出箱」会在回到线上后**重放**同一条证据。
 * 没有幂等键时，重放会走两次 `bumpVisit`——`sites.visit_count` 是排序的次键，
 * 而本机实测 99.8% 的站点该列为 0（查询日 2026-10-29），
 * 重复 +1 会被极小分母放大成错误排名。所以去重判定必须落在**插入之前**，
 * 并把布尔结果透给调用方，让路由知道「这次没新增行，副作用一次都别做」。
 *
 * 三层断言：
 *   ① 同 (kind, siteId, eventId) 在窗口内只落一行，第二次返回 false；
 *   ② 没有键的旧客户端逐条都记（不能把「没带键」误当「重复」）；
 *   ③ clientCreatedAt 是「事件什么时候发生」，不是「服务器什么时候收到」，
 *      但只在接受范围内生效——时钟没电的机器不能把事件写进 2001 年。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { EVENT_ID_RE, isUniqueViolation } from "../src/repository/events.ts";

const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let db: Db;
let repo: Repository;
let siteId = "";
let otherSiteId = "";

async function countEvents(kind: string, site: string): Promise<number> {
  const rows = (await repo.raw(
    "SELECT COUNT(*) AS c FROM events WHERE kind = ? AND site_id = ?",
    [kind, site],
  )) as Array<{ c: number }>;
  return Number(rows[0]?.c ?? 0);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-event-idem-"));
  db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "ev.db") });
  repo = new Repository(db);
  const cat = await repo.createCategory({ title: "幂等测试" });
  siteId = (await repo.createSite({ url: "https://idem-a.example.com", title: "幂等 A", categoryId: cat.id })).id;
  otherSiteId = (await repo.createSite({ url: "https://idem-b.example.com", title: "幂等 B", categoryId: cat.id })).id;
});

afterAll(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("recordEvent 的幂等键", () => {
  it("同 kind+siteId+eventId 第二次返回 false 且不落第二行", async () => {
    const eventId = "replay-1";
    await expect(repo.recordEvent("click", { siteId, eventId })).resolves.toBe(true);
    await expect(repo.recordEvent("click", { siteId, eventId })).resolves.toBe(false);
    expect(await countEvents("click", siteId)).toBe(1);
  });

  it("不同 eventId 各记一行（同站连点三次就是三条证据）", async () => {
    await expect(repo.recordEvent("click", { siteId, eventId: "multi-1" })).resolves.toBe(true);
    await expect(repo.recordEvent("click", { siteId, eventId: "multi-2" })).resolves.toBe(true);
    expect(await countEvents("click", siteId)).toBe(3);
  });

  it("不传 eventId 时逐条都记（旧客户端不能被当成重放丢掉）", async () => {
    const before = await countEvents("click", otherSiteId);
    await expect(repo.recordEvent("click", { siteId: otherSiteId })).resolves.toBe(true);
    await expect(repo.recordEvent("click", { siteId: otherSiteId })).resolves.toBe(true);
    expect(await countEvents("click", otherSiteId)).toBe(before + 2);
  });

  it("同 eventId 但不同站点/不同 kind 不去重（键只在同一动作语义内可比）", async () => {
    const eventId = "shared-key";
    await expect(repo.recordEvent("click", { siteId, eventId })).resolves.toBe(true);
    await expect(repo.recordEvent("favorite", { siteId, eventId })).resolves.toBe(true);
  });

  it("幂等键写进 meta，事后能从事件行反查是哪一次动作的重复投递", async () => {
    const eventId = "traceable-1";
    await repo.recordEvent("click", { siteId, eventId, meta: { position: 3 } });
    const rows = (await repo.raw(
      "SELECT meta FROM events WHERE kind = 'click' AND site_id = ? AND meta LIKE ? ORDER BY id DESC LIMIT 1",
      [siteId, `%"eventId":"${eventId}"%`],
    )) as Array<{ meta: string }>;
    const meta = JSON.parse(rows[0]!.meta) as Record<string, unknown>;
    expect(meta.eventId).toBe(eventId);
    expect(meta.position).toBe(3);
  });

  it("非法形态的键按「没有键」处理：既不进 LIKE 模式，也不落进 meta", async () => {
    const bogus = 'x" OR 1=1 --%';
    await expect(repo.recordEvent("click", { siteId, eventId: bogus })).resolves.toBe(true);
    await expect(repo.recordEvent("click", { siteId, eventId: bogus })).resolves.toBe(true);
    const rows = (await repo.raw(
      "SELECT meta FROM events WHERE kind = 'click' AND site_id = ? AND meta LIKE '%eventId%'",
      [siteId],
    )) as Array<{ meta: string }>;
    for (const row of rows) expect(JSON.parse(row.meta).eventId).not.toBe(bogus);
  });

  it("超出日桶的同键事件不再算重复（40 天后的同键是一次新动作）", async () => {
    const eventId = "old-window";
    const longAgo = Date.now() - 40 * DAY;
    await repo.recordEvent("click", { siteId, eventId, clientCreatedAt: longAgo });
    await expect(repo.recordEvent("click", { siteId, eventId })).resolves.toBe(true);
  });

  it("跨天复用同一个键是新动作，同一天内重放仍然算重复（日桶边界）", async () => {
    // 键会过期是刻意的：永久唯一会让「客户端固定复用一个键」的 bug 把该站点的
    // 点击永远静默丢掉；有界键把破坏半径压到一天。
    const eventId = "daily-key";
    const now = Date.now();
    await expect(repo.recordEvent("click", { siteId, eventId, clientCreatedAt: now })).resolves.toBe(true);
    await expect(repo.recordEvent("click", { siteId, eventId, clientCreatedAt: now - DAY })).resolves.toBe(true);
    await expect(repo.recordEvent("click", { siteId, eventId, clientCreatedAt: now })).resolves.toBe(false);
  });

  it("幂等键物化到 event_id / event_day 两列（索引与预筛共用同一个日桶）", async () => {
    const stamp = Date.now();
    await repo.recordEvent("click", { siteId, eventId: "materialized-1", clientCreatedAt: stamp });
    const rows = (await repo.raw(
      "SELECT event_id, event_day FROM events WHERE kind = 'click' AND site_id = ? AND event_id = ?",
      [siteId, "materialized-1"],
    )) as Array<{ event_id: string; event_day: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_id).toBe("materialized-1");
    expect(Number(rows[0]!.event_day)).toBe(Math.floor(Math.floor(stamp) / DAY));
  });

  it("预筛失效（读异常）时唯一索引兜底：仍只落一行，第二次返回 false", async () => {
    // 并发重放的真实形态：两个请求同时读到「无重复」。预筛是快速路径，
    // 兜底必须落在数据库约束上——否则「点一次、计数两次」只取决于时序。
    const before = await countEvents("click", otherSiteId);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rawSpy = vi.spyOn(repo, "raw").mockRejectedValue(new Error("prefilter down"));
    try {
      await expect(repo.recordEvent("click", { siteId: otherSiteId, eventId: "race-1" })).resolves.toBe(true);
      await expect(repo.recordEvent("click", { siteId: otherSiteId, eventId: "race-1" })).resolves.toBe(false);
    } finally {
      rawSpy.mockRestore();
      errSpy.mockRestore();
    }
    expect(await countEvents("click", otherSiteId)).toBe(before + 1);
  });
});

describe("recordEvent 的客户端时间", () => {
  it("窗口内的 clientCreatedAt 原样落库（重放保住真实点击时刻）", async () => {
    const stamp = Date.now() - 6 * DAY;
    await repo.recordEvent("click", { siteId: otherSiteId, eventId: "client-ts", clientCreatedAt: stamp });
    const rows = (await repo.raw(
      "SELECT created_at FROM events WHERE kind = 'click' AND site_id = ? AND meta LIKE ?",
      [otherSiteId, '%"eventId":"client-ts"%'],
    )) as Array<{ created_at: number }>;
    expect(Number(rows[0]!.created_at)).toBe(Math.floor(stamp));
  });

  it("窗口外的时间退回服务端 now（时钟没电的机器不能把事件写进历史里）", async () => {
    const ancient = Date.now() - 400 * DAY;
    const future = Date.now() + 60 * 60 * 1000;
    await repo.recordEvent("click", { siteId: otherSiteId, eventId: "clock-broken-1", clientCreatedAt: ancient });
    await repo.recordEvent("click", { siteId: otherSiteId, eventId: "clock-broken-2", clientCreatedAt: future });
    const rows = (await repo.raw(
      "SELECT created_at FROM events WHERE kind = 'click' AND site_id = ? AND (meta LIKE ? OR meta LIKE ?)",
      [otherSiteId, '%"eventId":"clock-broken-1"%', '%"eventId":"clock-broken-2"%'],
    )) as Array<{ created_at: number }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const at = Number(row.created_at);
      expect(at).toBeGreaterThan(Date.now() - 5 * 60 * 1000);
      expect(at).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
    }
  });
});

describe("EVENT_ID_RE", () => {
  it("只放行有界的字母数字键（它会被拼进 LIKE 模式）", () => {
    expect(EVENT_ID_RE.test("abc-123_XYZ")).toBe(true);
    expect(EVENT_ID_RE.test("x".repeat(64))).toBe(true);
    expect(EVENT_ID_RE.test("x".repeat(65))).toBe(false);
    expect(EVENT_ID_RE.test("")).toBe(false);
    expect(EVENT_ID_RE.test('a" OR 1=1')).toBe(false);
    expect(EVENT_ID_RE.test("a%b")).toBe(false);
  });
});

describe("isUniqueViolation", () => {
  it("只把「唯一约束冲突」当成幂等命中，别的错误必须照旧抛", () => {
    expect(isUniqueViolation({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(true);
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT_UNIQUE", message: "UNIQUE constraint failed" })).toBe(true);
    // libsql / 某些构建只给通用码 + 文本
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT", message: "UNIQUE constraint failed: events.kind" })).toBe(true);
    // 主键冲突是真 bug（id 撞车），不能被翻译成「重复投递」
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT_PRIMARYKEY", message: "PRIMARY KEY must be unique" })).toBe(false);
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT", message: "NOT NULL constraint failed: events.kind" })).toBe(false);
    expect(isUniqueViolation({ code: "SQLITE_ERROR", message: "no such table: events" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("UNIQUE constraint failed")).toBe(false);
  });
});
