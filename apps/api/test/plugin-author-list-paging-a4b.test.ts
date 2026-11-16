/**
 * A-4b 复现：作者 101+ 插件时，公开作者页与作者中心的列表截断在前 100 条。
 *
 * 根因（基底 1d876565）：
 *   - apps/web-overlay/src/app/marketplace/author/[key]/author-plugins-view.tsx
 *     的 load() 固定 fetchAuthorPlugins(ownerKey, { limit: 100 })，无 offset、
 *     无「加载更多」：第 101 个起的插件在列表 UI 里不可达（total 字段本身
 *     正确、stats.plugins 也正确，只列表翻不到）。
 *   - apps/web-overlay/src/app/marketplace/mine/page.tsx 的 load() 固定
 *     fetchMyPlugins({ identity, limit: 100 })，同样无 offset、无「加载更多」。
 *   - 服务端两条路由（GET /api/plugins/author/:key、GET /api/plugins/mine）
 *     早已支持 offset 并返回全量 total（listPluginsByOwnerKey /
 *     listPluginsByOwner 的 total 是 COUNT(*) 全量），fetch 层
 *     fetchAuthorPlugins / fetchMyPlugins 也已会拼 offset——只是页面没接。
 * 本文件先断言服务端分页本身可用（修前即应通过：服务端无需修复的证据），
 * 再断言两个页面把 offset 接上并给出「加载更多」入口（修前应失败）。
 *
 * 种子方式沿用 A-4 的 plugin-author-stats-limit.test.ts：发布路由有
 * 30/分钟的 per-identity 限流，走 HTTP 发 105 个会被 429 挡住——那是限流器
 * 行为，不是被测的分页逻辑。因此只用 HTTP 发第 1 个（顺带校验
 * anonId→ownerKey 的端到端接线），其余 104 个用 repo.createPlugin 以
 * status:"published" 直接建（与审核上架后的行状态一致）；断言本身全走
 * HTTP GET。
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
let ownerKey = "";

const ANON_ID = "a4b-author-list-paging-1";
const PLUGIN_COUNT = 105;

const sitePack = (name: string) => ({
  manifestVersion: 1,
  kind: "site-pack",
  name,
  description: "A-4b 复现用网址包",
  version: "1.0.0",
  tags: ["测试"],
  payload: { categories: [{ title: "插件测试类目" }], sites: [{ url: "https://a4b.example.com", title: "A" }] },
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-a4b-author-list-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);

  // 第 1 个走 HTTP 发布 + 审核上架：校验 anonId→ownerKey 接线，并拿到 ownerKey。
  const created = await app.inject({
    method: "POST",
    url: `/api/plugins?anonId=${ANON_ID}`,
    payload: sitePack("A4b 作者列表包 001"),
  });
  expect(created.statusCode, `HTTP 发布失败：${created.body}`).toBe(201);
  const body = created.json();
  ownerKey = body.ownerKey as string;
  expect(ownerKey).toMatch(/^[a-f0-9]{24}$/);
  const approved = await app.inject({
    method: "POST",
    url: `/api/plugins/${encodeURIComponent(body.slug as string)}/review`,
    payload: { action: "approve", note: "A-4b 复现上架" },
  });
  expect(approved.statusCode, `HTTP 上架失败：${approved.body}`).toBe(200);

  // 其余 104 个走 repo 直接建已上架行（发布路由 30/分钟限流，走 HTTP 会被 429 挡）。
  for (let i = 2; i <= PLUGIN_COUNT; i++) {
    await ctx.repo.createPlugin({
      manifest: sitePack(`A4b 作者列表包 ${String(i).padStart(3, "0")}`) as never,
      ownerIdentity: ANON_ID,
      status: "published",
    });
  }
}, 180_000);

afterAll(async () => {
  await app.close();
  await ctx.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 忽略 Windows 上 SQLite 文件 handle 异步释放产生的短暂占用
  }
});

describe("A-4b：服务端作者分页本身可用（offset + 全量 total）", () => {
  // 首个 inject 在冷启动 + 并行多线抢 CPU 时曾实测 53s，默认 30s 超时会把
  // 环境慢误判成行为失败；分页行为本身与超时无关，单测放宽到 120s。
  it("作者页 GET /api/plugins/author/:key?limit=100&offset=100 返回第 101–105 条，total=105", async () => {
    const first = await app.inject({
      method: "GET",
      url: `/api/plugins/author/${ownerKey}?limit=100&offset=0`,
    });
    expect(first.statusCode).toBe(200);
    const firstData = first.json();
    expect(firstData.total).toBe(PLUGIN_COUNT);
    expect(firstData.items).toHaveLength(100);

    const second = await app.inject({
      method: "GET",
      url: `/api/plugins/author/${ownerKey}?limit=100&offset=100`,
    });
    expect(second.statusCode).toBe(200);
    const secondData = second.json();
    expect(secondData.total).toBe(PLUGIN_COUNT);
    expect(secondData.items).toHaveLength(PLUGIN_COUNT - 100);
    // 两页无重复 id、合起来正好 105 条（loadMore 追加后的用户可见结果）
    const merged = [...firstData.items, ...secondData.items];
    expect(merged).toHaveLength(PLUGIN_COUNT);
    expect(new Set(merged.map((item: { id: string }) => item.id)).size).toBe(PLUGIN_COUNT);
  }, 120_000);

  it("作者中心 GET /api/plugins/mine?limit=100&offset=100 返回第 101–105 条，total=105", async () => {
    const first = await app.inject({
      method: "GET",
      url: `/api/plugins/mine?anonId=${ANON_ID}&limit=100&offset=0`,
    });
    expect(first.statusCode).toBe(200);
    const firstData = first.json();
    expect(firstData.total).toBe(PLUGIN_COUNT);
    expect(firstData.items).toHaveLength(100);

    const second = await app.inject({
      method: "GET",
      url: `/api/plugins/mine?anonId=${ANON_ID}&limit=100&offset=100`,
    });
    expect(second.statusCode).toBe(200);
    const secondData = second.json();
    expect(secondData.total).toBe(PLUGIN_COUNT);
    expect(secondData.items).toHaveLength(PLUGIN_COUNT - 100);
    const merged = [...firstData.items, ...secondData.items];
    expect(merged).toHaveLength(PLUGIN_COUNT);
    expect(new Set(merged.map((item: { id: string }) => item.id)).size).toBe(PLUGIN_COUNT);
  }, 120_000);
});
