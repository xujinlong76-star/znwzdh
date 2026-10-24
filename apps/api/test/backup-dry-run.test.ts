/**
 * 冷备恢复的预演闸门（data-sovereignty P2）。
 *
 * POST /api/backup/restore 是 admin 触发的全量写事务：写下去就改整库内容。
 * 此前没有 dryRun，也没有 rateLimit——admin 只能靠猜决定要不要执行。
 * 现在与 POST /api/sites/bulk 同口径：**dryRun 默认 true**，预演走与真写
 * 完全相同的计划计算，返回「将新增多少分类/站点 + 跳过原因 + 样例」。
 *
 * 本文件锁四件事：
 *   1. 不带参数 = 预演，绝不落库；
 *   2. 预演数字与真写结果一致（同一份计划）；
 *   3. 跳过口径可解释：库内已有 URL、备份内重复 URL、非 http(s) 链接分别计数；
 *   4. 预演不写审计（没有状态变更），只有真写才写 backup.restore。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const backupPack = () => ({
  version: "1.0",
  generator: "NavHub Test",
  exportedAt: Date.now(),
  categories: [
    { id: "cat-dry-1", title: "预演分类A", slug: "dry-a" },
    { id: "cat-dry-2", title: "预演分类B", slug: "dry-b" },
    // 备份内同标题：真写时按标题幂等只建一条，预演也必须只算一条
    { id: "cat-dry-3", title: "预演分类A", slug: "dry-a-dup" },
  ],
  sites: [
    { id: "s1", title: "新站点一", url: "https://dry-new-1.example.com", categoryId: "cat-dry-1" },
    // 备份内重复 URL（尾斜杠差异）：只算一条
    { id: "s2", title: "新站点一重复", url: "https://dry-new-1.example.com/", categoryId: "cat-dry-1" },
    // 库里已存在
    { id: "s3", title: "已存在", url: "https://existing.example.com", categoryId: "cat-dry-1" },
    // 危险协议：跳过
    { id: "s4", title: "坏链接", url: "javascript:alert(1)", categoryId: "cat-dry-1" },
  ],
  stats: { categoryCount: 3, siteCount: 4 },
});

describe("冷备恢复预演（dryRun 默认 true）", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-backup-dry-"));
    const config = loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "dry.db"),
      corsOrigins: ["*"],
    });
    ctx = await createContext(config);
    app = await buildServer(ctx);
    await app.ready();

    const cat = await ctx.repo.createCategory({ title: "已有分类", slug: "existing" });
    await ctx.repo.createSite({
      title: "已存在",
      url: "https://existing.example.com",
      categoryId: cat.id,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 上 SQLite 句柄释放有延迟：临时目录交给系统回收
    }
  });

  it("不带 dryRun 参数：只预演，不落库、不写审计", async () => {
    const beforeCats = (await ctx.repo.listCategories()).length;
    const beforeSites = (await ctx.repo.listAllSites()).length;
    const beforeAudits = await ctx.repo.raw(
      "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'backup.restore'",
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/backup/restore",
      payload: backupPack(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dryRun).toBe(true);
    // 3 个分类里 1 个重复标题 → 只预演 2 个
    expect(body.wouldRestore.categories).toBe(2);
    // 4 个站点：1 新建 + 1 备份内重复 + 1 库内已存在 + 1 危险协议
    expect(body.wouldRestore.sites).toBe(1);
    expect(body.skipped).toMatchObject({ duplicateCategories: 1, duplicateUrls: 2, invalidUrls: 1 });
    expect(body.sample.categories).toEqual(["预演分类A", "预演分类B"]);
    expect(body.sample.sites).toEqual(["https://dry-new-1.example.com"]);

    // 一条都没落库
    expect((await ctx.repo.listCategories()).length).toBe(beforeCats);
    expect((await ctx.repo.listAllSites()).length).toBe(beforeSites);
    // 预演不是一次操作，不写审计
    const afterAudits = await ctx.repo.raw(
      "SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'backup.restore'",
    );
    expect(Number(afterAudits[0].c)).toBe(Number(beforeAudits[0].c));
  });

  it("dryRun=false（对象载荷字段）：真写，且数量与预演一致", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/backup/restore",
      payload: { ...backupPack(), dryRun: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dryRun).toBeUndefined();
    expect(body.restored).toEqual({ categories: 2, sites: 1 });

    const cats = await ctx.repo.listCategories();
    expect(cats.filter((c) => c.title.startsWith("预演分类")).length).toBe(2);
    const site = await ctx.repo.findSiteByUrl("https://dry-new-1.example.com");
    expect(site).toBeDefined();
    expect(site!.categoryId).toBe("cat-dry-1");

    const audits = await ctx.repo.raw(
      "SELECT * FROM audit_logs WHERE action = 'backup.restore' ORDER BY created_at DESC LIMIT 1",
    );
    expect(audits.length).toBe(1);
  });

  it("再次预演：幂等后应新增 0 条", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/backup/restore?dryRun=true",
      payload: backupPack(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dryRun).toBe(true);
    expect(body.wouldRestore).toEqual({ categories: 0, sites: 0 });
  });

  it("dryRun=false 走 query（JSON 字符串体）才会真写", async () => {
    const payload = {
      ...backupPack(),
      categories: [{ id: "cat-query-1", title: "query 分类", slug: "query-cat" }],
      sites: [{ id: "sq1", title: "query 站点", url: "https://dry-query.example.com", categoryId: "cat-query-1" }],
    };
    const jsonBody = JSON.stringify(payload);

    const preview = await app.inject({
      method: "POST",
      url: "/api/backup/restore",
      headers: { "content-type": "application/json" },
      payload: jsonBody,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().dryRun).toBe(true);
    expect(preview.json().wouldRestore).toEqual({ categories: 1, sites: 1 });

    const applied = await app.inject({
      method: "POST",
      url: "/api/backup/restore?dryRun=false",
      headers: { "content-type": "application/json" },
      payload: jsonBody,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().restored).toEqual({ categories: 1, sites: 1 });
  });

  it("空库恢复：未知分类 ID 落到本次恢复的第一条分类（与旧事务口径一致）", async () => {
    const freshDir = mkdtempSync(join(tmpdir(), "navhub-backup-dry-empty-"));
    const freshCtx = await createContext(
      loadConfig({ mode: "lite", sqlitePath: join(freshDir, "empty.db"), corsOrigins: ["*"] }),
    );
    const freshApp = await buildServer(freshCtx);
    await freshApp.ready();
    try {
      const res = await freshApp.inject({
        method: "POST",
        url: "/api/backup/restore",
        payload: {
          version: "1.0",
          categories: [{ id: "cat-empty-1", title: "空库分类", slug: "empty" }],
          sites: [
            { id: "se1", title: "未知分类站点", url: "https://dry-empty.example.com", categoryId: "unknown-cat" },
          ],
        },
      });
      // 第一次只预演：空库下预演数字必须与随后真写一致
      expect(res.json().wouldRestore).toEqual({ categories: 1, sites: 1 });

      const applied = await freshApp.inject({
        method: "POST",
        url: "/api/backup/restore?dryRun=false",
        payload: {
          version: "1.0",
          categories: [{ id: "cat-empty-1", title: "空库分类", slug: "empty" }],
          sites: [
            { id: "se1", title: "未知分类站点", url: "https://dry-empty.example.com", categoryId: "unknown-cat" },
          ],
        },
      });
      expect(applied.json().restored).toEqual({ categories: 1, sites: 1 });
      const site = await freshCtx.repo.findSiteByUrl("https://dry-empty.example.com");
      expect(site?.categoryId).toBe("cat-empty-1");
    } finally {
      await freshApp.close();
      await freshCtx.close();
      await new Promise((r) => setTimeout(r, 30));
      try {
        rmSync(freshDir, { recursive: true, force: true });
      } catch {
        // Windows SQLite 句柄延迟释放
      }
    }
  });
});
