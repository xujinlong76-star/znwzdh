/**
 * Batch 4 Phase 2 P2-5：动态对比 LLM 改造——core 纯函数测试。
 *
 * 覆盖 §5.3 的 core 部分：
 *  - 结构化上下文：分面 label、health 只信 lastCheckedAt、未收录侧为 null、
 *    指纹 A/B 对调不变；
 *  - prompt：结构化事实在前、补充上下文在后、硬指令逐字存在；
 *  - assignComparisonProvenance：精确匹配→measured、改述→model_generated、
 *    空值→unverified、verdict 恒 model_generated、模型自标被忽略、
 *    知识库短路全 measured 且不改原对象；
 *  - buildStructuredMatrix：无 winner、固定 verdict、aiGenerated:false；
 *  - parseTechComparisonQuery：知识库命中即带 measured 标注。
 */
import { describe, expect, it } from "vitest";
import {
  assignComparisonProvenance,
  buildDynamicComparisonPrompt,
  buildStructuredComparisonContext,
  buildStructuredMatrix,
  COMPARISON_KNOWLEDGE_BASE,
  DYNAMIC_COMPARISON_DIMENSIONS,
  DYNAMIC_COMPARISON_HARD_RULES,
  isComparisonMatrixFullyAnnotated,
  parseTechComparisonQuery,
  STRUCTURED_COMPARISON_VERDICT,
  type StructuredComparisonContext,
  type TechComparisonMatrix,
} from "../src/index.ts";
import { getFacetOptionLabel } from "../src/facets.ts";

const LABEL = { facetLabel: getFacetOptionLabel };

const hitA = {
  title: "甲工具",
  url: "https://a.example.com",
  description: "甲工具的描述",
  categoryId: "cat-dev",
  facets: { pricing: ["freemium"], platform: ["web", "ios"], form: ["saas"] },
  health: { ok: true, lastCheckedAt: Date.parse("2026-11-10T00:00:00Z") },
  updatedAt: Date.parse("2026-11-10T00:00:00Z"),
};

const hitB = {
  title: "乙工具",
  url: "https://b.example.com",
  description: "乙工具的描述",
  categoryId: "cat-dev",
  facets: { pricing: ["paid"], platform: ["web"], form: ["desktop"] },
  health: { ok: false, lastCheckedAt: Date.parse("2026-11-09T00:00:00Z") },
  updatedAt: Date.parse("2026-11-09T00:00:00Z"),
};

function llmMatrix(): TechComparisonMatrix {
  return {
    id: "ai-cmp",
    title: "甲工具 vs 乙工具 深度选型对比",
    itemA: {
      name: "甲工具",
      category: "开发工具",
      license: "免费增值",
      primaryPros: ["上手快"],
      tradeoffs: ["高级功能收费"],
      bestFor: "个人开发者",
    },
    itemB: {
      name: "乙工具",
      category: "开发工具",
      license: "商业付费",
      primaryPros: ["功能全"],
      tradeoffs: ["贵"],
      bestFor: "企业团队",
    },
    dimensions: [
      { dimName: "核心能力", valueA: "免费增值", valueB: "商业付费", winner: "TIE" },
      { dimName: "免费与性价比", valueA: "改述过的便宜", valueB: "", winner: "A" },
      { dimName: "上手与生态", valueA: "未验证", valueB: "Web 网页端", winner: "B" },
    ],
    verdict: "按需选",
  };
}

function context(): StructuredComparisonContext {
  return buildStructuredComparisonContext(hitA, hitB, LABEL);
}

