import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { cleanTaxonomyAndDuplicates, taxonomyCanonicalUrlKey } from "../src/migrate.ts";
import { Repository } from "../src/repository.ts";

/**
 * taxonomy 清洗是破坏性迁移：URL 键必须保守，整批合并/删除必须原子。
 * 这里同时钉住 SQLite 回滚、重试成功，以及 PostgreSQL 独占连接事务。
 */
describe("taxonomy 迁移数据安全", () => {
  let db: Db;
  let repo: Repository;
  let categoryId: string;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    categoryId = (await repo.createCategory({ title: "迁移安全测试类目" })).id;
  });

  afterAll(async () => {
    await db.close();
  });

  it("canonical key 保留 www/scheme/query/端口；默认 dry-run，显式合并后才写完整 alias", async () => {
    expect(taxonomyCanonicalUrlKey("https://www.Example.com/path/?utm_source=x#frag")).toBe("https://www.example.com/path");
    expect(taxonomyCanonicalUrlKey("https://example.com/path")).not.toBe(taxonomyCanonicalUrlKey("https://www.example.com/path"));
    expect(taxonomyCanonicalUrlKey("http://example.com/path")).not.toBe(taxonomyCanonicalUrlKey("https://example.com/path"));
    expect(taxonomyCanonicalUrlKey("https://example.com/path?a=1")).not.toBe(taxonomyCanonicalUrlKey("https://example.com/path?a=2"));
    expect(taxonomyCanonicalUrlKey("https://example.com:8443/path")).not.toBe(taxonomyCanonicalUrlKey("https://example.com/path"));
    const rows = [
      { id: "canon-base", url: "https://canonical-migration.example/path", title: "基准", createdAt: 10 },
      { id: "canon-default-port", url: "https://canonical-migration.example:443/path", title: "基准", createdAt: 11 },
      { id: "canon-http", url: "http://canonical-migration.example/path", title: "基准", createdAt: 12 },
      { id: "canon-query-a", url: "https://canonical-migration.example/path?mode=a", title: "基准", createdAt: 13 },
      { id: "canon-query-b", url: "https://canonical-migration.example/path?mode=b", title: "基准", createdAt: 14 },
      { id: "canon-port", url: "https://canonical-migration.example:8443/path", title: "基准", createdAt: 15 },
      { id: "canon-www-keep", url: "https://www.canonical-migration.example/other/?utm_source=x", title: "www 主站", createdAt: 20 },
      { id: "canon-www-dup", url: "https://canonical-migration.example/other", title: "www 主站", createdAt: 21 },
    ];
    await repo.insertSitesBulk(rows.map((row) => ({ ...row, categoryId })), { hydrate: false });
    await repo.run("INSERT INTO events (kind, site_id, created_at) VALUES (?,?,?)", ["click", "canon-default-port", 100]);

    const preview = await cleanTaxonomyAndDuplicates(db);
    expect(preview).toMatchObject({ dryRun: true, sitesDeduplicated: 0, mergeCandidates: 1 });
    expect(await repo.raw("SELECT id FROM sites WHERE id = 'canon-default-port'")).toHaveLength(1);
    expect(await repo.raw("SELECT * FROM site_id_aliases WHERE old_site_id = 'canon-default-port'")).toHaveLength(0);

    expect((await cleanTaxonomyAndDuplicates(db, { dryRun: false })).sitesDeduplicated).toBe(1);
    const remaining = await repo.raw("SELECT id FROM sites WHERE url LIKE '%canonical-migration.example%' ORDER BY created_at");
    expect(remaining.map((row) => row.id)).toEqual([
      "canon-base", "canon-http", "canon-query-a", "canon-query-b", "canon-port", "canon-www-keep", "canon-www-dup",
    ]);
    expect((await repo.raw("SELECT site_id FROM events WHERE site_id = 'canon-base'"))[0]?.site_id).toBe("canon-base");
    const alias = (await repo.raw("SELECT * FROM site_id_aliases WHERE old_site_id = ?", ["canon-default-port"]))[0];
    expect(alias).toMatchObject({ canonical_site_id: "canon-base", old_title: "基准", old_url: "https://canonical-migration.example:443/path" });
    expect(String(alias.reason)).toContain("canonical URL");
    expect(await cleanTaxonomyAndDuplicates(db, { dryRun: false })).toMatchObject({ sitesDeduplicated: 0, conflicts: [] });
  });

  it("中途失败整批回滚且不吞错，修复后重跑可完成", async () => {
    await repo.insertSitesBulk(
      [
        { id: "rollback-keep", url: "https://rollback-migration.example/path", title: "回滚主站", categoryId, createdAt: 100 },
        { id: "rollback-dup", url: "https://rollback-migration.example:443/path/?utm_source=x#frag", title: "  回滚主站  ", categoryId, createdAt: 101 },
      ],
      { hydrate: false },
    );
    await repo.run(
      "INSERT INTO favorites (id, user_id, site_id, note, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      ["rollback-fav", "github:rollback", "rollback-dup", "必须保留", 100, 100],
    );
    await repo.run("INSERT INTO events (kind, site_id, created_at) VALUES (?,?,?)", [
      "click",
      "rollback-dup",
      100,
    ]);

    const real = db.sqlite!;
    let injected = false;
    const sqlite = new Proxy(real, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            const statement = target.prepare(sql);
            if (!injected && /^DELETE FROM sites\b/i.test(sql)) {
              return new Proxy(statement, {
                get(stmt, key) {
                  if (key === "run") {
                    return () => {
                      injected = true;
                      throw new Error("injected duplicate delete failure");
                    };
                  }
                  const value = Reflect.get(stmt, key, stmt);
                  return typeof value === "function" ? value.bind(stmt) : value;
                },
              });
            }
            return statement;
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      cleanTaxonomyAndDuplicates({ dialect: "sqlite", sqlite } as never, { dryRun: false }),
    ).rejects.toThrow("injected duplicate delete failure");
    expect(injected).toBe(true);

    const sites = await repo.raw("SELECT id, category_id FROM sites WHERE id IN (?,?)", [
      "rollback-keep",
      "rollback-dup",
    ]);
    expect(sites).toHaveLength(2);
    expect(sites.find((row) => row.id === "rollback-dup")?.category_id).toBe(categoryId);
    const favorites = await repo.raw("SELECT site_id FROM favorites WHERE id = ?", ["rollback-fav"]);
    const events = await repo.raw("SELECT site_id FROM events WHERE site_id = ?", ["rollback-dup"]);
    expect(favorites[0]?.site_id).toBe("rollback-dup");
    expect(events[0]?.site_id).toBe("rollback-dup");
    const failures = await repo.raw(
      "SELECT step FROM migration_failures WHERE step = ?",
      ["clean_taxonomy_and_duplicates_v3"],
    );
    expect(failures).toHaveLength(1);

    const retried = await cleanTaxonomyAndDuplicates(db, { dryRun: false });
    expect(retried.sitesDeduplicated).toBe(1);
    expect(await repo.raw("SELECT id FROM sites WHERE id = ?", ["rollback-dup"])).toHaveLength(0);
    expect((await repo.raw("SELECT site_id FROM favorites WHERE id = ?", ["rollback-fav"]))[0]?.site_id).toBe("rollback-keep");
    expect((await repo.raw("SELECT site_id FROM events WHERE site_id IN (?,?)", ["rollback-keep", "rollback-dup"]))[0]?.site_id).toBe("rollback-keep");
  });

  it("URL/标题或收藏文件夹无法证明无损时整组保留并记录冲突，旧 UUID 白名单不再绕过", async () => {
    await repo.insertSitesBulk(
      [
        { id: "title-keep", url: "https://title-proof.example/path", title: "相同 URL", categoryId, createdAt: 200 },
        { id: "title-dup", url: "https://title-proof.example:443/path", title: "不同站点", categoryId, createdAt: 201 },
        { id: "385c18b1-aa13-4a5c-a18c-be3fb3f9b51d", url: "https://cursor-old.example/", title: "Cursor", categoryId, createdAt: 202 },
        { id: "ef75c24d-dcf0-45b9-9068-c15ef9d2ab29", url: "https://cursor-other.example/", title: "Cursor", categoryId, createdAt: 203 },
        { id: "fav-keep", url: "https://favorite-proof.example/path", title: "收藏冲突", categoryId, createdAt: 204 },
        { id: "fav-dup", url: "https://favorite-proof.example:443/path/?utm_source=test", title: "收藏冲突", categoryId, createdAt: 205 },
      ],
      { hydrate: false },
    );
    await repo.run(
      "INSERT INTO favorites (id, user_id, site_id, folder_id, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      ["fav-conflict-keep", "github:conflict", "fav-keep", "folder-a", "保留 A", 1, 1],
    );
    await repo.run(
      "INSERT INTO favorites (id, user_id, site_id, folder_id, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      ["fav-conflict-dup", "github:conflict", "fav-dup", "folder-b", "保留 B", 1, 1],
    );

    const preview = await cleanTaxonomyAndDuplicates(db);
    expect(preview).toMatchObject({ dryRun: true, sitesDeduplicated: 0, mergeCandidates: 0 });
    expect(preview.conflicts.map((conflict) => conflict.reason)).toEqual(
      expect.arrayContaining(["title_mismatch", "attachment_conflict"]),
    );
    expect(preview.conflicts.find((conflict) => conflict.reason === "attachment_conflict")?.detail).toContain("文件夹");

    const applied = await cleanTaxonomyAndDuplicates(db, { dryRun: false });
    expect(applied.sitesDeduplicated).toBe(0);
    expect(await repo.raw("SELECT id FROM sites WHERE id IN (?,?,?,?,?,?) ORDER BY id", [
      "title-keep", "title-dup", "385c18b1-aa13-4a5c-a18c-be3fb3f9b51d",
      "ef75c24d-dcf0-45b9-9068-c15ef9d2ab29", "fav-keep", "fav-dup",
    ])).toHaveLength(6);
    expect(await repo.raw("SELECT id FROM favorites WHERE user_id = ? ORDER BY id", ["github:conflict"])).toHaveLength(2);
    expect(await repo.raw("SELECT * FROM site_id_aliases WHERE old_site_id IN (?,?)", ["title-dup", "fav-dup"])).toHaveLength(0);
    const failures = await repo.raw("SELECT error FROM migration_failures WHERE step = ?", ["taxonomy_dedup_v3_conflicts"]);
    expect(String(failures[0]?.error)).toContain("title_mismatch");
    expect(String(failures[0]?.error)).toContain("attachment_conflict");
  });

  it("显式合并且无损保留附属数据、完整旧行快照与 alias 链，重跑幂等", async () => {
    await repo.insertSitesBulk(
      [
        {
          id: "attach-keep", url: "https://attachment-proof.example/path", title: "附属数据", categoryId,
          description: "", metadata: { keep: true }, createdAt: 300,
        },
        {
          id: "attach-dup", url: "https://attachment-proof.example:443/path/?utm_source=test", title: " 附属数据 ",
          categoryId, description: "旧行说明必须归档",
          metadata: { archived: true }, createdAt: 301,
        },
      ],
      { hydrate: false },
    );
    await repo.run("UPDATE sites SET description_en = ?, visit_count = ?, last_visited_at = ? WHERE id = ?", [
      "old english", 2, 100, "attach-keep",
    ]);
    await repo.run("UPDATE sites SET description_en = ?, visit_count = ?, last_visited_at = ? WHERE id = ?", [
      "old english", 3, 200, "attach-dup",
    ]);
    await repo.run("INSERT INTO tags (id, name, slug, created_at) VALUES (?,?,?,?)", ["tag-common", "common", "common", 1]);
    await repo.run("INSERT INTO tags (id, name, slug, created_at) VALUES (?,?,?,?)", ["tag-keep", "keep", "keep", 1]);
    await repo.run("INSERT INTO tags (id, name, slug, created_at) VALUES (?,?,?,?)", ["tag-dup", "dup", "dup", 1]);
    await repo.run("INSERT INTO site_tags (site_id, tag_id) VALUES (?,?), (?,?), (?,?)", [
      "attach-keep", "tag-common", "attach-keep", "tag-keep", "attach-dup", "tag-dup",
    ]);
    await repo.run("INSERT INTO site_facets (site_id, facet_key, facet_value) VALUES (?,?,?), (?,?,?), (?,?,?)", [
      "attach-keep", "color", "red", "attach-dup", "color", "red", "attach-dup", "size", "large",
    ]);
    await repo.run(
      "INSERT INTO site_relations (id, source_site_id, target_site_id, target_title, target_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      ["rel-out", "attach-dup", "external-target", "外部", "https://external.example/", 1, 1],
    );
    await repo.run(
      "INSERT INTO site_relations (id, source_site_id, target_site_id, target_title, target_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      ["rel-in", "external-source", "attach-dup", "附属数据", "https://attachment-proof.example/path", 1, 1],
    );
    await repo.run(
      "INSERT INTO favorites (id, user_id, site_id, note, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      ["attach-fav-keep", "github:attach", "attach-keep", "keep note", JSON.stringify(["common", "keep"]), 10, 20],
    );
    await repo.run(
      "INSERT INTO favorites (id, user_id, site_id, note, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      ["attach-fav-dup", "github:attach", "attach-dup", "dup note", JSON.stringify(["common", "dup"]), 5, 30],
    );
    await repo.run(
      "INSERT INTO favorites (id, user_id, site_id, note, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      ["attach-fav-other", "github:other", "attach-dup", "other note", null, 1, 1],
    );
    await repo.run(
      "INSERT INTO collections (id, slug, title, created_at, updated_at) VALUES (?,?,?,?,?)",
      ["attach-collection", "attach-collection", "附属集合", 1, 1],
    );
    await repo.run("INSERT INTO collection_items (collection_id, site_id, sort, note) VALUES (?,?,?,?), (?,?,?,?)", [
      "attach-collection", "attach-keep", 10, "keep collection note",
      "attach-collection", "attach-dup", 3, "dup collection note",
    ]);
    await repo.run("INSERT INTO events (kind, site_id, created_at) VALUES (?,?,?), (?,?,?)", [
      "click", "attach-keep", 1, "click", "attach-dup", 2,
    ]);
    await repo.run("INSERT INTO health_checks (site_id, checked_at, ok) VALUES (?,?,?)", ["attach-dup", 3, 1]);
    await repo.run(
      "INSERT INTO site_archives (id, site_id, title, url, html_content, captured_at, created_at) VALUES (?,?,?,?,?,?,?)",
      ["attach-archive", "attach-dup", "附属数据", "https://attachment-proof.example/path", "<p>archive</p>", 4, 4],
    );
    await repo.run(
      "INSERT INTO site_reports (id, site_id, kinds, detail, source, created_at) VALUES (?,?,?,?,?,?)",
      ["attach-report", "attach-dup", JSON.stringify(["wrong-url"]), "report detail", "test", 5],
    );
    await repo.run(
      "INSERT INTO site_discovery_candidates (id, url, canonical_url, source, site_id, discovered_at, last_seen_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
      ["attach-candidate", "https://attachment-proof.example/path", "https://attachment-proof.example/path", "test", "attach-dup", 6, 6, 6],
    );
    await repo.run(
      "INSERT INTO wanted_searches (id, identity, query, notified_site_id, created_at) VALUES (?,?,?,?,?)",
      ["attach-wanted", "github:attach", "query", "attach-dup", 7],
    );
    await repo.run(
      "INSERT INTO watch_entries (id, user_id, drama_key, title, platform_site_id, platform_title, play_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      ["attach-watch", "github:attach", "drama", "Drama", "attach-dup", "附属数据", "https://video.example/", 8, 8],
    );
    await repo.run(
      "INSERT INTO user_profiles (user_id, visited_site_ids, favorite_site_ids, updated_at) VALUES (?,?,?,?)",
      ["github:attach", JSON.stringify(["attach-dup", "attach-keep"]), JSON.stringify(["attach-dup"]), 9],
    );
    await repo.run(
      "INSERT INTO taxonomy_proposals (id, kind, target_id, suggested_value, reason, meta, created_at) VALUES (?,?,?,?,?,?,?)",
      ["attach-proposal", "category_change", "attach-dup", "reg-other", "test", JSON.stringify({ siteIds: ["attach-dup", "attach-keep"] }), 10],
    );
    await repo.run("INSERT INTO embeddings (site_id, model, dim, vector, updated_at) VALUES (?,?,?,?,?), (?,?,?,?,?)", [
      "attach-keep", "model", 2, null, 11, "attach-dup", "model", 2, null, 11,
    ]);
    await repo.run("INSERT INTO site_radar (site_id, payload, model, updated_at) VALUES (?,?,?,?), (?,?,?,?)", [
      "attach-keep", JSON.stringify({ score: 1 }), "model", 12, "attach-dup", JSON.stringify({ score: 1 }), "model", 12,
    ]);
    await repo.run(
      "INSERT INTO site_prices (id, owner_identity, site_id, amount_minor, currency, period, source_type, verified_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?,?,?)",
      ["attach-price-keep", "github:attach", "attach-keep", 100, "CNY", "month", "user", 13, 13, 13,
        "attach-price-dup", "github:attach", "attach-dup", 100, "CNY", "month", "user", 13, 13, 13],
    );
    await repo.run(
      "INSERT INTO submission_reviews (site_id, review_status, reviewed_at, created_at) VALUES (?,?,?,?), (?,?,?,?)",
      ["attach-keep", "approved", 14, 14, "attach-dup", "approved", 14, 14],
    );
    await repo.run("INSERT INTO submission_owners (site_id, identity, created_at) VALUES (?,?,?), (?,?,?)", [
      "attach-keep", "github:attach", 15, "attach-dup", "github:attach", 15,
    ]);
    await repo.run(
      "INSERT INTO site_id_aliases (old_site_id, canonical_site_id, old_title, old_url, reason, merged_at) VALUES (?,?,?,?,?,?), (?,?,?,?,?,?)",
      ["attach-older", "attach-dup", "更早副本", "https://old.example/", "old", 1,
        "attach-dup", "attach-keep", "待更新标题", "https://old-url.example/", "old", 1],
    );

    const applied = await cleanTaxonomyAndDuplicates(db, { dryRun: false });
    expect(applied).toMatchObject({ sitesDeduplicated: 1, mergeCandidates: 1 });
    expect(applied.conflicts.some((conflict) => conflict.keepSiteId === "attach-keep")).toBe(false);
    expect(await repo.raw("SELECT id FROM sites WHERE id = ?", ["attach-dup"])).toHaveLength(0);
    expect((await repo.raw("SELECT tag_id FROM site_tags WHERE site_id = ? ORDER BY tag_id", ["attach-keep"])).map((r) => r.tag_id))
      .toEqual(["tag-common", "tag-dup", "tag-keep"]);
    expect(await repo.raw("SELECT * FROM site_facets WHERE site_id = ? ORDER BY facet_key", ["attach-keep"])).toHaveLength(2);
    expect((await repo.raw("SELECT source_site_id, target_site_id FROM site_relations ORDER BY id")).map((r) => [r.source_site_id, r.target_site_id]))
      .toEqual([["external-source", "attach-keep"], ["attach-keep", "external-target"]]);
    const favorite = (await repo.raw("SELECT * FROM favorites WHERE user_id = ?", ["github:attach"]))[0];
    expect(favorite.note).toContain("keep note");
    expect(favorite.note).toContain("dup note");
    expect(JSON.parse(String(favorite.tags))).toEqual(["common", "keep", "dup"]);
    expect(favorite.created_at).toBe(5);
    expect(favorite.updated_at).toBe(30);
    expect((await repo.raw("SELECT site_id FROM favorites WHERE id = ?", ["attach-fav-other"]))[0]?.site_id).toBe("attach-keep");
    const collection = (await repo.raw("SELECT * FROM collection_items WHERE collection_id = ?", ["attach-collection"]))[0];
    expect(collection.sort).toBe(3);
    expect(collection.note).toContain("keep collection note");
    expect(collection.note).toContain("dup collection note");
    for (const [table, column] of [
      ["events", "site_id"], ["health_checks", "site_id"], ["site_archives", "site_id"],
      ["site_reports", "site_id"], ["site_discovery_candidates", "site_id"],
    ] as const) {
      expect(await repo.raw(`SELECT ${column} FROM ${table} WHERE ${column} = ?`, ["attach-keep"])).toHaveLength(table === "events" ? 2 : 1);
      expect(await repo.raw(`SELECT ${column} FROM ${table} WHERE ${column} = ?`, ["attach-dup"])).toHaveLength(0);
    }
    expect((await repo.raw("SELECT notified_site_id FROM wanted_searches WHERE id = ?", ["attach-wanted"]))[0]?.notified_site_id).toBe("attach-keep");
    expect((await repo.raw("SELECT platform_site_id FROM watch_entries WHERE id = ?", ["attach-watch"]))[0]?.platform_site_id).toBe("attach-keep");
    const profile = (await repo.raw("SELECT * FROM user_profiles WHERE user_id = ?", ["github:attach"]))[0];
    expect(JSON.parse(String(profile.visited_site_ids))).toEqual(["attach-keep"]);
    expect(JSON.parse(String(profile.favorite_site_ids))).toEqual(["attach-keep"]);
    const proposal = (await repo.raw("SELECT * FROM taxonomy_proposals WHERE id = ?", ["attach-proposal"]))[0];
    expect(proposal.target_id).toBe("attach-keep");
    expect(JSON.parse(String(proposal.meta)).siteIds).toEqual(["attach-keep"]);
    for (const table of ["embeddings", "site_radar", "site_prices", "submission_reviews", "submission_owners"]) {
      expect(await repo.raw(`SELECT * FROM ${table} WHERE site_id = ?`, ["attach-keep"])).toHaveLength(1);
    }
    const aliases = await repo.raw("SELECT * FROM site_id_aliases WHERE old_site_id IN (?,?) ORDER BY old_site_id", ["attach-dup", "attach-older"]);
    expect(aliases).toHaveLength(2);
    expect(aliases.every((row) => row.canonical_site_id === "attach-keep")).toBe(true);
    expect(aliases.find((row) => row.old_site_id === "attach-dup")).toMatchObject({
      canonical_site_id: "attach-keep", old_title: " 附属数据 ", old_url: "https://attachment-proof.example:443/path/?utm_source=test",
    });
    expect(String(aliases.find((row) => row.old_site_id === "attach-dup")?.reason)).toContain("canonical URL");
    const keep = (await repo.raw("SELECT * FROM sites WHERE id = ?", ["attach-keep"]))[0];
    expect(keep.description).toBe("旧行说明必须归档");
    expect(keep.visit_count).toBe(5);
    expect(keep.last_visited_at).toBe(200);
    const metadata = JSON.parse(String(keep.metadata));
    expect(metadata.keep).toBe(true);
    expect(metadata._navhubMigration.mergedSites["attach-dup"].site).toMatchObject({
      id: "attach-dup", description_en: "old english", metadata: JSON.stringify({ archived: true }),
    });
    expect(metadata._navhubMigration.mergedSites["attach-dup"].collectionItems).toHaveLength(1);
    const rerun = await cleanTaxonomyAndDuplicates(db, { dryRun: false });
    expect(rerun.sitesDeduplicated).toBe(0);
    expect(rerun.conflicts.some((conflict) => conflict.keepSiteId === "attach-keep")).toBe(false);
  });

  it("PostgreSQL 在独占连接上 advisory lock/BEGIN/COMMIT/unlock，不把事务语句发给 pool", async () => {
    const calls: string[] = [];
    let released = 0;
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        return { rows: [], rowCount: 0 };
      },
      release: () => {
        released++;
      },
    };
    const pg = {
      query: async () => {
        throw new Error("migration must not use pool.query");
      },
      connect: async () => client,
    };

    const result = await cleanTaxonomyAndDuplicates({ dialect: "pg", pg }, { dryRun: false });
    expect(result).toMatchObject({ dryRun: false, categoriesCreated: 3, sitesDeduplicated: 0, conflicts: [] });
    expect(calls[0]).toContain("pg_advisory_lock(hashtext(current_database()::text), hashtext($1))");
    expect(calls[1]).toBe("BEGIN");
    expect(calls.at(-2)).toBe("COMMIT");
    expect(calls.at(-1)).toContain("pg_advisory_unlock(hashtext(current_database()::text), hashtext($1))");
    expect(calls.some((sql) => sql.includes("INSERT INTO categories") && sql.includes("$1"))).toBe(true);
    expect(released).toBe(1);
  });

  it("PostgreSQL 中途失败时回滚、显式解锁并释放独占连接", async () => {
    const calls: string[] = [];
    let released = 0;
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes("INSERT INTO categories")) throw new Error("injected pg category failure");
        return { rows: [], rowCount: 0 };
      },
      release: () => {
        released++;
      },
    };
    const pg = {
      query: async () => {
        throw new Error("migration must not use pool.query");
      },
      connect: async () => client,
    };

    await expect(cleanTaxonomyAndDuplicates({ dialect: "pg", pg }, { dryRun: false })).rejects.toThrow("injected pg category failure");
    expect(calls[0]).toContain("pg_advisory_lock(hashtext(current_database()::text), hashtext($1))");
    expect(calls[1]).toBe("BEGIN");
    expect(calls.at(-2)).toBe("ROLLBACK");
    expect(calls.at(-1)).toContain("pg_advisory_unlock(hashtext(current_database()::text), hashtext($1))");
    expect(calls).not.toContain("COMMIT");
    expect(released).toBe(1);
  });
});
