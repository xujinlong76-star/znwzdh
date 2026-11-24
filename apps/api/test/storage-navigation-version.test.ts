/**
 * 结构化文档的乐观并发（W5 2026-11-24，审计 §4(a) 修复）。
 *
 * 背景：`readStorageVersion` 对 navigation.json / site.json /
 * resource-metadata.json 一律返回 null，`ifVersion` 只保护 KV 类文档
 * （videos.json 等条件 UPDATE + 409）。导航整包覆盖写在多实例 PG 下是
 * last-write-wins，仅靠缩水保护与单事务原子性兜底。
 *
 * 本轮修复后：
 *   1. 三者都有真实版本源 —— 导航是 `data_version`（触发器递增，与快照
 *      缓存 / ETag 同源），site.json 是 KV 行 `site-config`，resource-metadata
 *      是 KV 行 `resource-metadata`；
 *   2. 带 `ifVersion` 的整包写做条件写入：导航在写事务内先拿串行化锁再
 *      比对版本（PG 下 advisory 锁、SQLite 下 BEGIN IMMEDIATE），版本已变
 *      即 409（`StorageVersionConflictError`，带 currentVersion）且整包回滚；
 *      site/resource 走 `writeKv` 的条件 UPDATE（原子 CAS）；
 *   3. 不带 `ifVersion` 的写保持原行为（盲目覆盖）：导航/站点/资源三处
 *      前端写入口今天都不传版本，直接改成必填会让全部管理保存 409 ——
 *      必填收口是后续的前端迁移，不在本轮。残留窗口见 lane 笔记。
 *
 * 锁三件事：
 *   1. 版本读数不再是 null；
 *   2. 陈旧版本写导航/site/resource 必须 409，且内容纹丝不动；
 *   3. 同版本并发写导航恰好一个成功、一个 409（sqlite 下 BEGIN IMMEDIATE
 *      串行化；PG 下靠 advisory 锁 —— 本测试只覆盖 sqlite 形态）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { readStoragePath, readStorageVersion, writeStoragePath } from "../src/storage.ts";

let dir = "";
let ctx: AppContext;

const NAV = "src/navsphere/content/navigation.json";
const SITE = "src/navsphere/content/site.json";
const RESOURCE = "src/navsphere/content/resource-metadata.json";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-nav-version-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "nav-version.db"),
    embedding: {
      model: "Xenova/bge-small-zh-v1.5",
      endpoint: "https://hf-mirror.com",
      dtype: "q8",
      cacheDir: join(dir, "models"),
      dim: 512,
      enabled: false,
    },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 单类目导航文档：siteIds 全是该测试独占的 id，避免跨测试互相软删干扰断言 */
function navDoc(catId: string, siteIds: string[]): Record<string, unknown> {
  return {
    navigationItems: [
      {
        id: catId,
        title: `分类 ${catId}`,
        enabled: true,
        items: siteIds.map((id, i) => ({
          id,
          title: `站点 ${id}`,
          href: `https://${id}.example.com`,
          enabled: true,
        })),
        subCategories: [],
      },
    ],
  };
}

function navSiteIds(doc: unknown, catId: string): string[] {
  const items = (doc as { navigationItems?: Array<{ id?: string; items?: Array<{ id?: string }> }> })
    .navigationItems ?? [];
  const cat = items.find((c) => c.id === catId);
  return (cat?.items ?? []).map((s) => s.id ?? "");
}

describe("结构化文档的版本读数", () => {
  it("site.json / resource-metadata.json：从未写过是 null，写过一次即为数字", async () => {
    expect(await readStorageVersion(ctx, SITE)).toBeNull();
    expect(await readStorageVersion(ctx, RESOURCE)).toBeNull();

    await writeStoragePath(ctx, SITE, JSON.stringify({ basic: { title: "版本探针" } }));
    await writeStoragePath(ctx, RESOURCE, JSON.stringify({ meta: 1 }));

    const siteV = await readStorageVersion(ctx, SITE);
    const resV = await readStorageVersion(ctx, RESOURCE);
    expect(siteV).toBeTypeOf("number");
    expect(resV).toBeTypeOf("number");
  });

  it("navigation.json：写后版本是数字，且与 navigation-default.json 同源", async () => {
    await writeStoragePath(ctx, NAV, JSON.stringify(navDoc("ver-cat", ["ver-s1"])));
    const v = await readStorageVersion(ctx, NAV);
    expect(v).toBeTypeOf("number");
    expect(await readStorageVersion(ctx, "src/navsphere/content/navigation-default.json")).toBe(v);
  });

  it("writeStoragePath 返回的 version 与重读的版本一致", async () => {
    const r = await writeStoragePath(ctx, NAV, JSON.stringify(navDoc("ver-cat", ["ver-s1", "ver-s2"])));
    expect(r.version).toBeTypeOf("number");
    expect(r.version).toBe(await readStorageVersion(ctx, NAV));
  });
});

