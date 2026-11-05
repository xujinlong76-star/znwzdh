/**
 * navigation.json 写回的批量路径（升级改造方案 P1-2）。
 *
 * 老实现每站点一次 `updateSite`：事务内先 getSite（带标签/分面相关子查询）、
 * 再 UPDATE、再 getSite 回读。8k 站点保存 ≈ 1.6 万次重读 + 8k 次写，全部压在
 * 同一条写事务里。这一轮换成：存量行全量读出 → 内存 diff → 只写变化行；
 * 新增/复活/删除分别走多行 INSERT / 批量 UPDATE / 批量软删。
 *
 * 这里同时钉住三类不能丢的语义：
 *   1. source 过滤：非 navsphere 来源的站点不在快照里也保留；
 *   2. 复活：快照带回回收站 id 时，等价于 createSiteWithId 的复活分支
 *      （清空 tags/facets/relations、metadata 归零、状态回 active）；
 *   3. 幂等：原样保存不推进 updated_at（diff 生效的直接证据）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { resolveSiteIcon } from "@navhub/core";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const NAV = "src/navsphere/content/navigation.json";
const TOP = 8;
const SUBS = 4;
// 8 × (199 + 4 × 199) = 7960：贴近 8k，又给下面的「手工站点 / 新站点」留出余量
// （超过 NAVIGATION_MAX_SITES 的库本来就不在快照的全量投影范围内）
const PER = 199;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-nav-bulk-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();

  for (let i = 0; i < TOP; i++) {
    await ctx.repo.createCategory({ id: `nav-top${i}`, title: `顶级类目 ${i}`, source: "navsphere" });
    for (let k = 0; k < SUBS; k++) {
      await ctx.repo.createCategory({ id: `nav-sub${i}-${k}`, title: `子类目 ${i}-${k}`, parentId: `nav-top${i}`, source: "navsphere" });
    }
  }
  const rows: Array<Parameters<AppContext["repo"]["insertSitesBulk"]>[0][number]> = [];
  for (let i = 0; i < TOP; i++) {
    for (let j = 0; j < PER; j++) {
      const id = `s-top${i}-${j}`;
      const url = `https://bulk-${id}.example.com`;
      rows.push({ id, url, title: `站点 ${id}`, iconKey: resolveSiteIcon(url, `站点 ${id}`), categoryId: `nav-top${i}`, sort: j, source: "navsphere" });
    }
    for (let k = 0; k < SUBS; k++) {
      for (let j = 0; j < PER; j++) {
        const id = `s-sub${i}-${k}-${j}`;
        const url = `https://bulk-${id}.example.com`;
        rows.push({ id, url, title: `站点 ${id}`, iconKey: resolveSiteIcon(url, `站点 ${id}`), categoryId: `nav-sub${i}-${k}`, sort: j, source: "navsphere" });
      }
    }
  }
  await ctx.repo.withTransaction(async () => {
    for (let i = 0; i < rows.length; i += 1000) {
      await ctx.repo.insertSitesBulk(rows.slice(i, i + 1000), { hydrate: false });
    }
  });
}, 120_000);

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 与 buildNavigationData 同形的两级快照（写回时逐字段与存量一致才算「未变化」） */
function buildSnapshot(): any {
  return {
    navigationItems: Array.from({ length: TOP }, (_, i) => ({
      id: `nav-top${i}`,
      title: `顶级类目 ${i}`,
      enabled: true,
      items: Array.from({ length: PER }, (_, j) => ({
        id: `s-top${i}-${j}`,
        title: `站点 s-top${i}-${j}`,
        href: `https://bulk-s-top${i}-${j}.example.com`,
        enabled: true,
      })),
      subCategories: Array.from({ length: SUBS }, (_, k) => ({
        id: `nav-sub${i}-${k}`,
        title: `子类目 ${i}-${k}`,
        enabled: true,
        items: Array.from({ length: PER }, (_, j) => ({
          id: `s-sub${i}-${k}-${j}`,
          title: `站点 s-sub${i}-${k}-${j}`,
          href: `https://bulk-s-sub${i}-${k}-${j}.example.com`,
          enabled: true,
        })),
      })),
    })),
  };
}

async function putSnapshot(data: unknown) {
  return app.inject({ method: "PUT", url: "/api/storage", payload: { path: NAV, content: JSON.stringify(data) } });
}

/**
 * 捕获一次请求落下的 SQL。
 *
 * 写放大回归（逐行 `getSite` 回读）的确定性指纹是「SELECT 条数与站点数同阶」，
 * 与机器负载无关；墙钟在多测试并行时会被邻居拖慢，只适合做数量级的兜底。
 */
