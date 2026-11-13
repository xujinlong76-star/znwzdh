/**
 * M12 keyset 分页 + P10 NOT IN → NOT EXISTS。
 *
 * 钉住的语义：
 *   1. 游标是不透明的 base64url(JSON)；非法游标抛 InvalidKeysetCursorError；
 *   2. 每个已转换的 listing：游标分页（小 limit）拼接结果与 OFFSET 全量
 *      顺序逐项一致——无重复、无遗漏、无抖动；末页 nextCursor 为 null；
 *   3. `tags.ts` 里不再出现 `NOT IN (`（相关子查询的 NOT EXISTS 反连接）；
 *      `llm-prices.ts` / `notifications.ts` 曾同样转成 NOT EXISTS，但用的
 *      `FROM (VALUES ...) AS keep/seen` 派生表在 W4 验证的 SQLite 上报
 *      `near "(": syntax error`，已 revert 回 NOT IN——那两处的列是主键、
 *      清单是内存里的非空 id，两侧永不为 NULL，P10 的 NULL 顾虑不成立，
 *      守卫只要求它们带「不要改成 VALUES 派生表」的注释、且活 SQL 里不含
 *      `FROM (VALUES ${...}` 模板。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import {
  buildKeysetPredicate,
  decodeKeysetCursor,
  encodeKeysetCursor,
  InvalidKeysetCursorError,
  jobKeysetValues,
  listVideoItems,
  parseKeysetCursor,
  siteKeysetValues,
  videoItemKeysetValues,
} from "../src/index.ts";
import type { TaxonomyProposal } from "@navhub/core";

let db: Db;
let repo: Repository;

beforeEach(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
});

afterEach(async () => {
  await db.close();
});

/** 用游标把「返回 nextCursor 的页函数」翻完，返回拼接后的 items。 */
async function drain<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const page = await fetchPage(cursor);
    out.push(...page.items);
    if (!page.nextCursor) return out;
    cursor = page.nextCursor;
  }
  throw new Error("游标翻页超过 50 页，疑似死循环");
}

/** 用游标把「返回裸数组的 listing」翻完：调用方按 limit+1 取、末行编游标。 */
async function drainArray<T>(
  fetchPage: (cursor?: string) => Promise<T[]>,
  limit: number,
  keyValues: (item: T) => Array<string | number>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard++) {
    const rows = await fetchPage(cursor);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    out.push(...page);
    if (!hasMore) return out;
    cursor = encodeKeysetCursor(keyValues(page[page.length - 1]!));
  }
  throw new Error("游标翻页超过 50 页，疑似死循环");
}

describe("keyset 游标编解码", () => {
  it("编解码往返，string/number 混合键值无损", () => {
    const values: Array<string | number> = [3, 0, 12.5, "site-9"];
    expect(decodeKeysetCursor(encodeKeysetCursor(values))).toEqual(values);
  });

  it("非法游标解码返回 null，不抛错", () => {
    expect(decodeKeysetCursor("")).toBeNull();
    expect(decodeKeysetCursor("!!!not-base64!!!")).toBeNull();
    expect(decodeKeysetCursor(encodeKeysetCursor([null]))).toBeNull();
    expect(decodeKeysetCursor(encodeKeysetCursor([]))).toBeNull();
    expect(decodeKeysetCursor(42)).toBeNull();
  });

  it("混合升/降序谓词按字典序展开，参数顺序与占位符一致", () => {
    const pred = buildKeysetPredicate(
      [
        { column: "s.sort", direction: "ASC" },
        { column: "s.trend_score", direction: "DESC" },
        { column: "s.id", direction: "ASC" },
      ],
      [2, 9, "abc"],
    );
    expect(pred).not.toBeNull();
    expect(pred!.sql).toBe(
      "((s.sort > ?) OR (s.sort = ? AND s.trend_score < ?) OR (s.sort = ? AND s.trend_score = ? AND s.id > ?))",
    );
    expect(pred!.params).toEqual([2, 2, 9, 2, 9, "abc"]);
  });

  it("键数与值数不符返回 null", () => {
    expect(buildKeysetPredicate([{ column: "id", direction: "DESC" }], [1, 2])).toBeNull();
  });

  it("parseKeysetCursor：缺省返回 undefined，非法/键数不对抛 InvalidKeysetCursorError", () => {
    expect(parseKeysetCursor(undefined, 2)).toBeUndefined();
    expect(parseKeysetCursor("", 2)).toBeUndefined();
    expect(parseKeysetCursor(encodeKeysetCursor([1, "x"]), 2)).toEqual([1, "x"]);
    expect(() => parseKeysetCursor("garbage!!", 2)).toThrow(InvalidKeysetCursorError);
    expect(() => parseKeysetCursor(encodeKeysetCursor([1]), 2)).toThrow(InvalidKeysetCursorError);
  });
});

