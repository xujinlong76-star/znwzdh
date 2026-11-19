#!/usr/bin/env node
/**
 * 结构化档案草稿生成（Batch0-02，细化方案 §4 / §5）。
 *
 * 只做机器可推导的预填，绝不编造：
 *   - pricing_model：先查人工核实覆盖表（pricing-overrides.json），再走
 *     与 core pricing.ts 同款的收紧版强信号规则（开源 > 免费增值 >
 *     完全免费 > 商业付费）；都不命中 → 显式 unknown。裸“免费”二字不判
 *     free（旧事故教训，见细化方案 §11.1）。
 *   - requires_account / free_trial / data_export：缺省 unknown。
 *   - license：仅当 pricing_model 为 open_source 且本站 href 本身就是
 *     GitHub 仓库地址时，预填该仓库的 LICENSE 文件 URL；否则留空。
 *   - best_for / not_for：脚本绝不生成自由文本，草稿中留空（null）。
 *   - 草稿行 profile_status='draft'，verified_at 写草稿生成时间并标注
 *     draft，不冒充核查时间；verified_by 写 'draft-script'。
 *
 * 写入口纪律（§4.2）：
 *   - 默认 dry-run：只统计、不写。传 --apply 才写。
 *   - 只写草稿：写 JSON 草稿文件；--db 传入且 site_profiles 表存在时
 *     才额外 upsert 到库里，且只更新 draft 行，永不覆盖 verified 行。
 *   - 不直接写 verified 行，不改 navigation.json，不碰 site_prices。
 *   - 幂等：重复跑只更新 draft 行；已有的 verified 行原样保留。
 *
 * --sample：30 站分层抽样（§5.1，种子 20261119 入库）。
 *   - 14 类按配额（AI 工具 7、前端开发 1、后端与云 3、运维与安全 1、
 *     开发者资源 2、设计与创意 3、效率办公 2、学习成长 3、学术科研 2、
 *     资讯媒体 1、影音娱乐 1、消费生活 2、公共服务 1、短剧 1，合计 30）；
 *   - 强制纳入 2 站（计入 30 站内，从 AI 工具类与学习成长类各抵 1 个
 *     随机名额）：① 1 个 open_source 定价档站（验 license）；② 1 个
 *     已有 site_prices 记录的站（验价格 join）——生产库 site_prices
 *     为 0 行时改抽“有明确免费档”（覆盖表 pricing == 'free'）的站；
 *   - 排除 enabled=false 的站；健康巡检 ok=false 且 30 天未复核的站
 *     在 --db 传入时按库里 health_ok / last_checked_at 排除，未传 --db
 *     时记为“未应用（无健康数据源）”，不静默假装已排除。
 *
 * 用法：
 *   node scripts/generate-site-profile-drafts.mjs --sample            # 只抽样统计，不写
 *   node scripts/generate-site-profile-drafts.mjs --sample --apply    # 写草稿 JSON + 抽样记录
 *   node scripts/generate-site-profile-drafts.mjs --apply --db data/navhub.db
 *   node scripts/generate-site-profile-drafts.mjs --sample --apply \
 *     --out <草稿 JSON> --sampling-out <抽样记录 JSON> --db <只读计量库>
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const storeRequire = createRequire(path.join(ROOT, "packages/store/package.json"));

export const DRAFT_SEED = 20261119;
export const DRAFT_VERIFIED_BY = "draft-script";

/** §5.1 分配表（合计 30 站）。键为 navigation.json 一级分类标题。 */
export const SAMPLE_QUOTAS = {
  "AI 工具": 7,
  "前端开发": 1,
  "后端与云": 3,
  "运维与安全": 1,
  "开发者资源": 2,
  "设计与创意": 3,
  "效率办公": 2,
  "学习成长": 3,
  "学术科研": 2,
  "资讯媒体": 1,
  "影音娱乐": 1,
  "消费生活": 2,
  "公共服务": 1,
  "短剧": 1,
};

/** 强制纳入 2 站各抵哪一类的随机名额。 */
export const FORCED_DEDUCT_FROM = { openSource: "AI 工具", priced: "学习成长" };

/** 30 天（毫秒）：健康排除的“未复核”窗口。 */
export const HEALTH_UNREVIEWED_MS = 30 * 24 * 60 * 60 * 1000;

/** 定性档受控值（唯一事实源：packages/core/src/facets.ts 的 pricing 键）。 */
export const PRICING_VALUES = ["free", "freemium", "paid", "open_source", "unknown"];

