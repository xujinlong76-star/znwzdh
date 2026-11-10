/**
 * AI 智能找站（POST /api/ai/find）的硬约束测试：
 *  1. 推荐只出站内站点——模型编造的 siteId 被丢弃，真实挑选保留且用模型理由；
 *  2. 无结果时如实 mode:"none" 并给分类入口，不编造任何 URL；
 *  3. 未配置密钥时不崩：降级为本地检索结果并标注 degraded:"unconfigured"；
 *  4. 场景包按步骤分组、顺序即建议使用顺序，且每步只含站内站点。
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { resetSystemLlmConfig, saveSystemLlmConfig } from "../src/llm-config.ts";
import { validateModelPicks, suggestCategories } from "../src/ai-finder.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let pptSiteId = "";
let pptSiteUrl = "https://www.zhaozhanzhe.example/ppt-master";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-ai-find-"));
  ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
  app = await buildServer(ctx);
  await app.ready();

  const office = await ctx.repo.createCategory({ title: "效率办公", slug: "office" });
  const video = await ctx.repo.createCategory({ title: "影视视频", slug: "video" });
  void video;
  const ppt = await ctx.repo.createSite({
    url: pptSiteUrl,
    title: "PPT 大师在线制作",
    description: "在线做 PPT 的演示文稿工具",
    categoryId: office.id,
    tags: ["PPT", "幻灯片", "演示"],
  });
  pptSiteId = ppt.id;
  await ctx.repo.createSite({
    url: "https://slides.example.com/free",
    title: "免费幻灯片模板站",
    description: "PPT 模板与幻灯片素材下载",
    categoryId: office.id,
    tags: ["PPT", "模板"],
  });
  await ctx.repo.createSite({
    url: "https://pic.example.com/free",
    title: "免费图片素材库",
    description: "免费图片素材与图标下载",
    categoryId: office.id,
    tags: ["图片", "素材", "图标"],
  });
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("纯逻辑：模型挑选校验", () => {
  it("候选外的 siteId 被丢弃，候选内保留并截断理由", () => {
    const { picks, dropped } = validateModelPicks(
      { picks: [
        { siteId: "real-1", reason: "  很适合   做演示 " },
        { siteId: "hallucinated-9", reason: "编造的" },
        { siteId: "real-1", reason: "重复" },
      ] },
      [{ siteId: "real-1", title: "真站", url: "https://real.example.com", description: null }],
    );
    expect(picks).toEqual([{ siteId: "real-1", reason: "很适合 做演示" }]);
    expect(dropped).toBe(2);
  });

  it("分类建议：标题有交集优先，否则给一级分类", () => {
    const cats = [
      { id: "a", title: "效率办公", parentId: null, slug: "office" },
      { id: "b", title: "影视视频", parentId: null, slug: "video" },
    ];
    expect(suggestCategories(cats, "办公")[0]?.id).toBe("a");
    expect(suggestCategories(cats, "完全无关的词").length).toBeGreaterThan(0);
  });
});

describe("未配置密钥：本地降级不崩、只出站内站点", () => {
  it("POST /api/ai/find {query:PPT} → mode local + degraded unconfigured", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ai/find", payload: { query: "做 PPT 用什么网站" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("local");
    expect(body.degraded).toBe("unconfigured");
    expect(body.notice).toContain("还没配置密钥");
    expect(body.recommendations.length).toBeGreaterThan(0);
    for (const r of body.recommendations) {
      expect([pptSiteUrl, "https://slides.example.com/free", "https://pic.example.com/free"]).toContain(r.url);
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("空参数 → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ai/find", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("无结果 → mode none + 分类入口，不编造 URL", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ai/find", payload: { query: "zxqwvkj plmnbvcxz qqqzzz" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe("none");
    expect(body.recommendations).toEqual([]);
    expect(body.categorySuggestions.length).toBeGreaterThan(0);
    expect(body.notice).toContain("还没有收录");
    expect(JSON.stringify(body)).not.toContain("http");
  });
});

describe("场景包：分步骤、只出站内站点", () => {
  it("make-ppt 场景返回步骤组，顺序与定义一致", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/find",
      payload: { query: "我要做一份工作汇报 PPT", sceneId: "make-ppt" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scene).toMatchObject({ id: "make-ppt", title: "做 PPT" });
    expect(body.steps.length).toBeGreaterThan(0);
    expect(body.steps[0].label).toContain("第一步");
    const allUrls = body.steps.flatMap((s: { sites: Array<{ url: string }> }) => s.sites.map((x) => x.url));
    expect(allUrls).toContain(pptSiteUrl);
    for (const u of allUrls) expect(u.endsWith(".example.com/free") || u === pptSiteUrl || u.includes("example")).toBe(true);
  });
});

describe("模型路径：编造 siteId 被丢弃", () => {
  let hub: Server;
  beforeAll(async () => {
    hub = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        void raw;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "chatcmpl-find", object: "chat.completion", created: 1, model: "fake-finder",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ picks: [
            { siteId: "hallucinated-id-999", reason: "编造站点的理由" },
            { siteId: pptSiteId, reason: "做汇报 PPT 最对口" },
          ] }) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }));
      });
      req.resume();
    });
    await new Promise<void>((r) => hub.listen(0, "127.0.0.1", r));
    const port = (hub.address() as { port: number }).port;
    await saveSystemLlmConfig(ctx, {
      enabled: true,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: "fake-finder",
      apiKey: ["fake", "key", "for", "tests"].join("-"),
      timeoutMs: 5000,
      thinking: false,
      allowPrivateNetwork: true,
    }, "test");
  });
  afterAll(async () => {
    await resetSystemLlmConfig(ctx, "test");
    await new Promise<void>((r) => hub.close(() => r()));
  });

  it("mode ai，第一条是真站且用模型理由，全程无编造站", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ai/find", payload: { query: "做 PPT 用什么网站" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe("ai");
    expect(body.degraded).toBeNull();
    expect(body.recommendations[0]).toMatchObject({ siteId: pptSiteId, url: pptSiteUrl, reason: "做汇报 PPT 最对口" });
    expect(JSON.stringify(body)).not.toContain("hallucinated");
    expect(JSON.stringify(body)).not.toContain("编造站点的理由");
  });
});
