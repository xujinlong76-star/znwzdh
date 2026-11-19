/**
 * 分面回填服务（DEV_BACKLOG A3）：给缺失分面的站点补推导值。
 *
 * 接入点（都走既有通道，不另起机制）：
 * 1. seed.ts runSeed 结尾——冷启动后整库补齐，docker 首次启动即有数据；
 * 2. storage.ts writeNavigationData 的 post-commit 阶段——每次快照写回
 *    （后台导入/编辑保存）后对全库 heal，新增站点自动获得标注。
 *
 * 纪律（与 packages/core/src/pricing.ts 同源）：
 * - 只填空缺（fillSiteFacetIfAbsent），已有值——尤其管理员手标——永不覆盖；
 * - pricing 每站必落一个值：人工核实覆盖表 > 强信号规则 > unknown 显式
 *   「未标注」，绝不猜；platform 只补无条件真值 web（本站收录标准即
 *   「可在线访问的网址」，见覆盖表文件头与 backfill 脚本同一口径）；
 * - 本服务失败不该拖垮调用方主流程：调用点各自 try/catch 只记日志。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { derivePricing, type PricingOverride, type PricingOverrides, type PricingValue } from "@navhub/core";
import { chunkList, inPredicate } from "@navhub/store";
import type { AppContext } from "./context.ts";

/**
 * 人工核实覆盖表：进程启动时读一次（core 零 IO，覆盖表由宿主注入）。
 * 寻址走 @navhub/core 包入口所在目录（pricing-overrides.json 与 core
 * 源码同目录），不依赖本文件所在位置——开发与生产都直跑 TS 源码，
 * 但包入口解析比相对路径更不怕将来构建形态变化。
 * 注意：不能 resolve "@navhub/core/package.json"，该包 exports 只开放
 * "." 子路径。读不到/解析失败时响亮失败：绝不静默降级为空表，否则回填
 * 会把应命中覆盖表的站写成 unknown，而 fill-if-absent 会让错误值永久粘住。
 */
function loadPricingOverrides(): PricingOverrides {
  const coreRequire = createRequire(import.meta.url);
  const coreEntry = coreRequire.resolve("@navhub/core");
  const jsonPath = join(dirname(coreEntry), "pricing-overrides.json");
  try {
    return JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, PricingOverride>;
  } catch (err) {
    throw new Error(`pricing 覆盖表加载失败（${jsonPath}）：${(err as Error).message}；回填拒绝静默降级为空表`, { cause: err });
  }
}

const PRICING_OVERRIDES = loadPricingOverrides();

export interface FacetBackfillSite {
  id: string;
  url: string;
  title?: string | null;
  description?: string | null;
  tags?: string[];
  facets?: Record<string, string[]>;
}

export interface FacetBackfillReport {
  scanned: number;
  /** 本次新写入的 pricing 行数。 */
  filledPricing: number;
  /** 本次新写入的 platform=web 行数。 */
  filledPlatform: number;
  /** 本次新写入的 requires_account=unknown 行数（02-site-profiles）。 */
  filledRequiresAccount: number;
  /** 本次新写入的 free_trial=unknown 行数（02-site-profiles）。 */
  filledFreeTrial: number;
  /** 本次新写入的 data_export=unknown 行数（02-site-profiles）。 */
  filledDataExport: number;
  /** 已有 pricing、本次跳过的站点数（保护人工标注）。 */
  alreadyLabeled: number;
  /** 新写入 pricing 的值分布。 */
  byValue: Partial<Record<PricingValue, number>>;
  /** 新写入 pricing 的来源分布：override=人工核实表 / rule=强信号规则 / unknown=显式未标注。 */
  bySource: { override: number; rule: number; unknown: number };
}

