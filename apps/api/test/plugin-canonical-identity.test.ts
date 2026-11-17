/**
 * Phase 2 批 B 回归锁：身份合并后，插件域用户态读写跟随 canonical 身份。
 *
 * 身份合并（identity_aliases）之后，旧 id 仍是一枚合法且已签名的身份：
 * 扩展、MCP、没刷新的旧标签页都会继续用它发请求。若插件路由直接用
 * 原始 id 读写，合并前的安装/星标/评价在旧身份视角下「消失」，写入
 * 又会另起孤儿行。本文件锁两件事：
 *   1. 以旧 id 读已安装列表 / 详情 / 市场列表 / 评价列表，拿到的都是
 *      canonical 名下的数据（详情 installed=true、评价按钮门禁恢复）；
 *   2. 以旧 id 写评价/安装，落库归属是 canonical（旧 id 不留任何行）。
 *
 * 不动：isOwner 比较、/mine、发布时的 ownerIdentity 归属（仍用原始 identity）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndCleanPluginManifest } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const OLD = "anon-phase2b-old-0001";
const NEW = "github:phase2b-new-0001";
const SLUG = "phase2b-pack";

function themeManifest(name: string) {
  const raw = {
    manifestVersion: 1,
    kind: "theme",
    name,
    version: "1.0.0",
    description: "Phase2B 复现主题",
    tags: ["测试"],
    payload: { accent: "violet", tokens: { "--primary": "262 83% 58%", "--primary-foreground": "0 0% 100%" } },
  } as const;
  const validated = validateAndCleanPluginManifest(raw as never);
  if (!validated.ok) throw new Error("清单不合法：" + validated.errors.join("; "));
  return validated.manifest;
}

const base = {
  mode: "lite" as const,
  embedding: { model: "none", endpoint: "", dtype: "q8" as const, dim: 512, enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubPhase2bTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const H = { "x-navhub-anon-id": OLD };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-phase2b-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "phase2b.db") } as never));
  app = await buildServer(ctx);
  await app.ready();
  await ctx.repo.createPlugin(
    {
      manifest: themeManifest("Phase2B 复现包"),
      slug: SLUG,
      status: "published",
      source: "seed",
      author: "github:someone-else",
      ownerIdentity: "github:someone-else",
    },
    { actor: "test", actorKind: "system" },
  );

  // 合并前：旧身份安装 + 发评价（走 HTTP，验链路本身是通的）
  const install = await app.inject({ method: "POST", url: `/api/plugins/${SLUG}/install`, headers: H, payload: {} });
  expect(install.statusCode).toBe(200);
  const review = await app.inject({
    method: "POST",
    url: `/api/plugins/${SLUG}/reviews`,
    headers: H,
    payload: { rating: 5, title: "好用", content: "合并前发的评价" },
  });
  expect(review.statusCode).toBe(201);
  const star = await app.inject({ method: "POST", url: `/api/plugins/${SLUG}/star`, headers: H, payload: {} });
  expect(star.statusCode).toBe(200);

  const merged = await ctx.repo.mergeIdentity(OLD, NEW);
  expect(merged.target).toBe(NEW);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("合并后旧身份读回（B-1）", () => {
  it("GET /api/plugins/installed（旧身份头）→ 看到已安装", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins/installed", headers: H });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ slug: string }> };
    expect(body.items.map((i) => i.slug)).toContain(SLUG);
  });

  it("GET /api/plugins/:slug（旧身份头）→ installed=true 且 myReview 非空", async () => {
    const res = await app.inject({ method: "GET", url: `/api/plugins/${SLUG}`, headers: H });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { plugin: { installed: boolean; myReview: unknown } };
    expect(body.plugin.installed).toBe(true);
    expect(body.plugin.myReview).not.toBeNull();
  });

  it("GET /api/plugins（旧身份头）→ 列表项 installed=true 且 starred=true", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins?limit=100", headers: H });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ slug: string; installed: boolean; starred: boolean }> };
    const item = body.items.find((i) => i.slug === SLUG);
    expect(item).toBeDefined();
    expect(item!.installed).toBe(true);
    expect(item!.starred).toBe(true);
  });

  it("GET /api/plugins/:slug/reviews（旧身份头）→ myReview 非空", async () => {
    const res = await app.inject({ method: "GET", url: `/api/plugins/${SLUG}/reviews`, headers: H });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { myReview: unknown };
    expect(body.myReview).not.toBeNull();
  });
});

describe("合并后旧身份写：落库归属 canonical，不产生孤儿行", () => {
  it("POST 评价（旧身份头）→ 201 且行落在 canonical 身份下", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/plugins/${SLUG}/reviews`,
      headers: H,
      payload: { rating: 4, title: "更新", content: "合并后更新的评价" },
    });
    expect(res.statusCode).toBe(201);
    const rows = await ctx.repo.raw("SELECT identity FROM plugin_reviews WHERE plugin_id = (SELECT id FROM plugins WHERE slug = ?)", [SLUG]);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.identity)).toBe(NEW);
    const orphan = await ctx.repo.raw("SELECT COUNT(*) AS c FROM plugin_reviews WHERE identity = ?", [OLD]);
    expect(Number(orphan[0]!.c)).toBe(0);
  });

  it("POST 安装（旧身份头）→ 已安装，不在旧 id 下新建孤儿行", async () => {
    const res = await app.inject({ method: "POST", url: `/api/plugins/${SLUG}/install`, headers: H, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { alreadyInstalled?: boolean };
    expect(body.alreadyInstalled).toBe(true);
    const orphan = await ctx.repo.raw("SELECT COUNT(*) AS c FROM plugin_installs WHERE identity = ?", [OLD]);
    expect(Number(orphan[0]!.c)).toBe(0);
  });

  it("DELETE 星标（旧身份头）→ 200，星标行按 canonical 身份删", async () => {
    const res = await app.inject({ method: "DELETE", url: `/api/plugins/${SLUG}/star`, headers: H });
    expect(res.statusCode).toBe(200);
    const rows = await ctx.repo.raw("SELECT COUNT(*) AS c FROM plugin_stars WHERE identity = ?", [NEW]);
    expect(Number(rows[0]!.c)).toBe(0);
  });

  it("DELETE 评价（旧身份头）→ 200，删的是 canonical 名下的评价", async () => {
    const mine = await app.inject({ method: "GET", url: `/api/plugins/${SLUG}/reviews`, headers: H });
    const myReview = (mine.json() as { myReview: { id: string } | null }).myReview;
    expect(myReview).not.toBeNull();
    const res = await app.inject({ method: "DELETE", url: `/api/plugins/${SLUG}/reviews/${myReview!.id}`, headers: H });
    expect(res.statusCode).toBe(200);
    const rows = await ctx.repo.raw("SELECT COUNT(*) AS c FROM plugin_reviews WHERE identity = ?", [NEW]);
    expect(Number(rows[0]!.c)).toBe(0);
  });
});

describe("导入 installNow 分支：旧身份导入并立即安装也跟随 canonical（B-2）", () => {
  it("POST /api/plugins/import（旧身份头，installNow: true）→ 201 且安装行落在 canonical 身份下", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/import",
      headers: H,
      payload: { manifest: themeManifest("Phase2B 导入包"), slug: "phase2b-import-pack", installNow: true },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { slug: string; install?: unknown };
    expect(body.install).not.toBeNull();
    const rows = await ctx.repo.raw(
      "SELECT identity FROM plugin_installs WHERE plugin_id = (SELECT id FROM plugins WHERE slug = ?)",
      [body.slug],
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.identity)).toBe(NEW);
    const orphan = await ctx.repo.raw("SELECT COUNT(*) AS c FROM plugin_installs WHERE identity = ?", [OLD]);
    expect(Number(orphan[0]!.c)).toBe(0);
  });
});