/**
 * mulberry32：确定性 PRNG（抽样用）。种子即抽样记录的 seed，换种子即换样本。
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗牌（返回新数组，不动入参）。 */
export function shuffled(list, rng) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * URL → 覆盖表键：小写 host（去掉 www. 前缀）+ 路径（去掉尾部斜杠）。
 * 与 packages/core/src/pricing.ts 的 pricingOverrideKey 逐字同口径。
 */
export function pricingOverrideKey(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return host + path;
  } catch {
    return null;
  }
}

/**
 * 收紧版强信号规则（与 packages/core/src/pricing.ts 的 PRICING_RULES
 * 同序同正则；脚本跑在 node 直跑环境、不编译 TS，只能抄一份，
 * scripts/test/generate-site-profile-drafts.test.mjs 钉住两侧同步）。
 */
export const PRICING_RULES = [
  { value: "open_source", pattern: /开源|open[\s-]?source/i, note: "文本明示开源" },
  {
    value: "freemium",
    pattern:
      /免费增值|freemium|免费试用|免费额度|免费层|免费版|部分免费|前几集免费|免费旁听|会员解锁|付费解锁|付费章节|付费内容|免费\s*\+|免费\+/i,
    note: "文本明示免费+付费并存（免费增值）",
  },
  {
    value: "free",
    pattern:
      /完全免费|永久免费|全场免费|全本免费|免费看|免费阅读|免费读|免费小说|免费素材|免费字体|免费开放|免费平台|免费教育|免费使用|免费下载/,
    note: "文本明示完全免费",
  },
  { value: "paid", pattern: /订阅制|付费订阅|付费购买|付费下载|仅付费|付费制/, note: "文本明示付费制" },
];

/**
 * pricing_model 预填：覆盖表优先，其次强信号规则，都不命中 → unknown。
 * 返回 { value, source: "override" | "rule" | "unknown", evidence? }。
 * 注意：裸“免费”二字不在任何一条规则里——描述含“免费”不等于免费。
 */
export function derivePricingModel(site, overrides) {
  const key = pricingOverrideKey(site.href ?? "");
  const hit = key ? overrides[key] : null;
  if (hit && PRICING_VALUES.includes(hit.pricing)) {
    return { value: hit.pricing, source: "override", evidence: hit.evidence ?? "" };
  }
  const blob = [site.title ?? "", site.description ?? "", ...(site.tags ?? [])].join(" ");
  for (const rule of PRICING_RULES) {
    if (rule.pattern.test(blob)) return { value: rule.value, source: "rule", evidence: rule.note };
  }
  return { value: "unknown", source: "unknown" };
}

/**
 * license 预填：仅当 pricing_model 为 open_source 且 href 本身就是
 * GitHub 仓库地址（github.com/<owner>/<repo>[/...]）时，返回该仓库的
 * LICENSE 文件 URL；否则返回 null（留空，不猜仓库地址）。
 */
export function deriveLicenseUrl(site, pricingModel) {
  if (pricingModel !== "open_source") return null;
  try {
    const u = new URL(site.href ?? "");
    if (u.hostname.toLowerCase().replace(/^www\./, "") !== "github.com") return null;
    const segments = u.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    return `https://github.com/${segments[0]}/${segments[1]}/blob/HEAD/LICENSE`;
  } catch {
    return null;
  }
}

/**
 * 单站草稿行。best_for / not_for 永远 null（脚本绝不生成自由文本）；
 * alternatives 永远 null（关系边须人工按 §2.3 边准入规则建，不推导）。
 */
export function buildDraftRow(site, overrides, generatedAt) {
  const pricing = derivePricingModel(site, overrides);
  const license = deriveLicenseUrl(site, pricing.value);
  return {
    site_id: site.id,
    title: site.title,
    href: site.href,
    category: site.category ?? null,
    pricing_model: pricing.value,
    pricing_model_source: pricing.source,
    pricing_model_evidence: pricing.evidence ?? "",
    requires_account: "unknown",
    free_trial: "unknown",
    data_export: ["unknown"],
    best_for: null,
    not_for: null,
    license,
    license_source: license ? "derived-from-href" : null,
    alternatives: null,
    profile_source_url: site.href,
    profile_verified_at: generatedAt,
    verified_by: DRAFT_VERIFIED_BY,
    profile_status: "draft",
  };
}

/**
 * 幂等合并：已有输出里的 verified 行原样保留（永不覆盖）；draft 行用
 * 新生成的草稿替换；全新站点追加。返回合并后的行数组（按 site_id 排序）。
 */
