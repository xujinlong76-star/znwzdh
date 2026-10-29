/**
 * 一键平替的「目标已在站内」分支。
 *
 * 兜底候选本来就取自站内同分类站点，模型也常推荐已经收录过的站。此前的实现只有一条路：
 * 把失效站点的 URL 直接改成目标 URL —— 目标 URL 已经被另一行占用时，SQLite 的
 * `sites.url` 唯一约束让整条请求 500，运营看到的只有「Internal Server Error」。
 * 这里钉住两条语义：
 *   1. 目标已在站内 → 归档失效站点、关联既有条目（不产生重复行、不 500）；
 *   2. 目标不在站内 → 保持原来的「就地修复」行为。
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
  dir = mkdtempSync(join(tmpdir(), "navhub-audit-apply-merge-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "apply-merge.db"),
    embedding: { enabled: false, cacheDir: join(dir, "models") },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function seedPair(suffix: string) {
  const cat = await ctx.repo.createCategory({ title: `平替分类-${suffix}` });
  const peer = await ctx.repo.createSite({
    title: `在站内的替代站-${suffix}`,
    url: `https://peer-${suffix}.example/tool`,
    categoryId: cat.id,
    status: "active",
  });
  const broken = await ctx.repo.createSite({
    title: `失效站点-${suffix}`,
    url: `https://broken-${suffix}.example/old`,
    categoryId: cat.id,
    status: "broken",
  });
  return { cat, peer, broken };
}

describe("POST /api/admin/audit/apply · 平替目标已在站内", () => {
  it("归档失效站点并关联既有条目，不撞唯一约束", async () => {
    const { peer, broken } = await seedPair("merge");

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/audit/apply",
      payload: {
        siteId: broken.id,
        action: "replacement",
        targetUrl: peer.url,
        targetTitle: peer.title,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.merged?.siteId).toBe(peer.id);
    expect(body.merged?.url).toBe(peer.url);
    expect(body.archivedSiteId).toBe(broken.id);

    // 失效站点被归档，既有条目保持 active 且未被改写
    const brokenAfter = await ctx.repo.getSite(broken.id);
    expect(brokenAfter?.status).toBe("archived");
    expect(brokenAfter?.url).toBe(broken.url);
    const peerAfter = await ctx.repo.getSite(peer.id);
    expect(peerAfter?.status).toBe("active");
    expect(peerAfter?.url).toBe(peer.url);
  });

  it("目标 URL 未被收录时仍就地修复原站点", async () => {
    const { broken } = await seedPair("inplace");
    const freshUrl = "https://fresh-target.example/tool";

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/audit/apply",
      payload: { siteId: broken.id, action: "replacement", targetUrl: freshUrl, targetTitle: "新目标" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.merged).toBeUndefined();
    expect(body.site?.url).toBe(freshUrl);
    expect(body.site?.status).toBe("active");

    const after = await ctx.repo.getSite(broken.id);
    expect(after?.url).toBe(freshUrl);
    expect(after?.status).toBe("active");
  });

  it("归档即退出巡检队列：合并后的条目不再出现在报告里，也不再拖低健康分", async () => {
    const { peer, broken } = await seedPair("exit");

    const reportBefore = (await app.inject({ method: "GET", url: "/api/admin/audit/report" })).json();
    expect(reportBefore.summary.issues.some((i: { siteId: string }) => i.siteId === broken.id)).toBe(true);

    await app.inject({
      method: "POST",
      url: "/api/admin/audit/apply",
      payload: { siteId: broken.id, action: "replacement", targetUrl: peer.url, targetTitle: peer.title },
    });

    const reportAfter = (await app.inject({ method: "GET", url: "/api/admin/audit/report" })).json();
    expect(reportAfter.summary.issues.some((i: { siteId: string }) => i.siteId === broken.id)).toBe(false);
    // 归档条目连同它的 URL 一起退出「扫描总数」：否则每次归档都让健康分永久失分
    expect(reportAfter.summary.totalSites).toBe(reportBefore.summary.totalSites - 1);
    expect(reportAfter.summary.healthScore).toBeGreaterThanOrEqual(reportBefore.summary.healthScore);
  });

  it("dismiss 是「别再烦我」，归档后同样退出巡检队列", async () => {
    const { broken } = await seedPair("dismiss");

    const res = await app.inject({
      method: "POST",
      url: "/api/admin/audit/apply",
      payload: { siteId: broken.id, action: "dismiss" },
    });
    expect(res.statusCode).toBe(200);

    const report = (await app.inject({ method: "GET", url: "/api/admin/audit/report" })).json();
    expect(report.summary.issues.some((i: { siteId: string }) => i.siteId === broken.id)).toBe(false);
  });
});
