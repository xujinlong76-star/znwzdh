/**
 * getFileContent：NavHub 中枢不可达时的降级路径。
 *
 * 复现用户报告的真实现场 —— Next dev 跑着、NavHub 中枢（8787）没起：
 *   layout.tsx 的 generateMetadata -> getFileContent(site.json)
 *   -> http 适配器连不上中枢 -> 回退构建期基线。
 *
 * 回退本身是设计好的三级兜底；本测试锁定修复后的两点行为：
 *   1. 连接级故障**不再**逐请求刷 console.error（用户看到的就是这个刷屏）；
 *      熔断器每个冷静期窗口只在适配器层 warn 一次。
 *   2. 失败结果进微缓存（短 TTL），同一轮渲染的并发突发不会各连一次中枢。
 * 而「中枢活着但报错」（HTTP 500）依然必须 console.error —— 真异常要可见。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// github.ts 顶层 import 了 @/lib/auth（next-auth v5 beta）。http 适配器的
// 读写路径完全不碰 auth()（只有 github 适配器的写路径用），而 next-auth
// 在 vitest 的 Node ESM 解析下会因 "next/server" 缺扩展名导入失败。
// 这里按接口外形 mock 掉，让测试聚焦存储接缝本身。
vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve(null),
}));

const SITE_PATH = "src/navsphere/content/site.json";

process.env.STORAGE_ADAPTER = "http";
process.env.NAVHUB_STORAGE_BASE_URL = "http://127.0.0.1:8787";
// 关闭熔断：本文件要验证的正是失败路径的日志分级与缓存，
// 熔断行为由 storage-adapter.test.ts 覆盖。开着冷静期的话，
// 第二个用例会被冷静期挡住、根本走不到适配器。
process.env.NAVHUB_STORAGE_COOLDOWN_MS = "0";

/** 每个用例重新导入，拿到干净的模块状态（contentCache + 适配器单例） */
async function freshGithub() {
  vi.resetModules();
  return import("@/lib/github");
}

type GithubModule = typeof import("@/lib/github");
let github: GithubModule;

beforeEach(async () => {
  // 模拟 Node fetch 的连接级故障 —— 与用户报告里 "fetch failed" 同型
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
  github = await freshGithub();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("中枢不可达（连接级故障）", () => {
  it("回退构建期基线，且不刷 console.error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const site = await github.getFileContent<{ basic?: { title?: string } }>(SITE_PATH);

    expect(site.basic?.title).toBe("NavSphere导航"); // 基线内容
    expect(error).not.toHaveBeenCalled(); // 用户报告的刷屏根因
    expect(warn).toHaveBeenCalledTimes(1); // 熔断器跳闸公告，每窗一条
  });

  it("失败结果进微缓存：连续两次读取只发起一次连接", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.mocked(globalThis.fetch);
    github.invalidateContentCache();

    await github.getFileContent(SITE_PATH);
    await github.getFileContent(SITE_PATH);

    expect(fetchSpy).toHaveBeenCalledTimes(1); // 第二次命中失败缓存
  });

  it("没有基线的文件返回 {}，不抛错、不刷 error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const doc = await github.getFileContent("src/navsphere/content/user-doc.json");

    expect(doc).toEqual({});
    expect(error).not.toHaveBeenCalled();
  });
});

describe("中枢活着但返回 500（真异常）", () => {
  it("回退基线，但必须 console.error 让问题可见", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response("内部错误", { status: 500 }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const site = await github.getFileContent<{ basic?: { title?: string } }>(SITE_PATH);

    expect(site.basic?.title).toBe("NavSphere导航");
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain("[storage] 读取失败");
  });
});
