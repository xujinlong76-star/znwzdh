/**
 * getFileContent：NavHub 中枢正常在线时的行为回归。
 *
 * 起一个真实的 node:http 服务当中枢，验证：
 *   1. 中枢数据优先于构建期基线（降级逻辑不会误伤正常路径）；
 *   2. 成功结果进微缓存，invalidateContentCache 后精确失效；
 *   3. 中枢返回 null（文件从未写入过）-> 静默回退基线，零日志。
 */
import { describe, expect, it, vi, beforeEach, afterAll, beforeAll } from "vitest";
import { createServer, type Server } from "node:http";
import { getFileContent, invalidateContentCache } from "@/lib/github";

// 同 github-fallback.test.ts：http 路径不碰 auth()，mock 掉以绕开
// next-auth v5 beta 在 vitest Node ESM 下的 "next/server" 解析问题。
vi.mock("@/lib/auth", () => ({
  auth: () => Promise.resolve(null),
}));

/** 中枢收到的读取请求路径，用于断言缓存行为 */
const seenPaths: string[] = [];

const server: Server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/api/storage") {
    res.writeHead(404).end();
    return;
  }
  const path = url.searchParams.get("path") ?? "";
  seenPaths.push(path);
  res.writeHead(200, { "Content-Type": "application/json" });
  if (path.endsWith("site.json")) {
    res.end(JSON.stringify({ basic: { title: "中枢实时标题" }, appearance: { favicon: "/hub.ico" } }));
  } else if (path.endsWith("custom-doc.json")) {
    res.end(JSON.stringify({ custom: true }));
  } else {
    res.end("null"); // 从未写入过
  }
});

let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  baseUrl = "http://127.0.0.1:" + port;
  process.env.STORAGE_ADAPTER = "http";
  process.env.NAVHUB_STORAGE_BASE_URL = baseUrl;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seenPaths.length = 0;
  invalidateContentCache();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("中枢在线", () => {
  it("中枢数据优先于构建期基线", async () => {
    const site = await getFileContent<{ basic?: { title?: string } }>("src/navsphere/content/site.json");

    expect(site.basic?.title).toBe("中枢实时标题");
    expect(seenPaths).toEqual(["src/navsphere/content/site.json"]);
  });

  it("成功结果进微缓存：连续两次读取只请求中枢一次", async () => {
    await getFileContent("src/navsphere/content/site.json");
    await getFileContent("src/navsphere/content/site.json");

    expect(seenPaths).toHaveLength(1);
  });

  it("invalidateContentCache 后重新读取（写后失效语义保持）", async () => {
    await getFileContent("src/navsphere/content/site.json");
    invalidateContentCache("src/navsphere/content/site.json");
    await getFileContent("src/navsphere/content/site.json");

    expect(seenPaths).toHaveLength(2);
  });

  it("中枢返回 null（文件从未写入过）-> 静默回退基线，零日志", async () => {
    const nav = await getFileContent<{ navigationItems: unknown[] }>("src/navsphere/content/navigation.json");

    expect(nav.navigationItems.length).toBeGreaterThan(0); // 基线导航内容
    expect(seenPaths).toEqual(["src/navsphere/content/navigation.json"]);
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("无基线的自定义文档直接透传中枢内容", async () => {
    const doc = await getFileContent<{ custom?: boolean }>("src/navsphere/content/custom-doc.json");

    expect(doc).toEqual({ custom: true });
  });
});
