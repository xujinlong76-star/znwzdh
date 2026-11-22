/**
 * /api/health 空库诚实探针（2026-11-22 :8787 空库根因修复 Part B）。
 *
 * 背景：dev-stack 的 serving DB 从建库起 sites=0，但 /api/health 恒报 ok:true，
 * 空站跑了 4 天监控里全绿。现在空库必须在探针里可见：warnings 含 sites=0。
 * ok 保持 true（存活语义不动），/api/ready 不改。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

function makeConfig(dir: string) {
  return loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
}

async function boot(dir: string) {
  const ctx = await createContext(makeConfig(dir));
  const app = await buildServer(ctx);
  await app.ready();
  return { ctx, app };
}

describe("空库 /api/health", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-health-empty-"));
    ({ ctx, app } = await boot(dir));
  });

  afterAll(async () => {
    await app.close();
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("sites=0 时 warnings 含空库警告，但 ok 仍为 true", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.stats.sites).toBe(0);
    expect(body.warnings).toContain("sites=0：库为空，/hot 与搜索将无结果（需跑种子）");
  });
});

describe("有站库 /api/health", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-health-seeded-"));
    ({ ctx, app } = await boot(dir));
    // 在首次 /api/health 调用前先写站，避免 stats 缓存读到旧值
    await ctx.repo.createCategory({ id: "cat-test", title: "测试类目" });
    await ctx.repo.createSite({ url: "https://example.com/seeded", title: "有站示例", description: "种子站", categoryId: "cat-test", tags: [] });
  });

  afterAll(async () => {
    await app.close();
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("有站时 warnings 为空数组", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.stats.sites).toBe(1);
    expect(body.warnings).toEqual([]);
  });
});
