/**
 * embedding.ts 补充覆盖：缓存 size、站点/插件索引文本、warmup / encodeBatch、
 * 进程内加载器（mock @huggingface/transformers，模型不可用时不碰真网络）。
 *
 * 注意：Worker 线程隔离路径（getWorker）需要真实 Worker 内加载模型，
 * 本文件只覆盖 warmup 的 Worker 入口（非法 dtype 时快速失败回退），
 * 不对 30s 超时内的真实模型下载做断言。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockEnv, mockPipeline } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, unknown>,
  mockPipeline: vi.fn(),
}));

vi.mock("@huggingface/transformers", () => ({
  pipeline: mockPipeline,
  env: mockEnv,
}));

import {
  createEmbeddingCache,
  createEmbeddingService,
  pluginEmbeddingText,
  siteEmbeddingText,
} from "../src/embedding.ts";

function fakeExtractor(dim: number, fill = 0.5) {
  return vi.fn(async () => ({ data: Array.from({ length: dim }, () => fill) }));
}

describe("createEmbeddingCache().size", () => {
  it("size 随写入增长", async () => {
    const cache = createEmbeddingCache(8);
    expect(cache.size).toBe(0);
    await cache.getOrCompute("a", async () => new Float32Array([1]));
    expect(cache.size).toBe(1);
    await cache.getOrCompute("b", async () => new Float32Array([2]));
    expect(cache.size).toBe(2);
    await cache.getOrCompute("a", async () => new Float32Array([9]));
    expect(cache.size).toBe(2);
  });
});

describe("siteEmbeddingText", () => {
  it("仅标题 / 标题+描述 / 标题+描述+网址", () => {
    expect(siteEmbeddingText({ title: "GitHub" })).toBe("为这个网站生成表示：GitHub");
    expect(siteEmbeddingText({ title: "GitHub", description: "代码托管" })).toBe(
      "为这个网站生成表示：GitHub。描述：代码托管",
    );
    expect(
      siteEmbeddingText({ title: "GitHub", description: "代码托管", url: "https://github.com" }),
    ).toBe("为这个网站生成表示：GitHub。描述：代码托管。网址：https://github.com");
  });
});

describe("pluginEmbeddingText", () => {
  it("仅名称；描述 / 类型 / 标签 / 站点标题依次拼接", () => {
    expect(pluginEmbeddingText({ name: "设计包" })).toBe("为这个插件生成表示：设计包");
    expect(
      pluginEmbeddingText({
        name: "设计包",
        description: "设计工具合集",
        kind: "site-pack",
        tags: ["设计", "工具"],
        sampleTitles: ["Figma", "Sketch"],
      }),
    ).toBe(
      "为这个插件生成表示：设计包。描述：设计工具合集。类型：网址包。标签：设计 / 工具。包含：Figma、Sketch",
    );
  });

  it("未知 kind 原样保留；空标签/空站点标题不拼接；站点标题只取前 12 个", () => {
    expect(pluginEmbeddingText({ name: "P", kind: "mystery-kind" })).toContain("类型：mystery-kind");
    expect(pluginEmbeddingText({ name: "P", tags: [], sampleTitles: [] })).toBe(
      "为这个插件生成表示：P",
    );
    const titles = Array.from({ length: 15 }, (_, i) => `站点${i + 1}`);
    const text = pluginEmbeddingText({ name: "P", sampleTitles: titles });
    expect(text).toContain("站点12");
    expect(text).not.toContain("站点13");
    expect(pluginEmbeddingText({ name: "P", kind: "theme" })).toContain("类型：主题");
    expect(pluginEmbeddingText({ name: "P", kind: "workspace-preset" })).toContain("类型：工作台预设");
  });
});

describe("createEmbeddingService 进程内路径（mock transformers）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  });

  it("warmup 成功：模型加载后 ready() 为 true，endpoint 尾斜杠两种写法都归一化", async () => {
    mockPipeline.mockResolvedValue(fakeExtractor(4));
    const svc = createEmbeddingService({ useWorker: false, dim: 4, endpoint: "https://hf.example.com" });
    expect(await svc.warmup()).toBe(true);
    expect(svc.ready()).toBe(true);
    expect(mockEnv.remoteHost).toBe("https://hf.example.com/");
    await svc.close?.();

    mockPipeline.mockResolvedValue(fakeExtractor(4));
    const svc2 = createEmbeddingService({ useWorker: false, dim: 4, endpoint: "https://hf.example.com/" });
    expect(await svc2.warmup()).toBe(true);
    expect(mockEnv.remoteHost).toBe("https://hf.example.com/");
    await svc2.close?.();
  });

  it("encode 成功：归一化输入进缓存，第二次命中不再调模型", async () => {
    const extractor = fakeExtractor(3, 0.25);
    mockPipeline.mockResolvedValue(extractor);
    const svc = createEmbeddingService({ useWorker: false, dim: 3 });
    const vec = await svc.encode("  Hello World ");
    expect(Array.from(vec)).toEqual([0.25, 0.25, 0.25]);
    expect(svc.stats?.()).toMatchObject({ size: 1, misses: 1 });
    const vec2 = await svc.encode("hello world");
    expect(vec2).toBe(vec);
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(svc.stats?.()).toMatchObject({ size: 1, hits: 1 });
    await svc.close?.();
  });

  it("encodeBatch 按原序返回；空数组直接返回空数组", async () => {
    mockPipeline.mockResolvedValue(fakeExtractor(2));
    const svc = createEmbeddingService({ useWorker: false, dim: 2 });
    expect(await svc.encodeBatch([])).toEqual([]);
    const out = await svc.encodeBatch(["a", "b", "c", "d", "e"]);
    expect(out).toHaveLength(5);
    expect(out.every((v) => v.length === 2)).toBe(true);
    await svc.close?.();
  });

  it("维度不符时抛错且不写缓存", async () => {
    mockPipeline.mockResolvedValue(fakeExtractor(3));
    const svc = createEmbeddingService({ useWorker: false, dim: 512 });
    await expect(svc.encode("hello")).rejects.toThrow("embedding 维度不符：期望 512，实际 3");
    expect(svc.stats?.().size).toBe(0);
    await svc.close?.();
  });

  it("非法 dtype 时加载快速失败：warmup 返回 false，encode 抛错", async () => {
    const svc = createEmbeddingService({
      useWorker: false,
      dtype: "bogus" as never,
      model: "fake-model",
    });
    expect(await svc.warmup()).toBe(false);
    expect(svc.ready()).toBe(false);
    await expect(svc.encode("hello")).rejects.toThrow("非法 embedding dtype: bogus");
    await expect(svc.encodeBatch(["x"])).rejects.toThrow("非法 embedding dtype: bogus");
    await svc.close?.();
  });

  it("空输入在 encodeBatch 里同样被拦截", async () => {
    const svc = createEmbeddingService({ useWorker: false });
    await expect(svc.encodeBatch([""])).rejects.toThrow("embedding 输入为空");
    await svc.close?.();
  });

  it("pipeline 抛错时 warmup 返回 false、encode 抛模型不可用", async () => {
    mockPipeline.mockRejectedValue(new Error("下载失败"));
    const svc = createEmbeddingService({ useWorker: false, model: "fake-model" });
    expect(await svc.warmup()).toBe(false);
    await expect(svc.encode("hello")).rejects.toThrow("embedding 模型不可用: 下载失败");
    await svc.close?.();
  });
});

describe("createEmbeddingService Worker 入口", () => {
  it("warmup 在 Worker 模式 + 非法 dtype 时快速失败，不挂起", async () => {
    const svc = createEmbeddingService({
      useWorker: true,
      dtype: "bogus" as never,
      model: "fake-model",
    });
    expect(svc.ready()).toBe(false);
    expect(await svc.warmup()).toBe(false);
    expect(svc.ready()).toBe(false);
    await svc.close?.();
    await svc.close?.();
  });
});