export function mergeDrafts(existingRows, freshRows) {
  const byId = new Map();
  for (const row of existingRows ?? []) {
    if (row && typeof row.site_id === "string") byId.set(row.site_id, row);
  }
  for (const row of freshRows) {
    const prev = byId.get(row.site_id);
    if (prev && prev.profile_status === "verified") continue;
    byId.set(row.site_id, row);
  }
  return [...byId.values()].sort((a, b) => (a.site_id < b.site_id ? -1 : 1));
}

/**
 * 从 navigation.json 展平全站：[{ id, title, href, description, tags,
 * enabled, category }]。category 取一级分类标题；enabled 缺省为 true。
 */
export function flattenNavigation(nav) {
  const out = [];
  for (const cat of nav.navigationItems ?? []) {
    const push = (item) => {
      if (!item || typeof item.id !== "string") return;
      out.push({
        id: item.id,
        title: item.title ?? "",
        href: item.href ?? "",
        description: item.description ?? "",
        tags: Array.isArray(item.tags) ? item.tags : [],
        enabled: item.enabled !== false,
        category: cat.title ?? cat.id ?? "",
      });
    };
    for (const item of cat.items ?? []) push(item);
    for (const sub of cat.subCategories ?? []) {
      for (const item of sub.items ?? []) push(item);
    }
  }
  return out;
}

/**
 * 30 站分层抽样（纯函数，§5.1）。
 *
 * @param sites 全站（flattenNavigation 的输出）
 * @param opts { seed, quotas, overrides, pricedSiteIds: Set<string> | null,
 *   sitePricesCount: number | null, excludedIds: Set<string> }
 *   - pricedSiteIds 为 null 表示 site_prices 未计量/无记录：强制站 ②
 *     改抽“有明确免费档”（覆盖表 pricing == 'free'）的站。
 *   - excludedIds 为健康排除与 enabled=false 之外的已排除站（如调用方
 *     从库里算出的 ok=false 且 30 天未复核站）。
 * @returns { sampled: Array<site & { forced: 0|1|2 }>, record: 抽样记录 }
 */
