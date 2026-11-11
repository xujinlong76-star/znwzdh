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
import { derivePricing, type PricingValue } from "@navhub/core";
import type { AppContext } from "./context.ts";

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
    alreadyLabeled: 0,
    byValue: {},
    bySource: { override: 0, rule: 0, unknown: 0 },
  };
  for (const site of sites) {
    const facets = site.facets ?? {};
    if ((facets.pricing?.length ?? 0) > 0) {
      report.alreadyLabeled += 1;
    } else {
      const derived = derivePricing({
        url: site.url,
        title: site.title ?? undefined,
        description: site.description ?? undefined,
        tags: site.tags,
      });
      await ctx.repo.fillSiteFacetIfAbsent(site.id, "pricing", derived.value);
      report.filledPricing += 1;
      report.byValue[derived.value] = (report.byValue[derived.value] ?? 0) + 1;
      report.bySource[derived.source] += 1;
    }
    if ((facets.platform?.length ?? 0) === 0) {
      await ctx.repo.fillSiteFacetIfAbsent(site.id, "platform", "web");
      report.filledPlatform += 1;
    }
  }
  return report;
}

/** 报告压成一行日志文本（seed / storage 两处调用点共用）。 */
export function formatFacetBackfillReport(report: FacetBackfillReport): string {
  return (
    `扫描 ${report.scanned} 站：补 pricing ${report.filledPricing} 条` +
    `（人工核实表 ${report.bySource.override} / 强信号规则 ${report.bySource.rule} / 未标注 ${report.bySource.unknown}），` +
    `补 platform=web ${report.filledPlatform} 条，已有标注跳过 ${report.alreadyLabeled} 站`
  );
}