export async function backfillDerivedFacets(
  ctx: AppContext,
  sites: FacetBackfillSite[],
): Promise<FacetBackfillReport> {
  const report: FacetBackfillReport = {
    scanned: sites.length,
    filledPricing: 0,
    filledPlatform: 0,
    filledRequiresAccount: 0,
    filledFreeTrial: 0,
    filledDataExport: 0,
    alreadyLabeled: 0,
    byValue: {},
    bySource: { override: 0, rule: 0, unknown: 0 },
  };
  // 结构化档案新键（02-site-profiles §7.1）：缺省 unknown，已有人类标注
  // 永不覆盖（fill-if-absent 纪律）。批量写：逐站逐键 fill 会在一次 8k
  // 站写回里发 ~2.4 万条语句（每条自带一次提交/fsync），实测把
  // navigation-write-bulk 的 8k 原样保存从 ~9.5s 拖到 ~23s（L3，
  // 2026-11-20）；改成每键按 500 切片的 INSERT...SELECT，语义与逐站
  // fill-if-absent 逐字一致（同一批 id 集合、同一 NOT EXISTS 判据，
  // 复活站点仍由调用方在 healSites 里排除，本函数不另扩范围）。
  const missingByKey: Record<"requires_account" | "free_trial" | "data_export", string[]> = {
    requires_account: [],
    free_trial: [],
    data_export: [],
  };
  for (const site of sites) {
    const facets = site.facets ?? {};
    if ((facets.pricing?.length ?? 0) > 0) {
      report.alreadyLabeled += 1;
    } else {
      const derived = derivePricing(
        {
          url: site.url,
          title: site.title ?? undefined,
          description: site.description ?? undefined,
          tags: site.tags,
        },
        PRICING_OVERRIDES,
      );
      await ctx.repo.fillSiteFacetIfAbsent(site.id, "pricing", derived.value);
      report.filledPricing += 1;
      report.byValue[derived.value] = (report.byValue[derived.value] ?? 0) + 1;
      report.bySource[derived.source] += 1;
    }
    if ((facets.platform?.length ?? 0) === 0) {
      await ctx.repo.fillSiteFacetIfAbsent(site.id, "platform", "web");
      report.filledPlatform += 1;
    }
    // unknown 是合法值：拿不准填 unknown，绝不猜——回填只补“未核实”标记，
    // 确定值一律由人工核实流程写。这里只收集缺失站 id，循环结束后再批量写。
    for (const key of ["requires_account", "free_trial", "data_export"] as const) {
      if ((facets[key]?.length ?? 0) === 0) missingByKey[key].push(site.id);
    }
  }
  for (const [key, counter] of [
    ["requires_account", "filledRequiresAccount"],
    ["free_trial", "filledFreeTrial"],
    ["data_export", "filledDataExport"],
  ] as const) {
    const ids = [...new Set(missingByKey[key])];
    for (const chunk of chunkList(ids)) {
      const pred = inPredicate("s.id", chunk);
      await ctx.repo.run(
        `INSERT INTO site_facets (site_id, facet_key, facet_value)
         SELECT s.id, ?, ? FROM sites s
          WHERE ${pred.sql}
            AND NOT EXISTS (
              SELECT 1 FROM site_facets f
               WHERE f.site_id = s.id AND f.facet_key = ?
            )`,
        [key, "unknown", ...pred.params, key],
      );
      report[counter] += chunk.length;
    }
  }
  return report;
}

/** 报告压成一行日志文本（seed / storage 两处调用点共用）。 */
export function formatFacetBackfillReport(report: FacetBackfillReport): string {
  return (
    `扫描 ${report.scanned} 站：补 pricing ${report.filledPricing} 条` +
    `（人工核实表 ${report.bySource.override} / 强信号规则 ${report.bySource.rule} / 未标注 ${report.bySource.unknown}），` +
    `补 platform=web ${report.filledPlatform} 条，` +
    `补 requires_account=unknown ${report.filledRequiresAccount} 条、` +
    `补 free_trial=unknown ${report.filledFreeTrial} 条、` +
    `补 data_export=unknown ${report.filledDataExport} 条，` +
    `已有标注跳过 ${report.alreadyLabeled} 站`
  );
}
