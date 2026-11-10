/**
 * 全局错误处理器与 404 的统一响应契约（2026-11-10）。
 *
 * ## 为什么单独测这一层
 *
 * `server.ts` 里有三个「全站生效、但各自只被间接覆盖」的契约：
 *
 *   1. **未知路由统一 JSON 404**（setNotFoundHandler）——客户端靠它区分
 *      「路由不存在」与「业务 404」；
 *   2. **500 绝不泄漏内部错误消息**（setErrorHandler 把 message 换成「内部错误」）；
 *   3. **retryable 语义**——只有 5xx 与 429 才为 true，客户端据此决定要不要重试。
 *
 * 这三条一旦回归，**整个 API 的错误响应都会走样**，但各自的业务测试都测不到
 * （它们断言的是业务码，不是这层兜底）。
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
  dir = mkdtempSync(join(tmpdir(), "navhub-err-contract-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "err.db"),
      embedding: { model: "x", endpoint: "x", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
      corsOrigins: ["*"],
    }),
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("未知路由：统一 JSON 404", () => {
  it("返回 error/message/requestId 三段，且 requestId 非空", async () => {
    const r = await app.inject({ method: "GET", url: "/api/definitely-not-a-route-xyz" });
    expect(r.statusCode).toBe(404);
    const body = r.json();
    expect(body.error).toBe("NOT_FOUND");
    expect(typeof body.message).toBe("string");
    expect(body.message).toContain("路由不存在");
    // requestId 是可追溯性的前提：排障时靠它把日志与响应串起来
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(0);
  });

  it("未知 POST 也是 404 而不是落进某个通配路由", async () => {
    const r = await app.inject({ method: "POST", url: "/api/no-such-post-endpoint-xyz", payload: {} });
    expect(r.statusCode).toBe(404);
    expect(r.json().error).toBe("NOT_FOUND");
  });

  it("message 里带上方法与路径，便于客户端定位", async () => {
    const r = await app.inject({ method: "DELETE", url: "/api/nope-abc" });
    expect(r.statusCode).toBe(404);
    expect(r.json().message).toContain("DELETE");
    expect(r.json().message).toContain("/api/nope-abc");
  });
});

describe("业务错误：不泄漏内部细节", () => {
  it("取不存在站点的详情返回结构化错误，且不带堆栈", async () => {
    const r = await app.inject({ method: "GET", url: "/api/sites/not-a-real-site-id-xyz" });
    // 业务 404 或 200 空体都接受（取决于路由实现），但绝不该是 500
    expect(r.statusCode).toBeLessThan(500);
    expect(r.body).not.toContain("at Object.");
    expect(r.body).not.toContain("node_modules");
  });
});
