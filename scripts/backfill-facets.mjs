#!/usr/bin/env node
/**
 * 分面属性回填（site_facets）。
 *
 * 为什么需要这个脚本：`site_facets` 是受控正交分面体系（packages/core/facets.ts
 * 的 CONTROLLED_FACETS）的存储表，前台 /search 的多维筛选栏、后台编辑面板都读它。
 * 但它**只能靠人工逐站编辑才有数据**——实测 dev 库 1026 个站点里 site_facets
 * 是 0 行，等于整套分面能力在真实数据上是「做了但看不见」。
 *
 * 做法：从**已有可信信号**（站点标签 tags + 少量描述关键词）按规则推导分面值。
 * 刻意保守：
 *   1. 只写 CONTROLLED_FACETS 里存在的键与值，写不进任何自造词；
 *   2. 只做「强信号」匹配（标签命中），不做模糊语义猜测——宁可少标，不可错标；
 *   3. 默认 dry-run，不传 --apply 绝不写库；
 *   4. platform=web 对全部站点成立（本系统的收录对象就是可在线访问的网址），
 *      这是唯一一条「无条件」推断，其余都要证据。
 *
 * 用法：
 *   node scripts/backfill-facets.mjs                 # 只统计，不写
 *   node scripts/backfill-facets.mjs --apply         # 真正写入
 *   node scripts/backfill-facets.mjs --db data/navhub.db --apply
 */
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const storeRequire = createRequire(path.join(ROOT, "packages/store/package.json"));

