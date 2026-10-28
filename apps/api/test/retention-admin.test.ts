import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { ASSET_DOC_DIR } from "../src/storage.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-retention-admin-"));
  ctx = await createContext(loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { required: false },
    embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "models"), enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  }));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("任务入队与保留策略预演路由", () => {
  it("POST /api/jobs 拒绝未知字段，不会按默认参数入队", async () => {
    const before = (await ctx.repo.listJobs(undefined, 200)).length;
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { kind: "purge_trash", payload: { olderThan: 1 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("任务参数无效");
    expect((await ctx.repo.listJobs(undefined, 200)).length).toBe(before);
  });

  it("retention/preview 即使收到 apply:true 也只统计，不删事件或遥测", async () => {
    const old = Date.now() - 400 * 86_400_000;
    await ctx.repo.recordEvent("click", { siteId: null, meta: { identity: "preview" } });
    ctx.db.sqlite!.prepare("UPDATE events SET created_at = ? WHERE rowid = last_insert_rowid()").run(old);
    ctx.db.sqlite!.prepare("INSERT INTO health_checks (site_id, checked_at, ok) VALUES (?,?,1)").run("preview-old", old);
    ctx.db.sqlite!.prepare(
      "INSERT INTO llm_usage (id, scenario, source, model, ok, created_at) VALUES (?,?,?,?,1,?)",
    ).run("preview-old", "chat", "test", "m", old);

    const res = await app.inject({
      method: "POST",
      url: "/api/jobs/retention/preview",
      payload: { mode: "rollup", apply: true, telemetryDays: 90 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().apply).toBe(false);
    expect(res.json().telemetry).toMatchObject({ healthChecks: 1, llmUsage: 1 });
    expect(Number(ctx.db.sqlite!.prepare("SELECT COUNT(*) AS count FROM events WHERE kind = 'click'").get()?.count)).toBe(1);
    expect(Number(ctx.db.sqlite!.prepare("SELECT COUNT(*) AS count FROM health_checks WHERE site_id = 'preview-old'").get()?.count)).toBe(1);
    expect(Number(ctx.db.sqlite!.prepare("SELECT COUNT(*) AS count FROM llm_usage WHERE id = 'preview-old'").get()?.count)).toBe(1);
    expect(ctx.db.sqlite!.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'events_daily'").get()).toBeUndefined();
  });
});

describe("品牌资产删除边界", () => {
  it("只列举和删除命名白名单内的资产，不提供通用 KV 删除", async () => {
    const assetPath = `${ASSET_DOC_DIR}/logo-0123456789.png.json`;
    const applePath = `${ASSET_DOC_DIR}/appleTouchIcon-0123456789.png.json`;
    const otherDocPath = `${ASSET_DOC_DIR}/notes.json`;
    for (const path of [assetPath, applePath, otherDocPath]) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/storage",
        payload: { path, content: JSON.stringify({ path }) },
      });
      expect(res.statusCode).toBe(200);
    }

    const listed = await app.inject({ method: "GET", url: "/api/storage/list" });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().assets.map((asset: { path: string }) => asset.path)).toEqual(expect.arrayContaining([assetPath, applePath]));
    expect(listed.json().assets).toHaveLength(2);

    const rejected = await app.inject({
      method: "DELETE",
      url: "/api/storage",
      payload: { path: otherDocPath },
    });
    expect(rejected.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/storage?path=${encodeURIComponent(otherDocPath)}` })).json()).toEqual({ path: otherDocPath });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/storage",
      payload: { path: assetPath },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ ok: true, path: assetPath });
    expect((await app.inject({ method: "GET", url: `/api/storage?path=${encodeURIComponent(assetPath)}` })).json()).toBeNull();

    const missing = await app.inject({
      method: "DELETE",
      url: "/api/storage",
      payload: { path: assetPath },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("已保存的引用不可删除，清空保存后才能删除且不能重新引用已删资源", async () => {
    const name = "logo-aaaaaaaaaa.png";
    const path = `${ASSET_DOC_DIR}/${name}.json`;
    const configPath = "src/navsphere/content/site.json";
    await app.inject({ method: "PUT", url: "/api/storage", payload: { path, content: "{}" } });
    const config = { appearance: { logo: `/api/site/asset/${name}` } };
    const saved = await app.inject({ method: "PUT", url: "/api/storage", payload: { path: configPath, content: JSON.stringify(config) } });
    expect(saved.statusCode).toBe(200);
    const listed = (await app.inject({ method: "GET", url: "/api/storage/list" })).json();
    expect(listed.assets.find((asset: { path: string }) => asset.path === path).references).toEqual(["appearance.logo"]);
    const blocked = await app.inject({ method: "DELETE", url: "/api/storage", payload: { path } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.body).toContain("appearance.logo");
    await app.inject({ method: "PUT", url: "/api/storage", payload: { path: configPath, content: JSON.stringify({ appearance: { logo: "" } }) } });
    expect((await app.inject({ method: "DELETE", url: "/api/storage", payload: { path } })).statusCode).toBe(200);
    const staleSave = await app.inject({ method: "PUT", url: "/api/storage", payload: { path: configPath, content: JSON.stringify(config) } });
    expect(staleSave.statusCode).toBe(409);
    expect(staleSave.body).toContain("appearance.logo");
  });

  it("并发保存与删除只能一方成功，不会留下悬空引用", async () => {
    const path = `${ASSET_DOC_DIR}/pwaIcon192-cccccccccc.png.json`;
    const configPath = "src/navsphere/content/site.json";
    await app.inject({ method: "PUT", url: "/api/storage", payload: { path, content: "{}" } });
    const [saved, deleted] = await Promise.all([
      app.inject({ method: "PUT", url: "/api/storage", payload: { path: configPath, content: JSON.stringify({ appearance: { pwaIcon192: "/api/site/asset/pwaIcon192-cccccccccc.png" } }) } }),
      app.inject({ method: "DELETE", url: "/api/storage", payload: { path } }),
    ]);
    expect([saved.statusCode, deleted.statusCode].sort()).toEqual([200, 409]);
    const stored = (await app.inject({ method: "GET", url: `/api/storage?path=${encodeURIComponent(configPath)}` })).json();
    const asset = (await app.inject({ method: "GET", url: `/api/storage?path=${encodeURIComponent(path)}` })).json();
    if (stored.appearance?.pwaIcon192) expect(asset).not.toBeNull();
  });

  it("绝对地址、编码名及查询串也会被计入已保存引用", async () => {
    const path = `${ASSET_DOC_DIR}/ogImage-dddddddddd.png.json`;
    await app.inject({ method: "PUT", url: "/api/storage", payload: { path, content: "{}" } });
    await app.inject({ method: "PUT", url: "/api/storage", payload: {
      path: "src/navsphere/content/site.json",
      content: JSON.stringify({ basic: { ogImage: "https://navhub.example.com/api/site/asset/%6fgImage-dddddddddd.png?v=1" } }),
    } });
    expect((await app.inject({ method: "DELETE", url: "/api/storage", payload: { path } })).statusCode).toBe(409);
  });

  it("配置损坏时拒绝把资源误判为孤儿", async () => {
    const path = `${ASSET_DOC_DIR}/logo-bbbbbbbbbb.png.json`;
    await app.inject({ method: "PUT", url: "/api/storage", payload: { path, content: "{}" } });
    ctx.db.sqlite!.prepare("UPDATE jobs SET payload = ? WHERE id = 'kv:site-config'").run("{invalid");
    try {
      expect((await app.inject({ method: "DELETE", url: "/api/storage", payload: { path } })).statusCode).toBe(503);
      expect((await app.inject({ method: "GET", url: "/api/storage/list" })).statusCode).toBe(503);
      expect((await app.inject({ method: "GET", url: `/api/storage?path=${encodeURIComponent(path)}` })).json()).toEqual({});
    } finally {
      ctx.db.sqlite!.prepare("UPDATE jobs SET payload = ? WHERE id = 'kv:site-config'").run("{}");
    }
  });
});
