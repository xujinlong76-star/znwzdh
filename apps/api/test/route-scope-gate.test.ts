/**
 * 路由 scope 白名单闸门。
 *
 * 为什么要钉住这条：`config.scope` 是自由对象字段，TypeScript 的 `RouteScope` 联合类型
 * 挡不住 `scope: "adminn"` 这种拼写错误。改造前它不会在任何地方报错，后果分两层——
 * 请求侧 `scopeSatisfies` 查不到 rank，`have >= undefined` 恒为 false，于是这条路由
 * 从此**人人 403**（数据是保住了，但功能静默死掉，只在真实调用时才暴露）；
 * 文档侧更糟：一个根本不存在的权限名会被印进公开的 `/api/openapi.json`。
 *
 * 现在的口径：注册瞬间抛错。装配期红一次，胜过线上静默失效。
 *
 * 顺序约束（别调）：Fastify 一旦进入 ready/监听就不许再加路由，
 * 而 `app.inject` 会隐式触发 ready——所以所有「注册探针」的用例必须排在
 * 需要 inject 的用例前面。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { KNOWN_ROUTE_SCOPES } from "../src/auth.ts";

describe("路由 scope 白名单闸门", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-scope-gate-"));
    ctx = await createContext(
      loadConfig({
        mode: "lite",
        sqlitePath: join(dir, "api.db"),
        corsOrigins: ["*"],
      }),
    );
    // 故意不 await app.ready()：ready 之后再加路由会被 Fastify 拒绝
    app = await buildServer(ctx);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("合法 scope 与缺省（不写 scope = public）照常注册", () => {
    for (const scope of ["public", "read", "write", "admin"]) {
      expect(() =>
        app.get(`/api/__scope_ok_${scope}`, { config: { scope: scope as never } }, () => ({ ok: true })),
      ).not.toThrow();
    }
    expect(() => app.get("/api/__scope_ok_default", () => ({ ok: true }))).not.toThrow();
  });

  it("拼错的 scope 在注册瞬间抛错，并点名是哪条路由", () => {
    expect(() =>
      app.get("/api/__scope_probe_typo", { config: { scope: "adminn" as never } }, () => ({ ok: true })),
    ).toThrow(/未知 scope/);

    // 报错必须带方法+路径：只给 scope 名的话，几百条路由里没人能定位到是谁写错了
    let message = "";
    try {
      app.get("/api/__scope_probe_locate", { config: { scope: "writ" as never } }, () => ({ ok: true }));
    } catch (err) {
      message = String((err as Error).message);
    }
    expect(message).toContain("未知 scope");
    expect(message).toContain("GET /api/__scope_probe_locate");
    // 白名单原文也要带上：写错的人不必再去翻 auth.ts 才知道合法值有哪些
    expect(message).toContain("public/read/write/admin");
  });

  it("被挡住的路由不会带着假 scope 溜进公开的 OpenAPI 文档", async () => {
    const res = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(res.statusCode).toBe(200);
    const text = res.payload;
    expect(text).not.toContain("__scope_probe_typo");
    expect(text).not.toContain("__scope_probe_locate");
    // 合法探针路由应当正常入册，证明闸门没有顺手关掉正常注册
    expect(text).toContain("__scope_ok_admin");
  });

  it("白名单与鉴权口径一致：admin ⊇ write ⊇ read，public 不参与鉴权", () => {
    expect([...KNOWN_ROUTE_SCOPES].sort()).toEqual(["admin", "public", "read", "write"]);
  });
});