let Database;
try {
  Database = storeRequire("better-sqlite3");
} catch (err) {
  console.error("无法加载 better-sqlite3（请先在仓库根执行 pnpm install）:", err.message);
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dbArgIdx = args.indexOf("--db");
const dbPath = path.resolve(
  ROOT,
  dbArgIdx >= 0 && args[dbArgIdx + 1] ? args[dbArgIdx + 1] : "data/navhub.db",
);

/**
 * 受控词表白名单——**唯一事实源是 packages/core/src/facets.ts**。
 * 这里再抄一份是因为本脚本跑在 node 直跑环境、不编译 TS；
 * 两侧不一致时以 core 为准，scripts/test/backfill-facets.test.mjs 会比对。
 */
const ALLOWED = {
  pricing: ["free", "freemium", "paid", "open_source"],
  platform: ["web", "ios", "android", "macos", "windows", "linux", "extension"],
  form: ["saas", "self_hosted", "cli", "api", "desktop"],
};

/** 标签/描述关键词 → 分面值。顺序即优先级，同一键内先命中先得（后续不覆盖）。 */
const RULES = [
  // 付费模式
  { key: "pricing", value: "open_source", re: /开源|open[-_ ]?source|\boss\b/i },
  { key: "pricing", value: "freemium", re: /免费增值|freemium|免费额度/i },
  { key: "pricing", value: "free", re: /完全免费|免费/ },
  { key: "pricing", value: "paid", re: /付费|商业|订阅|paid|commercial/i },
  // 运行平台（web 无条件另算）
  { key: "platform", value: "extension", re: /浏览器(插件|扩展)|chrome\s*扩展|extension/i },
  { key: "platform", value: "ios", re: /\bios\b|ipados|iphone/i },
  { key: "platform", value: "android", re: /android|安卓/i },
  { key: "platform", value: "macos", re: /macos|\bmac\b|os\s*x/i },
  { key: "platform", value: "windows", re: /windows/i },
  { key: "platform", value: "linux", re: /linux|ubuntu/i },
  // 产品形态
  { key: "form", value: "self_hosted", re: /docker|自托管|私有部署|self[-_ ]?host|本地部署/i },
  { key: "form", value: "cli", re: /\bcli\b|命令行|终端工具/i },
  { key: "form", value: "api", re: /\bapi\b|\bsdk\b|开发者接口/i },
  { key: "form", value: "saas", re: /\bsaas\b|在线服务/i },
  { key: "form", value: "desktop", re: /桌面(端|软件|应用)|desktop/i },
];

function loadSites(db) {
  const rows = db
    .prepare("SELECT id, title, url, description FROM sites WHERE deleted_at IS NULL")
    .all();
  const tagRows = db
    .prepare(
      "SELECT st.site_id AS siteId, t.name AS name, t.slug AS slug FROM site_tags st JOIN tags t ON t.id = st.tag_id",
    )
    .all();
  const tagsBySite = new Map();
  for (const r of tagRows) {
    const list = tagsBySite.get(r.siteId) ?? [];
    list.push(String(r.name), String(r.slug));
    tagsBySite.set(r.siteId, list);
  }
  return { rows, tagsBySite };
}

function deriveFacets(site, tags) {
  const corpus = [tags.join(" "), site.title ?? "", site.description ?? "", site.url ?? ""].join(" ");
  const picked = new Map();
  const push = (key, value) => {
    if (!ALLOWED[key]?.includes(value)) return;
    const set = picked.get(key) ?? new Set();
    set.add(value);
    picked.set(key, set);
  };

  // 唯一无条件推断：收录对象都是可在线访问的网址
  push("platform", "web");

  for (const rule of RULES) {
    if (rule.re.test(corpus)) push(rule.key, rule.value);
  }

  // pricing 是单选维度：同时命中时保留更强的（open_source > freemium > free > paid）
  const pricing = picked.get("pricing");
  if (pricing && pricing.size > 1) {
    const order = ["open_source", "freemium", "free", "paid"];
    const best = order.find((v) => pricing.has(v));
    picked.set("pricing", new Set([best]));
  }

  const out = {};
  for (const [key, set] of picked) out[key] = [...set];
  return out;
}

function main() {
  if (!apply) {
    console.log("[facets] DRY-RUN（不写库；加 --apply 才落盘）");
  }
  console.log("[facets] 数据库:", dbPath);
  const db = new Database(dbPath, { readonly: !apply });
  try {
    const existing = db.prepare("SELECT COUNT(*) AS n FROM site_facets").get().n;
    console.log("[facets] 现有 site_facets 行数:", existing);

    const { rows, tagsBySite } = loadSites(db);
    console.log("[facets] 存活站点:", rows.length);

    const valueCounts = new Map();
    const perSite = [];
    for (const site of rows) {
      const facets = deriveFacets(site, tagsBySite.get(site.id) ?? []);
      perSite.push({ id: site.id, facets });
      for (const [key, values] of Object.entries(facets)) {
        for (const v of values) {
          const k = key + ":" + v;
          valueCounts.set(k, (valueCounts.get(k) ?? 0) + 1);
        }
      }
    }

    console.log("[facets] 推导结果（站点数 / 取值）：");
    for (const [k, n] of [...valueCounts.entries()].sort()) {
      console.log("  " + k.padEnd(28) + n);
    }
    const labelled = perSite.filter((s) => Object.keys(s.facets).length > 1).length;
    console.log(`[facets] 至少带 1 个非 web 维度的站点：${labelled} / ${rows.length}`);

    if (!apply) {
      console.log("[facets] 未写入。确认无误后执行：node scripts/backfill-facets.mjs --apply");
      return;
    }

    const del = db.prepare("DELETE FROM site_facets WHERE site_id = ?");
    const ins = db.prepare(
      "INSERT OR IGNORE INTO site_facets (site_id, facet_key, facet_value) VALUES (?, ?, ?)",
    );
    const tx = db.transaction((items) => {
      for (const item of items) {
        del.run(item.id);
        for (const [key, values] of Object.entries(item.facets)) {
          for (const v of values) ins.run(item.id, key, v);
        }
      }
    });
    tx(perSite);
    const after = db.prepare("SELECT COUNT(*) AS n FROM site_facets").get().n;
    console.log("[facets] 写入完成，site_facets 行数:", after);
  } finally {
    db.close();
  }
}

main();
