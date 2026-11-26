/**
 * 热词冷启动回落（U-367）：无行为数据时，搜索空态与零结果建议回落 curated 列表。
 *
 * 切换条件（写死在这里，文案不得漂移）：
 *   - 行为榜单（suggestableTopQueries，180 天、≥2 身份 / ≥2 行、排除零结果词）
 *     非空 → 用行为榜单，source="behavioral"，文案「大家都在搜 / 大家在搜」；
 *   - 行为榜单为空且读侧未失败 → 回落站内类目数据：存活站点数最多的标签名
 *     （listTagsWithCounts，minCount=1），source="curated"，文案「热门推荐」；
 *   - 读侧失败（degraded）→ 不回落：空数组 + suggestionsDegraded（见
 *     search-hotwords.test.ts 的降级用例），失败不是冷启动；
 *   - 目录本身也空 → 仍为空，前端整块不渲染，不编造。
 *
 * 回落词保证可点：tag 分支（packages/store/src/search.ts termBranches）
 * 让标签名召回其标注站点；本文件另断言每枚回落词搜出 ≥1 条命中。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const PROBE = "zzprobe" + Date.now().toString(36) + "x";
const ORGANIC = "多人搜过热词";
// 回落期望：标签按存活站点数倒序、同数按名升序：
// 考研 3 站（s1/s2/s3）、写作 2 站（s3/s4）、设计 2 站（s2/s4）、学习 1 站（s1）。
const CURATED = ["考研", "写作", "设计", "学习"];

const base = {
  mode: "lite" as const,
  embedding: {
    model: "Xenova/bge-small-zh-v1.5",
    endpoint: "https://hf-mirror.com",
    dtype: "q8",
    dim: 512,
    enabled: false,
  },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

async function hotwords() {
  return app.inject({ method: "GET", url: "/api/search/hotwords" });
}

async function search(q: string, anonId?: string) {
  const url = `/api/search?q=${encodeURIComponent(q)}${anonId ? `&anonId=${encodeURIComponent(anonId)}` : ""}`;
  return app.inject({ method: "GET", url });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-hotword-fallback-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "fallback.db") }));
  app = await buildServer(ctx);
  await app.ready();
  // 只种目录数据、不写任何事件：这就是「新部署零行为数据」的冷启动态。
  const cat = await ctx.repo.createCategory({ title: "回落测试类目" });
  await ctx.repo.createSite({ url: "https://fallback-s1.example.com", title: "考研资料站", description: "考研学习资料", categoryId: cat.id, tags: ["考研", "学习"] });
  await ctx.repo.createSite({ url: "https://fallback-s2.example.com", title: "考研真题库", description: "考研设计真题", categoryId: cat.id, tags: ["考研", "设计"] });
  await ctx.repo.createSite({ url: "https://fallback-s3.example.com", title: "考研写作辅导", description: "考研写作学习", categoryId: cat.id, tags: ["考研", "写作"] });
  await ctx.repo.createSite({ url: "https://fallback-s4.example.com", title: "设计写作素材", description: "设计与写作素材", categoryId: cat.id, tags: ["设计", "写作"] });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("热词冷启动回落（U-367）", () => {
  it("零事件：GET /api/search/hotwords 回落 curated 标签榜，不再为空", async () => {
    const res = await hotwords();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { hotwords: string[]; source?: string; suggestionsDegraded?: boolean };
    expect(body.suggestionsDegraded).toBeUndefined();
    expect(body.source).toBe("curated");
    expect(body.hotwords).toEqual(CURATED);
  });

  it("零事件：零结果搜索的 suggestions/popular 回落 curated，且每词都能搜出命中", async () => {
    const res = await search(PROBE, "probe-user");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { hits: unknown[]; suggestions?: string[]; popular?: string[]; suggestionSource?: string };
    expect(body.hits).toEqual([]);
    expect(body.suggestionSource).toBe("curated");
    expect(body.suggestions).toEqual(CURATED);
    expect(body.popular).toEqual(CURATED);
    for (const word of body.suggestions ?? []) {
      const hit = await search(word, `hitcheck-${word}`);
      expect(hit.statusCode).toBe(200);
      expect((hit.json() as { hits: unknown[] }).hits.length, `回落词「${word}」应搜出命中`).toBeGreaterThan(0);
    }
  });

  it("行为数据到达后自动切回行为榜单（source=behavioral），回落词不再出现", async () => {
    // 两个身份各搜一次、回溯 60 秒：写后读隔离（before=请求开头）不挡旧行。
    await ctx.repo.recordEvent("search", { query: ORGANIC, identity: "fallback-person-a", clientCreatedAt: Date.now() - 60_000 });
    await ctx.repo.recordEvent("search", { query: ORGANIC, identity: "fallback-person-b", clientCreatedAt: Date.now() - 60_000 });
    const hw = await hotwords();
    expect(hw.statusCode).toBe(200);
    const hwBody = hw.json() as { hotwords: string[]; source?: string };
    expect(hwBody.source).toBe("behavioral");
    expect(hwBody.hotwords).toEqual([ORGANIC]);
    const res = await search(PROBE, "probe-user-2");
    expect(res.statusCode).toBe(200);
    const body = res.json() as { suggestions?: string[]; popular?: string[]; suggestionSource?: string };
    expect(body.suggestionSource).toBe("behavioral");
    expect(body.suggestions).toEqual([ORGANIC]);
    expect(body.popular).toEqual([ORGANIC]);
  });
});
