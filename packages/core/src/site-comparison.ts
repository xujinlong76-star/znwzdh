/**
 * 跨站对照：纯函数组装（Batch 4 Phase 1 第 1 项）。
 *
 * 只接 plain 数据（Site + 收藏备注/标签），不碰仓储、不发请求、不调 LLM：
 * REST（GET /api/compare）与 MCP（compare_sites）各自取数后共用这一份组装，
 * 两端不再复制维度逻辑。
 *
 * 七个维度（设计 §3.1 六维 + P2-2 价格数值格）：
 *   pricing     计费方式：site_facets.pricing，中文 label 走 getFacetOptionLabel；
 *               `unknown` 如实显示“未标注”，不推断。
 *   price       价格数值：用户手工填写或官方页抓取的 site_prices 记录；
 *               四件套（金额/货币/周期/核实日期）缺一件不出数值，pricing
 *               定性档照旧兜底；90 天标 stale、180 天降级 expired（见
 *               getPriceStaleness / priceCell）；不参与任何排序、打分、推荐。
 *   platform    支持平台：site_facets.platform（多值，中文 label 数组）。
 *   form        形态：site_facets.form（多值，中文 label 数组）。
 *   maintenance 是否还在维护：Site.health.lastCheckedAt + ok；
 *               “未验证”只能看 lastCheckedAt == null——health_ok 为 NULL 时
 *               ok 会折为 false，与巡检失败不可区分，绝不能用 ok === false 推断。
 *               来源标注“健康巡检”+时间戳。
 *   note        我的备注：favorites.note 原文。
 *   migration   迁移成本：用户填写；第一期无独立字段，来源为用户备注/标签
 *               （有备注用备注原文，无备注用标签）；两者都空则留空标“未验证”，不编造。
 *
 * 每个格子 `{ value, source, verified, verifiedAt }`：缺失时 value 为 null、
 * verified 为 false、verifiedAt 为 null，前端据此渲染“未验证”。不设 winner、
 * 不排名、不打分。
 */
import { getFacetOptionLabel } from "./facets.ts";
import { isBotBlockedHealthRecord } from "./probe-policy.ts";
import type { Site } from "./types.ts";

/** 对照表里的一个格子：值 + 来源 + 是否已验证 + 来源数据的核实时间（毫秒戳）。 */
export interface ComparisonCell {
  value: string | string[] | null;
  source: string;
  verified: boolean;
  verifiedAt: number | null;
  /** 仅 maintenance 格：健康巡检原始时间戳（与 verifiedAt 相同，单独列出供调用方直接取用）。 */
  lastCheckedAt?: number | null;
  /**
   * 仅 price 格：90–180 天未核实的“可能过期”标记（verified 仍为 true）。
   * expired（>180 天）时 verified 为 false、stale 不置位，值仍保留供灰显。
   */
  stale?: boolean;
  /** 仅 price 格：该价格的官方定价页 URL（有它前端才启用“从官方定价页抓取”）。 */
  sourceUrl?: string | null;
  /**
   * 仅 price 格：编辑表单回填用的原始记录字段（快照冻结时一并存下，
   * 值与 value 里的格式化串同源，不另作他用）。
   */
  amountMinor?: number;
  currency?: string;
  period?: string;
  freeTierLimit?: string | null;
}

/** 一站的对照行：七个维度各一格（Phase 1 六格 + P2-2 价格数值格）。 */
export interface SiteComparisonItem {
  siteId: string;
  title: string;
  url: string;
  pricing: ComparisonCell;
  platform: ComparisonCell;
  form: ComparisonCell;
  maintenance: ComparisonCell;
  note: ComparisonCell;
  migration: ComparisonCell;
  price: ComparisonCell;
}

/** 价格数值记录的 plain 形态（store 的 SitePriceRecord 的对照子集，不依赖 store 包）。 */
export interface SitePriceEntry {
  amountMinor: number;
  currency: string;
  period: string;
  freeTierLimit: string | null;
  sourceType: "manual" | "official_scrape";
  sourceUrl: string | null;
  verifiedAt: number;
}

/** 组装所需的收藏侧 plain 数据（FavoriteRecord 的对照子集，不依赖 store 包）。 */
export interface SiteComparisonFavorite {
  siteId: string;
  note: string | null;
  tags: string[] | null;
  updatedAt: number;
}

export interface SiteComparisonInput {
  site: Site;
  favorite: SiteComparisonFavorite;
  /** 本站的价格数值记录（无记录传 null/undefined → price 格“未验证”）。 */
  price?: SitePriceEntry | null;
}

