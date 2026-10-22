import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner } from "../src/jobs.ts";

/**
 * 后台任务的**全库覆盖**回归。
 *
 * repo.listSites() 默认 limit=100（那是给匿名搜索通道的成本上限，不是任务语义）。
 * recompute_rank / reindex 曾经直接复用它，于是：
 *  - 第 101 条以后的站点永远拿不到新热度分 —— 库越大，排序越像随机；
 *  - "全站重建索引"只重建前 100 条，而事件里照报 sites:100，看起来完全成功。
 * 两个缺陷都不会抛错、不会变慢，只会静默少做工作，所以必须用数量断言锁住。
 */
const TOTAL = 130; // > 100，且留足余量确认不是"刚好卡在边界"

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-jobs-cover-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "cover.db"),
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

  await ctx.repo.createCategory({ id: "fc", title: "覆盖测试类目" });
  for (let i = 0; i < TOTAL; i++) {
    await ctx.repo.createSite({
      url: `https://cover-${String(i).padStart(3, "0")}.example.com`,
      title: `覆盖站点 ${String(i).padStart(3, "0")}`,
      description: "第 100 条之后的站点同样要参与热度重算与索引重建",
      categoryId: "fc",
      tags: [],
      sort: i, // listSites 按 sort 升序取前 100：sort>=100 的站点正是被截掉的那批
    });
  }
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 最近一条某类事件的 meta（任务用它自报处理量，必须是真的） */
function lastEventMeta(kind: string): Record<string, unknown> | null {
  const row = ctx.db.sqlite!
    .prepare("SELECT meta FROM events WHERE kind = ? ORDER BY id DESC LIMIT 1")
    .get(kind) as { meta: string } | undefined;
  if (!row?.meta) return null;
  try {
    return JSON.parse(row.meta) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe("recompute_rank 覆盖全库", () => {
  it("sort>=100 的站点也能拿到热度分，事件自报的数量是全库条数", async () => {
    // 给"窗口外"的站点制造互动：缺陷版它永远拿不到分数，与窗口内站点形成可比差异
    const byUrl = ctx.db.sqlite!.prepare("SELECT id FROM sites WHERE url = ?").get(
      "https://cover-129.example.com",
    ) as { id: string } | undefined;
    const farId = byUrl!.id;

    for (let i = 0; i < 7; i++) {
      await ctx.repo.recordEvent("click", { siteId: farId, meta: { identity: "u-cover" } });
    }

    await ctx.repo.enqueueJob("recompute_rank", {});
    const runner = new JobRunner(ctx);
    const result = await runner.tick();
    expect(result.processed).toBe(1);

    const farAfter = await ctx.repo.getSite(farId);
    // 缺陷版：窗口外站点没被评分，trend_score 仍是初始 0
    expect(farAfter!.trendScore!).toBeGreaterThan(0);

    const meta = lastEventMeta("recompute_rank");
    expect(meta?.sites).toBe(TOTAL);
  });
});

describe("reindex 覆盖全库", () => {
  it("窗口外站点的 fts_tokens 也会被重建，事件自报的数量是全库条数", async () => {
    const byUrl = ctx.db.sqlite!.prepare("SELECT id FROM sites WHERE url = ?").get(
      "https://cover-128.example.com",
    ) as { id: string } | undefined;
    const farId = byUrl!.id;
    // 人为破坏窗口外站点的写入期预计算列，reindex 必须把它补回来
    ctx.db.sqlite!.prepare("UPDATE sites SET fts_tokens = '', pinyin_full = '' WHERE id = ?").run(farId);
    const poisoned = ctx.db.sqlite!.prepare("SELECT fts_tokens FROM sites WHERE id = ?").get(farId) as {
      fts_tokens: string;
    };
    expect(poisoned.fts_tokens).toBe("");

    await ctx.repo.enqueueJob("reindex", { vectors: false });
    const runner = new JobRunner(ctx);
    const result = await runner.tick();
    expect(result.processed).toBe(1);

    const fixed = ctx.db.sqlite!.prepare("SELECT fts_tokens FROM sites WHERE id = ?").get(farId) as {
      fts_tokens: string;
    };
    expect(fixed.fts_tokens.length).toBeGreaterThan(0);

    const meta = lastEventMeta("reindex");
    expect(meta?.sites).toBe(TOTAL);
    expect(meta?.vectors).toBe(false);
  });
});