export function sampleStratified(sites, opts) {
  const seed = opts.seed ?? DRAFT_SEED;
  const quotas = opts.quotas ?? SAMPLE_QUOTAS;
  const overrides = opts.overrides ?? {};
  const excludedIds = opts.excludedIds ?? new Set();
  const generatedAt = opts.generatedAt ?? Date.now();

  const eligible = sites.filter((s) => s.enabled && !excludedIds.has(s.id));
  const excludedEnabledFalse = sites.filter((s) => !s.enabled).length;
  const excludedOther = sites.filter((s) => s.enabled && excludedIds.has(s.id)).length;

  // 类内洗牌（同一 RNG 流、按 navigation.json 的分类出现顺序，保证可复现）
  const rng = mulberry32(seed);
  const byCategory = new Map();
  for (const site of eligible) {
    if (!byCategory.has(site.category)) byCategory.set(site.category, []);
    byCategory.get(site.category).push(site);
  }
  const drawn = new Map();
  for (const [category, quota] of Object.entries(quotas)) {
    const pool = shuffled(byCategory.get(category) ?? [], rng);
    drawn.set(category, pool.slice(0, quota));
  }

  const sampledById = new Map();
  for (const list of drawn.values()) {
    for (const site of list) sampledById.set(site.id, { ...site, forced: 0 });
  }

  const pricingOf = (site) => derivePricingModel(site, overrides).value;
  const forcedRng = mulberry32((seed + 101) >>> 0);
  const forced2Rng = mulberry32((seed + 202) >>> 0);

  const forced = [];
  // 强制站 ①：open_source 定价档（验 license），抵 AI 工具类 1 个随机名额
  const openSourcePool = shuffled(eligible.filter((s) => pricingOf(s) === "open_source"), forcedRng);
  const forced1 = openSourcePool[0] ?? null;
  if (forced1) {
    const already = sampledById.get(forced1.id);
    let replaced = null;
    if (!already) {
      const aiPicks = drawn.get(FORCED_DEDUCT_FROM.openSource) ?? [];
      const victim = aiPicks[aiPicks.length - 1];
      if (victim) {
        sampledById.delete(victim.id);
        replaced = victim.id;
      }
      sampledById.set(forced1.id, { ...forced1, forced: 1 });
    } else {
      already.forced = 1;
    }
    forced.push({
      slot: 1,
      kind: "open_source",
      site_id: forced1.id,
      title: forced1.title,
      deducted_from: FORCED_DEDUCT_FROM.openSource,
      replaced_site_id: replaced,
      already_in_sample: Boolean(already),
      reason: "验 license 字段（open_source 定价档）",
    });
  }

  // 强制站 ②：已有 site_prices 记录的站（验价格 join）；无记录时改抽有明确免费档的站
  let forced2 = null;
  let forced2Kind = null;
  if (opts.pricedSiteIds && opts.pricedSiteIds.size > 0) {
    const pool = shuffled(eligible.filter((s) => opts.pricedSiteIds.has(s.id)), forced2Rng);
    forced2 = pool[0] ?? null;
    forced2Kind = "priced";
  }
  if (!forced2) {
    const pool = shuffled(
      eligible.filter((s) => pricingOf(s) === "free" && s.id !== forced1?.id),
      forced2Rng,
    );
    forced2 = pool[0] ?? null;
    forced2Kind = "free_tier";
  }
  if (forced2) {
    const already = sampledById.get(forced2.id);
    let replaced = null;
    if (!already) {
      const picks = drawn.get(FORCED_DEDUCT_FROM.priced) ?? [];
      const victim = picks[picks.length - 1];
      if (victim && victim.id !== forced1?.id) {
        sampledById.delete(victim.id);
        replaced = victim.id;
      }
      sampledById.set(forced2.id, { ...forced2, forced: 2 });
    } else {
      already.forced = 2;
    }
    forced.push({
      slot: 2,
      kind: forced2Kind,
      site_id: forced2.id,
      title: forced2.title,
      deducted_from: FORCED_DEDUCT_FROM.priced,
      replaced_site_id: replaced,
      already_in_sample: Boolean(already),
      reason:
        forced2Kind === "priced"
          ? "验价格四件套与档案行的 join（已有 site_prices 记录）"
          : "site_prices 无记录，改抽有明确免费档的站（覆盖表 pricing == 'free'）",
    });
  }

  const sampled = [...sampledById.values()];
  const perCategory = {};
  for (const site of sampled) perCategory[site.category] = (perCategory[site.category] ?? 0) + 1;

  // 配额核算（审计用）：强制站计入被抵类的配额，但物理分类是它自己的类，
  // 所以物理分布与配额表有出入是合规的（如 AI 工具 6 物理 + 1 强制 = 7）。
  const quotaNotes = [];
  for (const f of forced) {
    if (f.replaced_site_id) {
      const forcedSite = sampledById.get(f.site_id);
      quotaNotes.push(
        `${f.deducted_from} 配额 ${quotas[f.deducted_from]} = ${quotas[f.deducted_from] - 1} 随机 + 1 强制（${f.site_id}，物理分类 ${forcedSite?.category ?? "?"}，替换 ${f.replaced_site_id}）`,
      );
    } else {
      quotaNotes.push(`${f.deducted_from} 配额 ${quotas[f.deducted_from]}：强制站 ${f.site_id} 已在随机抽中样本内，不占额外名额`);
    }
  }

  const record = {
    generated_at: generatedAt,
    seed,
    base: {
      total_sites: sites.length,
      eligible_sites: eligible.length,
      categories: [...byCategory.keys()],
    },
    quotas,
    site_prices: {
      count: opts.sitePricesCount ?? null,
      measured: opts.sitePricesCount !== null && opts.sitePricesCount !== undefined,
      priced_site_ids_count: opts.pricedSiteIds ? opts.pricedSiteIds.size : 0,
      note: "count 来自 --db 的只读 SELECT COUNT(*)；未传 --db 时为 null，强制站 ② 走免费档分支。",
    },
    forced,
    exclusions: {
      enabled_false: excludedEnabledFalse,
      other_excluded: excludedOther,
      note: "enabled=false 直接排除；健康巡检 ok=false 且 30 天未复核的排除只在调用方传入 excludedIds 时生效（本运行见下方 health_exclusion）。",
    },
    health_exclusion: opts.healthExclusion ?? { applied: false, count: 0, reason: "未传 --db，未应用" },
    per_category: perCategory,
    quota_notes: quotaNotes,
    total_sampled: sampled.length,
    sampled: sampled.map((s) => ({
      site_id: s.id,
      title: s.title,
      href: s.href,
      category: s.category,
      pricing_model: pricingOf(s),
      forced: s.forced,
    })),
  };
  return { sampled, record };
}

