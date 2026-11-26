/**
 * requestId 三方对账：响应头、响应体、日志必须是同一个对外别名。
 *
 * 背景：错误处理器曾用内部 `req.id` 填包络，而响应头/404 用 onRequest 生成的
 * `requestId` 别名 —— 客户端拿着 body 里的 id 去查日志，查到的是另一条链路。
 * 这里钉住「头、体」一致；日志侧由 server.ts 的 req.log.error 生效（同一子 logger）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const RID = "probe-request-id-abc-123";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-request-id-"));
  ctx = await createContext(loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "models"), enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubRequestIdTest/0.1" },
    corsOrigins: ["*"],
  } as never));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("requestId 与响应头一致（客户端 id 能查到日志）", () => {
  it("仓储层错误（400，InvalidKeysetCursorError）走统一包络时用对外别名，不是内部 req.id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sites?cursor=not-a-cursor&limit=5",
      headers: { "x-request-id": RID },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers["x-request-id"]).toBe(RID);
    expect(res.json().requestId).toBe(RID);
  });

  it("未匹配路由（404）头体同源", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/definitely-not-a-route",
      headers: { "x-request-id": RID },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers["x-request-id"]).toBe(RID);
    expect(res.json().requestId).toBe(RID);
  });

  it("路由级 sendError 包络也带 requestId（error/code 机器码 + message 人话）", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sites/definitely-not-a-site",
      headers: { "x-request-id": RID },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers["x-request-id"]).toBe(RID);
    const body = res.json();
    expect(body.error).toBe("NOT_FOUND");
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toBe("站点不存在");
    expect(body.requestId).toBe(RID);
  });

  it("routes/shared 的 notFound() 助手：error 仍保留人话，新增 code 与 requestId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/categories/by-slug/definitely-not-a-category",
      headers: { "x-request-id": RID },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers["x-request-id"]).toBe(RID);
    const body = res.json();
    // 历史契约：error 是前端直接展示的人话，不能改成机器码
    expect(body.error).toBe("类目不存在");
    expect(body.code).toBe("NOT_FOUND");
    expect(body.requestId).toBe(RID);
  });
});
