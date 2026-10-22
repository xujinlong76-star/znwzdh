
import { loadConfig, createContext } from "../apps/api/src/index.ts";

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

await ctx.close();

const pass = results.filter(r => r.ok).length;
console.log("\nSTANDARD MODE: " + pass + "/" + results.length + " passed");
process.exit(pass === results.length ? 0 : 1);
