/**
 * 站点 AI 透视（`GET /api/sites/:id/radar`）的持久化测试。
 *
 * 一次透视要打一次大模型，实测 3.5–60 秒；此前每次都重算。这里锁住四件事：
 *  1. **真实产出落库并命中**：第二次调用不打模型（用 fetch 桩计数证明）；
 *  2. **站点内容变了就失效**：指纹取在提示词上，改描述即改结论来源，旧文案不能继续供着；
 *  3. **换模型失效**：存量的 model 与当前 provider.model 不一致时不算命中；
 *  4. **失败不落库**：降级兜底文案写进库里，等于把一次抖动固化成永久文案。
 * 另加 purgeSite 的级联清理——site_radar 没有外键（手写双方言 DDL），漏删就留孤儿行。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const dir = mkdtempSync(join(tmpdir(), "navhub-radar-cache-"));
const base = {
  mode: "lite" as const,
  embedding: { model: "m", endpoint: "https://hf-mirror.com", dtype: "q8" as const, cacheDir: join(dir, "models"), dim: 512, enabled: false },
  // 真实网络一概不出门：模型端点由下方 fetch 桩接管
  llm: { baseUrl: "https://radar-stub.test/v1", apiKey: "test-key", model: "radar-test-model", timeoutMs: 3000 },
  fetch: { timeoutMs: 1000, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let modelCalls: string[] = [];

const RADAR = {
  summary: "存量结论：面向设计师的灵感采集工具",
  pricingType: "基础免费+进阶订阅",
  pricingWarning: "核心去水印需开通会员",
  accessRequirement: "需注册账号",
  bestForScenarios: ["灵感搜集", "情绪板"],
  pros: ["素材密度高"],
  cons: ["高级特性需订阅"],
  directAlternatives: ["平替A", "平替B"],
};

async function seedSite(id: string, description = "用于验证读穿缓存") {
  // 让每个用例自己的存量前提成立：站点行和透视行都从干净状态开始
  await ctx.repo.run("DELETE FROM site_radar WHERE site_id = ?", [id]);
  await ctx.repo.run("DELETE FROM sites WHERE id = ?", [id]);
  await ctx.repo.createSiteWithId({
    id,
    url: `https://${id}.example.com`,
    title: `透视测试站点 ${id}`,
    description,
    categoryId: "cat-radar",
  });
}

/** 接管 /chat/completions：calls 记录被调用了几次，是「命中不打模型」的唯一硬证据 */
function stubLlm(content: string | "boom") {
  const original = globalThis.fetch;
  modelCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes("/chat/completions")) return original(input as RequestInfo);
    modelCalls.push(url);
    if (content === "boom") throw new Error("模型不可达（测试桩）");
    return new Response(
      JSON.stringify({ model: "radar-test-model", choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

beforeAll(async () => {
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "radar.db") }));
  app = await buildServer(ctx);
  await app.ready();
  await ctx.repo.createCategory({ id: "cat-radar", title: "测试分类" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/sites/:id/radar 读穿缓存", () => {
  it("真实产出落库，第二次调用直接命中且不再打模型", async () => {
    await seedSite("site-hit");
    const restore = stubLlm(JSON.stringify(RADAR));
    try {
      const first = await app.inject({ method: "GET", url: "/api/sites/site-hit/radar" });
      expect(first.statusCode).toBe(200);
      expect(first.json().cached).toBeUndefined();
      expect(first.json().radar).toMatchObject({ summary: RADAR.summary });
      expect(modelCalls).toHaveLength(1);

      const second = await app.inject({ method: "GET", url: "/api/sites/site-hit/radar" });
      expect(second.statusCode).toBe(200);
      const body = second.json();
      expect(body.cached).toBe(true);
      expect(body.fallback).toBeUndefined();
      expect(body.radar.summary).toBe(RADAR.summary);
      // 命中必须是同一次模型调用：多打一次就等于没做持久化
      expect(modelCalls).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("站点描述被改写后旧结论不再命中（指纹判据）", async () => {
    await seedSite("site-stale-src");
    const restore = stubLlm(JSON.stringify(RADAR));
    try {
      await app.inject({ method: "GET", url: "/api/sites/site-stale-src/radar" });
      expect(modelCalls).toHaveLength(1);

      // 富化任务改写描述：透视提示词随之变化，存量必须失效
      await ctx.repo.updateSite("site-stale-src", { description: "描述已被自动富化任务改写" });
      const after = await app.inject({ method: "GET", url: "/api/sites/site-stale-src/radar" });
      expect(after.json().cached).toBeUndefined();
      expect(modelCalls).toHaveLength(2);

      // 第三次又回到命中：说明失效是一次性的重算，而不是把缓存打穿
      const third = await app.inject({ method: "GET", url: "/api/sites/site-stale-src/radar" });
      expect(third.json().cached).toBe(true);
      expect(modelCalls).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it("模型失败不写库：一次抖动不该固化成永久文案", async () => {
    await seedSite("site-fail");
    const restore = stubLlm("boom");
    try {
      const res = await app.inject({ method: "GET", url: "/api/sites/site-fail/radar" });
      expect(res.statusCode).toBe(200);
      expect(res.json().fallback).toBe(true);

      const rows = await ctx.repo.raw("SELECT COUNT(*) AS n FROM site_radar WHERE site_id = ?", ["site-fail"]);
      expect(Number(rows[0]!.n)).toBe(0);

      // 模型恢复后正常重算并落库，证明失败的这一次没有留下任何占位
      restore();
      const revive = stubLlm(JSON.stringify(RADAR));
      try {
        const ok = await app.inject({ method: "GET", url: "/api/sites/site-fail/radar" });
        expect(ok.json().cached).toBeUndefined();
        const again = await app.inject({ method: "GET", url: "/api/sites/site-fail/radar" });
        expect(again.json().cached).toBe(true);
      } finally {
        revive();
      }
    } finally {
      restore();
    }
  });

  it("站点不存在返回 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites/does-not-exist/radar" });
    expect(res.statusCode).toBe(404);
  });
});

describe("site_radar 的读写与失效判据", () => {
  const SRC = "a".repeat(32);

  it("换了模型不再命中：旧结论不会被永久供着", async () => {
    await seedSite("site-stale-model");
    await ctx.repo.saveSiteRadar("site-stale-model", RADAR, "some-older-model", SRC);
    expect(await ctx.repo.getSiteRadar("site-stale-model", "radar-test-model", SRC)).toBeNull();
  });

  it("提示词指纹不一致时不命中", async () => {
    await seedSite("site-src-mismatch");
    await ctx.repo.saveSiteRadar("site-src-mismatch", RADAR, "radar-test-model", SRC);
    expect(await ctx.repo.getSiteRadar("site-src-mismatch", "radar-test-model", "b".repeat(32))).toBeNull();
    expect((await ctx.repo.getSiteRadar("site-src-mismatch", "radar-test-model", SRC))?.radar).toEqual(RADAR);
  });

  it("存量 JSON 坏掉或还是旧格式裸对象时按未命中处理，而不是 500", async () => {
    await seedSite("site-corrupt");
    await ctx.repo.run(
      "INSERT INTO site_radar (site_id, payload, model, updated_at) VALUES (?,?,?,?)",
      ["site-corrupt", "{这不是合法 JSON", "radar-test-model", Date.now()],
    );
    expect(await ctx.repo.getSiteRadar("site-corrupt", "radar-test-model", SRC)).toBeNull();

    // 旧版本落的是裸透视对象（没有信封、也就没有指纹判据）：放行等于接受一个无法验证的结论
    await seedSite("site-legacy");
    await ctx.repo.run(
      "INSERT INTO site_radar (site_id, payload, model, updated_at) VALUES (?,?,?,?)",
      ["site-legacy", JSON.stringify(RADAR), "radar-test-model", Date.now()],
    );
    expect(await ctx.repo.getSiteRadar("site-legacy", "radar-test-model", SRC)).toBeNull();
  });

  it("saveSiteRadar 重复写同一站点是覆盖而不是追加", async () => {
    await seedSite("site-upsert");
    await ctx.repo.saveSiteRadar("site-upsert", RADAR, "radar-test-model", SRC);
    const revised = { ...RADAR, summary: "重算后的结论" };
    await ctx.repo.saveSiteRadar("site-upsert", revised, "radar-test-model", SRC);

    const rows = await ctx.repo.raw("SELECT COUNT(*) AS n FROM site_radar WHERE site_id = ?", ["site-upsert"]);
    expect(Number(rows[0]!.n)).toBe(1);
    expect((await ctx.repo.getSiteRadar("site-upsert", "radar-test-model", SRC))?.radar).toEqual(revised);
  });

  it("purgeSite 清掉透视行（表间没有外键，靠手动级联）", async () => {
    await seedSite("site-purge");
    await ctx.repo.saveSiteRadar("site-purge", RADAR, "radar-test-model", SRC);
    expect(await ctx.repo.getSiteRadar("site-purge", "radar-test-model", SRC)).not.toBeNull();

    await ctx.repo.purgeSite("site-purge");

    expect(await ctx.repo.getSiteRadar("site-purge", "radar-test-model", SRC)).toBeNull();
  });
});