describe("listSites keyset", () => {
  it("游标页拼接与 OFFSET 全量顺序一致（含 sort 并列 + trend_score 并列）", async () => {
    const cat = await repo.createCategory({ title: "Keyset 站点" });
    const sorts = [0, 0, 1, 1, 1, 2, 2];
    const trends = [5, 3, 9, 9, 1, 0, 0];
    for (let i = 0; i < 7; i++) {
      const site = await repo.createSite({
        url: `https://keyset-${i}.example.com`,
        title: `站点 ${i}`,
        categoryId: cat.id,
        status: "active",
      });
      await repo.run("UPDATE sites SET sort = ?, trend_score = ? WHERE id = ?", [sorts[i], trends[i], site.id]);
    }
    const full = await repo.listSites({ limit: 100 });
    const viaCursor = await drainArray(
      (cursor) => repo.listSites({ limit: 3, cursor }),
      2,
      siteKeysetValues,
    );
    expect(viaCursor.map((s) => s.id)).toEqual(full.map((s) => s.id));
    // 末页没有下一页游标：直接取第 3 页应为空
    expect(await repo.listSites({ limit: 2, cursor: encodeKeysetCursor(siteKeysetValues(full[full.length - 1]!)) })).toEqual([]);
  });

  it("非法游标抛 InvalidKeysetCursorError", async () => {
    await expect(repo.listSites({ cursor: "not-a-cursor" })).rejects.toThrow(InvalidKeysetCursorError);
  });
});

describe("listCategoriesPage keyset", () => {
  it("游标页拼接与 OFFSET 全量顺序一致，末页 nextCursor 为 null", async () => {
    for (const title of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]) {
      await repo.createCategory({ title });
    }
    const full = await repo.listCategoriesPage({ limit: 100 });
    const viaCursor = await drain((cursor) => repo.listCategoriesPage({ limit: 2, cursor }));
    expect(viaCursor.map((c) => c.id)).toEqual(full.items.map((c) => c.id));
    // 逐页走到底：offset 页也给 nextCursor，可直接切到游标翻页；末页为 null。
    // 不硬编码总行数（库里可能有种子类目），只断言走完的总数与全量一致。
    let cursor: string | undefined;
    let walked = 0;
    let lastNext: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await repo.listCategoriesPage({ limit: 2, cursor });
      walked += page.items.length;
      lastNext = page.nextCursor;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(walked).toBe(full.items.length);
    expect(lastNext).toBeNull();
    await expect(repo.listCategoriesPage({ cursor: "xx" })).rejects.toThrow(InvalidKeysetCursorError);
  });
});

describe("listFavoritesPage keyset", () => {
  it("created 与 title 两种排序的游标页都与全量一致", async () => {
    const cat = await repo.createCategory({ title: "收藏" });
    const user = "keyset-user";
    const titles = ["Zebra", "apple", "Mango", "banana", "Cherry"];
    for (let i = 0; i < 5; i++) {
      const site = await repo.createSite({
        url: `https://fav-${i}.example.com`,
        title: titles[i]!,
        categoryId: cat.id,
        status: "active",
      });
      await repo.addFavorite({ userId: user, siteId: site.id });
    }
    for (const sort of ["created", "title"] as const) {
      const full = await repo.listFavoritesPage(user, { sort, limit: 100 });
      const viaCursor = await drain((cursor) => repo.listFavoritesPage(user, { sort, limit: 2, cursor }));
      expect(viaCursor.map((f) => f.id)).toEqual(full.items.map((f) => f.id));
    }
  });
});