async function captureSql<T>(action: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  type RepoMethod = (...args: any[]) => Promise<any>;
  const calls: string[] = [];
  const repo = ctx.repo as unknown as Record<string, RepoMethod>;
  const originals = new Map<string, { own: boolean; fn: RepoMethod }>();
  for (const method of ["raw", "run", "runCount"] as const) {
    originals.set(method, { own: Object.prototype.hasOwnProperty.call(repo, method), fn: repo[method] });
    repo[method] = (sqlText: string, params?: unknown[]) => {
      calls.push(sqlText);
      return originals.get(method)!.fn.call(ctx.repo, sqlText, params);
    };
  }
  try {
    return { result: await action(), sql: calls };
  } finally {
    for (const [method, original] of originals) {
      if (original.own) repo[method] = original.fn;
      else delete repo[method];
    }
  }
}

async function siteRow(id: string): Promise<any> {
  const rows = await ctx.repo.raw(
    "SELECT id, title, category_id, status, source, deleted_at, sort, fts_tokens, updated_at FROM sites WHERE id = ?",
    [id],
  );
  return rows[0];
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await ctx.repo.raw(sql, params);
  return Number((rows[0] as any)?.n ?? 0);
}

function findItem(snapshot: any, id: string): any | undefined {
  for (const top of snapshot.navigationItems) {
    const direct = (top.items ?? []).find((item: any) => item.id === id);
    if (direct) return direct;
    for (const sub of top.subCategories ?? []) {
      const nested = (sub.items ?? []).find((item: any) => item.id === id);
      if (nested) return nested;
    }
  }
  return undefined;
}

function dropItem(snapshot: any, id: string): void {
  for (const top of snapshot.navigationItems) {
    top.items = (top.items ?? []).filter((item: any) => item.id !== id);
    for (const sub of top.subCategories ?? []) {
      sub.items = (sub.items ?? []).filter((item: any) => item.id !== id);
    }
  }
}

