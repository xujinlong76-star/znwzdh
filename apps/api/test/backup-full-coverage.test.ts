import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

/**
 * 备份与书签导出的**全量覆盖**回归。
 *
 * 为什么单独一个文件：repo.listSites() 的默认 limit=100 是给匿名搜索通道设的
 * 成本上限，导出接口曾经直接复用它 —— 于是"全量冷备"实际只含前 100 条站点，
 * 拿到的备份文件看起来完全正常（有 version、有 stats），恢复时却静默缺数据；
 * restore 的 URL 去重集合同样只有 100 条，第 101 条以后已存在的网址会被当成
 * 新增，撞上 sites_url_idx 唯一索引。
 * 现有 backup-api.test.ts 只有 1 个站点，永远测不到这条边界。
 */
const TOTAL_SITES = 131; // 必须 > 100，否则整个文件是在自我确认缺陷

describe("备份/书签导出必须覆盖全库（不受 listSites 默认 100 影响）", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;
  let categoryId: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-test-backup-cover-"));
    const config = loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] });
    ctx = await createContext(config);
    app = await buildServer(ctx);
    await app.ready();

    const cat = await ctx.repo.createCategory({ title: "覆盖测试类目", slug: "coverage" });
    categoryId = cat.id;
    await ctx.repo.createSite({
      title: "Kubernetes 官方文档",
      url: "https://kubernetes.io",
      description: "预设站点",
      categoryId,
      tags: ["k8s"],
    });
    for (let i = 0; i < TOTAL_SITES - 1; i++) {
      await ctx.repo.createSite({
        title: `覆盖站点 ${String(i).padStart(3, "0")}`,
        url: `https://cover-${String(i).padStart(3, "0")}.example.com`,
        description: "第 100 条之后的站点也必须进备份",
        categoryId,
        tags: [],
      });
    }
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("库里确实有 131 个站点（fixture 自检）", async () => {
    const backup = await ctx.repo.listAllSites();
    expect(backup.length).toBe(TOTAL_SITES);
    // 反向确认缺陷来源：默认分页只给 100 条
    expect((await ctx.repo.listSites()).length).toBe(100);
  });

  it("GET /api/export/backup.json 导出全部站点", async () => {
    const res = await app.inject({ method: "GET", url: "/api/export/backup.json" });
    expect(res.statusCode).toBe(200);
    const backup = res.json();
    expect(backup.sites).toHaveLength(TOTAL_SITES);
    expect(backup.stats.siteCount).toBe(TOTAL_SITES);
    // 第 101 条之后的站点必须在（按 sort 排序时它们正是被截掉的那批）
    expect(backup.sites.some((s: any) => s.url === "https://cover-129.example.com")).toBe(true);
  });

  it("GET /api/export/bookmarks.html 导出全部书签", async () => {
    const res = await app.inject({ method: "GET", url: "/api/export/bookmarks.html" });
    expect(res.statusCode).toBe(200);
    const anchors = (res.body.match(/<A HREF=/gi) ?? []).length;
    expect(anchors).toBe(TOTAL_SITES);
    expect(res.body).toContain("https://cover-129.example.com");
  });

  it("POST /api/backup/restore 对全库重放保持幂等（去重集合覆盖 100 条以后）", async () => {
    const exportRes = await app.inject({ method: "GET", url: "/api/export/backup.json" });
    expect(exportRes.statusCode).toBe(200);

    const res = await app.inject({ method: "POST", url: "/api/backup/restore", payload: exportRes.json() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    // 一条都不该新建：库里这 131 个网址全都存在。
    // 缺陷版只会把前 100 条认出来，剩下 31 条走 createSite 撞唯一索引。
    expect(body.restored.sites).toBe(0);
    expect(await ctx.repo.listAllSites()).toHaveLength(TOTAL_SITES);
  });
});
