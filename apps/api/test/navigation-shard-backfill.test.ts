/**
 * 导航分片一次性回填入口与读路径回落告警（U-386）：
 *  1. status：空库 / 写后 fresh / 缺片 / 过期四态；
 *  2. backfill：dry-run 只比对不写库、apply 写回后 fresh、空库不派生；
 *  3. 回落告警：读分片自愈失败时 events 表 + system_states 落库，status 可见，
 *     同原因 5 分钟内不重复记；
 *  4. 管理端点：GET status / POST backfill（默认 dry-run）/ 非法 body 400。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import {
  backfillNavigationShards,
  getNavigationShardStatus,
  NAVIGATION_SHARD_FALLBACK_STATE_KEY,
  pathToKey,
  readStoragePath,
  recordNavigationShardFallback,
  writeNavigationData,
} from "../src/storage.ts";
import {
  NAVIGATION_INDEX_PATH,
  navigationShardPath,
} from "../src/navigation-shards.ts";

const docV1 = {
  navigationItems: [
    {
      id: "cat-x",
      title: "分类X",
      items: [{ id: "n-1", title: "标题一", href: "https://example.com/1", enabled: true }],
      subCategories: [
        {
          id: "sub-x",
          title: "子分类",
          parentId: "cat-x",
          enabled: true,
          items: [{ id: "n-2", title: "标题二", href: "https://example.com/2", enabled: true }],
        },
      ],
    },
  ],
  replacementHistory: [],
};

function makeCtx(dir: string, dbName: string): Promise<AppContext> {
  return createContext(
    loadConfig({
      mode: "lite" as const,
      embedding: {
        model: "m",
        endpoint: "https://hf-mirror.com",
        dtype: "q8" as const,
        cacheDir: join(dir, "models"),
        dim: 512,
        enabled: false,
      },
      sqlitePath: join(dir, dbName),
      corsOrigins: ["*"],
    }),
  );
}

async function fallbackEventCount(ctx: AppContext): Promise<number> {
  const rows = await ctx.repo.raw("SELECT COUNT(*) AS n FROM events WHERE kind = ?", [
    "navigation_shard_fallback",
  ]);
  return Number(rows[0]?.n ?? 0);
}

/** KV 文档在 jobs 表里的行 id（见 storage.ts readKv：id = "kv:" + pathToKey(path)） */
function kvRowId(path: string): string {
  return "kv:" + pathToKey(path);
}

