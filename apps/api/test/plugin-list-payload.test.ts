/**
 * 插件市场列表的**载荷契约**回归。
 *
 * 背景（2026-10 实测）：`GET /api/plugins?limit=24` 的响应是 1.16MB，
 * 其中 730KB 是 site-pack 的完整 manifest —— 而列表页、卡片、安装弹窗
 * 都不读它（安装由服务端按 slug 读库，详情页走 `/api/plugins/:slug`）。
 * 现在默认精简：site-pack 不带 manifest，其余类型保持原样；
 * 需要完整清单的工具场景（Raycast 扩展的「复制 JSON」）显式带 `?manifest=1`。
 *
 * 这个测试锁的是三条：
 *  1. 默认：site-pack 无 manifest，但 summary 仍在（卡片计数依赖它）
 *  2. 默认：theme 等小清单类型不受影响（客户端安装要读 payload.tokens）
 *  3. `?manifest=1`：完整清单回来（否则工具场景静默拿到 undefined）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndCleanPluginManifest } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

function sitePack(name: string) {
  const raw = {
    manifestVersion: 1,
    kind: "site-pack",
    name,
    version: "1.0.0",
    description: "测试网址包",
    tags: ["测试"],
    payload: {
      categories: [{ title: "测试类目" }],
      sites: Array.from({ length: 12 }, (_, i) => ({
        url: `https://example-${i}.test/`,
        title: `站点 ${i}`,
        category: "测试类目",
      })),
    },
  } as const;
  const validated = validateAndCleanPluginManifest(raw as never);
  if (!validated.ok) throw new Error("清单不合法：" + validated.errors.join("; "));
  return validated.manifest;
}

function themePack(name: string) {
  const raw = {
    manifestVersion: 1,
    kind: "theme",
    name,
    version: "1.0.0",
    description: "测试主题",
    tags: ["测试"],
    payload: { accent: "violet", tokens: { "--primary": "262 83% 58%", "--primary-foreground": "0 0% 100%" } },
  } as const;
  const validated = validateAndCleanPluginManifest(raw as never);
  if (!validated.ok) throw new Error("清单不合法：" + validated.errors.join("; "));
  return validated.manifest;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-payload-"));
  ctx = await createContext(loadConfig({ sqlitePath: join(dir, "payload.db"), embedding: { enabled: false } } as never));
  await ctx.repo.createPlugin(
    { manifest: sitePack("载荷测试网址包"), slug: "payload-site-pack", status: "published", source: "seed", author: "测试" },
    { actor: "test", actorKind: "system" },
  );
  await ctx.repo.createPlugin(
    { manifest: themePack("载荷测试主题"), slug: "payload-theme", status: "published", source: "seed", author: "测试" },
    { actor: "test", actorKind: "system" },
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/plugins 载荷契约", () => {
  it("默认：site-pack 不带 manifest，但 summary 保留", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins?limit=50" });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<Record<string, any>>;
    const pack = items.find((i) => i.slug === "payload-site-pack");
    expect(pack).toBeTruthy();
    expect(pack!.manifest).toBeUndefined();
    expect(pack!.summary.siteCount).toBe(12);
    expect(pack!.summary.categoryCount).toBe(1);
  });

  it("默认：theme 的清单保留（客户端激活主题要读 payload.tokens）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins?limit=50" });
    const items = res.json().items as Array<Record<string, any>>;
    const theme = items.find((i) => i.slug === "payload-theme");
    expect(theme!.manifest).toBeTruthy();
    expect(theme!.manifest.kind).toBe("theme");
  });

  it("?manifest=1：site-pack 的完整清单回来", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins?limit=50&manifest=1" });
    const items = res.json().items as Array<Record<string, any>>;
    const pack = items.find((i) => i.slug === "payload-site-pack");
    expect(pack!.manifest).toBeTruthy();
    expect(pack!.manifest.payload.sites).toHaveLength(12);
  });
});