describe("navigation.json 写回批量路径（P1-2）", () => {
  it("约 8000 站点原样保存：diff 生效（updated_at 不动）且耗时低于 5 秒", async () => {
    const control = await siteRow("s-top0-0");
    const t0 = performance.now();
    const res = await putSnapshot(buildSnapshot());
    const elapsed = performance.now() - t0;
    expect(res.statusCode, res.body).toBe(200);
    expect(elapsed, `8k 站点保存耗时 ${Math.round(elapsed)}ms`).toBeLessThan(5000);

    const after = await siteRow("s-top0-0");
    expect(after.title).toBe(control.title);
    // 未变化行不写：这是「内存 diff」与「无条件 UPDATE」的可观测差别
    expect(after.updated_at).toBe(control.updated_at);
    expect(await count("SELECT COUNT(*) AS n FROM sites WHERE deleted_at IS NULL")).toBe(TOP * (PER + SUBS * PER));
  }, 60_000);

  it("只有真正变化的站点被写：标题更新、fts 重建，其余行时间戳不动", async () => {
    const target = "s-top0-0";
    const control = "s-top0-1";
    const before = await siteRow(target);
    const controlBefore = await siteRow(control);

    const snapshot = buildSnapshot();
    findItem(snapshot, target)!.title = "标题被改过的站点";
    const res = await putSnapshot(snapshot);
    expect(res.statusCode, res.body).toBe(200);

    const after = await siteRow(target);
    expect(after.title).toBe("标题被改过的站点");
    expect(after.updated_at).toBeGreaterThan(before.updated_at);
    expect(after.fts_tokens).not.toBe(before.fts_tokens);
    expect((await siteRow(control)).updated_at).toBe(controlBefore.updated_at);
  }, 60_000);

  it("删除语义不变：非 navsphere 来源保留，托管站点缺席才软删（关联数据暂留）", async () => {
    const manual = await ctx.repo.createSite({
      url: "https://manual-keep.example.com",
      title: "手工站点",
      categoryId: "nav-top0",
      source: "manual",
    });
    const target = "s-top0-1";
    await ctx.repo.setSiteTags(target, ["ai-工具"]);
    await ctx.repo.setSiteFacets(target, { topic: ["ai"] });
    await ctx.repo.setSiteRelations(target, [
      { id: "rel-snap-1", sourceSiteId: target, targetSiteId: null, targetTitle: "目标站", targetUrl: "https://rel-target.example.com", relationType: "related" },
    ]);

    const snapshot = buildSnapshot();
    dropItem(snapshot, target);
    const res = await putSnapshot(snapshot);
    expect(res.statusCode, res.body).toBe(200);

    expect((await ctx.repo.getSite(manual.id))?.id).toBe(manual.id);
    const removed = await siteRow(target);
    expect(removed.deleted_at).not.toBeNull();
    // 软删不清关联：复活路径必须自己清（下面一条用例）
    expect(await count("SELECT COUNT(*) AS n FROM site_tags WHERE site_id = ?", [target])).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*) AS n FROM site_facets WHERE site_id = ?", [target])).toBeGreaterThan(0);
    expect(await count("SELECT COUNT(*) AS n FROM site_relations WHERE source_site_id = ?", [target])).toBeGreaterThan(0);
  }, 60_000);

  it("复活语义与 createSiteWithId 一致：回 active、清空 tags/facets/relations、source 归一", async () => {
    const target = "s-top0-1";
    const snapshot = buildSnapshot();
    findItem(snapshot, target)!.title = "复活后的站点";
    const res = await putSnapshot(snapshot);
    expect(res.statusCode, res.body).toBe(200);

    const revived = await siteRow(target);
    expect(revived.deleted_at).toBeNull();
    expect(revived.status).toBe("active");
    expect(revived.source).toBe("navsphere");
    expect(revived.title).toBe("复活后的站点");
    expect(await count("SELECT COUNT(*) AS n FROM site_tags WHERE site_id = ?", [target])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM site_facets WHERE site_id = ?", [target])).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM site_relations WHERE source_site_id = ?", [target])).toBe(0);
  }, 60_000);

  it("快照里的新站点走多行 INSERT：来源 navsphere、检索字段已建", async () => {
    const snapshot = buildSnapshot();
    snapshot.navigationItems[0].items.push({
      id: "brand-new-site",
      title: "全新站点",
      href: "https://brand-new.example.com",
      enabled: true,
    });
    const res = await putSnapshot(snapshot);
    expect(res.statusCode, res.body).toBe(200);

    const created = await siteRow("brand-new-site");
    expect(created.category_id).toBe("nav-top0");
    expect(created.source).toBe("navsphere");
    expect(created.deleted_at).toBeNull();
    expect(String(created.fts_tokens ?? "").length).toBeGreaterThan(0);
  }, 60_000);

  it("最坏情况：约 8000 行全部变化时批量落库，且不逐行重读（SQL 形状守卫）", async () => {
    const snapshot = buildSnapshot();
    // 每条都改标题：全量 UPDATE 路径（批量取标签 + 逐行 UPDATE），是写放大的上限
    for (const top of snapshot.navigationItems) {
      for (const item of top.items ?? []) item.title = item.title + "（改名）";
      for (const sub of top.subCategories ?? []) {
        for (const item of sub.items ?? []) item.title = item.title + "（改名）";
      }
    }
    const t0 = performance.now();
    const { result: res, sql } = await captureSql(() => putSnapshot(snapshot));
    const elapsed = performance.now() - t0;
    expect(res.statusCode, res.body).toBe(200);

    // 旧实现是「每站点 getSite（带标签/分面相关子查询）+ UPDATE + 再 getSite 回读」，
    // 8k 行就是 2.4 万条 SQL；现在的 SELECT 只跟类目数（40）和分片数走，
    // 与站点数无关。这个断言在慢机器/并行负载下同样成立。
    const selects = sql.filter((statement) => /^\s*SELECT/i.test(statement));
    expect(
      selects.length,
      `SELECT 条数=${selects.length}（站点 ${TOP * (PER + SUBS * PER)} 个）：${selects.slice(0, 8).join(" | ")}`,
    ).toBeLessThan(200);
    // 写入形状：每个变化行一条 UPDATE，没有额外回读（回读会同时抬高 SELECT 与总条数）
    expect(sql.length, `SQL 总条数=${sql.length}`).toBeLessThan(9000);

    // 墙钟只拦「数量级退化」。计划验收的 8k < 5s 是隔离口径（单跑本文件实测见日志）；
    // 全量测试并行跑时邻居会把这条路径拖到 6s 上下，固定 5s 会让门禁随机变红。
    expect(elapsed, `8k 行全量更新耗时 ${Math.round(elapsed)}ms（5s 基准请单跑本文件核对）`).toBeLessThan(15_000);

    const changed = await siteRow("s-top7-198");
    expect(changed.title).toBe("站点 s-top7-198（改名）");
    expect(String(changed.fts_tokens)).toContain("改名");
  }, 60_000);
});