const FACET_SOURCE = "站点分面";
const NOTE_SOURCE = "我的备注";
const HEALTH_SOURCE = "健康巡检";
const PRICE_MANUAL_SOURCE = "手工填写";
const PRICE_SCRAPE_SOURCE = "官方定价页";

/** 价格过期三档（Batch 4 Phase 2 P2-2，服务端算，REST / MCP / 快照三端一致）。 */
export type PriceStaleness = "fresh" | "stale" | "expired";

export const PRICE_FRESH_DAYS = 90;
export const PRICE_STALE_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 价格核实新鲜度：age ≤ 90 天 → fresh；90 天 < age ≤ 180 天 → stale；
 * age > 180 天 → expired。边界锁：90 天整 = fresh，180 天整 = stale，
 * 180 天 +1ms = expired。now 默认 Date.now()，测试可注入。
 */
export function getPriceStaleness(verifiedAt: number, now: number = Date.now()): PriceStaleness {
  const age = now - verifiedAt;
  if (age <= PRICE_FRESH_DAYS * DAY_MS) return "fresh";
  if (age <= PRICE_STALE_DAYS * DAY_MS) return "stale";
  return "expired";
}

const PRICE_CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  HKD: "HK$",
  AUD: "A$",
  CAD: "C$",
  SGD: "S$",
  KRW: "₩",
};

/** 无小数位货币（最小单位即本位）：金额不除以 100。 */
const PRICE_ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW"]);

const PRICE_PERIOD_SUFFIXES: Record<string, string> = {
  month: "/月",
  year: "/年",
  once: "/次",
  usage: "/用量",
};

/** 金额格式化：去尾零（1990 → 19.9，2000 → 20，1999 → 19.99）。 */
function formatPriceAmount(amountMinor: number, currency: string): string {
  if (PRICE_ZERO_DECIMAL_CURRENCIES.has(currency)) return String(amountMinor);
  const major = amountMinor / 100;
  return Number.isInteger(major) ? String(major) : major.toFixed(2).replace(/0$/, "");
}

/**
 * 价格数值格式化（core 纯函数，三端共用，不在前端各写一份）：
 * 例：`¥19.9/月 · 免费档100次/月`。未列出的货币走 currency 代码本身。
 */
export function formatSitePrice(entry: SitePriceEntry): string {
  const symbol = PRICE_CURRENCY_SYMBOLS[entry.currency] ?? entry.currency;
  const suffix = PRICE_PERIOD_SUFFIXES[entry.period] ?? "";
  const base = `${symbol}${formatPriceAmount(entry.amountMinor, entry.currency)}${suffix}`;
  const freeTier = entry.freeTierLimit?.trim();
  return freeTier ? `${base} · 免费档${freeTier}` : base;
}

/**
 * 价格数值格：四件套（amount / currency / period / verifiedAt）缺一件
 * → 不出价格格（未验证），`pricing` 定性档照旧兜底。
 * fresh → verified: true；stale → verified: true + stale: true；
 * expired → verified: false，值仍保留（灰显用），source 与 verifiedAt 保留。
 */
function priceCell(price: SitePriceEntry | null | undefined, now: number): ComparisonCell {
  const source = price?.sourceType === "official_scrape" ? PRICE_SCRAPE_SOURCE : PRICE_MANUAL_SOURCE;
  if (
    !price ||
    !Number.isFinite(price.amountMinor) ||
    !price.currency?.trim() ||
    !price.period?.trim() ||
    !Number.isFinite(price.verifiedAt)
  ) {
    return { value: null, source, verified: false, verifiedAt: null, sourceUrl: price?.sourceUrl ?? null };
  }
  const staleness = getPriceStaleness(price.verifiedAt, now);
  const detail = {
    amountMinor: price.amountMinor,
    currency: price.currency,
    period: price.period,
    freeTierLimit: price.freeTierLimit,
  };
  if (staleness === "expired") {
    return {
      value: formatSitePrice(price),
      source,
      verified: false,
      verifiedAt: price.verifiedAt,
      sourceUrl: price.sourceUrl,
      ...detail,
    };
  }
  return {
    value: formatSitePrice(price),
    source,
    verified: true,
    verifiedAt: price.verifiedAt,
    ...(staleness === "stale" ? { stale: true } : {}),
    sourceUrl: price.sourceUrl,
    ...detail,
  };
}