describe("通知 keyset", () => {
  it("listNotificationsPage 游标页与全量一致", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.createNotification({ identity: "u-notif", kind: "sync", title: `通知 ${i}` });
    }
    const full = await repo.listNotificationsPage("u-notif", 100, 0, false);
    const viaCursor = await drain((cursor) => repo.listNotificationsPage("u-notif", 2, 0, false, cursor));
    expect(viaCursor.map((n) => n.id)).toEqual(full.items.map((n) => n.id));
  });

  it("listNotificationDeliveries 游标页与全量一致", async () => {
    for (let i = 0; i < 4; i++) {
      await repo.emitNotification({
        identity: "u-deliv",
        idempotencyKey: `k-${i}`,
        kind: "sync",
        title: `投递 ${i}`,
        channels: ["inapp"],
      });
    }
    const full = await repo.listNotificationDeliveries({ limit: 100 });
    expect(full.items).toHaveLength(4);
    const viaCursor = await drain((cursor) => repo.listNotificationDeliveries({ limit: 2, cursor }));
    expect(viaCursor.map((d) => d.id)).toEqual(full.items.map((d) => d.id));
  });
});

describe("listJobs keyset", () => {
  it("游标页拼接与 OFFSET 全量一致（含同毫秒 created_at 并列）", async () => {
    const now = Date.now();
    for (let i = 0; i < 6; i++) {
      await repo.run(
        "INSERT INTO jobs (id, kind, payload, status, attempts, error, created_at, updated_at, next_run_at, progress_done, progress_total) VALUES (?,?,?,?,?,NULL,?,?,NULL,0,0)",
        [`job-${i}`, "health_check", "{}", "done", 0, now - (i % 2) * 1000, now],
      );
    }
    const full = await repo.listJobs("done", 100);
    const viaCursor = await drainArray(
      (cursor) => repo.listJobs("done", 3, 0, { cursor }),
      2,
      jobKeysetValues,
    );
    expect(viaCursor.map((j) => j.id)).toEqual(full.map((j) => j.id));
    await expect(repo.listJobs("done", 10, 0, { cursor: "bad" })).rejects.toThrow(InvalidKeysetCursorError);
  });
});

describe("listAuditLogs / listVisitsPage keyset", () => {
  it("审计日志游标页与全量一致", async () => {
    for (let i = 0; i < 5; i++) {
      await repo.audit({ actor: "admin", action: "test.keyset", target: `t-${i}` });
    }
    const full = await repo.listAuditLogs({ limit: 100 });
    const viaCursor = await drain((cursor) => repo.listAuditLogs({ limit: 2, cursor }));
    expect(viaCursor.map((a) => a.id)).toEqual(full.items.map((a) => a.id));
  });

  it("访问历史游标页与全量一致", async () => {
    const cat = await repo.createCategory({ title: "访问" });
    const site = await repo.createSite({ url: "https://visit.example.com", title: "访问站", categoryId: cat.id, status: "active" });
    for (let i = 0; i < 5; i++) {
      await repo.recordEvent("click", { siteId: site.id, identity: "u-visit" });
    }
    const full = await repo.listVisitsPage("u-visit", 100, 0);
    const viaCursor = await drain((cursor) => repo.listVisitsPage("u-visit", 2, 0, cursor));
    expect(viaCursor.map((v) => v.id)).toEqual(full.items.map((v) => v.id));
  });
});

describe("listTaxonomyProposals keyset", () => {
  it("游标页拼接与全量一致（含 confidence 并列）", async () => {
    const now = Date.now();
    const proposals: TaxonomyProposal[] = [0, 1, 2, 3, 4].map((i) => ({
      id: `prop-${i}`,
      kind: "tag_consolidation",
      targetId: `tag-${i}`,
      suggestedValue: `Tag ${i}`,
      confidence: i % 2 === 0 ? 0.9 : 0.8,
      reason: "测试",
      status: "pending",
      createdAt: now - (i % 3) * 1000,
    }));
    await repo.saveTaxonomyProposals(proposals);
    const full = await repo.listTaxonomyProposals({ limit: 100 });
    expect(full.total).toBe(5);
    const viaCursor = await drain((cursor) => repo.listTaxonomyProposals({ limit: 2, cursor }));
    expect(viaCursor.map((p) => p.id)).toEqual(full.items.map((p) => p.id));
  });
});

