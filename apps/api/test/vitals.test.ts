/**
 * RUM 上报端点（POST /api/vitals）的回归。
 *
 * 这条链路是 sendBeacon 的 fire-and-forget，出错不能影响页面，
 * 但也不能「静默什么都收」：指标名必须白名单、数值必须有界，
 * 否则 events 表会被脏数据灌满（这是公开端点，无鉴权）。
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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-vitals-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/vitals", () => {
  it("合法指标返回 204，并落一条 vitals 事件", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/vitals",
      payload: { name: "LCP", value: 1832.4, rating: "good", path: "/hot" },
    });
    expect(res.statusCode).toBe(204);

    const rows = await ctx.repo.raw("SELECT kind, meta FROM events WHERE kind = ?", ["vitals"]);
    expect(rows.length).toBe(1);
    expect(String(rows[0].meta)).toContain("LCP");
  });

  it("非法指标名返回 400（公开端点必须白名单）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/vitals",
      payload: { name: "EVIL", value: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("数值越界返回 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/vitals",
      payload: { name: "CLS", value: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("不带身份字段也不会报错（匿名上报）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/vitals",
      payload: { name: "TTFB", value: 120 },
    });
    expect(res.statusCode).toBe(204);
  });
});
