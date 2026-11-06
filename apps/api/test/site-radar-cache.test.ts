/**
 * 站点 AI 透视（`GET /api/sites/:id/radar`）的持久化测试。
 *
 * 一次透视要打一次大模型，实测 44–60 秒；此前每次都重算。这里锁住三件事：
 *  1. **命中即返回**：存量可用时不发模型请求（测试环境没有可用密钥，
 *     一旦真的去打模型就会拿到 fallback 标记，断言立刻失败）；
 *  2. **换模型自动失效**：存量的 model 与当前解析出的 provider.model 不一致时不算命中；
 *  3. **失败不落库**：降级兜底文案写进库里，等于把一次抖动固化成永久文案。
 * 另加 purgeSite 的级联清理——site_radar 没有外键（手写双方言 DDL），漏删就留孤儿行。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { resolveLlm } from "../src/llm-config.ts";

const dir = mkdtempSync(join(tmpdir(), "navhub-radar-cache-"));
const base = {
  mode: "lite" as const,
  embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
  // apiKey: null —— 模型调用必然失败，正好用来断言「失败不落库」与「命中不打模型」
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 3000 },
  fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
/** 与路由读取侧同一个来源，避免把模型名硬编码进测试 */
let currentModel: string;

const RADAR = {
  summary: "存量结论：面向设计师的灵感采集工具",
  pricingType: "基础免费+进阶订阅",
  pricingWarning: "核心去水印需开通会员",
  pros: ["素材密度高"],
  cons: ["高级特性需订阅"],
  directAlternatives: ["平替A", "平替B"],
};

async function seedSite(id: string) {
  // 让每个用例自己的存量前提成立：站点行和透视行都从干净状态开始
  await ctx.repo.run("DELETE FROM site_radar WHERE site_id = ?", [id]);
  await ctx.repo.run("DELETE FROM sites WHERE id = ?", [id]);
  await ctx.repo.createSiteWithId({
    id,
    url: `https://${id}.example.com`,
    title: `透视测试站点 ${id}`,
    description: "用于验证读穿缓存",
    categoryId: "cat-radar",
  });
}

beforeAll(async () => {
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "radar.db") }));
  app = await buildServer(ctx);
  await app.ready();
  // 同级类目标题必须唯一，只在库建一次
  await ctx.repo.createCategory({ id: "cat-radar", title: "测试分类" });
  const llm = await resolveLlm(ctx);
  currentModel = llm.provider.model;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/sites/:id/radar 读穿缓存", () => {
  it("存量命中：直接返回库里的结论，不打模型", async () => {
    await seedSite("site-hit");
    await ctx.repo.saveSiteRadar("site-hit", RADAR, currentModel);

    const res = await app.inject({ method: "GET", url: "/api/sites/site-hit/radar" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cached).toBe(true);
    // 没有 fallback 标记 = 这一轮根本没走降级，也就没碰模型
    expect(body.fallback).toBeUndefined();
    expect(body.radar).toEqual(RADAR);
  });

  it("换了模型不再命中：旧结论不会被永久供着", async () => {
    await seedSite("site-stale-model");
    await ctx.repo.saveSiteRadar("site-stale-model", RADAR, "some-older-model");

    const res = await app.inject({ method: "GET", url: "/api/sites/site-stale-model/radar" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cached).toBeUndefined();
    expect(body.fallback).toBe(true);
  });

  it("存量 JSON 坏掉时按未命中处理，而不是 500", async () => {
    await seedSite("site-corrupt");
    await ctx.repo.run(
      "INSERT INTO site_radar (site_id, payload, model, updated_at) VALUES (?,?,?,?)",
      ["site-corrupt", "{这不是合法 JSON", currentModel, Date.now()],
    );

    const res = await app.inject({ method: "GET", url: "/api/sites/site-corrupt/radar" });

    expect(res.statusCode).toBe(200);
    expect(res.json().cached).toBeUndefined();
  });

  it("模型失败不写库：一次抖动不该固化成永久文案", async () => {
    await seedSite("site-fail");

    const res = await app.inject({ method: "GET", url: "/api/sites/site-fail/radar" });
    expect(res.statusCode).toBe(200);
    expect(res.json().fallback).toBe(true);

    expect(await ctx.repo.getSiteRadar("site-fail", currentModel)).toBeNull();

    // 再开一次仍然会尝试重算（而不是供着上一次的兜底文案）
    const again = await app.inject({ method: "GET", url: "/api/sites/site-fail/radar" });
    expect(again.json().cached).toBeUndefined();
  });

  it("站点不存在返回 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites/does-not-exist/radar" });
    expect(res.statusCode).toBe(404);
  });
});

describe("site_radar 的读写与级联", () => {
  it("saveSiteRadar 重复写同一站点是覆盖而不是追加", async () => {
    await seedSite("site-upsert");
    await ctx.repo.saveSiteRadar("site-upsert", RADAR, currentModel);
    const revised = { ...RADAR, summary: "重算后的结论" };
    await ctx.repo.saveSiteRadar("site-upsert", revised, currentModel);

    const rows = await ctx.repo.raw("SELECT COUNT(*) AS n FROM site_radar WHERE site_id = ?", ["site-upsert"]);
    expect(Number(rows[0]!.n)).toBe(1);
    expect((await ctx.repo.getSiteRadar("site-upsert", currentModel))?.radar).toEqual(revised);
  });

  it("purgeSite 清掉透视行（表间没有外键，靠手动级联）", async () => {
    await seedSite("site-purge");
    await ctx.repo.saveSiteRadar("site-purge", RADAR, currentModel);
    expect(await ctx.repo.getSiteRadar("site-purge", currentModel)).not.toBeNull();

    await ctx.repo.purgeSite("site-purge");

    expect(await ctx.repo.getSiteRadar("site-purge", currentModel)).toBeNull();
  });
});
