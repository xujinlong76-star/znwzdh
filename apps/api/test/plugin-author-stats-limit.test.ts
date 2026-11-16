/**
 * A-4 复现：作者页 / 作者中心的安装/星标统计只按前 100 个插件汇总。
 *
 * 根因（基底 1d876565）：
 *   - GET /api/plugins/author/:key 用 listPluginsByOwnerKey(key, { limit: 100 })
 *     的 items 求和 stats.installs/stars；作者插件 >100 时第 101 个起的安装/星标
 *     恒不计入，total 字段本身正确、只有 stats 偏小。
 *   - GET /api/plugins/mine 只返回分页 items；作者中心前端对 items 求和，
 *     同样只按前 100 条算。
 * 本文件断言「105 个插件的作者，统计必须等于全量和」：修前 installs/stars
 * 只算前 100 个（300/200），修后应为全量（315/210）；/mine 修前根本不返回
 * stats 字段。
 *
 * 种子方式：发布路由有 30/分钟的 per-identity 限流，走 HTTP 发 105 个会被
 * 429 挡住——那是限流器行为，不是被测的聚合逻辑。因此只用 HTTP 发第 1 个
 * （顺带校验 anonId→ownerKey 的端到端接线），其余 104 个用 repo.createPlugin
 * 以 status:"published" 直接建（与审核上架后的行状态一致）；断言本身全走
 * HTTP GET。计数列 install_count/star_count 由写路径（安装/星标）维护，
 * 测试里用 repo.run 直接置数，只为给聚合提供已知的非零计数，不绕过被测
 * 的聚合逻辑本身。
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

const ANON_ID = "a34-author-stats-1";
const PLUGIN_COUNT = 105;
const INSTALLS_EACH = 3;
const STARS_EACH = 2;

const sitePack = (name: string) => ({
  manifestVersion: 1,
  kind: "site-pack",
  name,
  description: "A-4 复现用网址包",
  version: "1.0.0",
  tags: ["测试"],
  payload: { categories: [{ title: "插件测试类目" }], sites: [{ url: "https://a34.example.com", title: "A" }] },
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugin-a34-author-stats-"));
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
    payload: sitePack("A34 作者统计包 001"),
  });
  expect(created.statusCode, `HTTP 发布失败：${created.body}`).toBe(201);
  const body = created.json();
  ownerKey = body.ownerKey as string;
  expect(ownerKey).toMatch(/^[a-f0-9]{24}$/);
  const approved = await app.inject({
    method: "POST",
    url: `/api/plugins/${encodeURIComponent(body.slug as string)}/review`,
    payload: { action: "approve", note: "A-4 复现上架" },
  });
  expect(approved.statusCode, `HTTP 上架失败：${approved.body}`).toBe(200);

  // 其余 104 个走 repo 直接建已上架行（发布路由 30/分钟限流，走 HTTP 会被 429 挡）。
  for (let i = 2; i <= PLUGIN_COUNT; i++) {
    await ctx.repo.createPlugin({
      manifest: sitePack(`A34 作者统计包 ${String(i).padStart(3, "0")}`) as never,
      ownerIdentity: ANON_ID,
      status: "published",
    });
  }

  // 每个插件 3 安装 / 2 星标：全量和应为 315 / 210；只算前 100 个则是 300 / 200。
  await ctx.repo.run(
    "UPDATE plugins SET install_count = ?, star_count = ? WHERE owner_key = ?",
    [INSTALLS_EACH, STARS_EACH, ownerKey],
  );
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

describe("A-4：作者统计必须覆盖全部插件，不只前 100 个", () => {
  it("105 个已上架插件的作者：stats.installs/stars 等于全量和", async () => {
    const author = await app.inject({ method: "GET", url: `/api/plugins/author/${ownerKey}` });
    expect(author.statusCode).toBe(200);
    const data = author.json();
    expect(data.total).toBe(PLUGIN_COUNT);
    expect(data.stats.plugins).toBe(PLUGIN_COUNT);
    expect(data.stats.installs).toBe(PLUGIN_COUNT * INSTALLS_EACH);
    expect(data.stats.stars).toBe(PLUGIN_COUNT * STARS_EACH);
    // 作者名仍取自最新上架插件（与修前 listPluginsByOwnerKey 全量取首条同口径）
    expect(data.author).toBeTruthy();
  });

  it("作者中心 /mine：stats 覆盖全部插件的状态计数与安装/星标/remix 合计", async () => {
    const mine = await app.inject({
      method: "GET",
      url: `/api/plugins/mine?anonId=${ANON_ID}&limit=100`,
    });
    expect(mine.statusCode).toBe(200);
    const data = mine.json();
    expect(data.total).toBe(PLUGIN_COUNT);
    expect(data.items).toHaveLength(100);
    // 修前：响应无 stats 字段，前端只能对当页 100 条求和（300/200）。
    expect(data.stats).toBeDefined();
    expect(data.stats.total).toBe(PLUGIN_COUNT);
    expect(data.stats.published).toBe(PLUGIN_COUNT);
    expect(data.stats.pending).toBe(0);
    expect(data.stats.rejected).toBe(0);
    expect(data.stats.other).toBe(0);
    expect(data.stats.installs).toBe(PLUGIN_COUNT * INSTALLS_EACH);
    expect(data.stats.stars).toBe(PLUGIN_COUNT * STARS_EACH);
    expect(data.stats.remixes).toBe(0);
  });
});
