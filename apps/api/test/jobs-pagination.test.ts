/**
 * `GET /api/jobs` 的分页（升级改造方案 P1-7）。
 *
 * 背景：此前只解析 limit，不解析 offset —— 第 201 条以后的任务在 HTTP 层
 * 完全不可达，排查历史失败任务只能直连数据库。这一轮补的是：
 *   1. `offset` + `nextOffset` / `hasMore`（多取一行判定，不靠「满页」猜）；
 *   2. 排序带 id 第二键：批量入队会让大量行落在同一毫秒，单键排序在跨页时
 *      不稳定，同一行可能出现在两页里；
 *   3. `(status, created_at)` 索引，避免翻页退化成全表读 + 临时排序。
 *
 * 非空性：把 ORDER BY 的 id 第二键删掉，同毫秒用例（先撤掉覆盖索引，
 * 否则索引序会替 SQL 兜底）会因顺序错乱失败；把 offset 写死为 0，翻页用例立即失败。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const base = {
  mode: "lite" as const,
  embedding: {
    model: "none",
    endpoint: "",
    dtype: "q8" as const,
    dim: 512,
    cacheDir: join(tmpdir(), "navhub-jobs-page-models"),
    enabled: false,
  },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubJobsPageTest/0.1" },
  corsOrigins: ["*"],
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-jobs-pagination-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "api.db") } as never));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  // 每个用例自造数据集；jobs 表在测试库里没有业务数据（种子只写 sites/categories）
  await ctx.repo.run("DELETE FROM jobs");
});

async function insertJob(id: string, status: string, createdAt: number, kind = "health_check") {
  await ctx.repo.run(
    "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES (?,?,?,?,0,?,?)",
    [id, kind, "{}", status, createdAt, createdAt],
  );
}

interface JobsPageBody {
  items: Array<{ id: string; status: string }>;
  nextOffset: number;
  hasMore: boolean;
}

async function listPage(query: string): Promise<JobsPageBody> {
  const res = await app.inject({ method: "GET", url: "/api/jobs?" + query });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as JobsPageBody;
}

describe("GET /api/jobs 分页", () => {
  it("1000 条任务可以完整翻页：无重复、无遗漏、终止条件正确", async () => {
    const total = 1000;
    for (let i = 0; i < total; i++) {
      // 每 10 条落在同一毫秒：既测分页，也顺便压住「同毫秒并列」的排序不稳定
      await insertJob("j-" + String(i).padStart(4, "0"), "done", 1_700_000_000_000 + Math.floor(i / 10));
    }

    const seen: string[] = [];
    let offset = 0;
    let pages = 0;
    let hasMore = true;
    while (hasMore) {
      const page = await listPage(`limit=137&offset=${offset}`);
      pages++;
      expect(page.items.length).toBeLessThanOrEqual(137);
      expect(page.nextOffset).toBe(offset + page.items.length);
      seen.push(...page.items.map((j) => j.id));
      offset = page.nextOffset;
      hasMore = page.hasMore;
      // 防御：有 hasMore 却零进度说明分页实现坏了，直接失败而不是死循环
      if (hasMore) expect(page.items.length).toBeGreaterThan(0);
    }

    expect(pages).toBe(Math.ceil(total / 137));
    expect(new Set(seen).size, "翻页出现了重复行").toBe(total);
    expect(seen.length, "翻页出现了重复行或漏项").toBe(total);
    expect(seen.sort()).toEqual(Array.from({ length: total }, (_, i) => "j-" + String(i).padStart(4, "0")).sort());
  });

  it("同毫秒批量入队时排序稳定：按 id 逐页取也不重复、不遗漏，且顺序是全序", async () => {
    const total = 60;
    for (let i = 0; i < total; i++) await insertJob("tie-" + String(i).padStart(2, "0"), "done", 1_700_000_000_000);

    // 覆盖索引 (created_at DESC, id DESC) 本身就会把同毫秒行按 id 倒序吐出来，
    // 让「ORDER BY 漏写 id 第二键」看不出差别。先撤掉索引逼出排序器路径：
    // 这同时覆盖「旧库尚未建索引」时的正确性。
    await ctx.repo.run("DROP INDEX IF EXISTS jobs_created_idx");
    const seen: string[] = [];
    try {
      let offset = 0;
      for (;;) {
        const page = await listPage(`limit=7&offset=${offset}`);
        seen.push(...page.items.map((j) => j.id));
        offset = page.nextOffset;
        if (!page.hasMore) break;
      }
    } finally {
      await ctx.repo.run("CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs(created_at DESC, id DESC)");
    }
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => "tie-" + String(total - 1 - i).padStart(2, "0")));
  });

  it("空页稳定：offset 超出末尾返回空数组、hasMore=false、nextOffset 不回退", async () => {
    await insertJob("only", "done", 1_700_000_000_000);
    const page = await listPage("limit=10&offset=50");
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextOffset).toBe(50);

    // 再确认一次：空页本身是稳定结果，不会因重复请求变成非空
    expect(await listPage("limit=10&offset=50")).toEqual(page);
  });

  it("status 过滤与 offset 组合生效，且借住 jobs 表的 KV 行不会出现", async () => {
    for (let i = 0; i < 5; i++) await insertJob("ok-" + i, "done", 1_700_000_000_000 + i);
    for (let i = 0; i < 5; i++) await insertJob("bad-" + i, "failed", 1_700_000_000_000 + i);
    await ctx.repo.run(
      "INSERT INTO jobs (id, kind, payload, status, attempts, created_at, updated_at) VALUES (?,?,?,?,0,?,?)",
      ["kv:site-config", "kv", "{}", "done", 1_800_000_000_000, 1_800_000_000_000],
    );

    const page = await listPage("status=failed&limit=2&offset=1");
    expect(page.items.map((j) => j.id)).toEqual(["bad-3", "bad-2"]);
    expect(page.hasMore).toBe(true);

    const tail = await listPage("status=failed&limit=2&offset=4");
    expect(tail.items).toHaveLength(1);
    expect(tail.hasMore).toBe(false);

    const all = await listPage("limit=200");
    expect(all.items.some((j) => j.id === "kv:site-config")).toBe(false);
  });

  it("页大小有上限：limit 再大也只返回 200 条，并如实给出 hasMore", async () => {
    for (let i = 0; i < 210; i++) await insertJob("cap-" + String(i).padStart(3, "0"), "pending", 1_700_000_000_000 + i);
    const page = await listPage("limit=100000");
    expect(page.items).toHaveLength(200);
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(200);
  });

  it("接线守卫：翻页索引真的建了出来（旧库也补得上）", async () => {
    const rows = await ctx.repo.raw(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('jobs_created_idx', 'jobs_status_created_idx')",
    );
    expect(rows.map((r) => String(r.name)).sort()).toEqual(["jobs_created_idx", "jobs_status_created_idx"]);
  });
});
