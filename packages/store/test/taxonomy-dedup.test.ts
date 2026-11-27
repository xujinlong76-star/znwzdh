import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { cleanTaxonomyAndDuplicates } from "../src/migrate.ts";
import { Repository } from "../src/repository.ts";

/**
 * 类目重构与重复站点去重（20261107 版本的写路径）。
 *
 * 背景：a0b00ba2 把 cleanTaxonomyAndDuplicates 的默认改成 dry-run 后，
 * 20261107 版本首次执行也空跑，重复站点合并的写路径在 CI 全量覆盖里从未执行
 * （migrate.ts 的去重段在全量覆盖里只剩读路径）。
 * 本文件用真实重复站点覆盖它：canonical URL 相同 + 归一标题相同 → 合并；
 * 标题不同 → 冲突保留；附属收藏冲突 → 冲突保留。
 * 两个重复站用“尾斜杠有无”区分原始 URL：canonical key 相同（可合并），
 * 但原始字符串不同，不会撞 sites_url 唯一索引。
 */
describe("重复站点去重", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  const insertSite = (id: string, url: string, title: string, createdAt: number) => {
    db.sqlite!.prepare(
      "INSERT INTO sites (id, url, title, category_id, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    ).run(id, url, title, "reg-ai-tools", createdAt, createdAt);
  };

  const siteRow = async (id: string) =>
    (await repo.raw("SELECT id, url, title, metadata FROM sites WHERE id = ?", [id]))[0];

  it("canonical URL 与归一标题都相同：合并重复站，保留站记 mergedSites 并建 alias", async () => {
    insertSite("dedup-keep-1", "https://dup.example.com/widget", "Widget", 1000);
    insertSite("dedup-dup-1", "https://dup.example.com/widget/", "Widget", 2000);

    const result = await cleanTaxonomyAndDuplicates(db, { dryRun: false });

    expect(result.sitesDeduplicated).toBe(1);
    expect(result.mergeCandidates).toBe(1);
    expect(result.conflicts).toHaveLength(0);

    expect(await siteRow("dedup-dup-1")).toBeUndefined();
    const keep = await siteRow("dedup-keep-1");
    expect(keep).toBeDefined();
    const meta = JSON.parse(String(keep!.metadata));
    expect(meta._navhubMigration.mergedSites["dedup-dup-1"].reason).toBe(
      "canonical_url_and_normalized_title_equal",
    );
    const alias = await repo.raw(
      "SELECT old_site_id, canonical_site_id FROM site_id_aliases WHERE old_site_id = ?",
      ["dedup-dup-1"],
    );
    expect(alias).toHaveLength(1);
    expect(alias[0]!.canonical_site_id).toBe("dedup-keep-1");
  });

  it("标题不同：整组冲突保留，不合并、不删站", async () => {
    insertSite("dedup-keep-2", "https://mismatch.example.com/a", "Alpha", 1000);
    insertSite("dedup-dup-2", "https://mismatch.example.com/a/", "Beta", 2000);

    const result = await cleanTaxonomyAndDuplicates(db, { dryRun: false });

    expect(result.sitesDeduplicated).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.reason).toBe("title_mismatch");
    expect(await siteRow("dedup-keep-2")).toBeDefined();
    expect(await siteRow("dedup-dup-2")).toBeDefined();
  });

  it("附属收藏冲突：同一用户在两站的文件夹不同，冲突保留", async () => {    insertSite("dedup-keep-3", "https://fav.example.com/tool", "Tool", 1000);
    insertSite("dedup-dup-3", "https://fav.example.com/tool/", "Tool", 2000);
    await repo.run(
      "INSERT INTO favorites (id, user_id, site_id, folder_id, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      ["fav-keep-3", "u1", "dedup-keep-3", "folder-a", 1000, 1000],
    );
    await repo.run(
      "INSERT INTO favorites (id, user_id, site_id, folder_id, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      ["fav-dup-3", "u1", "dedup-dup-3", "folder-b", 1000, 1000],
    );

    const result = await cleanTaxonomyAndDuplicates(db, { dryRun: false });

    expect(result.sitesDeduplicated).toBe(0);
    // 注意：上一个用例留下的 title_mismatch 组仍在库里，每次运行都会再次报冲突，
    // 所以这里只断言本次的 attachment_conflict 在场，不断言总数。
    const attachment = result.conflicts.find(
      (c) => c.keepSiteId === "dedup-keep-3",
    );
    expect(attachment).toBeDefined();
    expect(attachment!.reason).toBe("attachment_conflict");
    expect(await siteRow("dedup-keep-3")).toBeDefined();
    expect(await siteRow("dedup-dup-3")).toBeDefined();
  });

  it("合并带收藏：同一用户在两站同文件夹收藏，合并笔记与标签、删重复收藏", async () => {
    insertSite("dedup-keep-4", "https://move.example.com/tool", "Move", 1000);
    insertSite("dedup-dup-4", "https://move.example.com/tool/", "Move", 2000);
    await repo.run(
      "INSERT INTO favorites (id, user_id, site_id, folder_id, note, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      ["fav-keep-4", "u3", "dedup-keep-4", "folder-a", "keep note", '["a"]', 1000, 1000],
    );
    await repo.run(
      "INSERT INTO favorites (id, user_id, site_id, folder_id, note, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      ["fav-dup-4", "u3", "dedup-dup-4", "folder-a", "dup note", '["b"]', 2000, 2000],
    );

    const result = await cleanTaxonomyAndDuplicates(db, { dryRun: false });

    expect(result.sitesDeduplicated).toBe(1);
    expect(await siteRow("dedup-dup-4")).toBeUndefined();
    const favs = await repo.raw(
      "SELECT id, site_id, note, tags FROM favorites WHERE user_id = ? ORDER BY id",
      ["u3"],
    );
    expect(favs).toHaveLength(1);
    expect(favs[0]!.site_id).toBe("dedup-keep-4");
    expect(favs[0]!.note).toBe("keep note\ndup note");
    expect(JSON.parse(String(favs[0]!.tags)).sort()).toEqual(["a", "b"]);
  });
});