function unverifiedCell(source: string): ComparisonCell {
  return { value: null, source, verified: false, verifiedAt: null };
}

function pricingCell(site: Site): ComparisonCell {
  const raw = site.facets?.pricing?.map((v) => v.trim().toLowerCase()).filter(Boolean) ?? [];
  const value = raw[0];
  // unknown / 缺失都如实显示“未标注”：pricing 是 derivePricing 保证每站必有的
  // 数据完备性标记，unknown = 尚未核实标注，不是“免费”。
  if (!value || value === "unknown") {
    return { value: getFacetOptionLabel("pricing", "unknown"), source: FACET_SOURCE, verified: false, verifiedAt: null };
  }
  // 分面没有独立的核实时间戳：取站点记录最后更新时间作来源日期。
  return { value: getFacetOptionLabel("pricing", value), source: FACET_SOURCE, verified: true, verifiedAt: site.updatedAt };
}

function multiFacetCell(site: Site, key: "platform" | "form"): ComparisonCell {
  const values = site.facets?.[key]?.map((v) => v.trim().toLowerCase()).filter(Boolean) ?? [];
  if (values.length === 0) return unverifiedCell(FACET_SOURCE);
  return {
    value: values.map((v) => getFacetOptionLabel(key, v)),
    source: FACET_SOURCE,
    verified: true,
    verifiedAt: site.updatedAt,
  };
}

function maintenanceCell(site: Site): ComparisonCell {
  const lastCheckedAt = site.health?.lastCheckedAt ?? null;
  if (lastCheckedAt == null) {
    // 从未巡检过：verified 只能看 lastCheckedAt，ok 此时恒为 false（NULL 折叠），
    // 绝不能据此写成“已停更”或“不可达”。
    return { value: null, source: HEALTH_SOURCE, verified: false, verifiedAt: null, lastCheckedAt: null };
  }
  if (isBotBlockedHealthRecord(site.health?.error)) {
    // WAF/风控拦截（U-13）：站点在线但拒绝巡检抓取，本次没取到内容。
    // ok=false 在这里是“拒绝我们”，不是“站点已死”——写成已核实的“不可达”
    // 会把活站判死；按未验证处理（与 verify.ts 手动验证口径一致），
    // lastCheckedAt 保留，供调用方知道“上次试过是在何时”。
    return { value: null, source: HEALTH_SOURCE, verified: false, verifiedAt: null, lastCheckedAt };
  }
  return {
    value: site.health?.ok ? "可达" : "不可达",
    source: HEALTH_SOURCE,
    verified: true,
    verifiedAt: lastCheckedAt,
    lastCheckedAt,
  };
}

function noteCell(favorite: SiteComparisonFavorite): ComparisonCell {
  const note = favorite.note?.trim() ? favorite.note : null;
  if (!note) return unverifiedCell(NOTE_SOURCE);
  return { value: note, source: NOTE_SOURCE, verified: true, verifiedAt: favorite.updatedAt };
}

function migrationCell(favorite: SiteComparisonFavorite): ComparisonCell {
  // 第一期无独立字段：迁移成本只能来自用户自己写的东西（备注原文优先，标签次之）。
  // 两者都空就留空标“未验证”——没有可验证的迁移信息时，宁可空着也不编造。
  const note = favorite.note?.trim() ? favorite.note : null;
  if (note) return { value: note, source: NOTE_SOURCE, verified: true, verifiedAt: favorite.updatedAt };
  const tags = (favorite.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (tags.length > 0) return { value: tags, source: "我的标签", verified: true, verifiedAt: favorite.updatedAt };
  return unverifiedCell(NOTE_SOURCE);
}

/**
 * 按入参顺序组装对照行（调用方负责按请求 siteIds 顺序传入，并先做本人收藏校验）。
 * now 仅供测试注入过期边界，生产调用方不传（默认 Date.now()）。
 * 价格数值不参与任何排序、打分、推荐——本函数只拼格子。
 */
export function buildSiteComparison(items: SiteComparisonInput[], now: number = Date.now()): SiteComparisonItem[] {
  return items.map(({ site, favorite, price }) => ({
    siteId: site.id,
    title: site.title,
    url: site.url,
    pricing: pricingCell(site),
    platform: multiFacetCell(site, "platform"),
    form: multiFacetCell(site, "form"),
    maintenance: maintenanceCell(site),
    note: noteCell(favorite),
    migration: migrationCell(favorite),
    price: priceCell(price, now),
  }));
}