/** 只读计量：site_prices 行数 + 有记录的站 id 集 + 健康排除站 id 集。 */
export function measureDb(dbPath) {
  const result = { count: null, pricedSiteIds: new Set(), excludedIds: new Set(), error: null };
  if (!dbPath || !existsSync(dbPath)) {
    result.error = dbPath ? `库文件不存在：${dbPath}` : "未传 --db";
    return result;
  }
  let Database;
  try {
    Database = storeRequire("better-sqlite3");
  } catch (err) {
    result.error = `无法加载 better-sqlite3：${err.message}`;
    return result;
  }
  let db;
  try {
    db = new Database(dbPath, { readonly: true });
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
    );
    if (tables.has("site_prices")) {
      result.count = db.prepare("SELECT COUNT(*) AS n FROM site_prices").get().n;
      for (const row of db.prepare("SELECT DISTINCT site_id FROM site_prices").all()) {
        if (row.site_id) result.pricedSiteIds.add(row.site_id);
      }
    } else {
      result.count = 0;
    }
    if (tables.has("sites")) {
      const cutoff = Date.now() - HEALTH_UNREVIEWED_MS;
      const rows = db
        .prepare(
          "SELECT id FROM sites WHERE health_ok = 0 AND (last_checked_at IS NULL OR last_checked_at < ?)",
        )
        .all(cutoff);
      for (const row of rows) result.excludedIds.add(row.id);
    }
  } catch (err) {
    result.error = `只读计量失败：${err.message}`;
  } finally {
    try {
      db?.close();
    } catch {
      // 忽略关闭错误
    }
  }
  return result;
}

/** --db 入库（仅 --apply 时）：只更新 draft 行，永不覆盖 verified 行。 */
export function upsertDraftsToDb(dbPath, rows) {
  if (!existsSync(dbPath)) return { written: 0, skipped: rows.length, reason: `库文件不存在：${dbPath}` };
  let Database;
  try {
    Database = storeRequire("better-sqlite3");
  } catch (err) {
    return { written: 0, skipped: rows.length, reason: `无法加载 better-sqlite3：${err.message}` };
  }
  const db = new Database(dbPath);
  try {
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
    );
    if (!tables.has("site_profiles")) {
      return { written: 0, skipped: rows.length, reason: "site_profiles 表未落地（W3 未提交），跳过入库" };
    }
    const now = Date.now();
    const insert = db.prepare(
      `INSERT INTO site_profiles
        (site_id, best_for, not_for, license, alternatives, profile_source_url,
         profile_verified_at, verified_by, profile_status, created_at, updated_at)
       VALUES (@site_id, NULL, NULL, @license, NULL, @profile_source_url,
         @profile_verified_at, @verified_by, 'draft', @now, @now)
       ON CONFLICT(site_id) DO NOTHING`,
    );
    const updateDraft = db.prepare(
      `UPDATE site_profiles SET license = @license, profile_source_url = @profile_source_url,
         profile_verified_at = @profile_verified_at, verified_by = @verified_by,
         updated_at = @now WHERE site_id = @site_id AND profile_status = 'draft'`,
    );
    let written = 0;
    const run = db.transaction((list) => {
      for (const row of list) {
        const params = {
          site_id: row.site_id,
          license: row.license,
          profile_source_url: row.profile_source_url,
          profile_verified_at: row.profile_verified_at,
          verified_by: row.verified_by,
          now,
        };
        const info = insert.run(params);
        if (info.changes === 1) {
          written += 1;
        } else {
          const u = updateDraft.run(params);
          if (u.changes === 1) written += 1;
        }
      }
    });
    run(rows);
    return { written, skipped: rows.length - written, reason: null };
  } finally {
    db.close();
  }
}

