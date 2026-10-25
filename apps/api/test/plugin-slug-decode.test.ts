/**
 * 路径参数解码口径（2026-10-25 run47）。
 *
 * 后端 lint 的两个「未使用导入」error 不是随手多写的一行：`safeDecodeParam` 被引进
 * `plugin-audit.ts` / `plugin-overlap.ts` 却没接上调用点，于是这两条路由一直在用裸
 * `decodeURIComponent`。Node 对畸形百分号编码（`%zz`）抛 URIError，Fastify 折成 500 ——
 * 一个访客可控的 slug 就能打出服务端错误，而 CI 因为该步带 continue-on-error 从未报过。
 *
 * 这里钉两件事，缺一就是假统一：
 *   1. 畸形编码必须落在 4xx（走「查不到」或「参数不合法」），不得是 5xx；
 *   2. 合法编码仍要真的解码 —— 用回显的 slug 断言，避免有人为了过测把解码整个删掉。
 * 四个调用点同口径（audit / url-health / overlap / featured / versions）。
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
  dir = mkdtempSync(join(tmpdir(), "navhub-slug-decode-"));
  ctx = await createContext(loadConfig({ sqlitePath: join(dir, "decode.db") }));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  await new Promise((r) => setTimeout(r, 30));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows SQLite 句柄延迟释放
  }
});

/** 本轮改到的全部 :slug 路由；`%zz` 是会让 decodeURIComponent 抛 URIError 的输入 */
const SLUG_ROUTES: { method: "GET" | "POST" | "PATCH"; url: (slug: string) => string }[] = [
  { method: "POST", url: (s) => `/api/plugins/${s}/audit` },
  { method: "GET", url: (s) => `/api/plugins/${s}/url-health` },
  { method: "GET", url: (s) => `/api/plugins/${s}/overlap` },
  { method: "PATCH", url: (s) => `/api/plugins/${s}/featured` },
  { method: "POST", url: (s) => `/api/plugins/${s}/versions` },
];

describe("畸形百分号编码的 slug 不得变成 500", () => {
  for (const route of SLUG_ROUTES) {
    it(`${route.method} ${route.url(":slug")} ⇒ 4xx`, async () => {
      const res = await app.inject({
        method: route.method,
        url: route.url("%zz"),
        payload: {},
      });
      expect(res.statusCode, `响应体：${res.body.slice(0, 200)}`).toBeLessThan(500);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });
  }
});

describe("合法编码仍然解码（不能靠删掉解码来过测）", () => {
  it("回显的 slug 是解码后的原文，不是 %20", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins/a%20b/url-health" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("a b");
    expect(res.json().error).not.toContain("a%20b");
  });
});
