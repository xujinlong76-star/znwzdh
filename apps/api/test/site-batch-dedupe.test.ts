/**
 * `/api/sites/batch` 的批量去重语义（性能改造的回归网）。
 *
 * 背景：原实现在事务内对每条站点调用一次 `findSiteByUrl`，200 条上限就是
 * 200 次查询。改造后改为「一次 IN 查询预取已存在 URL + 批次内集合补登」。
 * 这类改造最容易在三个地方改坏，所以逐条钉住：
 *
 * 1. **批次内重复**：第一条插入后，第二条必须仍被判为重复（不能靠 DB 唯一索引兜底，
 *    因为 sites 表的唯一约束不是「未软删」条件索引，撞索引会抛 500 而不是返回 duplicates）。
 * 2. **斜杠变体**：`https://a.com` 与 `https://a.com/` 是同一个站点，两条路径
 *    （`item.url` 原文 / `canonicalizeUrl` 归一）都要能命中。
 * 3. **软删行不算重复**：回收站里的站点 URL 仍占着唯一索引，但业务上允许重新导入，
 *    原实现用 `deleted_at IS NULL` 过滤，批量版必须保持。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-batch-dedupe-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "batch.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
  await ctx.repo.ensureUncategorized();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function batch(urls: string[]) {
  const res = await app.inject({
    method: "POST",
    url: "/api/sites/batch",
    payload: { sites: urls.map((url) => ({ url, title: url })) },
  });
  return { status: res.statusCode, body: res.json() as Record<string, any> };
}

describe("POST /api/sites/batch 批量去重", () => {
  it("同批次内的重复（含斜杠变体）只落一条，其余计入 duplicates", async () => {
    const first = await batch([
      "https://batch-dup.example.com",
      "https://batch-dup.example.com/",
      "https://batch-dup.example.com/", // 原文重复
    ]);
    expect(first.status).toBe(201);
    expect(first.body.created).toBe(1);
    expect(first.body.duplicates).toBe(2);
  });

  it("与库中已有站点重复时被识别（跨批次，斜杠变体双向）", async () => {
    const created = await batch(["https://batch-cross.example.com/"]);
    expect(created.body.created).toBe(1);

    // 库内是带斜杠的写法，第二次传入无斜杠；第三次反过来
    const again = await batch(["https://batch-cross.example.com", "https://batch-cross.example.com/"]);
    expect(again.body.created).toBe(0);
    expect(again.body.duplicates).toBe(2);
  });

  it("批量规模下计数仍准确（40 条新 + 10 条重复）", async () => {
    const fresh = Array.from({ length: 40 }, (_, i) => `https://batch-scale-${i}.example.com`);
    const first = await batch(fresh);
    expect(first.body.created).toBe(40);
    expect(first.body.duplicates).toBe(0);

    const mixed = [...fresh.slice(0, 10), ...Array.from({ length: 5 }, (_, i) => `https://batch-new-${i}.example.com`)];
    const second = await batch(mixed);
    expect(second.body.created).toBe(5);
    expect(second.body.duplicates).toBe(10);

    // 落库总数必须与声明一致，不能出现「说 40 条实际 41 条」
    const total = await ctx.repo.raw(
      "SELECT COUNT(*) AS c FROM sites WHERE url LIKE 'https://batch-%' AND deleted_at IS NULL",
    );
    expect(Number(total[0]?.c ?? 0)).toBe(40 + 5 + 1 + 1);
  });

  it("软删行不算重复（回收站里的 URL 允许重新导入）", async () => {
    const created = await batch(["https://batch-softdel.example.com"]);
    expect(created.body.created).toBe(1);

    const existing = await ctx.repo.findSiteByUrl("https://batch-softdel.example.com");
    expect(existing).not.toBeNull();
    await ctx.repo.deleteSite(existing!.id);

    const again = await batch(["https://batch-softdel.example.com"]);
    expect(again.body.created).toBe(1);
    expect(again.body.duplicates).toBe(0);
  });
});
