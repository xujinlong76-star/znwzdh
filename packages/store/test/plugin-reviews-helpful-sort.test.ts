/**
 * 评价「有用」投票与排序（P2-3）存储层测试。
 *
 * 覆盖：投票切换一人一票不重复计数、自己不能投自己、三种排序顺序、
 * helpfulByMe 回填、非默认排序不走 keyset 游标（nextCursor 为 null、
 * 非法游标也不抛错）、迁移后 helpful_count 列与票表存在。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndCleanPluginManifest, type PluginManifest } from "@navhub/core";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

let dir: string;
let db!: Db;
let repo!: Repository;

function manifestOf(raw: unknown): PluginManifest {
  const res = validateAndCleanPluginManifest(raw);
  if (!res.ok) throw new Error("fixture 未通过契约校验：" + res.errors.join(" | "));
  return res.manifest;
}

async function makePublished(slug: string) {
  return repo.createPlugin({
    manifest: manifestOf({
      manifestVersion: 1,
      kind: "site-pack",
      name: `有用排序包-${slug}`,
      version: "1.0.0",
      payload: { sites: [{ url: `https://${slug}.example.com/`, title: slug }] },
    }),
    status: "published",
    slug,
  });
}

async function installAndReview(slug: string, identity: string, rating: number) {
  await repo.installPlugin(slug, identity);
  return repo.createPluginReview(slug, identity, { rating, content: `${identity} 的 ${rating} 星评价` });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-reviews-helpful-"));
  db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "test.db") });
  repo = new Repository(db);
});

afterAll(async () => {
  await db.close?.();
  rmSync(dir, { recursive: true, force: true });
});

describe("togglePluginReviewHelpful：投票切换", () => {
  it("一人一票：投上 +1、再点撤回 -1、第三次又投上，计数不漂移", async () => {
    const p = await makePublished("helpful-toggle");
    const review = await installAndReview("helpful-toggle", "author-t", 5);
    expect(review.helpfulCount).toBe(0);

    const first = await repo.togglePluginReviewHelpful("helpful-toggle", review.id, "voter-1");
    expect(first.helpful).toBe(true);
    expect(first.helpfulCount).toBe(1);

    const second = await repo.togglePluginReviewHelpful("helpful-toggle", review.id, "voter-1");
    expect(second.helpful).toBe(false);
    expect(second.helpfulCount).toBe(0);

    const third = await repo.togglePluginReviewHelpful("helpful-toggle", review.id, "voter-1");
    expect(third.helpful).toBe(true);
    expect(third.helpfulCount).toBe(1);

    // 票表只有一行（主键去重），计数与票表行数一致
    const rows = await repo.raw("SELECT COUNT(*) AS cnt FROM plugin_review_helpful_votes WHERE review_id = ?", [review.id]);
    expect(Number(rows[0]?.cnt)).toBe(1);
  });

  it("多人投票累计；同一人反复切换不重复计数", async () => {
    const p = await makePublished("helpful-multi");
    const review = await installAndReview("helpful-multi", "author-m", 4);
    await repo.togglePluginReviewHelpful("helpful-multi", review.id, "voter-a");
    await repo.togglePluginReviewHelpful("helpful-multi", review.id, "voter-b");
    await repo.togglePluginReviewHelpful("helpful-multi", review.id, "voter-a"); // 撤回
    await repo.togglePluginReviewHelpful("helpful-multi", review.id, "voter-a"); // 再投上
    const after = await repo.getUserPluginReview(p.id, "author-m");
    expect(after?.helpfulCount).toBe(2);
  });

  it("不能给自己的评价投票；未知评价/未知插件分别报错", async () => {
    const p = await makePublished("helpful-self");
    const review = await installAndReview("helpful-self", "author-s", 5);
    await expect(repo.togglePluginReviewHelpful("helpful-self", review.id, "author-s")).rejects.toThrow(
      "不能给自己的评价投「有用」",
    );
    await expect(repo.togglePluginReviewHelpful("helpful-self", "no-such-id", "voter-1")).rejects.toThrow("评价不存在");
    await expect(repo.togglePluginReviewHelpful("no-such-plugin", review.id, "voter-1")).rejects.toThrow("插件不存在");
  });
});

describe("listPluginReviews：排序与 helpfulByMe", () => {
  it("helpful 排序按票数倒序；highest/lowest 按评分倒序/正序", async () => {
    const p = await makePublished("helpful-sort");
    const low = await installAndReview("helpful-sort", "author-low", 1);
    const mid = await installAndReview("helpful-sort", "author-mid", 4);
    const high = await installAndReview("helpful-sort", "author-high", 5);
    // 票数：low 3 票、mid 1 票、high 0 票（与评分顺序故意错开，区分两种排序）
    for (const voter of ["v1", "v2", "v3"]) {
      await repo.togglePluginReviewHelpful("helpful-sort", low.id, voter);
    }
    await repo.togglePluginReviewHelpful("helpful-sort", mid.id, "v1");

    const byHelpful = await repo.listPluginReviews(p.id, { sort: "helpful" });
    expect(byHelpful.items.map((r) => r.id)).toEqual([low.id, mid.id, high.id]);
    expect(byHelpful.items.map((r) => r.helpfulCount)).toEqual([3, 1, 0]);

    const byHighest = await repo.listPluginReviews(p.id, { sort: "highest" });
    expect(byHighest.items.map((r) => r.id)).toEqual([high.id, mid.id, low.id]);

    const byLowest = await repo.listPluginReviews(p.id, { sort: "lowest" });
    expect(byLowest.items.map((r) => r.id)).toEqual([low.id, mid.id, high.id]);

    const byDefault = await repo.listPluginReviews(p.id);
    expect(byDefault.total).toBe(3);
    expect(byDefault.items.map((r) => r.id).sort()).toEqual([low.id, mid.id, high.id].sort());
  });

  it("helpfulByMe：传 identity 时回填，投过的为 true、其余为 false；不传时留空", async () => {
    const p = await makePublished("helpful-byme");
    const r1 = await installAndReview("helpful-byme", "author-1", 5);
    const r2 = await installAndReview("helpful-byme", "author-2", 4);
    await repo.togglePluginReviewHelpful("helpful-byme", r1.id, "voter-x");

    const withIdentity = await repo.listPluginReviews(p.id, { identity: "voter-x" });
    const byId = new Map(withIdentity.items.map((r) => [r.id, r.helpfulByMe]));
    expect(byId.get(r1.id)).toBe(true);
    expect(byId.get(r2.id)).toBe(false);

    const withoutIdentity = await repo.listPluginReviews(p.id);
    expect(withoutIdentity.items.every((r) => r.helpfulByMe === undefined)).toBe(true);
  });

  it("非默认排序不走 keyset 游标：nextCursor 为 null，非法游标也不抛错", async () => {
    const p = await makePublished("helpful-cursor");
    await installAndReview("helpful-cursor", "author-1", 5);
    await installAndReview("helpful-cursor", "author-2", 4);
    await installAndReview("helpful-cursor", "author-3", 3);

    const page = await repo.listPluginReviews(p.id, { sort: "helpful", limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.nextCursor).toBeNull();

    // 同一非法游标在默认排序下会抛，在 helpful 排序下直接忽略
    const ignored = await repo.listPluginReviews(p.id, { sort: "highest", cursor: "!!!invalid" });
    expect(ignored.items).toHaveLength(3);
  });

  it("迁移：helpful_count 列与 plugin_review_helpful_votes 表存在", async () => {
    const cols = await repo.raw("PRAGMA table_info(plugin_reviews)");
    expect(cols.some((c) => String(c.name) === "helpful_count")).toBe(true);
    const tables = await repo.raw(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plugin_review_helpful_votes'",
    );
    expect(tables).toHaveLength(1);
  });
});
