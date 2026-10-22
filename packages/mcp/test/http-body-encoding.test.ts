/**
 * MCP HTTP 入口的请求体解码契约。
 *
 * 旧实现 `raw += chunk` 把每个 Buffer 单独按 UTF-8 转字符串：TCP 分片落在多字节
 * 汉字中间时，那一格变成 U+FFFD。JSON 依旧解析成功、工具依旧返回 ok，
 * 于是中文标题/描述**看起来写进去了，实际已经损坏**——site-pack 的清单、
 * batch_import 的批量描述都是 routinely > 64KB 的纯中文载荷。
 *
 * 顺带钉住体积上限按**字节**计：`raw.length` 是字符数，与传给 SDK 的
 * maxRequestBodySize（字节）不同单位，纯中文载荷下旧实现相当于放宽 3 倍。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createContext, loadConfig, type AppContext } from "@navhub/api";
import { createMcpHttpServer } from "../src/http-server.ts";

let dir: string;
let ctx: AppContext;
let server: Server;
let base: string;

const TOKEN = "body-encoding-token";

function listen(s: Server): Promise<string> {
  return new Promise((resolve) => {
    s.listen(0, "127.0.0.1", () => resolve("http://127.0.0.1:" + (s.address() as AddressInfo).port));
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-mcp-body-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "body.db"),
      embedding: { model: "none", endpoint: "", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
      llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 3000 },
      fetch: { timeoutMs: 1200, maxBytes: 131072, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest" },
      corsOrigins: ["*"],
    } as never),
  );
  // create_site 的类目入参必须是叶子（G2 在写入口生效），夹具照真树形建
  await ctx.repo.createCategory({ id: "cat-body-root", title: "编码测试" });
  await ctx.repo.createCategory({ id: "cat-body", title: "编码测试子类目", parentId: "cat-body-root" });
  server = createMcpHttpServer({ ctx, token: TOKEN, scopes: ["read", "write"] });
  base = await listen(server);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP 请求体解码", () => {
  it("跨 TCP 分片的多字节正文不被拆坏（写进去的中文和收到的一致）", async () => {
    // 30000 个汉字 = 90000 字节，必然跨过 Node 单块 65536 字节的读取边界，
    // 而 65536 不是 3 的整数倍 → 分片点一定落在某个汉字的中间
    const description = "导".repeat(30_000);
    const url = "https://encoding-split.test/";
    const res = await fetch(base + "/tools/create_site", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify({ url, title: "分片测试", description, categoryId: "cat-body" }),
    });
    expect(res.status).toBe(200);

    const stored = await ctx.repo.findSiteByUrl(url);
    expect(stored).toBeTruthy();
    expect(stored!.description).toBe(description);
  });

  it("体积上限按字节而非字符计数", async () => {
    // 35 万个汉字：字符数 350K < 1_000_000，但字节数 1_050_000 > 上限
    const huge = "字".repeat(350_000);
    const res = await fetch(base + "/tools/create_site", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify({ url: "https://encoding-toolarge.test/", title: "超限", description: huge, categoryId: "cat-body" }),
    });
    expect(res.status).toBe(413);
    expect(await ctx.repo.findSiteByUrl("https://encoding-toolarge.test/")).toBeNull();
  });
});
