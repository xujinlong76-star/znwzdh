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
 * A3（DEV_BACKLOG）后的分工：运行时回填已接进主流程（apps/api 的
 * facet-backfill.ts 在 seed 与快照写回后自动补齐，同一套口径），本脚本只作
 * 存量库的一次性运维/校验工具保留。pricing 口径与 core 严格一致：
 *   - 先查人工核实覆盖表（packages/core/src/pricing-overrides.json，与
 *     packages/core/src/pricing.ts 共用同一数据源）；
 *   - 再走收紧版强信号规则（旧版「有『免费』二字就判 free」已废除——那会把
 *     收费站误标免费，比不标更坏）；
 *   - 都不命中 → 显式写 unknown（未标注），不留空、不猜；
 *   - --apply 时**永不覆盖已有 pricing**（管理员手标优先）：已有 pricing 的
 *     站点原样保留其值，只重写其余维度。
 *
 * 用法：
 *   node scripts/backfill-facets.mjs                 # 只统计，不写
 *   node scripts/backfill-facets.mjs --apply         # 真正写入
 *   node scripts/backfill-facets.mjs --db data/navhub.db --apply
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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
  pricing: ["free", "freemium", "paid", "open_source", "unknown"],
  platform: ["web", "ios", "android", "macos", "windows", "linux", "extension"],
  form: ["saas", "self_hosted", "cli", "api", "desktop"],
};

/**
 * pricing 推导（与 packages/core/src/pricing.ts 的 PRICING_RULES 逐条对应，
 * 改一处必须同步另一处）：人工覆盖表 > 强信号规则 > unknown。
 * 规则只看标题+描述+标签（不含 URL——URL 里的词不是定价证据）。
 */
const PRICING_OVERRIDES = (() => {
  try {
    return JSON.parse(
      readFileSync(path.join(ROOT, "packages/core/src/pricing-overrides.json"), "utf8"),
    );
  } catch {
    return {};
  }
})();

function pricingOverrideKey(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.hostname.toLowerCase().replace(/^www\./, "") + u.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

const PRICING_RULES = [
  { value: "open_source", re: /开源|open[\s-]?source/i },
  {
    value: "freemium",
    re: /免费增值|freemium|免费试用|免费额度|免费层|免费版|部分免费|前几集免费|免费旁听|会员解锁|付费解锁|付费章节|付费内容|免费\s*\+|免费\+/i,
  },
  {
    value: "free",
    re: /完全免费|永久免费|全场免费|全本免费|免费看|免费阅读|免费读|免费小说|免费素材|免费字体|免费开放|免费平台|免费教育|免费使用|免费下载/,
  },
  { value: "paid", re: /订阅制|付费订阅|付费购买|付费下载|仅付费|付费制/ },
];

function derivePricing(site, tags) {
  const key = pricingOverrideKey(site.url ?? "");
  const override = key ? PRICING_OVERRIDES[key] : undefined;
  if (override?.pricing) return override.pricing;
  const blob = [site.title ?? "", site.description ?? "", tags.join(" ")].join(" ");
  for (const rule of PRICING_RULES) {
    if (rule.re.test(blob)) return rule.value;
  }
  return "unknown";
}

/** 标签/描述关键词 → 分面值（platform/form 用）。顺序即优先级。 */
const RULES = [
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

  // pricing 单选且必有一个值（含 unknown），走独立推导（覆盖表 > 规则 > unknown）
  picked.set("pricing", new Set([derivePricing(site, tags)]));

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
    const determinate = perSite.filter(
      (s) => s.facets.pricing && s.facets.pricing[0] !== "unknown",
    ).length;
    console.log(`[facets] pricing 有确定值（非未标注）：${determinate} / ${rows.length}`);

    if (!apply) {
      console.log("[facets] 未写入。确认无误后执行：node scripts/backfill-facets.mjs --apply");
      return;
    }

    // A3：已有 pricing 永不覆盖（管理员手标优先于推导）。先读存量 pricing，
    // 写回时这些站点沿用原值——本脚本的全量重写只作用于其余维度。
    const existingPricing = new Map(
      db
        .prepare("SELECT site_id, facet_value FROM site_facets WHERE facet_key = 'pricing'")
        .all()
        .map((r) => [r.site_id, r.facet_value]),
    );
    let preserved = 0;
    for (const item of perSite) {
      const kept = existingPricing.get(item.id);
      if (kept && ALLOWED.pricing.includes(kept)) {
        item.facets.pricing = [kept];
        preserved++;
      }
    }
    if (preserved > 0) console.log(`[facets] 已有 pricing 保留不覆盖：${preserved} 站`);

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
