/**
 * 热榜摘要入库（P0-1 步骤 A）：迁移与读写口径的定向回归。
 *
 * 覆盖的完成检查（见 brief-top10-stepA-2026-11-15-1722.md）：
 *  2. 老库启动时补列（旧表无 summary 列 → 启动后出现）；
 *  4. 其余五源刷新后 summary 全为 null；
 *  5. 迁移前已入库的旧行读出 summary: null，不抛错；
 *  6. GET /api/hotlist 与 GET /api/brief/today 的响应字段不变（不下发 summary）；
 *  8. 回滚兼容：带 summary 列的库用旧字段映射仍可读（残留列无害）。
 * 检查 3（知乎摘要逐条入库）由 hotlist-refresh.test.ts「正常路径」用例断言。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { refreshHotlistSource, type HotlistFetch } from "../src/hotlist/refresh.ts";
import { hotlistSourceById } from "../src/hotlist/sources.ts";

const here = dirname(fileURLToPath(import.meta.url));
function fixtureBody(name: string): string {
  return readFileSync(join(here, "fixtures", "hotlist", name), "utf8");
}

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-hotlist-summary-"));
  // 先造一张「迁移前」的旧表：与旧版 DDL 逐字一致，无 summary 列，并写入 2 行旧数据
  const legacy = new DatabaseSync(join(dir, "legacy.db"));
  legacy.exec(`
    CREATE TABLE hotlist_entries (
      source TEXT NOT NULL,
      rank INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      hot_value INTEGER,
      hot_label TEXT,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (source, rank)
    );
  `);
  const insert = legacy.prepare(
    "INSERT INTO hotlist_entries (source, rank, title, url, hot_value, hot_label, fetched_at) VALUES (?,?,?,?,?,?,?)",
  );
  insert.run("zhihu", 1, "旧行标题一", "https://www.zhihu.com/question/111", null, null, 1700000000000);
  insert.run("zhihu", 2, "旧行标题二", "https://www.zhihu.com/question/222", null, null, 1700000000000);
  legacy.close();
  // 再按正常路径打开：openDb 应跑 migrateColumns，把缺的列补上
  ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "legacy.db"), corsOrigins: ["*"] }));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** 密钥用假值，现设现撤，绝不用真实 Secret（async 感知：await 完再恢复） */
async function withFakeSecret<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.NAVHUB_ZHIHU_ACCESS_SECRET;
  process.env.NAVHUB_ZHIHU_ACCESS_SECRET = "test-secret-for-unit-test";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.NAVHUB_ZHIHU_ACCESS_SECRET;
    else process.env.NAVHUB_ZHIHU_ACCESS_SECRET = prev;
  }
}

describe("热榜摘要入库（P0-1 步骤 A）", () => {
  it("检查 2+5：老库启动后 summary 列出现，旧行读出 summary: null", async () => {
    const columns = (await ctx.repo.raw("PRAGMA table_info(hotlist_entries)") as Array<{ name: string }>);
    expect(columns.map((c) => c.name)).toContain("summary");
    const stored = await ctx.repo.listHotlistEntries("zhihu");
    expect(stored).toHaveLength(2);
    expect(stored.map((i) => i.title)).toEqual(["旧行标题一", "旧行标题二"]);
    for (const item of stored) {
      expect(item.summary).toBeNull();
    }
  });

  it("检查 4：其余五源刷新后 summary 全为 null", async () => {
    for (const id of ["weibo", "baidu", "toutiao", "douyin", "bilibili"]) {
      const def = hotlistSourceById(id)!;
      const fetchImpl: HotlistFetch = async () => ({ status: 200, body: fixtureBody(`${id}.json`) });
      const entry = await refreshHotlistSource(ctx, def, fetchImpl, Date.now());
      expect(entry.ok).toBe(true);
      expect(entry.items).toBeGreaterThan(0);
      const stored = await ctx.repo.listHotlistEntries(id);
      expect(stored.length).toBeGreaterThan(0);
      for (const item of stored) {
        expect(item.summary).toBeNull();
      }
    }
  });

  it("检查 6：/api/hotlist 与 /api/brief/today 不下发 summary", async () => {
    const def = hotlistSourceById("zhihu")!;
    const fetchImpl: HotlistFetch = async () => ({ status: 200, body: fixtureBody("zhihu.json") });
    await withFakeSecret(() => refreshHotlistSource(ctx, def, fetchImpl, Date.now()));

    const hotRes = await app.inject({ method: "GET", url: "/api/hotlist" });
    expect(hotRes.statusCode).toBe(200);
    const hotBody = hotRes.json() as {
      sources: Array<{ items: Array<Record<string, unknown>> }>;
    };
    let hotItemCount = 0;
    for (const source of hotBody.sources) {
      for (const item of source.items) {
        hotItemCount += 1;
        expect(Object.keys(item).sort()).toEqual(["hotLabel", "hotValue", "rank", "title", "url"]);
      }
    }
    expect(hotItemCount).toBeGreaterThan(0);

    const briefRes = await app.inject({ method: "GET", url: "/api/brief/today" });
    expect(briefRes.statusCode).toBe(200);
    const briefBody = briefRes.json() as { hotPicks: Array<Record<string, unknown>> };
    expect(briefBody.hotPicks.length).toBeGreaterThan(0);
    for (const pick of briefBody.hotPicks) {
      expect("summary" in pick).toBe(false);
    }
  });

  it("检查 8：带 summary 列的库用旧字段映射仍可读（回滚无害）", async () => {
    // 模拟回退后的旧代码：SELECT * 后只映射旧字段，忽略多余列。
    // 直接用第二个 SQLite 连接读同一文件（不关闭 ctx，旧代码读库本就如此）。
    const db = new DatabaseSync(join(dir, "legacy.db"));
    try {
      const rows = db.prepare("SELECT * FROM hotlist_entries ORDER BY source ASC, rank ASC").all() as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const oldFields = {
          source: String(row.source),
          rank: Number(row.rank),
          title: String(row.title),
          url: String(row.url),
          hotValue: row.hot_value == null ? null : Number(row.hot_value),
          hotLabel: row.hot_label ?? null,
          fetchedAt: Number(row.fetched_at ?? 0),
        };
        expect(oldFields.title).toBeTruthy();
        expect(oldFields.url).toMatch(/^https:\/\//);
        expect(oldFields.fetchedAt).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  });
});
