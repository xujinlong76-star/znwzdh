/**
 * 付费模式（pricing 分面）推导 —— DEV_BACKLOG A3。
 *
 * 背景：pricing 分面的筛选管道全通、数据近乎为空（回填脚本从未进部署链路），
 * 且旧脚本规则是「描述里有『免费』两字就判 free」这类弱信号，会把收费站误标
 * 免费——比不标更坏（用户筛「免费」点进去要付费）。本模块是全仓唯一的推导
 * 实现，API 回填服务与 scripts/backfill-facets.mjs 共用同一数据源与规则口径：
 *
 * 1. 人工核实覆盖表（pricing-overrides.json，按 URL 键）：每条带 evidence
 *    注记（站内描述原文 / 开源仓库 / 官网定价页口径），优先级最高；
 * 2. 强信号规则（收紧版）：只认无歧义的措辞（开源、明示免费模式、会员/
 *    付费解锁、订阅制等），裸「免费」二字不作数；
 * 3. 都不命中 → unknown（显式「未标注」），绝不猜。
 *
 * 写入侧一律 fill-if-absent：已有的 pricing（管理员手标、种子数据）永不被
 * 推导结果覆盖。覆盖表维护方式：新增站点先查官网定价页/仓库许可证，能核实
 * 才入表并写明 evidence；核实不了就不入表，自然落 unknown。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 数据文件用 readFileSync 读（与 seed.ts 读 seed-data.json 同一模式）：API 是
// Node 直跑 TS 源码，裸 JSON import 需要 import attribute 且各运行时口径不一。
const overridesJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "pricing-overrides.json"), "utf8"),
) as Record<string, PricingOverride>;

export type PricingValue = "free" | "freemium" | "paid" | "open_source" | "unknown";

export interface PricingOverride {
  pricing: Exclude<PricingValue, "unknown">;
  /** 证据注记：这条定性依据什么可核对的来源。 */
  evidence: string;
  /** 覆盖表撰写时的站名，仅供人读对照，不参与匹配。 */
  title?: string;
}

export const PRICING_OVERRIDES: Readonly<Record<string, PricingOverride>> = overridesJson;

/**
 * URL → 覆盖表键：小写 host（去掉 www. 前缀）+ 路径（去掉尾部斜杠），
 * 不含协议与查询串。github.com 这类共享域名靠路径区分不同仓库；
 * 生成覆盖表与运行时匹配必须用同一函数，避免两边口径漂移。
 */
export function pricingOverrideKey(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return host + path;
  } catch {
    return null;
  }
}

export function lookupPricingOverride(rawUrl: string): PricingOverride | null {
  const key = pricingOverrideKey(rawUrl);
  if (!key) return null;
  return PRICING_OVERRIDES[key] ?? null;
}

export interface PricingSignalInput {
  url: string;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface PricingDerivation {
  value: PricingValue;
  source: "override" | "rule" | "unknown";
  evidence?: string;
}

/**
 * 强信号规则（按序匹配，先到先得）。顺序即优先级：
 * 开源 > 免费增值 > 完全免费 > 商业付费。
 *
 * 与旧回填脚本规则的关键差异（收紧点）：
 * - 不再用裸 /免费/ 判 free：描述里出现「免费」太常见（免费试用、免费版
 *   引流），单凭二字无法区分 free 与 freemium；
 * - 免费增值信号必须先于完全免费判定：「前几集免费、会员解锁」含「免费」
 *   但本质是 freemium；
 * - 付费侧只认「订阅制/付费购买」这类整体定性词，不用 /付费|商业|订阅/
 *   裸词（一句「无付费墙」都会误伤）。
 */
const PRICING_RULES: Array<{ value: Exclude<PricingValue, "unknown">; pattern: RegExp; note: string }> = [
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

export function derivePricing(input: PricingSignalInput): PricingDerivation {
  const override = lookupPricingOverride(input.url);
  if (override) return { value: override.pricing, source: "override", evidence: override.evidence };
  const blob = [input.title ?? "", input.description ?? "", ...(input.tags ?? [])].join(" ");
  for (const rule of PRICING_RULES) {
    if (rule.pattern.test(blob)) return { value: rule.value, source: "rule", evidence: rule.note };
  }
  return { value: "unknown", source: "unknown" };
}
