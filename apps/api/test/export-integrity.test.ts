/**
 * 批次 H 回归（2026-11-06）：匿名书签导出可见性 + 合规审计导出截断标记。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { isBookmarkExportVisibleSite } from "../src/routes/backup.ts";

describe("批次 H：导出完整性与可见性", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-test-export-integrity-"));
    ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
    app = await buildServer(ctx);
    await app.ready();
    const cat = await ctx.repo.createCategory({ title: "测试分类", slug: "test-cat" });
    await ctx.repo.createSite({ title: "active", url: "https://active.example.com", categoryId: cat.id });
    await ctx.repo.createSite({ title: "pending", url: "https://pending.example.com", categoryId: cat.id, status: "pending" });
    await ctx.repo.createSite({ title: "archived", url: "https://archived.example.com", categoryId: cat.id, status: "archived" });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("isBookmarkExportVisibleSite 排除 pending/archived/enabled=false，保留 active/broken", () => {
    expect(isBookmarkExportVisibleSite({ enabled: true, status: "active" })).toBe(true);
    expect(isBookmarkExportVisibleSite({ enabled: true, status: "broken" })).toBe(true);
    expect(isBookmarkExportVisibleSite({ enabled: true, status: "pending" })).toBe(false);
    expect(isBookmarkExportVisibleSite({ enabled: true, status: "archived" })).toBe(false);
    expect(isBookmarkExportVisibleSite({ enabled: false, status: "active" })).toBe(false);
  });

  it("匿名书签导出不含 pending / archived 站点 URL", async () => {
    const res = await app.inject({ method: "GET", url: "/api/export/bookmarks.html" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("active.example.com");
    expect(res.body).not.toContain("pending.example.com");
    expect(res.body).not.toContain("archived.example.com");
  });

  it("审计导出响应含 truncated / nextOffset / count 标记（新增字段不破坏旧消费方）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/audit/export?limit=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("truncated");
    expect(body).toHaveProperty("nextOffset");
    expect(body).toHaveProperty("count");
    expect(body).toHaveProperty("items");
    expect(body.count).toBe(body.items.length);
    // 若日志超过 limit，必须能察觉截断并拿到续取偏移
    if (body.truncated) {
      expect(typeof body.nextOffset).toBe("number");
      expect(body.notice).toContain("截断");
    }
  });
});
