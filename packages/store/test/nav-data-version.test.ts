/**
 * 导航快照版本号（P1-1）与站点聚合列批量补齐（P1-1）的仓储层回归。
 *
 * 两组断言各自锁一件事：
 *
 *   1. **版本号必须「变过就动」**。它的唯一用途是让快照缓存在下一次读立即失效；
 *      漏一次 bump 不是变慢，而是把旧快照继续喂给「读-改-写」的写侧 —— 快照里没有
 *      就等于用户删了。所以 bump 交给数据库触发器，而这里逐个来源表、逐个事件、
 *      并包含**绕过仓储的直写 SQL** 一起验，防止「只有走仓储才生效」。
 *
 *   2. **批量补齐必须与相关子查询逐字节一致**。列表路径改成了
 *      「1 条主查询 + 2 条 GROUP BY 聚合」，如果两条路径给出的标签/分面顺序或内容不同，
 *      同一个站点会在不同接口里表现不一致（快照与详情页对不上），而这种漂移
 *      在单一路径的测试里永远发现不了。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { NAV_VERSION_TRIGGER_EVENTS, NAV_VERSION_TRIGGER_TABLES, navVersionTriggerNames } from "../src/migrate.ts";
import { hydrateSites, selectSitesSql, SELECT_SITES_BASE_SQL } from "../src/repository/sites.ts";
import { rowToSite } from "../src/repository/dialect.ts";

let db: Db;
let repo: Repository;

beforeAll(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
});

afterAll(async () => {
  await db.close();
});

describe("data_version 单行表", () => {
  it("建表时就种下 id=1 的行（触发器只 UPDATE，行不在就静默失效）", async () => {
    const rows = await repo.raw("SELECT version FROM data_version WHERE id = 1");
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].version)).toBeGreaterThanOrEqual(0);
  });

  it("版本号读不到时返回 null，而不是抛错或返回 NaN", async () => {
    expect(await repo.readNavDataVersion()).toBeTypeOf("number");
    await repo.run("DELETE FROM data_version");
    try {
      expect(await repo.readNavDataVersion()).toBeNull();
    } finally {
      await repo.run("INSERT INTO data_version (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING");
    }
    // 表整个不存在时同样要降级（老库 / 迁移未跑完），不能把读接口带崩
    await repo.run("DROP TABLE data_version");
    try {
      expect(await repo.readNavDataVersion()).toBeNull();
      const probe = await repo.navVersionProbe();
      // 触发器挂在来源表上，删掉 data_version 不会带走它们：探针必须照实说「触发器都在」，
      // 靠 version:null 表达「读数没了」。把两者混为一谈会让 /api/health 报出错误的原因。
      expect(probe.version).toBeNull();
      expect(probe.missing).toEqual([]);
      expect(probe.present).toHaveLength(navVersionTriggerNames().length);
    } finally {
      await db.sqlite!.exec(
        "CREATE TABLE IF NOT EXISTS data_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0)",
      );
      await db.sqlite!.exec("INSERT INTO data_version (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING");
    }
    expect(await repo.readNavDataVersion()).toBeTypeOf("number");
  });
});

describe("版本号触发器", () => {
  it("每张来源表 × 每个事件都在（清单缺一即红）", async () => {
    const probe = await repo.navVersionProbe();
    expect(probe.missing, "缺少 bump 触发器：" + probe.missing.join(",")).toEqual([]);
    expect(probe.present).toHaveLength(NAV_VERSION_TRIGGER_TABLES.length * NAV_VERSION_TRIGGER_EVENTS.length);
  });

  it("任何一张来源表的写入都会让版本号变大", async () => {
    const before = await repo.readNavDataVersion();
    expect(before).toBeTypeOf("number");

    const cases: Array<{ label: string; sql: string; params?: unknown[] }> = [
      // 绕过仓储的直写 SQL：后台任务/运维脚本/测试就是这个形态
      { label: "sites insert", sql: "INSERT INTO sites (id, url, title, category_id, created_at, updated_at) VALUES ('v-s1', 'https://v1.example.com', '版本站点', 'v-c1', 1, 1)" },
      { label: "sites update", sql: "UPDATE sites SET title = '版本站点改名' WHERE id = 'v-s1'" },
      { label: "sites delete", sql: "DELETE FROM sites WHERE id = 'v-s1'" },
      { label: "categories insert", sql: "INSERT INTO categories (id, anchor, title, created_at, updated_at) VALUES ('v-c1', 'v-c1', '版本类目', 1, 1)" },
      { label: "categories update", sql: "UPDATE categories SET title = '版本类目改名' WHERE id = 'v-c1'" },
      { label: "categories delete", sql: "DELETE FROM categories WHERE id = 'v-c1'" },
      { label: "tags insert", sql: "INSERT INTO tags (id, name, slug, created_at) VALUES ('v-t1', '版本标签', 'version-tag', 1)" },
      { label: "tags update", sql: "UPDATE tags SET slug = 'version-tag-2' WHERE id = 'v-t1'" },
      { label: "tags delete", sql: "DELETE FROM tags WHERE id = 'v-t1'" },
      { label: "site_tags insert", sql: "INSERT INTO site_tags (site_id, tag_id) VALUES ('v-s2', 'v-t2')" },
      { label: "site_tags delete", sql: "DELETE FROM site_tags WHERE site_id = 'v-s2'" },
      { label: "site_facets insert", sql: "INSERT INTO site_facets (site_id, facet_key, facet_value) VALUES ('v-s2', 'price', 'free')" },
      { label: "site_facets delete", sql: "DELETE FROM site_facets WHERE site_id = 'v-s2'" },
    ];
    // 剩下的 delete 事件（site_tags/site_facets 的 update 等）由上一条语句覆盖不了，
    // 因此这里逐条比对「每条语句执行后版本号都必须比上一条更大」。
    let last = Number(before);
    for (const c of cases) {
      await repo.run(c.sql, c.params ?? []);
      const now = await repo.readNavDataVersion();
      expect(now, "写入未 bump 版本号：" + c.label).not.toBeNull();
      expect(now!, c.label + " 后版本号必须变大").toBeGreaterThan(last);
      last = now!;
    }
  });

  it("非来源表的写入不动版本号（版本号只代表导航数据）", async () => {
    const before = await repo.readNavDataVersion();
    await repo.run("INSERT INTO events (kind, site_id, created_at) VALUES ('click', 'v-nonav', 1)");
    expect(await repo.readNavDataVersion()).toBe(before);
    await repo.run("DELETE FROM events WHERE site_id = 'v-nonav'");
  });
});

describe("站点聚合列批量补齐（取代逐行相关子查询）", () => {
  const seed = async () => {
    await repo.createCategory({ id: "h-c1", title: "聚合类目", sort: 1, source: "api" } as never);
    await repo.createSiteWithId({ id: "h-s1", url: "https://h1.example.com", title: "聚合站点一", categoryId: "h-c1", source: "api" } as never);
    await repo.createSiteWithId({ id: "h-s2", url: "https://h2.example.com", title: "聚合站点二", categoryId: "h-c1", source: "api" } as never);
    await repo.createSiteWithId({ id: "h-s3", url: "https://h3.example.com", title: "无标签站点", categoryId: "h-c1", source: "api" } as never);
    // 故意按反字典序打标：批量路径与相关子查询都必须给出同一个（排序后的）顺序
    await repo.setSiteTags("h-s1", ["zeta", "alpha", "mid"]);
    await repo.setSiteTags("h-s2", ["beta"]);
    await repo.setSiteFacets("h-s1", { price: ["free", "open"], platform: ["web"] });
  };

  const cleanup = async () => {
    for (const id of ["h-s1", "h-s2", "h-s3"]) {
      await repo.run("DELETE FROM site_tags WHERE site_id = ?", [id]);
      await repo.run("DELETE FROM site_facets WHERE site_id = ?", [id]);
      await repo.run("DELETE FROM sites WHERE id = ?", [id]);
    }
    await repo.run("DELETE FROM tags WHERE slug IN ('zeta','alpha','mid','beta')");
    await repo.run("DELETE FROM categories WHERE id = 'h-c1'");
  };

  it("批量补齐与相关子查询路径逐字段一致（含标签顺序）", async () => {
    await seed();
    try {
      const ids = ["h-s1", "h-s2", "h-s3"];
      // 相关子查询路径（单行读用的那条）
      const placeholders = ids.map(() => "?").join(",");
      const correlatedRows = await repo.raw(
        selectSitesSql(repo) + " WHERE s.id IN (" + placeholders + ") GROUP BY s.id",
        ids,
      );
      const baseRows = await repo.raw(SELECT_SITES_BASE_SQL + " WHERE s.id IN (" + placeholders + ")", ids);
      const hydrated = await hydrateSites(repo, baseRows);

      // 两条路径都要经过 rowToSite：分面里有一部分是**内存启发式**（metadata / 按 URL 推断的
      // workspaces→scene），只在同一个转换下才可比。手工切字符串会把这部分漏掉，
      // 于是「批量路径多出了 scene」这种差异看起来像 bug，实际是断言写错了口径。
      const sortById = <T extends { id: string }>(list: T[]): T[] =>
        [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const correlated = sortById(correlatedRows.map((r) => rowToSite(r)));
      const merged = sortById(hydrated);

      expect(merged.map((s) => s.id)).toEqual(correlated.map((s) => s.id));
      for (let i = 0; i < correlated.length; i++) {
        expect(merged[i], "批量补齐与相关子查询结果不一致：" + correlated[i].id).toEqual(correlated[i]);
      }
      // 显式锁顺序与内容（上面整对象相等已经覆盖，这里给出可读的失败信息）
      expect(merged.find((s) => s.id === "h-s1")!.tags).toEqual(["alpha", "mid", "zeta"]);
      expect(merged.find((s) => s.id === "h-s1")!.facets).toMatchObject({ platform: ["web"], price: ["free", "open"] });
      expect(merged.find((s) => s.id === "h-s3")!.tags).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("facets:false 只省查询：标签照旧，表里的分面不再出现", async () => {
    await seed();
    try {
      const rows = await repo.raw(SELECT_SITES_BASE_SQL + " WHERE s.id IN ('h-s1','h-s3')");
      const full = await hydrateSites(repo, rows);
      const lean = await hydrateSites(repo, rows, { facets: false });
      const full1 = full.find((s) => s.id === "h-s1")!;
      const lean1 = lean.find((s) => s.id === "h-s1")!;
      // 先确认样例真的走通了（否则下面的「没有」是假的没有）
      expect(full1.facets.price).toEqual(["free", "open"]);
      expect(lean1.tags).toEqual(full1.tags);
      // site_facets 的键整个消失；剩下的只可能来自内存启发式（不花查询），
      // 两个模式必须给同一个值，否则快照会看到和详情页不同的分面。
      expect(lean1.facets.price).toBeUndefined();
      expect(lean1.facets.platform).toBeUndefined();
      expect(Object.keys(lean1.facets).sort()).toEqual(
        Object.keys(full1.facets).filter((k) => k !== "price" && k !== "platform").sort(),
      );
    } finally {
      await cleanup();
    }
  });

  it("列表路径不再带逐行相关子查询（回归到 SQL 文本上钉住）", async () => {
    // 列表的主查询就是这条常量；聚合改在 hydrateSites 里按站点数一批做完。
    // 「相关子查询回来了」的直接征兆就是这条投影里又出现 site_tags / site_facets。
    expect(SELECT_SITES_BASE_SQL).not.toContain("site_tags");
    expect(SELECT_SITES_BASE_SQL).not.toContain("site_facets");
    // listSites / listAllSites 都必须走批量补齐：结果里标签仍然在
    await seed();
    try {
      const listed = await repo.listSites({ categoryId: "h-c1", limit: 10 });
      expect(listed.find((s) => s.id === "h-s1")?.tags).toEqual(["alpha", "mid", "zeta"]);
      const all = await repo.listAllSites(100, { facets: false });
      expect(all.find((s) => s.id === "h-s1")?.tags).toEqual(["alpha", "mid", "zeta"]);
      // 快照投影不读分面：facets:false 时确实没去查 site_facets
      expect(all.find((s) => s.id === "h-s1")?.facets.price).toBeUndefined();
      expect(all.find((s) => s.id === "h-s1")?.facets.platform).toBeUndefined();
      // 默认模式（详情页/其它列表）照旧给全
      const withFacets = await repo.listAllSites(100);
      expect(withFacets.find((s) => s.id === "h-s1")?.facets.price).toEqual(["free", "open"]);
    } finally {
      await cleanup();
    }
  });
});