describe("listVideoItems / listPluginReviews keyset", () => {
  it("视频条目游标页与全量一致（含 sort 并列与跨分类）", async () => {
    const now = Date.now();
    for (let i = 0; i < 6; i++) {
      await repo.run(
        "INSERT INTO video_items (id, category_id, title, href, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
        [`vid-${i}`, i < 3 ? "cat-a" : "cat-b", `视频 ${i}`, `https://v.example.com/${i}`, i % 2, now, now],
      );
    }
    const full = await listVideoItems(repo, { limit: 100 });
    const viaCursor = await drainArray(
      (cursor) => listVideoItems(repo, { limit: 3, cursor }),
      2,
      videoItemKeysetValues,
    );
    expect(viaCursor.map((v) => v.id)).toEqual(full.map((v) => v.id));
  });

  it("插件评价游标页与全量一致（含 updated_at 并列）", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      await repo.run(
        "INSERT INTO plugin_reviews (id, plugin_id, identity, rating, installed_version, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        [`rev-${i}`, "plug-1", `user-${i}`, 5, "1.0.0", "visible", now - (i % 2) * 1000, now - (i % 2) * 1000],
      );
    }
    const full = await repo.listPluginReviews("plug-1", { limit: 100 });
    expect(full.total).toBe(5);
    const viaCursor = await drain((cursor) => repo.listPluginReviews("plug-1", { limit: 2, cursor }));
    expect(viaCursor.map((r) => r.id)).toEqual(full.items.map((r) => r.id));
  });
});

describe("P10：NOT IN → NOT EXISTS", () => {
  it("tags.ts 不再出现 NOT IN（相关子查询的 NOT EXISTS 反连接）", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/repository/tags.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/\bNOT IN\s*\(/);
    expect(src).toContain("NOT EXISTS");
  });

  it("llm-prices.ts / notifications.ts：NOT IN 只许带 NULL 安全注释，且不含 VALUES 派生表", () => {
    for (const file of ["llm-prices.ts", "notifications.ts"]) {
      const src = readFileSync(fileURLToPath(new URL("../src/repository/" + file, import.meta.url)), "utf8");
      // 这两处的 NOT IN 两侧永不为 NULL（主键列 + 内存非空 id 清单），见源码注释
      expect(src).toMatch(/\bNOT IN\s*\(/);
      expect(src).toContain("永不为 NULL");
      expect(src).toContain("不要改成");
      // W4 验证过：FROM (VALUES ...) 派生表在部分 SQLite 上报 near "(": syntax error。
      // 这里只拦「活 SQL」（模板里的 FROM (VALUES ${...})），注释里可以直写被禁写法。
      expect(src).not.toMatch(/FROM \(VALUES \$\{/);
    }
  });

  it("单价簿全量替换：被移除的模型真的消失（NOT IN 清扫）", async () => {
    await repo.replaceLlmModelPrices([
      { model: "keep", promptPer1kRmb: 1, completionPer1kRmb: 1 },
      { model: "drop", promptPer1kRmb: 1, completionPer1kRmb: 1 },
    ]);
    await repo.replaceLlmModelPrices([{ model: "keep", promptPer1kRmb: 2, completionPer1kRmb: 2 }]);
    expect((await repo.listLlmModelPrices()).map((p) => p.model)).toEqual(["keep"]);
  });

  it("标签合并：已绑目标标签的站点不重复迁移（NOT EXISTS 反连接）", async () => {
    const cat = await repo.createCategory({ title: "合并" });
    const both = await repo.createSite({
      url: "https://merge-both.example.com",
      title: "双标站",
      categoryId: cat.id,
      tags: ["源标签", "目标标签"],
      status: "active",
    });
    const onlySource = await repo.createSite({
      url: "https://merge-src.example.com",
      title: "单标站",
      categoryId: cat.id,
      tags: ["源标签"],
      status: "active",
    });
    const tags = await repo.listTagsWithCounts();
    const source = tags.find((t) => t.name === "源标签")!;
    const target = tags.find((t) => t.name === "目标标签")!;
    const res = await repo.mergeTags(source.id, target.id);
    expect(res.moved).toBe(1);
    const rows = await repo.raw("SELECT site_id FROM site_tags WHERE tag_id = ?", [target.id]);
    const ids = rows.map((r) => String(r.site_id)).sort();
    expect(ids).toEqual([both.id, onlySource.id].sort());
  });

  it("relay 领取：同轮已处理行不再重复领取（NOT EXISTS 排除）", async () => {
    for (let i = 0; i < 3; i++) {
      await repo.emitNotification({
        identity: "u-relay",
        idempotencyKey: `r-${i}`,
        kind: "sync",
        title: `中继 ${i}`,
        channels: ["inapp"],
      });
    }
    expect(await repo.relayNotifications(10)).toEqual({ delivered: 3, failed: 0 });
    expect(await repo.relayNotifications(10)).toEqual({ delivered: 0, failed: 0 });
  });
});
