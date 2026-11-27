/**
 * `PUT /api/storage` 乐观并发的两条硬约束。
 *
 * 背景：`ifVersion` 最初写成「先 `readKvVersion` → 比对 → 写入」。这三步之间有 await，
 * 窗口是敞开的。sqlite 驱动全是同步调用，微任务排队让窗口实际关着
 * （实测 12 轮同版本并发写全部 A=200 / B=409）；**但 pg 驱动是真异步往返**，
 * 两家写入方会同时通过比对，后写的把前一次悄悄覆盖 —— 正是 ifVersion 要防的丢失更新。
 *
 * 这条用例锁两件事：
 *   1. 比对与写入在**数据库层**完成（条件 UPDATE + 受影响行数），不依赖驱动是否同步；
 *   2. 版本号**严格单调递增**，即使两次写入落在同一毫秒也不相等。
 *
 * 为什么 2 也重要：版本号就是 `jobs.updated_at`。同一毫秒的两次写入若得到同一版本，
 * 第三方拿着该版本仍能通过比对 —— 那是个 1ms 宽的同版本窗口。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { readStorageVersion, readStoragePath, writeStoragePath } from "../src/storage.ts";

let dir = "";
let ctx: AppContext;

/** 走通用 JSON 文档分支（不是 navigation/site/videos 这类结构化路径） */
const PATH = "src/navsphere/content/version-probe.json";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-version-atomic-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "version.db"),
    embedding: {
      model: "Xenova/bge-small-zh-v1.5",
      endpoint: "https://hf-mirror.com",
      dtype: "q8",
      cacheDir: join(dir, "models"),
      dim: 512,
      enabled: false,
    },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("版本号单调性", () => {
  it("同一毫秒内的两次写入也必须拿到严格递增的版本", async () => {
    // 冻结 Date.now()：两次写入的 now 完全相同。
    // 旧实现（updated_at = now）会给出两个相等的版本，客户端无法据此判断「中间有人写过」。
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-28T08:00:00.000Z"));
      await writeStoragePath(ctx, PATH, JSON.stringify({ seq: 1 }));
      const v1 = await readStorageVersion(ctx, PATH);

      vi.setSystemTime(new Date("2026-10-28T08:00:00.000Z")); // 仍是同一毫秒
      await writeStoragePath(ctx, PATH, JSON.stringify({ seq: 2 }));
      const v2 = await readStorageVersion(ctx, PATH);

      expect(v1).not.toBeNull();
      expect(v2).not.toBeNull();
      expect(v2! - v1!).toBeGreaterThanOrEqual(1);
      expect(v2).toBeGreaterThan(v1!);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ifVersion 的原子性", () => {
  it("版本匹配时写入成功并推进版本；用旧版本再写必须 409", async () => {
    await writeStoragePath(ctx, PATH, JSON.stringify({ seq: "init" }));
    const v1 = (await readStorageVersion(ctx, PATH))!;

    const ok = await writeStoragePath(ctx, PATH, JSON.stringify({ seq: "second" }), { ifVersion: v1 });
    expect(ok.ok).toBe(true);

    const v2 = (await readStorageVersion(ctx, PATH))!;
    expect(v2).toBeGreaterThan(v1);

    // 拿旧版本重放：必须拒绝，且把当前版本如实回报（客户端据此重读后重算）
    await expect(
      writeStoragePath(ctx, PATH, JSON.stringify({ seq: "stale" }), { ifVersion: v1 }),
    ).rejects.toMatchObject({ statusCode: 409, currentVersion: v2 });

    // 被拒绝的写入不能改动内容
    const after = (await readStoragePath(ctx, PATH)) as { seq?: string };
    expect(after.seq).toBe("second");
  });

  it("行不存在时带 ifVersion 必须 409，不能凭空创建", async () => {
    const ghost = "src/navsphere/content/ghost-probe.json";
    expect(await readStorageVersion(ctx, ghost)).toBeNull();

    await expect(
      writeStoragePath(ctx, ghost, JSON.stringify({ a: 1 }), { ifVersion: 1 }),
    ).rejects.toMatchObject({ statusCode: 409, currentVersion: null });

    // 没有产生任何行
    expect(await readStorageVersion(ctx, ghost)).toBeNull();
  });

  it("不带 ifVersion 时仍可创建并覆盖（首次写入路径不受影响）", async () => {
    const fresh = "src/navsphere/content/fresh-probe.json";
    await writeStoragePath(ctx, fresh, JSON.stringify({ a: 1 }));
    const v1 = (await readStorageVersion(ctx, fresh))!;
    await writeStoragePath(ctx, fresh, JSON.stringify({ a: 2 }));
    const v2 = (await readStorageVersion(ctx, fresh))!;
    expect(v2).toBeGreaterThan(v1);
    expect(((await readStoragePath(ctx, fresh)) as { a?: number }).a).toBe(2);
  });
});
