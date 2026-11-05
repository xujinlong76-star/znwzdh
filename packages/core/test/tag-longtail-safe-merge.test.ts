import { describe, expect, it } from "vitest";
import { auditTagConsolidation } from "../src/taxonomy-governance.ts";

/**
 * 标签长尾治理（item 1）：安全合并候选的安全闸回归。
 *
 * isSafeEditDistanceOne 不可直接调用（非导出），但它的效应完全由 auditTagConsolidation
 * 的产出体现——这是与本仓现有 core 测试一致的观测方式（见 taxonomy-governance.test.ts）。
 * 这里钉死两件事：
 *   1) deep-scan 报告第八节人工逐条核对的 10 条已核准别名/合并候选，审计仍会产出提案
 *      （即它们「通过」了安全闸，不会被漏杀）；
 *   2) 已知会污染数据的坏对（APM→API、编译器→编辑器、pnpm→npm）绝不产出 tag_consolidation 提案。
 */
describe("标签长尾：安全合并候选的安全闸", () => {
  // [低频候选, 高频主标签]，与 deep-scan-report-2026-10-31.md 第八节 10 条一致
  const vettedSafeMerges: Array<[string, string]> = [
    ["国产工具", "国产"],
    ["AI 工具", "AI"],
    ["安全框架", "安全"],
    ["扩展框架", "扩展"],
    ["零运行时", "运行时"],
    ["Web 框架", "Web"],
    ["全栈框架", "全栈"],
    ["多数据库", "数据库"],
    ["高性价比", "性价比"],
    ["终端工具", "终端"],
  ];

  it("10 条已核准候选全部通过安全闸（审计仍产出提案）", () => {
    for (const [lower, higher] of vettedSafeMerges) {
      const proposals = auditTagConsolidation([
        { tag: higher, count: 50 },
        { tag: lower, count: 1 },
      ]);
      const hit = proposals.find(
        (p) => p.currentValue === lower && p.suggestedValue === higher,
      );
      expect(hit, `已核准候选 "${lower}→${higher}" 不应被安全闸漏杀`).toBeDefined();
      expect(hit?.kind).toBe("tag_consolidation");
    }
  });

  it("已知坏对绝不产出 tag_consolidation 提案", () => {
    const mustNotMerge: Array<[string, string]> = [
      ["APM", "API"],
      ["编译器", "编辑器"],
      ["pnpm", "npm"],
    ];
    for (const [lower, higher] of mustNotMerge) {
      const proposals = auditTagConsolidation([
        { tag: higher, count: 50 },
        { tag: lower, count: 1 },
      ]);
      const hit = proposals.find(
        (p) => p.currentValue === lower && p.suggestedValue === higher,
      );
      expect(hit, `不应把 "${lower}" 并入 "${higher}"`).toBeUndefined();
    }
  });
});
