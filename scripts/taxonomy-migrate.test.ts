/**
 * P3 迁移脚本回归（scripts/taxonomy-migrate.mjs）。
 *
 * 三个最容易被误判的点：
 *  1. dry-run 必须零写入（否则「先看看」就已经改了库）；
 *  2. apply 全链路：registry 投影、remap 日志、回收站恢复、旧根删除、
 *     标题唯一索引、零引用标签提案、reindex 任务；
 *  3. 缺口占比 >=5% 时在写入前拒绝（数据落到未分类是静默事故）。
 *
 * 用临时库 + 合成备份跑真实脚本，不 mock openDb。
 */
import { afterAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../packages/store/src/driver.ts";
import { runTaxonomyMigrate } from "./taxonomy-migrate.mjs";

const storeRequire = createRequire(new URL("../packages/store/package.json", import.meta.url));
const Database = storeRequire("better-sqlite3") as new (path: string, opts?: Record<string, unknown>) => any;

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navhub-taxonomy-migrate-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const MATCHED = 26;

async function buildFixture(opts: { gapOnly?: boolean } = {}): Promise<{ dbPath: string; backupPath: string }> {
  const dir = tempDir();
  const dbPath = join(dir, "navhub.db");
  const backupPath = join(dir, "old.db");
  const now = Date.now();

  const db = await openDb({ dialect: "sqlite", sqlitePath: dbPath, skipOrphanCleanup: true });
  const raw = db.sqlite;
  const insertCat = raw.prepare(
    "INSERT INTO categories (id, anchor, parent_id, title, sort, source, created_at, updated_at) VALUES (?,?,?,?,0,'seed',?,?)",
  );
  insertCat.run("cat-ai", "cat-ai", null, "AI 工具", now, now);
  insertCat.run("cat-dev", "cat-dev", null, "开发运维", now, now);

  const insertSite = raw.prepare(
    `INSERT INTO sites (id, url, title, category_id, sub_category_id, status, enabled, created_at, updated_at, deleted_at)
     VALUES (?,?,?,?,?, 'active', 1, ?, ?, ?)`,
  );
  insertSite.run("live-1", "https://kubernetes.io", "Kubernetes", "cat-dev", null, now, now, null);

  if (opts.gapOnly) {
    insertSite.run("trash-gap", "https://etherscan.io", "Etherscan", "cat-old-blockchain", null, now, now, now - 1000);
  } else {
    for (let i = 0; i < MATCHED; i += 1) {
      if (i === 0) {
        insertSite.run("trash-1", "https://hub.docker.com", "Docker Hub", "cat-old-containers", null, now, now, now - 1000);
      } else if (i === 1) {
        insertSite.run("trash-2", "https://vitejs.dev", "Vite", "cat-old-build", "cat-old-core", now, now, now - 2000);
      } else {
        insertSite.run(`trash-${i + 1}`, `https://example-${i}.test`, `站点 ${i}`, "cat-old-containers", null, now, now, now - 3000 - i);
      }
    }
    insertSite.run("trash-gap", "https://etherscan.io", "Etherscan", "cat-old-blockchain", null, now, now, now - 4000);
  }

  const insertTag = raw.prepare("INSERT INTO tags (id, name, slug, group_name, created_at) VALUES (?,?,?, 'topic', ?)");
  insertTag.run("tag-react", "React", "react", now);
  insertTag.run("tag-dead", "DeadTag", "deadtag", now);
  insertTag.run("tag-zero", "ZeroTag", "zerotag", now);
  raw.prepare("INSERT INTO site_tags (site_id, tag_id) VALUES (?,?)").run("live-1", "tag-react");
  raw.prepare("INSERT INTO site_tags (site_id, tag_id) VALUES (?,?)").run("trash-gap", "tag-dead");
  await db.close();

  const backup = new Database(backupPath);
  backup.exec("CREATE TABLE categories (id TEXT PRIMARY KEY, title TEXT NOT NULL, parent_id TEXT)");
  const insertOld = backup.prepare("INSERT INTO categories (id, title, parent_id) VALUES (?,?,?)");
  insertOld.run("cat-old-dev", "开发工具", null);
  insertOld.run("cat-old-containers", "容器与编排", "cat-old-dev");
  insertOld.run("cat-old-frontend", "前端开发", null);
  insertOld.run("cat-old-build", "构建与工程化", "cat-old-frontend");
  insertOld.run("cat-old-core", "核心框架", "cat-old-frontend");
  insertOld.run("cat-old-web3", "Web3", null);
  insertOld.run("cat-old-blockchain", "区块浏览器", "cat-old-web3");
  backup.close();

  return { dbPath, backupPath };
}

function readonly(dbPath: string): any {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

describe("taxonomy-migrate（P3）", () => {
  it("dry-run 只出报表，不改库、不建 category_remaps", async () => {
    const { dbPath, backupPath } = await buildFixture();
    const report = await runTaxonomyMigrate({ dbPath, backupDbPath: backupPath, apply: false, restoreMatched: true });

    expect(report.trashed.total).toBe(MATCHED + 1);
    expect(report.trashed.matched).toBe(MATCHED);
    expect(report.trashed.gap).toBe(1);
    expect(report.trashed.restoreCandidates).toBe(MATCHED);
    expect(report.active.movable).toBe(1);
    expect(report.duplicates).toHaveLength(0);

    const db = readonly(dbPath);
    try {
      expect(Number(db.prepare("SELECT COUNT(*) AS n FROM categories").get().n)).toBe(2);
      expect(Number(db.prepare("SELECT COUNT(*) AS n FROM sites WHERE deleted_at IS NOT NULL").get().n)).toBe(MATCHED + 1);
      expect(db.prepare("SELECT category_id FROM sites WHERE id = 'trash-1'").get().category_id).toBe("cat-old-containers");
      expect(Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='category_remaps'").get().n)).toBe(0);
      expect(Number(db.prepare("SELECT COUNT(*) AS n FROM taxonomy_proposals").get().n)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("apply 完成投影、恢复、下移、旧根删除、索引与提案", async () => {
    const { dbPath, backupPath } = await buildFixture();
    const report = await runTaxonomyMigrate({
      dbPath,
      backupDbPath: backupPath,
      apply: true,
      restoreMatched: true,
      batchId: "test-batch",
    });

    expect(report.indexCreated).toBe(true);
    expect(report.postDuplicates).toHaveLength(0);
    expect(report.applied.restored).toBe(MATCHED);
    expect(report.applied.movedActive).toBe(1);
    expect(report.applied.legacyRootsDeleted?.sort()).toEqual(["cat-ai", "cat-dev"]);
    expect(report.reindex?.reused).toBe(false);

    const db = readonly(dbPath);
    try {
      const q = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args);
      const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args);

      // 投影：233 条 registry + 未分类；旧种子根已删除；旧根与 registry 根不再同名并存
      expect(Number(q("SELECT COUNT(*) AS n FROM categories").n)).toBe(234);
      expect(all("SELECT id FROM categories WHERE title = 'AI 工具' AND parent_id IS NULL").map((r: any) => r.id)).toEqual([
        "reg-ai-tools",
      ]);
      expect(q("SELECT id FROM categories WHERE id = 'cat-uncategorized'").id).toBe("cat-uncategorized");

      // 恢复与下移
      const t1 = q("SELECT category_id, sub_category_id, deleted_at FROM sites WHERE id = 'trash-1'");
      expect(t1).toEqual({ category_id: "reg-containers-and-orchestration", sub_category_id: null, deleted_at: null });
      const t2 = q("SELECT category_id, sub_category_id, deleted_at FROM sites WHERE id = 'trash-2'");
      expect(t2).toEqual({ category_id: "reg-build-and-tooling", sub_category_id: "reg-core-frameworks", deleted_at: null });
      const gap = q("SELECT category_id, deleted_at FROM sites WHERE id = 'trash-gap'");
      expect(gap.category_id).toBe("cat-uncategorized");
      expect(gap.deleted_at).not.toBeNull();
      const live = q("SELECT category_id, deleted_at FROM sites WHERE id = 'live-1'");
      expect(live).toEqual({ category_id: "reg-containers-and-orchestration", deleted_at: null });

      // remap 日志：旧标题与旧父标题都要留下来（回滚/审计靠它）
      const remaps = all("SELECT site_id, field, old_title, old_parent_title, new_leaf_id FROM category_remaps WHERE batch_id = 'test-batch' ORDER BY site_id, field");
      const t2Rows = remaps.filter((r: any) => r.site_id === "trash-2");
      expect(t2Rows).toEqual([
        { site_id: "trash-2", field: "category", old_title: "构建与工程化", old_parent_title: "前端开发", new_leaf_id: "reg-build-and-tooling" },
        { site_id: "trash-2", field: "sub_category", old_title: "核心框架", old_parent_title: "前端开发", new_leaf_id: "reg-core-frameworks" },
      ]);
      const t1Rows = remaps.filter((r: any) => r.site_id === "trash-1");
      expect(t1Rows).toHaveLength(1);
      expect(t1Rows[0].old_parent_title).toBe("开发工具");

      // 「每父标题唯一」两条部分索引
      const indexNames = all("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'categories_%title_uniq'")
        .map((r: any) => r.name)
        .sort();
      expect(indexNames).toEqual(["categories_child_title_uniq", "categories_root_title_uniq"]);

      // 标签：脚本不删 tags 行；未恢复站点的关联被清掉；零引用标签只出提案
      expect(q("SELECT id FROM tags WHERE id = 'tag-dead'").id).toBe("tag-dead");
      expect(Number(q("SELECT COUNT(*) AS n FROM site_tags WHERE site_id = 'trash-gap'").n)).toBe(0);
      expect(Number(q("SELECT COUNT(*) AS n FROM site_tags WHERE site_id = 'live-1'").n)).toBe(1);
      const tagProposals = all("SELECT id, meta FROM taxonomy_proposals WHERE kind = 'tag_consolidation' ORDER BY id");
      expect(tagProposals.map((r: any) => r.id)).toEqual(["tag_zero_ref_DeadTag", "tag_zero_ref_ZeroTag"]);
      for (const p of tagProposals) expect(JSON.parse(p.meta).action).toBe("delete");
      const gapProposals = all("SELECT target_title FROM taxonomy_proposals WHERE kind = 'category_gap'");
      expect(gapProposals).toEqual([{ target_title: "区块浏览器" }]);

      // reindex 作业
      expect(q("SELECT status FROM jobs WHERE kind = 'reindex'").status).toBe("pending");
    } finally {
      db.close();
    }
  });

  it("缺口占比达到 5% 时在写入前拒绝 apply", async () => {
    const { dbPath, backupPath } = await buildFixture({ gapOnly: true });

    await expect(
      runTaxonomyMigrate({ dbPath, backupDbPath: backupPath, apply: true, restoreMatched: true }),
    ).rejects.toMatchObject({ code: "TAXONOMY_GAP_TOO_HIGH" });

    const db = readonly(dbPath);
    try {
      expect(Number(db.prepare("SELECT COUNT(*) AS n FROM categories").get().n)).toBe(2);
      expect(Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='category_remaps'").get().n)).toBe(0);
      expect(Number(db.prepare("SELECT COUNT(*) AS n FROM categories WHERE id LIKE 'reg-%'").get().n)).toBe(0);
    } finally {
      db.close();
    }
  });
});
