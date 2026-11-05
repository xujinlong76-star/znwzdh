/**
 * 标签链路的三处一致性回归：
 *
 * 1. mergeTags 漏重算站点索引 → 合并后旧标签名仍能搜到那些站点（静默错结果）。
 *    deleteTag 一直有重算，mergeTags 没有 —— 两条改 site_tags 的写路径口径分叉。
 * 2. setSiteTags 逐条 INSERT 不去重 → 同请求传 "AI" 与 "ai"（解析到同一 tag_id）
 *    撞 site_tags_unique_idx(site_id, tag_id)，整个事务回滚，PATCH /api/sites 500。
 * 3. 标签匹配（search.ts 的 siteIdsWithTag / browse 下推、sites.ts 的分面计数）
 *    拿 trim 后的原值直接比 slug/name/alias，而库里 slug 是 slugify 的产物（小写、
 *    空格转连字符）→ tag=AI 匹配不到 slug 为 "ai" 的标签，过滤静默为空。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { buildIndexFields } from "../src/repository/dialect.ts";
import { SearchEngine } from "../src/search.ts";

describe("标签完整性：合并重算 / 去重写入 / 大小写不敏感匹配", () => {
  let db: Db;
  let repo: Repository;
  let search: SearchEngine;
  let categoryId: string;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    search = new SearchEngine({ db, fts: null, vectors: null, repo });
    categoryId = (await repo.createCategory({ title: "标签一致性回归" })).id;
  });

  afterAll(async () => {
    await db.close();
  });

  it("mergeTags 后重算站点索引：旧标签不再留在检索语料里", async () => {
    const site = await repo.createSite({
      url: "https://merge.example.com/legacy",
      title: "待合并站点",
      description: "回归用站点",
      categoryId,
      tags: ["遗留标签词"],
      status: "active",
    });
    const anchor = await repo.createSite({
      url: "https://merge.example.com/target",
      title: "锚点站点",
      description: "承载目标标签",
      categoryId,
      tags: ["目标标签"],
      status: "active",
    });
    await repo.setSiteTags(anchor.id, ["目标标签"]);

    const before = (await repo.raw(
      "SELECT title, description, url, fts_tokens, pinyin_full, pinyin_initials FROM sites WHERE id = ?",
      [site.id],
    ))[0]!;
    const idxBefore = buildIndexFields({
      title: String(before.title),
      description: before.description == null ? null : String(before.description),
      url: String(before.url),
      tags: ["遗留标签词"],
    });
    // 前提守卫：语料确实含有旧标签，否则「合并后不含」是空断言
    expect(String(before.pinyin_full)).toBe(idxBefore.pinyinFull);

    const tags = await repo.listTagsWithCounts();
    const source = tags.find((t) => t.name === "遗留标签词")!;
    const target = tags.find((t) => t.name === "目标标签")!;
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();

    const moved = await repo.mergeTags(source.id, target.id);
    expect(moved.moved).toBe(1);

    // 站点已改挂目标标签
    const siteTags = await repo.raw(
      "SELECT t.name FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = ?",
      [site.id],
    );
    expect(siteTags.map((r) => String(r.name))).toEqual(["目标标签"]);

    // 索引必须等于「按新标签重算」的结果 —— 这正是 mergeTags 漏掉的那一半
    const after = (await repo.raw(
      "SELECT title, description, url, fts_tokens, pinyin_full, pinyin_initials FROM sites WHERE id = ?",
      [site.id],
    ))[0]!;
    const idxAfter = buildIndexFields({
      title: String(after.title),
      description: after.description == null ? null : String(after.description),
      url: String(after.url),
      tags: ["目标标签"],
    });
    expect(idxBefore.pinyinFull).not.toBe(idxAfter.pinyinFull);
    expect(String(after.fts_tokens)).toBe(idxAfter.ftsTokens);
    expect(String(after.pinyin_full)).toBe(idxAfter.pinyinFull);
    expect(String(after.pinyin_initials)).toBe(idxAfter.pinyinInitials);
  });

  it("遗留别名摘除后，旧标签名不再命中这些站点", async () => {
    // 合并会自动把源标签 slug 记为目标标签的别名（SKOS 兼容），
    // 所以「旧名仍能命中」在这一步是**设计内**的。真正的错结果出现在
    // 别名被摘掉之后：此时旧名已无处解析，若站点索引还停留在合并前，
    // 拼音/全文通道仍会把这些站点翻出来 —— 不报错，只是结果错。
    await repo.removeTagAlias("遗留标签词");
    expect(await repo.resolveTag("遗留标签词")).toBeNull();

    const res = await search.search({
      q: "遗留标签词",
      limit: 20,
      disableSemantic: true,
      disablePersonal: true,
    });
    const sites = await repo.getSitesByIds(res.hits.map((h) => h.siteId));
    for (const hit of res.hits) {
      expect(sites.get(hit.siteId)?.url).not.toBe("https://merge.example.com/legacy");
    }
  });

  it("setSiteTags 传入等价标签名（AI / ai）不报错且只落一条关联", async () => {
    const site = await repo.createSite({
      url: "https://dedupe.example.com/ai",
      title: "去重站点",
      description: "同一请求传两个等价标签名",
      categoryId,
      tags: ["工具"],
      status: "active",
    });

    // 修复前：upsertTag 把两者解析到同一 tag_id，第二次 INSERT 撞唯一索引，
    // 整个事务回滚 —— 表现为 PATCH /api/sites 直接失败。
    await expect(repo.setSiteTags(site.id, ["AI", "ai"])).resolves.toBeUndefined();

    const links = await repo.raw("SELECT tag_id FROM site_tags WHERE site_id = ?", [site.id]);
    expect(links).toHaveLength(1);

    // 大小写之外：trim 同值、slugify 同值同样只算一个
    await expect(repo.setSiteTags(site.id, [" AI ", "ai", "AI"])).resolves.toBeUndefined();
    expect(await repo.raw("SELECT tag_id FROM site_tags WHERE site_id = ?", [site.id])).toHaveLength(1);

    // 不同标签仍然各落一条
    await expect(repo.setSiteTags(site.id, ["AI", "ai", "工具"])).resolves.toBeUndefined();
    expect(await repo.raw("SELECT tag_id FROM site_tags WHERE site_id = ?", [site.id])).toHaveLength(2);

    // PATCH 路径（updateSite）同样不被等价重复名打断
    const patched = await repo.updateSite(site.id, { tags: ["Ai", "AI", "工具"] });
    expect(patched).not.toBeNull();
    expect(await repo.raw("SELECT tag_id FROM site_tags WHERE site_id = ?", [site.id])).toHaveLength(2);
  });

  it("标签过滤大小写不敏感：AI / ai / Ai 命中同一集合", async () => {
    const site = await repo.createSite({
      url: "https://case.example.com/ai-tool",
      title: "大小写标签站点",
      description: "检验 tag 参数大小写",
      categoryId,
      tags: ["AI 工具"],
      status: "active",
    });
    await repo.setSiteTags(site.id, ["AI 工具"]);

    // 库里 slug 是 slugify 的产物（"ai-工具"），name 保留原样（"AI 工具"）
    const rows = await repo.raw("SELECT name, slug FROM tags WHERE name = ? LIMIT 1", ["AI 工具"]);
    expect(rows[0]).toBeTruthy();
    expect(String(rows[0]!.slug)).toBe("ai-工具");

    for (const tag of ["AI 工具", "ai 工具", "ai-工具", "AI-工具"]) {
      const res = await search.search({ tag, limit: 20, disableSemantic: true, disablePersonal: true });
      expect(res.hits.some((h) => h.siteId === site.id), `tag=${tag} 应命中`).toBe(true);
    }

    // 纯 ASCII 大小写同样归一
    const en = await repo.createSite({
      url: "https://case.example.com/design",
      title: "大小写英文标签",
      description: "检验纯英文标签大小写",
      categoryId,
      tags: ["Design"],
      status: "active",
    });
    for (const tag of ["Design", "design", "DESIGN", "DeSiGn"]) {
      const res = await search.search({ tag, limit: 20, disableSemantic: true, disablePersonal: true });
      expect(res.hits.some((h) => h.siteId === en.id), `tag=${tag} 应命中`).toBe(true);
    }

    // 分面计数走同一口径（listFacetsSummary 的 tag 过滤也曾是裸比较）
    const facets = await repo.listFacetsSummary({ tag: "DESIGN" });
    const facetsLower = await repo.listFacetsSummary({ tag: "design" });
    expect(JSON.stringify(facets)).toBe(JSON.stringify(facetsLower));
  });

  it("browse 下推路径（>500 命中）同样大小写不敏感", async () => {
    // browse 在标签命中 >500 时把谓词下推成子查询（避免上千绑定参数），
    // 这条分支与 siteIdsWithTag 必须同口径，否则同一 tag 在两种规模下结果不同。
    const tagName = "PushDown 标签";
    const urls: string[] = [];
    for (let i = 0; i < 510; i++) urls.push(`https://pushdown.example.com/s${i}`);
    const created = await repo.insertSitesBulk(
      urls.map((url, i) => ({
        id: `pushdown-${i}`,
        url,
        title: `下推站点 ${i}`,
        description: "",
        categoryId,
        tags: [tagName],
        status: "active" as const,
      })),
      { hydrate: false },
    );
    expect(created.count).toBe(510);

    for (const tag of [tagName, tagName.toLowerCase(), tagName.toUpperCase(), "pushdown-标签"]) {
      const res = await search.search({ tag, limit: 5, disableSemantic: true, disablePersonal: true });
      expect(res.hits.length, `tag=${tag} 应有结果`).toBeGreaterThan(0);
      for (const hit of res.hits) expect(hit.siteId.startsWith("pushdown-")).toBe(true);
    }

    // 清理，避免后续用例的计数被这批数据带偏
    for (let i = 0; i < 510; i++) await repo.purgeSite(`pushdown-${i}`);
  });
});