describe("getNavigationShardStatus / backfillNavigationShards", () => {
  const dir = mkdtempSync(join(tmpdir(), "navhub-shard-backfill-"));
  let ctx: AppContext;

  beforeAll(async () => {
    ctx = await makeCtx(dir, "backfill.db");
  });

  afterAll(async () => {
    await ctx?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("空库：fresh=false（data_version 种子为 0、索引缺失），backfill 不派生空索引", async () => {
    const status = await getNavigationShardStatus(ctx);
    expect(status.dataVersion).toBe(0);
    expect(status.indexPresent).toBe(false);
    expect(status.fresh).toBe(false);
    expect(status.missingShards).toEqual([NAVIGATION_INDEX_PATH]);
    expect(status.lastFallback).toBeNull();

    const dry = await backfillNavigationShards(ctx, { dryRun: true });
    expect(dry.empty).toBe(true);
    expect(dry.wouldWrite).toBe(0);
    const applied = await backfillNavigationShards(ctx, { dryRun: false });
    expect(applied.empty).toBe(true);
    expect(applied.wrote).toBe(0);
    const index = await readStoragePath(ctx, NAVIGATION_INDEX_PATH);
    expect(index).toBeNull();
  });

  it("写导航后 status fresh：缺失/过期均为空", async () => {
    await writeNavigationData(ctx, docV1 as never);
    const status = await getNavigationShardStatus(ctx);
    expect(status.dataVersion).not.toBeNull();
    expect(status.indexPresent).toBe(true);
    expect(status.indexSourceVersion).toBe(status.dataVersion);
    expect(status.fresh).toBe(true);
    expect(status.totalItems).toBe(2);
    expect(status.missingShards).toEqual([]);
    expect(status.staleShards).toEqual([]);
  });

  it("删一片：dry-run 只报该片 missing 且零写；apply 写回后 fresh", async () => {
    const catPath = navigationShardPath("cat-x");
    await ctx.repo.runCount("DELETE FROM jobs WHERE id = ?", [kvRowId(catPath)]);
    const status = await getNavigationShardStatus(ctx);
    expect(status.fresh).toBe(false);
    expect(status.missingShards).toEqual([catPath]);
    expect(status.staleShards).toEqual([]);

    const dry = await backfillNavigationShards(ctx, { dryRun: true });
    expect(dry.empty).toBe(false);
    expect(dry.wouldWrite).toBe(1);
    expect(dry.wrote).toBe(0);
    expect(dry.writes).toContainEqual({ path: catPath, change: "missing" });
    expect(dry.writes).toContainEqual({ path: NAVIGATION_INDEX_PATH, change: "unchanged" });
    // dry-run 零写：片仍是缺的
    const stillMissing = await getNavigationShardStatus(ctx);
    expect(stillMissing.missingShards).toEqual([catPath]);

    const applied = await backfillNavigationShards(ctx, { dryRun: false });
    expect(applied.wouldWrite).toBe(1);
    expect(applied.wrote).toBe(1);
    expect(applied.skippedUnchanged).toBe(1);
    const after = await getNavigationShardStatus(ctx);
    expect(after.fresh).toBe(true);
    expect(after.missingShards).toEqual([]);
    const dryAgain = await backfillNavigationShards(ctx, { dryRun: true });
    expect(dryAgain.wouldWrite).toBe(0);
  });

  it("data_version 前进后 status 报 stale（含索引本身），apply 跟随新版本", async () => {
    const beforeVersion = await ctx.repo.readNavDataVersion();
    await ctx.repo.createSite({
      url: "https://example.com/self-heal",
      title: "自愈新增站",
      categoryId: "cat-x",
    });
    const afterVersion = await ctx.repo.readNavDataVersion();
    expect(afterVersion).not.toBe(beforeVersion);

    // 只查 status，不走读路径（读路径会惰性自愈，分片就不再 stale 了）
    const status = await getNavigationShardStatus(ctx);
    expect(status.fresh).toBe(false);
    expect(status.indexSourceVersion).toBe(beforeVersion);
    expect(status.staleShards).toContain(NAVIGATION_INDEX_PATH);
    expect(status.staleShards).toContain(navigationShardPath("cat-x"));

    const dry = await backfillNavigationShards(ctx, { dryRun: true });
    expect(dry.wouldWrite).toBe(2);
    expect(dry.writes).toContainEqual({ path: navigationShardPath("cat-x"), change: "stale" });
    expect(dry.writes).toContainEqual({ path: NAVIGATION_INDEX_PATH, change: "stale" });

    const applied = await backfillNavigationShards(ctx, { dryRun: false });
    expect(applied.wrote).toBe(2);
    const after = await getNavigationShardStatus(ctx);
    expect(after.fresh).toBe(true);
    expect(after.totalItems).toBe(3);
  });
});

describe("读路径回落告警 recordNavigationShardFallback", () => {
  const dir = mkdtempSync(join(tmpdir(), "navhub-shard-fallback-"));
  let ctx: AppContext;

  beforeAll(async () => {
    ctx = await makeCtx(dir, "fallback.db");
    await writeNavigationData(ctx, docV1 as never);
  });

  afterAll(async () => {
    await ctx?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("直接调用：events + system_states 各落一条，status 可见；同原因 5 分钟内不重复", async () => {
    expect(await fallbackEventCount(ctx)).toBe(0);
    await recordNavigationShardFallback(ctx, "测试回落原因", {
      path: navigationShardPath("cat-x"),
      dataVersion: 1,
    });
    expect(await fallbackEventCount(ctx)).toBe(1);
    const record = await ctx.repo.getSystemState<{
      reason: string;
      count: number;
      path: string | null;
    }>(NAVIGATION_SHARD_FALLBACK_STATE_KEY);
    expect(record?.reason).toBe("测试回落原因");
    expect(record?.count).toBe(1);
    expect(record?.path).toBe(navigationShardPath("cat-x"));
    const status = await getNavigationShardStatus(ctx);
    expect(status.lastFallback?.reason).toBe("测试回落原因");

    // 同原因 5 分钟内：只记 error 日志，不再写 events / system_states
    await recordNavigationShardFallback(ctx, "测试回落原因", {
      path: navigationShardPath("cat-x"),
      dataVersion: 1,
    });
    expect(await fallbackEventCount(ctx)).toBe(1);

    // 不同原因：新记一条
    await recordNavigationShardFallback(ctx, "另一测试回落原因", { dataVersion: 1 });
    expect(await fallbackEventCount(ctx)).toBe(2);
  });

  it("读分片时自愈失败（data_version 取不到）：返回旧片并告警落库", async () => {
    const version = await ctx.repo.readNavDataVersion();
    expect(version).not.toBeNull();
    // 删掉 data_version 单行：readNavDataVersion 变 null，自愈走不下去
    await ctx.repo.runCount("DELETE FROM data_version WHERE id = 1", []);
    expect(await ctx.repo.readNavDataVersion()).toBeNull();

    const before = await fallbackEventCount(ctx);
    const shard = (await readStoragePath(ctx, navigationShardPath("cat-x"))) as {
      sourceVersion: number;
    } | null;
    // 旧片照常返回（读路径不比现状差），但告警必须落库
    expect(shard?.sourceVersion).toBe(version);
    expect(await fallbackEventCount(ctx)).toBe(before + 1);
    const status = await getNavigationShardStatus(ctx);
    expect(status.lastFallback?.reason).toContain("data_version 取不到");

    // 恢复版本号行，避免影响同文件后续用例
    await ctx.repo.runCount("INSERT INTO data_version (id, version) VALUES (1, ?)", [version]);
    expect(await ctx.repo.readNavDataVersion()).toBe(version);
  });
});

describe("管理端点 /api/admin/navigation-shards/*", () => {
  const dir = mkdtempSync(join(tmpdir(), "navhub-shard-routes-"));
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    ctx = await makeCtx(dir, "routes.db");
    app = await buildServer(ctx);
    await writeNavigationData(ctx, docV1 as never);
  });

  afterAll(async () => {
    await app?.close();
    await ctx?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET status：写后 fresh", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/navigation-shards/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fresh).toBe(true);
    expect(body.totalItems).toBe(2);
  });

  it("POST backfill 默认 dry-run：删一片后报 missing 且零写；显式 dryRun:false 写回", async () => {
    const catPath = navigationShardPath("cat-x");
    await ctx.repo.runCount("DELETE FROM jobs WHERE id = ?", [kvRowId(catPath)]);

    const dry = await app.inject({
      method: "POST",
      url: "/api/admin/navigation-shards/backfill",
      payload: {},
    });
    expect(dry.statusCode).toBe(200);
    expect(dry.json().dryRun).toBe(true);
    expect(dry.json().wouldWrite).toBe(1);
    expect(dry.json().wrote).toBe(0);
    expect((await getNavigationShardStatus(ctx)).missingShards).toEqual([catPath]);

    const applied = await app.inject({
      method: "POST",
      url: "/api/admin/navigation-shards/backfill",
      payload: { dryRun: false },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().dryRun).toBe(false);
    expect(applied.json().wrote).toBe(1);
    expect((await getNavigationShardStatus(ctx)).fresh).toBe(true);
  });

  it("POST backfill 非法 body → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/navigation-shards/backfill",
      payload: { dryRun: "yes" },
    });
    expect(res.statusCode).toBe(400);
  });
});
