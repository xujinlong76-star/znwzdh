import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

describe("Dimension 2: Data Sovereignty & Backup API", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-test-backup-"));
    const config = loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      corsOrigins: ["*"],
    });

    ctx = await createContext(config);
    app = await buildServer(ctx);
    await app.ready();

    // 预置分类与站点
    const cat = await ctx.repo.createCategory({
      title: "云原生与架构",
      slug: "cloud-native",
      description: "Cloud & Architecture",
    });

    await ctx.repo.createSite({
      title: "Kubernetes 官方文档",
      url: "https://kubernetes.io",
      description: "Production-Grade Container Orchestration",
      categoryId: cat.id,
      tags: ["k8s", "cloud", "devops"],
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET /api/export/bookmarks.html 应返回标准 Netscape 格式书签", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/export/bookmarks.html",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["content-disposition"]).toContain("navhub-bookmarks.html");

    const html = res.body;
    expect(html).toContain("<!DOCTYPE NETSCAPE-Bookmark-file-1>");
    expect(html).toContain("<H1>Bookmarks</H1>");
    expect(html).toContain("云原生与架构");
    expect(html).toContain("Kubernetes 官方文档");
    expect(html).toContain('HREF="https://kubernetes.io"');
    expect(html).toContain("Production-Grade Container Orchestration");
  });

  it("GET /api/export/backup.json 应返回符合冷备 Schema 的 JSON 数据包", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/export/backup.json",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["content-disposition"]).toContain(".nhbak.json");

    const backup = JSON.parse(res.body);
    expect(backup.version).toBe("1.0");
    expect(backup.generator).toContain("NavHub");
    expect(backup.stats.categoryCount).toBeGreaterThanOrEqual(1);
    expect(backup.stats.siteCount).toBeGreaterThanOrEqual(1);
    expect(backup.categories.some((c: any) => c.title === "云原生与架构")).toBe(true);
    expect(backup.sites.some((s: any) => s.title === "Kubernetes 官方文档")).toBe(true);
  });

  it("POST /api/backup/restore 应支持从冷备包幂等恢复数据", async () => {
    const payload = {
      version: "1.0",
      generator: "NavHub 2026 Sovereign Backup Engine",
      exportedAt: Date.now(),
      categories: [
        {
          id: "cat-restore-test",
          title: "测试恢复分类",
          slug: "test-restore",
          description: "Restored Category",
        },
      ],
      sites: [
        {
          id: "site-restore-test",
          title: "测试恢复站点",
          url: "https://test-restore.dev",
          description: "Restored Site",
          categoryId: "cat-restore-test",
          tags: ["test", "restore"],
        },
      ],
      stats: {
        categoryCount: 1,
        siteCount: 1,
      },
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/backup/restore",
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.restored.categories).toBe(1);
    expect(body.restored.sites).toBe(1);

    // 验证再次恢复相同数据时幂等不重复创建
    const res2 = await app.inject({
      method: "POST",
      url: "/api/backup/restore",
      payload,
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.restored.categories).toBe(0);
    expect(body2.restored.sites).toBe(0);
  });
});
