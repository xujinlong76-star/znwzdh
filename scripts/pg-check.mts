
import { loadConfig, createContext } from "../apps/api/src/index.ts";
import { cleanupOrphanPluginCategories, migrateCategorySlugs } from "../packages/store/src/migrate.ts";

// 本脚本会**清库**（下面 DELETE FROM sites/categories/... 是无条件的），
// 所以目标库必须是显式声明的测试库。
// 之前这里回退到 NAVHUB_DATABASE_URL，再回退到硬编码的
// postgres://navhub:navhub@127.0.0.1:5432/navhub —— 那正好是
// `docker compose --profile standard` 起的那个库（默认口令、publish 到宿主机 5432）。
// 于是「跑一下 pnpm test:pg 验证 PG 通路」= 把真实数据全删了，且没有任何提示。
// CI 一直显式注入 NAVHUB_TEST_DATABASE_URL（见 .github/workflows/ci.yml），
// 取消回退不会影响它。
const testUrl = process.env.NAVHUB_TEST_DATABASE_URL?.trim();
if (!testUrl) {
  console.error(
    [
      "pg-check 拒绝执行：本脚本会清空目标库里的站点/类目/标签/事件/审计。",
      "请显式指定一个可以丢的测试库，例如：",
      "  NAVHUB_TEST_DATABASE_URL=postgres://navhub:navhub@127.0.0.1:5432/navhub_test node scripts/pg-check.mts",
      "（不再回退到 NAVHUB_DATABASE_URL 或内置 DSN：那等于对着生产库跑删除。）",
    ].join("\n"),
  );
  process.exit(2);
}
// 第二道闸：库名看着就不像测试库时也要显式确认。
// 有人会把 NAVHUB_TEST_DATABASE_URL 指到"顺手的那个大库"，变量名不构成保护。
const dbName = (() => {
  try {
    return new URL(testUrl).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();
if (!/(^|[_-])(test|ci)([_-]|$)/i.test(dbName) && !process.env.NAVHUB_PG_CHECK_ALLOW_ANY_DB) {
  console.error(
    `pg-check 拒绝执行：目标库名「${dbName || "(解析不到)"}」不像测试库（需要包含 test/ci）。\n` +
      "确认这个库可以清空后，用 NAVHUB_PG_CHECK_ALLOW_ANY_DB=1 覆盖本判断。",
  );
  process.exit(2);
}
console.log("目标测试库：" + testUrl.replace(/\/\/[^@/]*@/, "//***@") + "（本脚本会清空其中的业务表）");

const config = loadConfig({
  mode: "standard",
  databaseUrl: testUrl,
  embedding: { model: "x", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: "./data/models", dim: 512, enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 5000, maxBytes: 1048576, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "t" },
  corsOrigins: ["*"],
});

const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log((ok ? "  PASS  " : "  FAIL  ") + name + (extra ? "  " + extra : "")); };

const ctx = await createContext(config);
const db = ctx.db.pg;

// 干净起点：清空本脚本可能留下的数据
await db.query("DELETE FROM site_tags");
await db.query("DELETE FROM sites");
await db.query("DELETE FROM categories");
await db.query("DELETE FROM tags");
await db.query("DELETE FROM sites_vec");
await db.query("DELETE FROM events");
await db.query("DELETE FROM audit_logs");

console.log("capabilities: " + JSON.stringify(ctx.capabilities.notes));
check("pgvector (HNSW) 就绪", ctx.capabilities.notes.some(n => n.includes("pgvector")));

// 1) 类目（物化路径）
const cat = await ctx.repo.createCategory({ id: "pg-cat", title: "PG 类目" });
const sub = await ctx.repo.createCategory({ id: "pg-sub", title: "PG 子类目", parentId: "pg-cat" });
check("类目物化路径", sub.anchor === "pg-cat/" + sub.anchor.split("/")[1] || sub.anchor.startsWith("pg-cat/"), "anchor=" + sub.anchor);

// 2) 站点 + 中文标签
const site = await ctx.repo.createSite({
  url: "https://weather.com.cn", title: "中国天气网", description: "全国天气预报查询",
  categoryId: "pg-cat", tags: ["天气", "生活"],
});
check("创建站点", Boolean(site.id));
check("中文标签可写回", site.tags.length === 2, "tags=" + JSON.stringify(site.tags));

// 3) 读回标签（此前永远为空）
const found = await ctx.repo.findSiteByUrl("https://weather.com.cn");
check("按 URL 读回且标签不为空", Boolean(found && found.tags.length === 2), "tags=" + JSON.stringify(found?.tags));

// 4) 更新
const upd = await ctx.repo.updateSite(site.id, { title: "中国天气网（已更新）" });
check("更新站点", upd?.title === "中国天气网（已更新）");

// 5) 全文检索（PG tsvector）
const ftsHits = await ctx.fts.search("天气", 5);
check("tsvector 命中中文子串『天气』", ftsHits.length > 0, "hits=" + ftsHits.length);
const ftsHits2 = await ctx.fts.search("天气预报", 5);
check("tsvector 命中『天气预报』", ftsHits2.length > 0);

// 6) 走完整检索引擎
const s1 = await ctx.search.search({ q: "天气", limit: 5 });
check("检索引擎『天气』命中", s1.hits.length > 0, "channels=" + JSON.stringify(s1.channelsUsed));
const s2 = await ctx.search.search({ q: "zgtqw", limit: 5 });
check("拼音首字母 zgtqw 命中中国天气网", s2.hits.length > 0);
const s3 = await ctx.search.search({ q: "", limit: 10 });
check("浏览模式可用", s3.hits.length > 0, "hits=" + s3.hits.length);

// 7) 类目含子类过滤
await ctx.repo.createSite({ url: "https://example.com/sub", title: "子类站点", categoryId: "pg-sub" });
const s4 = await ctx.search.search({ q: "", categoryId: "pg-cat", limit: 20 });
check("父类目过滤包含子类目", s4.hits.length === 2, "hits=" + s4.hits.length);

// 8) 标签过滤（中文）
const s5 = await ctx.search.search({ q: "", tag: "天气", limit: 10 });
check("中文标签过滤命中", s5.hits.length === 1, "hits=" + s5.hits.length);

// 9) 幂等：同 URL 再建应能找到重复
const dup = await ctx.repo.findSiteByUrl("https://weather.com.cn");
check("重复 URL 可被检测", dup?.id === site.id);

// 10) 删除
await ctx.repo.deleteSite(site.id);
const after = await ctx.repo.findSiteByUrl("https://weather.com.cn");
check("删除后读不到", after === null);

// 11) 统计
const st = await ctx.repo.stats();
check("统计返回真实计数", st.sites === 1 && st.categories === 2, JSON.stringify(st));

// 12) 审计与事件
await ctx.repo.audit({ actor: "pg-test", action: "test", target: "x" });
await ctx.repo.recordEvent("search", { query: "天气" });
const ev = await db.query("SELECT count(*)::int AS c FROM events");
const au = await db.query("SELECT count(*)::int AS c FROM audit_logs");
check("审计与事件落库", Number((ev.rows[0] as any).c) > 0 && Number((au.rows[0] as any).c) > 0);

// 13) 类目计数聚合（GET /api/categories/counts 的实现，双指针并集）
const countCat = await ctx.repo.createCategory({ id: "pg-cat-count", title: "PG 计数类目" });
const otherCat = await ctx.repo.createCategory({ id: "pg-cat-other", title: "PG 计数类目二" });
await ctx.repo.createSite({ url: "https://count-pg-1.example.com", title: "计数站点一", categoryId: countCat.id });
await ctx.repo.createSite({ url: "https://count-pg-2.example.com", title: "计数站点二", categoryId: countCat.id, subCategoryId: otherCat.id });
// 主副指针同类目：只计一次
await ctx.repo.createSite({ url: "https://count-pg-3.example.com", title: "计数站点三", categoryId: countCat.id, subCategoryId: countCat.id });
await ctx.repo.createSite({ url: "https://count-pg-4.example.com", title: "计数站点四", categoryId: countCat.id, status: "broken" });
const cnt = new Map((await ctx.repo.categorySiteCounts()).map((r) => [r.categoryId, r.sites]));
check(
  "类目计数：双指针并集、同指针去重、只算 active 未删",
  cnt.get(countCat.id) === 3 && cnt.get(otherCat.id) === 1 && !cnt.has("pg-cat"),
  JSON.stringify([...cnt]),
);

// 14) 类目分页有界
const page1 = await ctx.repo.listCategoriesPage({ limit: 2, offset: 0 });
check("类目分页：limit 生效并回 total", page1.items.length === 2 && page1.total === 4 && page1.limit === 2, `total=${page1.total}`);
const page2 = await ctx.repo.listCategoriesPage({ limit: 2, offset: 2 });
check("类目分页：offset 翻页不重不漏", page2.items.length === 2 && !page1.items.some((c) => page2.items.some((d) => d.id === c.id)));
const rootPage = await ctx.repo.listCategoriesPage({ parentId: null });
check("类目分页：parentId=null 只出根", rootPage.items.every((c) => !c.parentId) && rootPage.total === 3, `total=${rootPage.total}`);

// 15) 兜底类目在 PG 上同样是「清扫打不掉」的系统类目
const unc = await ctx.repo.ensureUncategorized();
const uncCat = await ctx.repo.getCategory(unc);
check("未分类：固定 id + source=system", unc === "cat-uncategorized" && uncCat?.source === "system" && uncCat?.sort === 999);
await cleanupOrphanPluginCategories(ctx.db);
check("启动清扫不吃掉未分类", (await ctx.repo.getCategory(unc)) !== null);

// 16) slug：列 / 部分唯一索引 / 存量回填（/category/{slug} 的地基）
const slugCat = await ctx.repo.createCategory({ id: "pg-cat-slug", title: "PG 效率类目", titleEn: "PG Slug Demo" });
check("新建类目自带 ASCII slug", slugCat.slug === "pg-slug-demo", `slug=${slugCat.slug}`);
const slugZh = await ctx.repo.createCategory({ id: "pg-cat-slug-zh", title: "游戏电竞" });
check(
  "纯中文标题走拼音兜底",
  (await ctx.repo.getCategoryBySlug("youxidianjing"))?.id === slugZh.id,
  `slug=${slugZh.slug}`,
);
// 部分唯一索引必须真在：没有 WHERE slug IS NOT NULL，下面的两条 NULL 会直接炸
const slugIdx = await ctx.repo.raw("SELECT indexdef FROM pg_indexes WHERE tablename = 'categories' AND indexname = 'categories_slug_idx'");
check("slug 唯一索引存在且为部分索引", String((slugIdx as any)[0]?.indexdef ?? "").includes("WHERE (slug IS NOT NULL)"), String((slugIdx as any)[0]?.indexdef));
await ctx.repo.run(
  "INSERT INTO categories (id, anchor, parent_id, title, title_en, slug, description, icon, enabled, sort, source, alt_labels, related_categories, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ["pg-cat-legacy-1", "pg-cat-legacy-1", null, "PG 旧行甲", null, null, null, null, 1, 0, "api", "[]", "[]", Date.now(), Date.now()],
);
await ctx.repo.run(
  "INSERT INTO categories (id, anchor, parent_id, title, title_en, slug, description, icon, enabled, sort, source, alt_labels, related_categories, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ["pg-cat-legacy-2", "pg-cat-legacy-2", null, "PG 旧行乙", null, null, null, null, 1, 0, "api", "[]", "[]", Date.now(), Date.now()],
);
const backfilled = await migrateCategorySlugs(ctx.db);
check("存量 NULL slug 回填（只补 NULL 行）", backfilled === 2, `written=${backfilled}`);
check("回填后再跑是幂等零写", (await migrateCategorySlugs(ctx.db)) === 0);
// 「PG 旧行甲」的 ASCII 部分只剩 pg，两条同名前缀必须拿到不同 URL
const legacySlugs = [
  (await ctx.repo.getCategory("pg-cat-legacy-1"))!.slug!,
  (await ctx.repo.getCategory("pg-cat-legacy-2"))!.slug!,
];
check(
  "回填行可按 slug 读回且互不撞车",
  new Set(legacySlugs).size === 2 &&
    legacySlugs.every((s) => /^pg(-\d+)?$/.test(s)) &&
    (await ctx.repo.getCategoryBySlug(legacySlugs[0]))?.id === "pg-cat-legacy-1",
  legacySlugs.join(","),
);
let slugClash = false;
try {
  await ctx.repo.createCategory({ id: "pg-cat-slug-clash", title: "撞名", slug: "pg-slug-demo" });
} catch {
  slugClash = true;
}
check("显式 slug 撞库报错（不静默改名）", slugClash);

await ctx.close();

const pass = results.filter(r => r.ok).length;
console.log("\nSTANDARD MODE: " + pass + "/" + results.length + " passed");
process.exit(pass === results.length ? 0 : 1);