describe("buildStructuredComparisonContext", () => {
  it("分面走中文 label：pricing/platform/form 均为 label 而非原值", () => {
    const ctx = context();
    expect(ctx.sideA?.pricing).toEqual(["免费增值"]);
    expect(ctx.sideA?.platform).toEqual(["Web 网页端", "iOS / iPadOS"]);
    expect(ctx.sideB?.pricing).toEqual(["商业付费"]);
    expect(ctx.sideA?.form).toEqual(["在线 SaaS"]);
    expect(ctx.text).toContain("免费增值");
    expect(ctx.text).not.toContain("freemium");
  });

  it("pricing 为 unknown 时不是已核实事实：pricing 为空，文本写未验证", () => {
    const ctx = buildStructuredComparisonContext(
      { ...hitA, facets: { pricing: ["unknown"] } },
      null,
      LABEL,
    );
    expect(ctx.sideA?.pricing).toEqual([]);
    expect(ctx.text).toContain("付费模式：未验证");
  });

  it("health 只信 lastCheckedAt：ok 但从未巡检 → maintenance 为 null", () => {
    const ctx = buildStructuredComparisonContext(
      { ...hitA, health: { ok: true, lastCheckedAt: null } },
      { ...hitB, health: { ok: false, lastCheckedAt: null } },
      LABEL,
    );
    expect(ctx.sideA?.maintenance).toBeNull();
    expect(ctx.sideB?.maintenance).toBeNull();
    expect(ctx.text).toContain("是否还在维护：未验证");
  });

  it("health 有 lastCheckedAt：ok→可达，!ok→不可达，并带核实日期", () => {
    const ctx = context();
    expect(ctx.sideA?.maintenance).toEqual({ status: "可达", lastCheckedAt: Date.parse("2026-11-10T00:00:00Z") });
    expect(ctx.sideB?.maintenance).toEqual({ status: "不可达", lastCheckedAt: Date.parse("2026-11-09T00:00:00Z") });
    expect(ctx.text).toContain("可达（最后核实于 2026-11-10）");
  });

  it("未收录侧为 null，文本明示未验证", () => {
    const ctx = buildStructuredComparisonContext(hitA, null, LABEL);
    expect(ctx.sideB).toBeNull();
    expect(ctx.text).toContain("未收录：站内无此工具的条目");
  });

  it("指纹与查询顺序无关：A/B 对调指纹不变，text 顺序跟随查询", () => {
    const ab = buildStructuredComparisonContext(hitA, hitB, LABEL);
    const ba = buildStructuredComparisonContext(hitB, hitA, LABEL);
    expect(ba.fingerprint).toBe(ab.fingerprint);
    expect(ba.text.indexOf("- 标题：乙工具")).toBeGreaterThan(-1);
    expect(ba.text.indexOf("乙工具")).toBeLessThan(ba.text.indexOf("甲工具"));
  });

  it("分面改动 → 指纹变（缓存失效判据）", () => {
    const before = buildStructuredComparisonContext(hitA, hitB, LABEL);
    const after = buildStructuredComparisonContext(
      { ...hitA, facets: { ...hitA.facets, pricing: ["paid"] } },
      hitB,
      LABEL,
    );
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });
});

describe("buildDynamicComparisonPrompt", () => {
  const prompt = buildDynamicComparisonPrompt("甲工具", "乙工具", context(), "甲工具 (https://a.example.com): 甲工具的描述", "乙工具 (https://b.example.com): 乙工具的描述");

  it("硬指令逐字存在：四条子句缺一不可", () => {
    expect(prompt).toContain("只转述以下结构化事实");
    expect(prompt).toContain("结构化事实里没有的，写‘未验证’，不许编造");
    expect(prompt).toContain("不许新增对照维度");
    expect(prompt).toContain("winner 只能取 A / B / TIE，依据不足时取 TIE");
    expect(prompt).toContain(DYNAMIC_COMPARISON_HARD_RULES);
  });

  it("结构化事实在前、补充上下文在后：title/url/description 只在补充区", () => {
    const structuredAt = prompt.indexOf("【站内已核实结构化事实】");
    const supplementaryAt = prompt.indexOf("【补充上下文");
    expect(structuredAt).toBeGreaterThan(-1);
    expect(supplementaryAt).toBeGreaterThan(structuredAt);
    expect(prompt.indexOf("免费增值")).toBeLessThan(supplementaryAt);
    expect(prompt.indexOf("甲工具 (https://a.example.com)")).toBeGreaterThan(supplementaryAt);
  });

  it("维度白名单即 prompt 里的三维：模型新增维度无处可去", () => {
    for (const dim of DYNAMIC_COMPARISON_DIMENSIONS) {
      expect(prompt).toContain(`"dimName": "${dim}"`);
    }
  });
});

