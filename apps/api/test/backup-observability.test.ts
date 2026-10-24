/**
 * 备份恢复的可观测性（2026-10-24）。
 *
 * 恢复是「一次请求改整库内容」的操作，此前只有两处外部可观测面：
 * 成功时一条只含条数的审计、失败时一行日志。这留下三个盲区：
 *
 * 1. **失败不可追**：审计表空白，运维无法回答「什么时候失败、备份多大、什么原因」；
 * 2. **耗时不可测**：没有 durationMs，慢了只能靠用户抱怨；
 * 3. **恢复后语义检索缺失**：恢复只写 sites/site_tags，不建向量，语义通道要等
 *    下一个定时 reindex（每 4 小时）才可用——恢复完立刻搜，语义结果是缺的。
 *
 * 本文件钉住这三点的修复，并额外验证「响应不泄漏原始数据库错误」。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { classifyRestoreError } from "../src/routes/backup.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-backup-obs-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "obs.db"),
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
  await ctx.repo.ensureUncategorized();
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 一份最小合法冷备包（结构对齐 exportNavHubBackup：version 必须是 "1.0"） */
function backupPayload(sites: Array<{ id: string; title: string; url: string; categoryId?: string }>) {
  return {
    version: "1.0",
    generator: "NavHub 2026 Sovereign Backup Engine",
    exportedAt: Date.now(),
    categories: [],
    sites: sites.map((site) => ({
      id: site.id,
      title: site.title,
      url: site.url,
      description: "",
      categoryId: site.categoryId ?? "",
      tags: [],
    })),
    stats: { categoryCount: 0, siteCount: sites.length },
  };
}

describe("classifyRestoreError（跨方言错误归类）", () => {
  it("识别 SQLite 与 PostgreSQL 的重复键措辞", () => {
    expect(classifyRestoreError(new Error("UNIQUE constraint failed: categories.id"))).toBe("duplicate_key");
    expect(
      classifyRestoreError(new Error('duplicate key value violates unique constraint "categories_pkey"')),
    ).toBe("duplicate_key");
    expect(classifyRestoreError(new Error("PRIMARY KEY 冲突"))).toBe("duplicate_key");
  });

  it("识别外键 / 非空 / schema 缺失", () => {
    expect(classifyRestoreError(new Error("FOREIGN KEY constraint failed"))).toBe("foreign_key");
    expect(classifyRestoreError(new Error("violates foreign key constraint"))).toBe("foreign_key");
    expect(classifyRestoreError(new Error("NOT NULL constraint failed: sites.category_id"))).toBe("not_null");
    expect(classifyRestoreError(new Error("no such table: sites"))).toBe("schema");
  });

  it("未知错误回落 unknown，绝不把原文当类别", () => {
    expect(classifyRestoreError(new Error("kaboom"))).toBe("unknown");
    expect(classifyRestoreError(undefined)).toBe("unknown");
  });
});

describe("POST /api/backup/restore 的可观测性", () => {
  it("成功后审计含耗时与跳过项，并入队 reindex", async () => {
    await ctx.repo.run("DELETE FROM jobs");
    const res = await app.inject({
      method: "POST",
      url: "/api/backup/restore?dryRun=false",
      payload: backupPayload([
        { id: "obs-site-1", title: "可观测站点一", url: "https://obs-1.example.com" },
        { id: "obs-site-2", title: "可观测站点二", url: "https://obs-2.example.com" },
      ]),
    });
    expect(res.statusCode).toBe(200);

    const audits = await ctx.repo.raw(
      "SELECT diff FROM audit_logs WHERE action = 'backup.restore' ORDER BY created_at DESC LIMIT 1",
    );
    expect(audits).toHaveLength(1);
    const diff = JSON.parse(String(audits[0]!.diff ?? "{}"));
    expect(diff.sites).toBe(2);
    expect(typeof diff.durationMs).toBe("number");
    expect(diff.durationMs).toBeGreaterThanOrEqual(0);
    // 跳过项必须结构化申报（预演与本轮实际一致）
    expect(diff.skipped).toEqual({ duplicateCategories: 0, invalidUrls: 0, duplicateUrls: 0 });

    const jobs = await ctx.repo.raw("SELECT kind, payload FROM jobs WHERE kind = ?", ["reindex"]);
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(String(jobs[0]!.payload ?? "{}")).vectors).toBe(true);
  });

  it("失败时写 backup.restore_failed 审计，响应只回类别不回原始错误", async () => {
    await ctx.repo.run("DELETE FROM audit_logs");
    // 同 id 两条分类：第二条撞主键，整体回滚
    const payload = {
      version: "1.0",
      generator: "NavHub 2026 Sovereign Backup Engine",
      exportedAt: Date.now(),
      categories: [
        { id: "obs-dup-cat", title: "可观测分类一", slug: "obs-dup-1" },
        { id: "obs-dup-cat", title: "可观测分类二", slug: "obs-dup-2" },
      ],
      sites: [],
      stats: { categoryCount: 2, siteCount: 0 },
    };
    const res = await app.inject({ method: "POST", url: "/api/backup/restore?dryRun=false", payload });
    expect(res.statusCode).toBe(409);
    const body = res.json() as Record<string, unknown>;
    expect(body.error).toBe("RESTORE_FAILED");
    expect(body.reason).toBe("duplicate_key");
    // 原始 message 不能透出（可能含具体值与约束名）
    expect(JSON.stringify(body)).not.toMatch(/UNIQUE constraint|constraint failed|obs-dup-cat/);

    const audits = await ctx.repo.raw(
      "SELECT diff FROM audit_logs WHERE action = 'backup.restore_failed' ORDER BY created_at DESC LIMIT 1",
    );
    expect(audits).toHaveLength(1);
    const diff = JSON.parse(String(audits[0]!.diff ?? "{}"));
    expect(diff.reason).toBe("duplicate_key");
    expect(diff.plannedCategories).toBe(2);
    expect(typeof diff.durationMs).toBe("number");
  });

  it("预演不写审计、不入队任务（没有状态变更就不该留痕）", async () => {
    await ctx.repo.run("DELETE FROM audit_logs");
    await ctx.repo.run("DELETE FROM jobs");
    const res = await app.inject({
      method: "POST",
      url: "/api/backup/restore?dryRun=true",
      payload: backupPayload([{ id: "obs-dry-1", title: "预演站点", url: "https://obs-dry.example.com" }]),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Record<string, unknown>).dryRun).toBe(true);

    const audits = await ctx.repo.raw("SELECT COUNT(*) AS c FROM audit_logs WHERE action LIKE 'backup.restore%'");
    expect(Number(audits[0]!.c ?? 0)).toBe(0);
    const jobs = await ctx.repo.raw("SELECT COUNT(*) AS c FROM jobs WHERE kind = ?", ["reindex"]);
    expect(Number(jobs[0]!.c ?? 0)).toBe(0);
  });
});
