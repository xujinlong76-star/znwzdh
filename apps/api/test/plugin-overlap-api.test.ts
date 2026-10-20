/**
 * 插件包重复预览（P0-2）测试。
 *
 * 重点锁住三件事，它们错了用户就会被误导：
 *   1. URL 等价形态必须与安装侧同口径（`https://a.com` ≡ `https://a.com/` ≡ 带 utm 的原文）；
 *   2. 软删除的站点不计入「已存在」——否则回收站里的旧站点会让用户以为装不进来；
 *   3. 包内自重复只算一次。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndCleanPluginManifest } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { urlLookupForms } from "../src/routes/plugin-overlap.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

function packManifest(name: string, urls: string[]) {
  const raw = {
    manifestVersion: 1,
    kind: "site-pack",
    name,
    description: "重复预览测试用网址包：覆盖尾斜杠、追踪参数与软删除三种等价场景。",
    version: "1.0.0",
    tags: ["test"],
    payload: {
      categories: [{ title: "测试类目" }],
      sites: urls.map((url, i) => ({ url, title: `测试站点 ${i}`, category: "测试类目" })),
    },
  };
  const validated = validateAndCleanPluginManifest(raw);
  if (!validated.ok) throw new Error(`测试清单不合法：${validated.errors.join("; ")}`);
  return validated.manifest;
}

async function seedPack(slug: string, name: string, urls: string[]) {
  await ctx.repo.createPlugin(
    { manifest: packManifest(name, urls), slug, status: "published", source: "seed", author: "测试" },
    { actor: "test", actorKind: "system" },
  );
}

/** 直接往库里放一个站点，模拟「之前装过别的包」或「用户手工加过」 */
async function seedSite(url: string, source = "manual") {
  const category = await ctx.repo.ensureCategory("测试类目", "test");
  return ctx.repo.createSiteWithId({
    // 与生产一致：落库存的是**原文**，去重靠两侧展开比对
    id: `site-${Math.random().toString(36).slice(2, 10)}`,
    url,
    title: `已有站点 ${url}`,
    description: null,
    categoryId: category,
    subCategoryId: null,
    tags: [],
    status: "active",
    enabled: true,
    source,
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-overlap-"));
  const config = loadConfig({ sqlitePath: join(dir, "overlap.db"), embedding: { enabled: false } });
  ctx = await createContext(config);
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app?.close();
  await ctx.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 上 SQLite 句柄释放可能稍晚，忽略即可
  }
});

describe("URL 等价形态（与安装侧同口径）", () => {
  it("尾斜杠、大小写域名、追踪参数都应互相命中", () => {
    const a = new Set(urlLookupForms("https://Example.com/"));
    expect(a.has("https://example.com/")).toBe(true);
    expect(a.has("https://example.com")).toBe(true);

    const b = new Set(urlLookupForms("https://example.com/?utm_source=x"));
    expect(b.has("https://example.com")).toBe(true);
    expect(b.has("https://example.com/")).toBe(true);
  });

  it("不同路径不应被当成同一条", () => {
    expect(urlLookupForms("https://example.com/a").every((f) => !f.includes("/b"))).toBe(true);
  });
});

describe("GET /api/plugins/:slug/overlap", () => {
  it("跨包重复：已存在的 URL 计入 existing，不重复计入 fresh", async () => {
    await seedSite("https://dup-a.example.com/");
    await seedSite("https://dup-b.example.com/page");
    await seedPack("overlap-pack", "重复预览包", [
      "https://dup-a.example.com", // 尾斜杠差异 → 命中
      "https://dup-b.example.com/page/?utm_source=newsletter", // 等价 → 命中
      "https://fresh-1.example.com",
      "https://fresh-2.example.com",
    ]);

    const res = await app.inject({ method: "GET", url: "/api/plugins/overlap-pack/overlap" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.declared).toBe(4);
    expect(body.unique).toBe(4);
    expect(body.existing).toBe(2);
    expect(body.fresh).toBe(2);
    expect(body.existingSamples.length).toBe(2);
  });

  it("包内自重复：清单校验层已按 URL 归一，declared 与 unique 都不重复计数", async () => {
    await seedPack("overlap-dup", "包内重复包", [
      "https://self-dup.example.com",
      "https://self-dup.example.com/",
    ]);
    const res = await app.inject({ method: "GET", url: "/api/plugins/overlap-dup/overlap" });
    const body = res.json();
    expect(body.declared).toBe(1);
    expect(body.unique).toBe(1);
  });

  it("软删除的站点不算已存在（回收站旧记录不应挡住重新导入）", async () => {
    const site = await seedSite("https://trashed.example.com");
    await ctx.repo.deleteSite(site.id);
    await seedPack("overlap-trashed", "回收站包", ["https://trashed.example.com"]);

    const res = await app.inject({ method: "GET", url: "/api/plugins/overlap-trashed/overlap" });
    const body = res.json();
    expect(body.existing).toBe(0);
    expect(body.fresh).toBe(1);
  });

  it("不存在的插件 404；非网址包 400", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/plugins/nope-nope/overlap" });
    expect(missing.statusCode).toBe(404);

    const themeManifest = validateAndCleanPluginManifest({
      manifestVersion: 1,
      kind: "theme",
      name: "测试主题",
      description: "仅用于验证非 site-pack 会被拒绝",
      version: "1.0.0",
      tags: ["test"],
      payload: { accent: "amber", tokens: { "--background": "40 40% 97%", "--foreground": "28 40% 14%" } },
    });
    if (!themeManifest.ok) throw new Error(`主题清单不合法：${themeManifest.errors.join("; ")}`);
    await ctx.repo.createPlugin(
      { manifest: themeManifest.manifest, slug: "overlap-theme", status: "published", source: "seed", author: "测试" },
      { actor: "test", actorKind: "system" },
    );
    const notPack = await app.inject({ method: "GET", url: "/api/plugins/overlap-theme/overlap" });
    expect(notPack.statusCode).toBe(400);
  });
});
