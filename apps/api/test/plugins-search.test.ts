/**
 * 插件语义检索集成测试（D2）：
 *  1. 降级通道：embedding 关闭时 /api/plugins/search 关键词回退 + degraded 标注，
 *     /similar 空列表 + degraded，未上架 404；
 *  2. 语义通道（桩编码器 + MemoryVectorStore 替换 ctx.pluginVectors）：
 *     审核上架即建向量、查询命中正确、相似插件排除自身、下架同步摘向量。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryVectorStore } from "@navhub/store";
import type { EmbeddingService } from "@navhub/ai";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const sitePack = (name: string, description: string, siteTitle: string) => ({
  manifestVersion: 1,
  kind: "site-pack",
  name,
  description,
  version: "1.0.0",
  tags: ["检索测试"],
  payload: {
    categories: [{ title: "检索测试类目" }],
    sites: [{ url: `https://${encodeURIComponent(siteTitle)}.example.com`, title: siteTitle }],
  },
});

async function publishAndApprove(name: string, description: string, siteTitle: string): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/plugins?anonId=search-test-owner",
    payload: sitePack(name, description, siteTitle),
  });
  expect(created.statusCode).toBe(201);
  const slug = created.json().slug as string;

  const approved = await app.inject({
    method: "POST",
    url: `/api/plugins/${encodeURIComponent(slug)}/review`,
    payload: { action: "approve" },
  });
  expect(approved.statusCode).toBe(200);
  return slug;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugins-search-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("插件检索：模型关闭时关键词回退（degraded 标注）", () => {
  it("search：命中已上架插件，mode=keyword 且 degraded=true", async () => {
    const slug = await publishAndApprove("降级召回包", "适合关键词兜底的检索测试插件", "降级站点");

    const res = await app.inject({
      method: "GET",
      url: "/api/plugins/search?q=" + encodeURIComponent("降级召回"),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe("keyword");
    expect(body.degraded).toBe(true);
    expect(body.items.some((p: { slug: string }) => p.slug === slug)).toBe(true);
  });

  it("空 q 等价于浏览：degraded=false，kind 过滤生效", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins/search?kind=theme" });
    const body = res.json();
    expect(body.mode).toBe("keyword");
    expect(body.degraded).toBe(false);
    expect(body.items.every((p: { kind: string }) => p.kind === "theme")).toBe(true);
  });

  it("similar：无向量可用时返回空列表 + degraded=true（前端静默隐藏）", async () => {
    const slug = await publishAndApprove("无向量包", "尚未建立语义向量的插件", "无向量站");
    const res = await app.inject({ method: "GET", url: `/api/plugins/${slug}/similar` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toEqual([]);
    expect(body.degraded).toBe(true);
  });

  it("similar：不存在的插件返回 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins/no-such-plugin/similar" });
    expect(res.statusCode).toBe(404);
  });
});

describe("插件检索：桩编码器下的语义通道", () => {
  const DIM = 8;

  /** 确定性簇向量：同簇余弦距离 ~0，异簇远离（不过分追求正交，断言只依赖"自身最近"） */
  function clusterVec(seed: number): Float32Array {
    const a = new Float32Array(DIM);
    for (let i = 0; i < DIM; i++) a[i] = Math.sin(seed * 9.7 + i * 0.3) + 0.05;
    return a;
  }
  const vDesign = clusterVec(1);
  const vDev = clusterVec(2);
  const vOther = clusterVec(3);

  function encodeText(t: string): Float32Array {
    if (t.includes("设计")) return vDesign;
    if (t.includes("开发")) return vDev;
    return vOther;
  }

  let designSlug = "";
  let devSlug = "";
  let themeSlug = "";

  beforeAll(async () => {
    // 桩编码器：替换 ctx.embedding 与 ctx.pluginVectors（维度对齐到 DIM）
    const stub: EmbeddingService = {
      dim: DIM,
      model: "stub-encoder",
      encode: async (t: string) => encodeText(t),
      encodeBatch: async (ts: string[]) => ts.map((t) => encodeText(t)),
      ready: () => true,
      warmup: async () => true,
    };
    ctx.embedding = stub;
    ctx.pluginVectors = new MemoryVectorStore(DIM);

    designSlug = await publishAndApprove("设计师灵感合集", "为设计师准备的灵感采集网址包", "设计灵感站");
    devSlug = await publishAndApprove("开发者效率工具集", "面向开发者的效率工具合集", "开发工具站");
    themeSlug = await publishAndApprove("暮色主题", "深色极简风格主题包", "主题展示站");
  });

  it("审核上架即建立向量：plugin_embeddings 有行且维度正确", async () => {
    const back = await ctx.repo.getPluginEmbedding(designSlug);
    expect(back).not.toBeNull();
    expect(back!.length).toBe(DIM);
  });

  it("search：与查询向量最近的插件排第一，mode=semantic 且 not degraded", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/plugins/search?q=" + encodeURIComponent("寻找设计灵感"),
    });
    const body = res.json();
    expect(body.mode).toBe("semantic");
    expect(body.degraded).toBe(false);
    expect(body.items[0].slug).toBe(designSlug);
    expect(body.items[0].score).toBeGreaterThan(0.99);
  });

  it("search：kind 过滤在语义结果上生效（无匹配时返回空语义列表）", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/plugins/search?q=" + encodeURIComponent("设计") + "&kind=workspace-preset",
    });
    const body = res.json();
    expect(body.mode).toBe("semantic");
    expect(body.items).toEqual([]);
  });

  it("similar：排除自身，返回同池的已上架插件", async () => {
    const res = await app.inject({ method: "GET", url: `/api/plugins/${designSlug}/similar` });
    const body = res.json();
    expect(body.degraded).toBe(false);
    const slugs = body.items.map((p: { slug: string }) => p.slug);
    expect(slugs).not.toContain(designSlug);
    expect(slugs).toContain(devSlug);
    expect(slugs).toContain(themeSlug);
  });

  it("下架后：持久层向量被摘除，搜索与相似都不再包含它", async () => {
    const delist = await app.inject({
      method: "POST",
      url: `/api/plugins/${devSlug}/review`,
      payload: { action: "delist" },
    });
    expect(delist.statusCode).toBe(200);

    expect(await ctx.repo.getPluginEmbedding(devSlug)).toBeNull();

    const similar = await app.inject({ method: "GET", url: `/api/plugins/${designSlug}/similar` });
    expect(similar.json().items.map((p: { slug: string }) => p.slug)).not.toContain(devSlug);

    const search = await app.inject({
      method: "GET",
      url: "/api/plugins/search?q=" + encodeURIComponent("开发者效率工具"),
    });
    expect(search.json().items.map((p: { slug: string }) => p.slug)).not.toContain(devSlug);
  });
});
