/**
 * 任务入队的破坏性分级 + 恢复 staging 白名单（P0-1）。
 *
 * 背景：`POST /api/jobs` 的路由 scope 只能是单一 label（write），而这条路由
 * 同时接受只产读数的巡检与不可逆操作（覆盖恢复、物理清空、真删事件/审计）。
 * 分级只能在处理器里按 kind 判定：
 *
 *   - write 令牌入队破坏性 kind → 403（即使带 confirm）；
 *   - admin 令牌入队破坏性 kind 必须显式 confirm:true（speed bump + 可审计）；
 *   - 开放模式（匿名持有全部 scope）历史行为不变，但破坏性 kind 同样要 confirm。
 *
 * 第二层是 staging 路径：端点生成路径不代表所有入队来源都可信，任务侧只读
 * `NAVHUB_RESTORE_STAGING_DIR` 内的文件，并限制文件大小。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { JobRunner } from "../src/jobs.ts";
import { assertRestoreStagingPath, restoreStagingDir } from "../src/restore-staging.ts";

const BOOTSTRAP = "job-tiers-bootstrap-secret";

let dir: string;
let stagingDir: string;
let openCtx: AppContext;
let openApp: Awaited<ReturnType<typeof buildServer>>;
let authCtx: AppContext;
let authApp: Awaited<ReturnType<typeof buildServer>>;

const baseConfig = () => ({
  mode: "lite" as const,
  embedding: {
    model: "m",
    endpoint: "https://hf-mirror.com",
    dtype: "q8" as const,
    cacheDir: join(dir, "models"),
    dim: 512,
    enabled: false,
  },
  corsOrigins: ["*"],
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-job-tiers-"));
  stagingDir = join(dir, "staging");
  process.env.NAVHUB_RESTORE_STAGING_DIR = stagingDir;

  openCtx = await createContext(loadConfig({ ...baseConfig(), sqlitePath: join(dir, "open.db") }));
  openApp = await buildServer(openCtx);
  await openApp.ready();

  authCtx = await createContext(
    loadConfig({
      ...baseConfig(),
      sqlitePath: join(dir, "auth.db"),
      authRequired: true,
      bootstrapToken: BOOTSTRAP,
    }),
  );
  authApp = await buildServer(authCtx);
  await authApp.ready();
});

afterAll(async () => {
  await openApp.close();
  await openCtx.close();
  await authApp.close();
  await authCtx.close();
  delete process.env.NAVHUB_RESTORE_STAGING_DIR;
  rmSync(dir, { recursive: true, force: true });
});

async function mint(name: string, scopes: string): Promise<string> {
  const res = await authApp.inject({
    method: "POST",
    url: "/api/tokens",
    headers: { authorization: `Bearer ${BOOTSTRAP}` },
    payload: { name, scopes },
  });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}

async function enqueue(token: string, body: Record<string, unknown>) {
  return authApp.inject({
    method: "POST",
    url: "/api/jobs",
    headers: { authorization: `Bearer ${token}` },
    payload: body,
  });
}

describe("开放模式：历史行为与 confirm 门槛", () => {
  it("常规任务匿名入队照旧可用", async () => {
    const res = await openApp.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { kind: "health_check", payload: { limit: 5 } },
    });
    expect(res.statusCode).toBe(201);
  });

  it("破坏性 kind 未带 confirm → 400，且不产生任务行", async () => {
    const before = (await openCtx.repo.listJobs(undefined, 200)).length;
    const res = await openApp.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { kind: "purge_trash", payload: { olderThanDays: 1 } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("confirm");
    expect((await openCtx.repo.listJobs(undefined, 200)).length).toBe(before);
  });

  it("破坏性 kind 带 confirm → 201（开放模式匿名仍持全部 scope）", async () => {
    const res = await openApp.inject({
      method: "POST",
      url: "/api/jobs",
      payload: { kind: "purge_trash", payload: { olderThanDays: 1 }, confirm: true },
    });
    expect(res.statusCode, res.body).toBe(201);
  });
});

describe("鉴权模式：write 与 admin 的分界", () => {
  let writeToken: string;
  let adminToken: string;

  beforeAll(async () => {
    writeToken = await mint("job-writer", "write");
    adminToken = await mint("job-admin", "admin");
  });

  it("write 令牌入队 backup_restore → 403（即使带 confirm）", async () => {
    const res = await enqueue(writeToken, {
      kind: "backup_restore",
      payload: { stagingPath: join(stagingDir, "plan.json") },
      confirm: true,
    });
    expect(res.statusCode).toBe(403);
  });

  it("write 令牌入队 purge_trash → 403", async () => {
    const res = await enqueue(writeToken, {
      kind: "purge_trash",
      payload: { olderThanDays: 1 },
      confirm: true,
    });
    expect(res.statusCode).toBe(403);
  });

  it("write 令牌入队 data_retention apply:true → 403", async () => {
    const res = await enqueue(writeToken, {
      kind: "data_retention",
      payload: { mode: "rollup", apply: true },
      confirm: true,
    });
    expect(res.statusCode).toBe(403);
  });

  it("write 令牌入队 data_retention dry-run 与常规巡检 → 201", async () => {
    const dry = await enqueue(writeToken, {
      kind: "data_retention",
      payload: { mode: "rollup", apply: false },
    });
    expect(dry.statusCode, dry.body).toBe(201);

    const health = await enqueue(writeToken, { kind: "health_check", payload: { limit: 3 } });
    expect(health.statusCode, health.body).toBe(201);
  });

  it("admin 入队破坏性 kind 未带 confirm → 400", async () => {
    const res = await enqueue(adminToken, {
      kind: "purge_trash",
      payload: { olderThanDays: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("confirm");
  });

  it("admin 带 confirm 入队 → 201，并写 job.enqueue_destructive 审计", async () => {
    const res = await enqueue(adminToken, {
      kind: "purge_trash",
      payload: { olderThanDays: 1 },
      confirm: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    const jobId = res.json().id as string;

    const rows = (await authCtx.repo.raw(
      "SELECT action FROM audit_logs WHERE target = ? ORDER BY created_at DESC",
      [jobId],
    )) as Array<{ action: string }>;
    expect(rows.map((row) => row.action)).toContain("job.enqueue_destructive");
  });
});

describe("恢复 staging 目录白名单", () => {
  it("目录内路径通过并归一化", () => {
    expect(restoreStagingDir()).toBe(resolve(stagingDir));
    expect(assertRestoreStagingPath(join(stagingDir, "a.json"))).toBe(resolve(stagingDir, "a.json"));
  });

  it("目录外路径 / 目录本身 / 上跳路径全部拒绝", () => {
    expect(() => assertRestoreStagingPath(join(dir, "outside.json"))).toThrow(/stagingPath/);
    expect(() => assertRestoreStagingPath(stagingDir)).toThrow(/stagingPath/);
    expect(() => assertRestoreStagingPath(join(stagingDir, "..", "outside.json"))).toThrow(/stagingPath/);
  });

  it("绕过端点直接入队：任务侧同样拒绝目录外路径", async () => {
    await authCtx.repo.run("DELETE FROM jobs");
    const outside = join(dir, "outside-plan.json");
    writeFileSync(outside, JSON.stringify({ categories: [], sites: [] }), "utf8");

    const id = await authCtx.repo.enqueueJob("backup_restore", { stagingPath: outside });
    await new JobRunner(authCtx, { enableCron: false }).tick();

    const row = (await authCtx.repo.raw("SELECT status, error FROM jobs WHERE id = ?", [id]))[0] as {
      status?: string;
      error?: string | null;
    };
    expect(String(row.status)).not.toBe("done");
    expect(String(row.error ?? "")).toContain("stagingPath");
  });
});
