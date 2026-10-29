/**
 * 点击证据与 `sites.visit_count` 的**只读对账**（纯函数）。
 *
 * 为什么要对账：`visit_count` 是热度排序的次键（`sites_hot_idx` 按
 * `enabled, trend_score DESC` 之外还要看它），但本机实测 99.8% 的站点该列为 0。
 * 这个读数有两种完全相反的解释——「没人点」与「点了没送到」——只看计数分不出来。
 * 对账把两侧放在一张表上：
 *   - `visit_count > 0` 但零条 `kind=click` 证据：计数发生在证据链路之前，
 *     或证据被保留策略清掉了，或某条写入路径绕过了 `/api/events`；
 *   - 有 `kind=click` 证据但 `visit_count = 0`：`bumpVisit` 没跑（重放被去重是
 *     **预期**行为，不是缺陷），或写入失败。
 *
 * 口径（引用读数时必须一起给出）：
 *   - 所有比率都只是**线索**，不是结论：本机样本量小，且两侧的时间窗不同
 *     （`visit_count` 是终身累计，事件按保留策略滚动清理）；
 *   - 结果必须带行数与查询时刻，否则数字无法复现。
 *
 * 这里只做形状与汇总，不做任何判断性修复——调用方（脚本）只打印，不改库。
 */

export interface ClickReconcileSiteInput {
  siteId: string;
  title: string | null;
  visitCount: number;
  /** 该站点在事件表里的 kind=click 行数（不含 click_delivery） */
  clickEvents: number;
}

export interface ClickReconcileGap {
  siteId: string;
  title: string | null;
  visitCount: number;
  clickEvents: number;
  /** visitCount - clickEvents；正数 = 有计数没证据，负数 = 有证据没计数 */
  gap: number;
}

export interface ClickDeliveryTally {
  outcome: string;
  code: string;
  count: number;
}

export interface ClickReconcileSummary {
  sitesScanned: number;
  totalVisitCount: number;
  totalClickEvents: number;
  sitesWithVisitCount: number;
  sitesWithClickEvidence: number;
  /** visit_count > 0 且零点击证据 */
  visitedWithoutEvidence: number;
  /** 有点击证据且 visit_count = 0 */
  clicksWithoutVisitCount: number;
  /** 两侧都非零但数值不同 */
  mismatchedBothSides: number;
  /** 按 |gap| 倒序的前 limit 个站点（只列确实有差值的） */
  topGaps: ClickReconcileGap[];
  delivery: ClickDeliveryTally[];
}

export const CLICK_RECONCILE_TOP_GAPS = 20;

function safeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 汇总两侧读数。输入已是逐站点的聚合行，函数本身不碰数据库、不读时钟。
 */
export function summarizeClickReconcile(
  sites: ClickReconcileSiteInput[],
  delivery: ClickDeliveryTally[] = [],
  limit = CLICK_RECONCILE_TOP_GAPS,
): ClickReconcileSummary {
  let totalVisitCount = 0;
  let totalClickEvents = 0;
  let sitesWithVisitCount = 0;
  let sitesWithClickEvidence = 0;
  let visitedWithoutEvidence = 0;
  let clicksWithoutVisitCount = 0;
  let mismatchedBothSides = 0;
  const gaps: ClickReconcileGap[] = [];

  for (const site of sites) {
    const visitCount = safeInt(site.visitCount);
    const clickEvents = safeInt(site.clickEvents);
    totalVisitCount += visitCount;
    totalClickEvents += clickEvents;
    if (visitCount > 0) sitesWithVisitCount += 1;
    if (clickEvents > 0) sitesWithClickEvidence += 1;
    if (visitCount > 0 && clickEvents === 0) visitedWithoutEvidence += 1;
    if (clickEvents > 0 && visitCount === 0) clicksWithoutVisitCount += 1;
    if (visitCount > 0 && clickEvents > 0 && visitCount !== clickEvents) mismatchedBothSides += 1;
    if (visitCount !== clickEvents) {
      gaps.push({
        siteId: site.siteId,
        title: site.title,
        visitCount,
        clickEvents,
        gap: visitCount - clickEvents,
      });
    }
  }

  gaps.sort(
    (a, b) =>
      Math.abs(b.gap) - Math.abs(a.gap) ||
      b.visitCount - a.visitCount ||
      a.siteId.localeCompare(b.siteId),
  );

  const cappedLimit = Math.max(1, Math.min(200, Math.floor(limit) || CLICK_RECONCILE_TOP_GAPS));
  const deliveryTally = delivery
    .map((row) => ({
      outcome: String(row.outcome ?? ""),
      code: String(row.code ?? ""),
      count: safeInt(row.count),
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.outcome.localeCompare(b.outcome) || a.code.localeCompare(b.code));

  return {
    sitesScanned: sites.length,
    totalVisitCount,
    totalClickEvents,
    sitesWithVisitCount,
    sitesWithClickEvidence,
    visitedWithoutEvidence,
    clicksWithoutVisitCount,
    mismatchedBothSides,
    topGaps: gaps.slice(0, cappedLimit),
    delivery: deliveryTally,
  };
}