describe("assignComparisonProvenance（LLM 路径）", () => {
  it("分面 label 精确匹配 → measured；改述 → model_generated", () => {
    const out = assignComparisonProvenance(llmMatrix(), context());
    // "免费增值" 逐字等于 A 侧 pricing label；"商业付费" 逐字等于 B 侧 pricing label
    expect(out.dimensions[0]?.provenanceA).toBe("measured");
    expect(out.dimensions[0]?.provenanceB).toBe("measured");
    // "改述过的便宜" 只是意思相近，不是逐字事实
    expect(out.dimensions[1]?.provenanceA).toBe("model_generated");
  });

  it("空值与“未验证” → unverified", () => {
    const out = assignComparisonProvenance(llmMatrix(), context());
    expect(out.dimensions[1]?.provenanceB).toBe("unverified");
    expect(out.dimensions[2]?.provenanceA).toBe("unverified");
  });

  it("平台 label 精确匹配同样 measured（维度不拘于 pricing）", () => {
    const out = assignComparisonProvenance(llmMatrix(), context());
    expect(out.dimensions[2]?.provenanceB).toBe("measured");
  });

  it("license 逐字等于计费档 label → measured；category 自由文本 → model_generated", () => {
    const out = assignComparisonProvenance(llmMatrix(), context());
    expect(out.itemA.provenance?.license).toBe("measured");
    expect(out.itemB.provenance?.license).toBe("measured");
    expect(out.itemA.provenance?.category).toBe("model_generated");
  });

  it("开放文本字段恒为 model_generated：pros/tradeoffs/bestFor 即使撞上事实也不升格", () => {
    const matrix = llmMatrix();
    matrix.itemA.primaryPros = ["免费增值"];
    const out = assignComparisonProvenance(matrix, context());
    expect(out.itemA.provenance?.primaryPros).toBe("model_generated");
    expect(out.itemA.provenance?.tradeoffs).toBe("model_generated");
    expect(out.itemA.provenance?.bestFor).toBe("model_generated");
  });

  it("verdict 恒为 model_generated（非空时）；空 verdict → unverified", () => {
    const out = assignComparisonProvenance(llmMatrix(), context());
    expect(out.verdictProvenance).toBe("model_generated");
    const empty = llmMatrix();
    empty.verdict = "";
    expect(assignComparisonProvenance(empty, context()).verdictProvenance).toBe("unverified");
  });

  it("模型自标 provenance 一律忽略：谎称 measured 的改述仍为 model_generated", () => {
    const matrix = llmMatrix() as TechComparisonMatrix & {
      dimensions: Array<Record<string, unknown>>;
    };
    matrix.dimensions[1]!.provenanceA = "measured";
    matrix.itemA.provenance = { license: "measured", category: "measured" };
    (matrix as Record<string, unknown>).verdictProvenance = "measured";
    const out = assignComparisonProvenance(matrix as TechComparisonMatrix, context());
    expect(out.dimensions[1]?.provenanceA).toBe("model_generated");
    expect(out.itemA.provenance?.category).toBe("model_generated");
    expect(out.verdictProvenance).toBe("model_generated");
  });

  it("不改输入矩阵（返回新对象）", () => {
    const matrix = llmMatrix();
    assignComparisonProvenance(matrix, context());
    expect(matrix.dimensions[0]).not.toHaveProperty("provenanceA");
    expect(matrix.itemA).not.toHaveProperty("provenance");
  });

  it("保守方向：无任何匹配时全员 model_generated，绝不默认 measured", () => {
    const emptyCtx = buildStructuredComparisonContext(null, null, LABEL);
    const out = assignComparisonProvenance(llmMatrix(), emptyCtx);
    for (const d of out.dimensions) {
      expect(["model_generated", "unverified"]).toContain(d.provenanceA);
      expect(["model_generated", "unverified"]).toContain(d.provenanceB);
    }
    expect(out.dimensions.some((d) => d.provenanceA === "measured" || d.provenanceB === "measured")).toBe(false);
  });
});

describe("assignComparisonProvenance（知识库短路）", () => {
  it("知识库矩阵全字段 measured，不伪造基准上下文", () => {
    const kb = COMPARISON_KNOWLEDGE_BASE[0]!;
    const out = assignComparisonProvenance(kb, { sideA: null, sideB: null, text: "", fingerprint: "" }, { source: "knowledge_base" });
    expect(out.verdictProvenance).toBe("measured");
    for (const spec of [out.itemA, out.itemB]) {
      expect(spec.provenance).toEqual({
        category: "measured",
        license: "measured",
        primaryPros: "measured",
        tradeoffs: "measured",
        bestFor: "measured",
      });
    }
    for (const d of out.dimensions) {
      expect(d.provenanceA).toBe("measured");
      expect(d.provenanceB).toBe("measured");
    }
  });

  it("短路不改 COMPARISON_KNOWLEDGE_BASE 原对象", () => {
    const kb = COMPARISON_KNOWLEDGE_BASE[0]!;
    assignComparisonProvenance(kb, { sideA: null, sideB: null, text: "", fingerprint: "" }, { source: "knowledge_base" });
    expect(kb).not.toHaveProperty("verdictProvenance");
    expect(kb.dimensions[0]).not.toHaveProperty("provenanceA");
  });
});

