/**
 * 投稿 AI 自动填表（prefill）升级行为测试。
 *
 * 覆盖三段自动流里后端契约的可测部分：
 *  1. 自动采集：抓取到的 icon/og:image/正文语料进响应与降级分支；
 *  2. 自动选主分类：LLM 无 key 的降级路径分类留空（不许塞第一个分类），
 *     且响应含 confidence/candidates 结构；
 *  3. 查重预告：已收录网址在识别阶段返回 duplicate，不让用户白填。
 *
 * LLM 有 key 的分支依赖外部模型，不在这里测（契约字段结构由无 key
 * 与降级分支保证一致）；网络抓取用 @navhub/ai 的 guardedFetch mock。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FETCH_RESULT = {
  body: `<html lang="zh-CN"><head><title>Acme 画板</title>
    <meta name="description" content="在线协作白板工具">
    <link rel="icon" href="https://acme.example/icon.png">
    <meta property="og:image" content="https://acme.example/cover.png">
    </head><body><main>Acme 画板是一款面向团队的在线协作白板，支持实时光标与模板库。</main></body></html>`,
  finalUrl: "https://acme.example/",
  status: 200,
  headers: new Headers(),
};

vi.mock("@navhub/ai", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@navhub/ai")>();
  return {
    ...orig,
    guardedFetch: vi.fn(async () => FETCH_RESULT),
  };
});

// 无 API key 的 LLM 解析：强制走「启发式提取」降级分支（分类必须留空）
vi.mock("../src/llm-config.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/llm-config.ts")>();
  return {
    ...orig,
    resolveLlm: vi.fn(async () => ({
      provider: { apiKey: "", model: "test-model", baseUrl: "", provider: "openai" },
      fallbacks: [],
      source: "test",
    })),
  };
});

import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const CATS = [
  {
    id: "cat-ai",
    title: "AI 工具",
    description: "AI 对话、绘图与编程助手",
    subCategories: [{ id: "sub-draw", title: "AI 绘图", description: "图像生成与编辑" }],
  },
  { id: "cat-design", title: "设计与创意", description: "设计素材与灵感" },
];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-prefill-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "prefill.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
  await ctx.repo.createCategory({ id: "cat-ai", title: "AI 工具" });
  await ctx.repo.createCategory({ id: "cat-design", title: "设计与创意" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe("投稿 prefill：自动采集 + 自动选分类契约", () => {
  it("无 LLM key 降级：分类留空、结构完整（confidence/candidates/icon）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions/prefill",
      payload: { url: "https://acme.example/", categories: CATS },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      success: boolean;
      fallback?: boolean;
      prefill: Record<string, unknown>;
    };
    expect(body.success).toBe(true);
    expect(body.fallback).toBe(true);
    // 分类判断不了必须留空，绝不默认塞分类树第一个
    expect(body.prefill.category).toBe("");
    expect(body.prefill.subcategory).toBe("");
    // 升级契约字段齐全
    expect(body.prefill.confidence).toBe(0);
    expect(Array.isArray(body.prefill.candidates)).toBe(true);
    expect(typeof body.prefill.icon).toBe("string");
    expect(String(body.prefill.icon)).toContain("acme.example");
    // 抓取语料进 title/description（降级也带真实抓取值）
    expect(String(body.prefill.title)).toContain("Acme");
    expect(body.prefill.duplicate).toBeNull();
  });

  it("查重预告：已收录网址返回 duplicate.siteId", async () => {
    const created = await ctx.repo.createSite({
      url: "https://acme.example/",
      title: "Acme 画板",
      categoryId: "cat-design",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions/prefill",
      payload: { url: "https://acme.example/", categories: CATS },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { prefill: { duplicate: { siteId: string } | null } };
    expect(body.prefill.duplicate).not.toBeNull();
    expect(body.prefill.duplicate?.siteId).toBe(created.id);
  });

  it("非法 URL 仍 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions/prefill",
      payload: { url: "javascript:alert(1)", categories: CATS },
    });
    expect(res.statusCode).toBe(400);
  });
});
