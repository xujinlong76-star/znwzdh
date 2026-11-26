/**
 * 热词冷启动回落（U-367）降级回归：读失败时不回落 curated。
 *
 * 背景：既有降级测试（search-hotwords.test.ts 的「suggestableTopQueries 读失败」
 * 用例、search-suggestions-degraded.test.ts）都不种标签，拦不住「降级时回落」
 * 的 bug——库里明明有可回落的标签，读失败却仍把 curated 榜单当热词/建议发出去，
 * 会把一次读故障伪装成冷启动。本文件复用回落测试同款 4 站点种子
 * （考研×3 / 写作×2 / 设计×2 / 学习×1），在该种子上强制
 * `suggestableTopQueries` 拒绝，钉住两端点：
 *   - GET /api/search/hotwords → hotwords == [] + suggestionsDegraded: true，
 *     source 绝不为 "curated"；
 *   - 零结果 GET /api/search → suggestions == popular == [] +
 *     suggestionsDegraded: true，suggestionSource 绝不为 "curated"。
 *
 * 对照用例先证实：同一种子、无 mock 时两端点确实回落 curated——
 * 若将来有人把 `!degraded` 设闸删掉，本文件的降级用例会立刻变红。
 * 独立文件，避免与 search-hotwords-fallback.test.ts 内「行为数据到达后切回」
 * 用例的事件顺序耦合。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const PROBE = "zzprobe-degraded" + Date.now().toString(36) + "x";
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
  dir = mkdtempSync(join(tmpdir(), "navhub-hotword-fallback-degraded-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "fallback-degraded.db") }));
  app = await buildServer(ctx);
  await app.ready();
  // 只种目录数据、不写任何事件：与回落测试同一冷启动态，区别是本文件随后
  // 强制读失败，验证「失败不是冷启动」。
  const cat = await ctx.repo.createCategory({ title: "降级回落测试类目" });
  await ctx.repo.createSite({ url: "https://degraded-s1.example.com", title: "考研资料站", description: "考研学习资料", categoryId: cat.id, tags: ["考研", "学习"] });
  await ctx.repo.createSite({ url: "https://degraded-s2.example.com", title: "考研真题库", description: "考研设计真题", categoryId: cat.id, tags: ["考研", "设计"] });
  await ctx.repo.createSite({ url: "https://degraded-s3.example.com", title: "考研写作辅导", description: "考研写作学习", categoryId: cat.id, tags: ["考研", "写作"] });
  await ctx.repo.createSite({ url: "https://degraded-s4.example.com", title: "设计写作素材", description: "设计与写作素材", categoryId: cat.id, tags: ["设计", "写作"] });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("热词冷启动回落降级回归（U-367）", () => {
  it("对照：无读失败时同一批标签种子确实回落 curated", async () => {
    const res = await hotwords();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { hotwords: string[]; source?: string; suggestionsDegraded?: boolean };
    expect(body.suggestionsDegraded).toBeUndefined();
    expect(body.source).toBe("curated");
    expect(body.hotwords).toEqual(CURATED);
  });

  it("suggestableTopQueries 读失败：热词端点为空 + 降级标记，绝不回落 curated", async () => {
    const spy = vi.spyOn(ctx.repo, "suggestableTopQueries").mockRejectedValue(new Error("simulated hotwords read failure"));
    try {
      const res = await hotwords();
      expect(res.statusCode).toBe(200);
      const body = res.json() as { hotwords: string[]; source?: string; suggestionsDegraded?: boolean };
      expect(body.hotwords).toEqual([]);
      expect(body.suggestionsDegraded).toBe(true);
      expect(body.source).not.toBe("curated");
    } finally {
      spy.mockRestore();
    }
  });

  it("suggestableTopQueries 读失败：零结果搜索建议/热门为空 + 降级标记，绝不回落 curated", async () => {
    const spy = vi.spyOn(ctx.repo, "suggestableTopQueries").mockRejectedValue(new Error("simulated suggestions read failure"));
    try {
      const res = await search(PROBE, "degraded-probe-user");
      expect(res.statusCode).toBe(200);
      const body = res.json() as { hits: unknown[]; suggestions?: string[]; popular?: string[]; suggestionSource?: string; suggestionsDegraded?: boolean };
      expect(body.hits).toEqual([]);
      expect(body.suggestions).toEqual([]);
      expect(body.popular).toEqual([]);
      expect(body.suggestionsDegraded).toBe(true);
      expect(body.suggestionSource).not.toBe("curated");
    } finally {
      spy.mockRestore();
    }
  });
});