describe("isComparisonMatrixFullyAnnotated", () => {
  it("assign 后的矩阵完整；缺任一标注即不完整", () => {
    expect(isComparisonMatrixFullyAnnotated(assignComparisonProvenance(llmMatrix(), context()))).toBe(true);
    const incomplete = llmMatrix();
    expect(isComparisonMatrixFullyAnnotated(incomplete)).toBe(false);
    const partial = assignComparisonProvenance(llmMatrix(), context());
    delete (partial.dimensions[0] as Partial<typeof partial.dimensions[0]>).provenanceB;
    expect(isComparisonMatrixFullyAnnotated(partial)).toBe(false);
    const noVerdict = assignComparisonProvenance(llmMatrix(), context());
    delete (noVerdict as Partial<typeof noVerdict>).verdictProvenance;
    expect(isComparisonMatrixFullyAnnotated(noVerdict)).toBe(false);
  });
});

describe("buildStructuredMatrix", () => {
  it("维度取分面/健康度并集，值取 label 或未验证", () => {
    const m = buildStructuredMatrix(hitA, hitB, "甲工具", "乙工具", LABEL);
    expect(m.dimensions.map((d) => d.dimName)).toEqual(["付费模式", "支持平台", "产品形态", "是否还在维护"]);
    expect(m.dimensions[0]).toEqual({ dimName: "付费模式", valueA: "免费增值", valueB: "商业付费", provenanceA: "measured", provenanceB: "measured" });
    expect(m.dimensions[3]).toEqual({ dimName: "是否还在维护", valueA: "可达", valueB: "不可达", provenanceA: "measured", provenanceB: "measured" });
  });

  it("winner 一律省略；verdict 为固定句且 verdictProvenance 为 model_generated；aiGenerated 为 false", () => {
    const m = buildStructuredMatrix(hitA, hitB, "甲工具", "乙工具", LABEL);
    expect(m.dimensions.every((d) => d.winner === undefined)).toBe(true);
    expect(m.verdict).toBe(STRUCTURED_COMPARISON_VERDICT);
    expect(m.verdictProvenance).toBe("model_generated");
    expect(m.aiGenerated).toBe(false);
  });

  it("未收录侧全格未验证；其余字段 provenance 为 measured/unverified", () => {
    const m = buildStructuredMatrix(hitA, null, "甲工具", "乙工具", LABEL);
    expect(m.dimensions.every((d) => d.valueB === "未验证" && d.provenanceB === "unverified")).toBe(true);
    expect(m.itemB.name).toBe("乙工具");
    expect(m.itemB.provenance?.category).toBe("unverified");
    expect(m.itemB.provenance?.primaryPros).toBe("unverified");
    expect(m.itemA.provenance?.license).toBe("measured");
    expect(isComparisonMatrixFullyAnnotated(m)).toBe(true);
  });

  it("category 显示分类标题而非原始 categoryId（categoryLabel 传入时）", () => {
    const m = buildStructuredMatrix(hitA, hitB, "甲工具", "乙工具", {
      ...LABEL,
      categoryLabel: (id) => (id === "cat-dev" ? "开发工具" : null),
    });
    expect(m.itemA.category).toBe("开发工具");
    expect(m.itemB.category).toBe("开发工具");
    expect(m.itemA.category).not.toBe("cat-dev");
    expect(m.itemA.provenance?.category).toBe("measured");
    expect(m.itemB.provenance?.category).toBe("measured");
  });

  it("无 categoryLabel 时 category 标“未验证”，不显示原始 categoryId", () => {
    const m = buildStructuredMatrix(hitA, hitB, "甲工具", "乙工具", LABEL);
    expect(m.itemA.category).toBe("未验证");
    expect(m.itemB.category).toBe("未验证");
    expect(m.itemA.provenance?.category).toBe("unverified");
    expect(m.itemB.provenance?.category).toBe("unverified");
  });

  it("categoryLabel 查无此分类 → “未验证”", () => {
    const m = buildStructuredMatrix(hitA, hitB, "甲工具", "乙工具", {
      ...LABEL,
      categoryLabel: () => null,
    });
    expect(m.itemA.category).toBe("未验证");
    expect(m.itemA.provenance?.category).toBe("unverified");
    const empty = buildStructuredMatrix(hitA, hitB, "甲工具", "乙工具", {
      ...LABEL,
      categoryLabel: () => "   ",
    });
    expect(empty.itemA.category).toBe("未验证");
  });
});

describe("parseTechComparisonQuery（知识库命中带标注）", () => {
  it("react vs vue 命中即全字段 measured", () => {
    const m = parseTechComparisonQuery("react vs vue");
    expect(m?.id).toBe("react-vs-vue");
    expect(m?.verdictProvenance).toBe("measured");
    expect(m?.dimensions.every((d) => d.provenanceA === "measured" && d.provenanceB === "measured")).toBe(true);
    expect(m?.itemA.provenance?.license).toBe("measured");
  });

  it("未命中仍为 null", () => {
    expect(parseTechComparisonQuery("react 教程")).toBeNull();
  });
});
