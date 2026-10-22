/**
 * 导出端点契约（方案 2026-10-23 · P1-7）。
 *
 * 三个导出端点是「用户把数据带走」的唯一通道，此前零测试：
 * `GET /api/export/bookmarks.html`、`GET /api/export/backup.json`、
 * `GET /api/me/export`。这里锁 content-type / content-disposition 与内容完整性，
 * 防止某次重构把 attachment 头或编码丢掉（浏览器会直接把 JSON 渲染成页面）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const base = {
  mode: "lite" as const,
  embedding: { model: "none", endpoint: "", dtype: "q8" as const, dim: 512, enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubExportTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-export-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "export.db") } as never));
  app = await buildServer(ctx);
  await app.ready();

  const cat = await ctx.repo.createCategory({ id: "cat-export", title: "导出测试类目", slug: "export-test" });
  await ctx.repo.createSite({
    url: "https://export.example.com/one",
    title: "导出测试站点",
    description: "用于验证导出端点",
    categoryId: cat.id,
  });
});

afterAll(async () => {
  await app.close();
  await new Promise((r) => setTimeout(r, 30));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 上 SQLite 句柄释放有延迟，临时目录交给系统回收
  }
});

describe("导出端点", () => {
  it("书签 HTML：attachment + text/html，且包含站点标题", async () => {
    const res = await app.inject({ method: "GET", url: "/api/export/bookmarks.html" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain("navhub-bookmarks.html");
    expect(res.body).toContain("NETSCAPE");
    expect(res.body).toContain("导出测试站点");
  });

  it("冷备 JSON：attachment + application/json，内容可解析且包含站点", async () => {
    const res = await app.inject({ method: "GET", url: "/api/export/backup.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toContain(".nhbak.json");
    const parsed = JSON.parse(res.body) as { sites?: Array<{ url?: string }>; version?: unknown };
    expect(Array.isArray(parsed.sites)).toBe(true);
    expect(parsed.sites?.some((s) => String(s.url ?? "").includes("export.example.com/one"))).toBe(true);
  });

  it("个人数据导出：attachment + JSON，含收藏/设置等字段", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/export?anonId=anon-export-user" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain("navhub-export-");
    const payload = JSON.parse(res.body) as Record<string, unknown>;
    for (const key of ["favorites", "favoriteFolders", "searchHistory", "settings", "crdt"]) {
      expect(payload).toHaveProperty(key);
    }
  });
});
