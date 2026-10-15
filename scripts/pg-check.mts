
import { loadConfig, createContext } from "../apps/api/src/index.ts";

const config = loadConfig({
  mode: "standard",
  databaseUrl: process.env.NAVHUB_TEST_DATABASE_URL || process.env.NAVHUB_DATABASE_URL || "postgres://navhub:navhub@127.0.0.1:5432/navhub",
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