describe("导航整包写的乐观并发", () => {
  it("同版本写成功并推进版本；陈旧版本再写必须 409，且内容不动", async () => {
    await writeStoragePath(ctx, NAV, JSON.stringify(navDoc("cas-cat", ["cas-a1"])));
    const v1 = (await readStorageVersion(ctx, NAV))!;

    const ok = await writeStoragePath(
      ctx,
      NAV,
      JSON.stringify(navDoc("cas-cat", ["cas-a1", "cas-b1"])),
      { ifVersion: v1 },
    );
    expect(ok.ok).toBe(true);
    const v2 = (await readStorageVersion(ctx, NAV))!;
    expect(v2).toBeGreaterThan(v1);
    expect(ok.version).toBe(v2);

    // 拿旧版本重放：必须拒绝，且把当前版本如实回报（客户端据此重读后重算）
    await expect(
      writeStoragePath(ctx, NAV, JSON.stringify(navDoc("cas-cat", ["cas-a1", "cas-c1"])), { ifVersion: v1 }),
    ).rejects.toMatchObject({ statusCode: 409, currentVersion: v2 });

    // 被拒绝的写入不能改动内容：b1 在，c1 不在
    const after = await readStoragePath(ctx, NAV);
    expect(navSiteIds(after, "cas-cat")).toEqual(["cas-a1", "cas-b1"]);
  });

  it("同版本并发写：恰好一个成功、一个 409，胜者内容落库", async () => {
    await writeStoragePath(ctx, NAV, JSON.stringify(navDoc("race-cat", ["race-base"])));
    const v = (await readStorageVersion(ctx, NAV))!;

    const results = await Promise.allSettled([
      writeStoragePath(ctx, NAV, JSON.stringify(navDoc("race-cat", ["race-base", "race-w1"])), { ifVersion: v }),
      writeStoragePath(ctx, NAV, JSON.stringify(navDoc("race-cat", ["race-base", "race-w2"])), { ifVersion: v }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });

    // 只有一个胜者落库：w1 与 w2 恰好其一在，另一不在
    const after = await readStoragePath(ctx, NAV);
    const ids = navSiteIds(after, "race-cat");
    expect(ids).toContain("race-base");
    expect(ids.filter((id) => id === "race-w1" || id === "race-w2")).toHaveLength(1);
  });

  it("不带 ifVersion 的导航写仍可覆盖（既有调用方不受影响）", async () => {
    await writeStoragePath(ctx, NAV, JSON.stringify(navDoc("blind-cat", ["blind-1"])));
    await writeStoragePath(ctx, NAV, JSON.stringify(navDoc("blind-cat", ["blind-1", "blind-2"])));
    const after = await readStoragePath(ctx, NAV);
    expect(navSiteIds(after, "blind-cat")).toEqual(["blind-1", "blind-2"]);
  });
});

describe("site.json / resource-metadata.json 的乐观并发", () => {
  it("site.json：陈旧版本写必须 409，且配置不动", async () => {
    await writeStoragePath(ctx, SITE, JSON.stringify({ basic: { title: "一" } }));
    const v1 = (await readStorageVersion(ctx, SITE))!;

    await writeStoragePath(ctx, SITE, JSON.stringify({ basic: { title: "二" } }), { ifVersion: v1 });
    const v2 = (await readStorageVersion(ctx, SITE))!;
    expect(v2).toBeGreaterThan(v1);

    await expect(
      writeStoragePath(ctx, SITE, JSON.stringify({ basic: { title: "三" } }), { ifVersion: v1 }),
    ).rejects.toMatchObject({ statusCode: 409, currentVersion: v2 });

    const after = (await readStoragePath(ctx, SITE)) as { basic?: { title?: string } };
    expect(after.basic?.title).toBe("二");
  });

  it("resource-metadata.json：陈旧版本写必须 409，且内容不动", async () => {
    await writeStoragePath(ctx, RESOURCE, JSON.stringify({ n: 1 }));
    const v1 = (await readStorageVersion(ctx, RESOURCE))!;

    await writeStoragePath(ctx, RESOURCE, JSON.stringify({ n: 2 }), { ifVersion: v1 });
    const v2 = (await readStorageVersion(ctx, RESOURCE))!;
    expect(v2).toBeGreaterThan(v1);

    await expect(
      writeStoragePath(ctx, RESOURCE, JSON.stringify({ n: 3 }), { ifVersion: v1 }),
    ).rejects.toMatchObject({ statusCode: 409, currentVersion: v2 });

    const after = (await readStoragePath(ctx, RESOURCE)) as { n?: number };
    expect(after.n).toBe(2);
  });
});