function parseArgs(argv) {
  const args = { sample: false, apply: false, seed: DRAFT_SEED, out: null, samplingOut: null, db: null, nav: null, overrides: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sample") args.sample = true;
    else if (a === "--apply") args.apply = true;
    else if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--sampling-out") args.samplingOut = argv[++i];
    else if (a === "--db") args.db = argv[++i];
    else if (a === "--nav") args.nav = argv[++i];
    else if (a === "--overrides") args.overrides = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log("用法：node scripts/generate-site-profile-drafts.mjs [--sample] [--apply] [--seed N] [--out <path>] [--sampling-out <path>] [--db <path>] [--nav <path>] [--overrides <path>]");
      process.exit(0);
    } else {
      console.error(`未知参数：${a}`);
      process.exit(2);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const navPath = path.resolve(ROOT, args.nav ?? "apps/web-overlay/src/navsphere/content/navigation.json");
  const overridesPath = path.resolve(ROOT, args.overrides ?? "packages/core/src/pricing-overrides.json");
  const nav = JSON.parse(readFileSync(navPath, "utf8"));
  const overrides = JSON.parse(readFileSync(overridesPath, "utf8"));
  const sites = flattenNavigation(nav);
  const generatedAt = Date.now();

  // 只读计量（不写库）：site_prices 行数 + 健康排除
  let measure = { count: null, pricedSiteIds: new Set(), excludedIds: new Set(), error: "未传 --db" };
  if (args.db) {
    measure = measureDb(path.resolve(ROOT, args.db));
    if (measure.error) console.warn(`[drafts] 计量提示：${measure.error}`);
    else {
      console.log(`[drafts] site_prices COUNT(*) = ${measure.count}（${path.resolve(ROOT, args.db)}）`);
      if (measure.excludedIds.size > 0) {
        console.log(`[drafts] 健康排除 ${measure.excludedIds.size} 站（ok=false 且 30 天未复核）`);
      }
    }
  }

  let targets = sites;
  let samplingRecord = null;
  if (args.sample) {
    const { sampled, record } = sampleStratified(sites, {
      seed: args.seed,
      overrides,
      pricedSiteIds: measure.pricedSiteIds.size > 0 ? measure.pricedSiteIds : null,
      sitePricesCount: measure.count,
      excludedIds: measure.excludedIds,
      generatedAt,
      healthExclusion: args.db
        ? { applied: true, count: measure.excludedIds.size, reason: "按库里 health_ok / last_checked_at" }
        : { applied: false, count: 0, reason: "未传 --db，无健康数据源，未应用" },
    });
    targets = sampled;
    samplingRecord = record;
    console.log(`[drafts] 抽样 ${sampled.length} 站（种子 ${args.seed}）：`);
    for (const [cat, n] of Object.entries(record.per_category)) console.log(`  ${cat}：${n}`);
    for (const f of record.forced) {
      console.log(`  强制站 slot ${f.slot}（${f.kind}）：${f.title}（${f.site_id}），抵 ${f.deducted_from} 随机名额${f.replaced_site_id ? `，替换 ${f.replaced_site_id}` : "，已在抽中样本内"}`);
    }
  }

  const fresh = targets.map((site) => buildDraftRow(site, overrides, generatedAt));
  const byPricing = {};
  for (const row of fresh) byPricing[row.pricing_model] = (byPricing[row.pricing_model] ?? 0) + 1;
  console.log(`[drafts] 草稿 ${fresh.length} 行（pricing_model 分布 ${JSON.stringify(byPricing)}，license 预填 ${fresh.filter((r) => r.license).length} 行，best_for/not_for 全部留空）`);

  if (!args.apply) {
    console.log("[drafts] dry-run：未写任何文件/库。传 --apply 才写。");
    return;
  }

  const outPath = path.resolve(ROOT, args.out ?? "data/site-profile-drafts.json");
  mkdirSync(path.dirname(outPath), { recursive: true });
  let existing = [];
  if (existsSync(outPath)) {
    try {
      existing = JSON.parse(readFileSync(outPath, "utf8")).rows ?? [];
    } catch {
      existing = [];
    }
  }
  const merged = mergeDrafts(existing, fresh);
  writeFileSync(outPath, JSON.stringify({ generated_at: generatedAt, seed: args.seed, rows: merged }, null, 2) + "\n");
  console.log(`[drafts] 草稿 JSON 已写 ${outPath}（${merged.length} 行，verified 行 ${existing.filter((r) => r.profile_status === "verified").length} 行原样保留）`);

  if (samplingRecord) {
    const samplingPath = path.resolve(ROOT, args.samplingOut ?? "data/site-profile-sampling.json");
    mkdirSync(path.dirname(samplingPath), { recursive: true });
    samplingRecord.drafts_file = outPath;
    writeFileSync(samplingPath, JSON.stringify(samplingRecord, null, 2) + "\n");
    console.log(`[drafts] 抽样记录已写 ${samplingPath}`);
  }

  if (args.db) {
    const res = upsertDraftsToDb(path.resolve(ROOT, args.db), fresh);
    if (res.reason) console.warn(`[drafts] 入库跳过：${res.reason}`);
    else console.log(`[drafts] 入库：${res.written} 行写入/更新（draft 行），${res.skipped} 行跳过（verified 行）`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
