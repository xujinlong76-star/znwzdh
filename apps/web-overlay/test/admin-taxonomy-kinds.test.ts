/**
 * 治理队列 UI 与 core 提案类型清单的结构不变量。
 *
 * 背景：`TaxonomyProposalKind` 是闭集，但 UI 的 KIND_META / 筛选器是手写的第二份清单。
 * 新 kind 上线而 UI 漏改时不会报错——提案会带着「未知类型」落进队列，
 * 审核人看不到合适的标签与处置提示。这里把两份清单钉在一起。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TAXONOMY_PROPOSAL_KINDS } from "../../../packages/core/src/taxonomy-governance.ts";

const SRC = readFileSync(
  fileURLToPath(new URL("../src/app/admin/taxonomy/page.tsx", import.meta.url)),
  "utf8",
);

function kindMetaKeys(): string[] {
  const start = SRC.indexOf("const KIND_META");
  const end = SRC.indexOf("export default function AdminTaxonomyPage");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = SRC.slice(start, end);
  return [...block.matchAll(/^ {2}([a-z_]+): \{/gm)].map((m) => m[1]!);
}

describe("admin/taxonomy 治理队列（P6）", () => {
  it("KIND_META 覆盖 core 声明的全部提案类型", () => {
    expect(kindMetaKeys().sort()).toEqual([...TAXONOMY_PROPOSAL_KINDS].sort());
  });

  it("两个类目健康类型都有筛选入口", () => {
    for (const kind of ["leaf_too_small", "duplicate_title"]) {
      expect(SRC).toContain(`id: '${kind}'`);
    }
  });

  it("健康类提案只记录人工决议，按钮文案不承诺自动合并", () => {
    expect(SRC).toContain("proposal.kind === 'leaf_too_small' || proposal.kind === 'duplicate_title'");
    expect(SRC).toContain("'记录决议'");
  });

  it("审计完成后按 kind 汇总展示，而不是只报总数", () => {
    expect(SRC).toContain("res.byKind");
    expect(SRC).toContain("KIND_META[kind as TaxonomyProposal['kind']]");
  });
});
