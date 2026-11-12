/**
 * relations.ts 覆盖：SKOS 概念转换与站点关系规范化。
 *
 * 该文件此前没有任何测试引用（7.69% 行覆盖）：类目转 SKOS 的 URI/层级
 * 逻辑与关系类型白名单没有任何回归保护。
 */
import { describe, expect, it } from "vitest";
import {
  categoryToSkosConcept,
  CONTROLLED_RELATION_TYPES,
  normalizeSiteRelation,
} from "../src/relations.ts";
import type { Category } from "../src/types.ts";

function cat(over: Record<string, unknown> = {}): Category {
  return {
    id: "c1",
    title: "开发工具",
    anchor: "dev",
    enabled: true,
    ...over,
  } as unknown as Category;
}

describe("CONTROLLED_RELATION_TYPES", () => {
  it("七种受控关系齐全；对称性与反向关系符合定义", () => {
    expect(Object.keys(CONTROLLED_RELATION_TYPES).sort()).toEqual([
      "alternative",
      "complementary",
      "ecosystem",
      "mirror",
      "part_of",
      "related",
      "upstream",
    ]);
    expect(CONTROLLED_RELATION_TYPES.alternative.symmetric).toBe(true);
    expect(CONTROLLED_RELATION_TYPES.part_of).toMatchObject({ symmetric: false, inverse: "contains" });
    expect(CONTROLLED_RELATION_TYPES.upstream).toMatchObject({ symmetric: false, inverse: "downstream" });
    expect(CONTROLLED_RELATION_TYPES.mirror.symmetric).toBe(true);
  });
});

describe("categoryToSkosConcept", () => {
  it("基本映射：URI 用 slug、prefLabel 中英、notation 取 anchor", () => {
    const concept = categoryToSkosConcept(
      cat({ slug: "dev-tools", titleEn: "Dev Tools", description: "开发相关", altLabels: ["dev"] }),
      [],
    );
    expect(concept).toMatchObject({
      "@context": "http://www.w3.org/2004/02/skos/core#",
      "@type": "Concept",
      id: "c1",
      uri: "https://navhub.local/categories/dev-tools",
      prefLabel: { zh: "开发工具", en: "Dev Tools" },
      altLabel: ["dev"],
      definition: "开发相关",
      broader: undefined,
      narrower: [],
      related: [],
      notation: "dev",
    });
  });

  it("slug 为空/空白时 URI 回退到 id；无 titleEn 时 en 为 undefined", () => {
    const noSlug = categoryToSkosConcept(cat({ slug: undefined }), []);
    expect(noSlug.uri).toBe("https://navhub.local/categories/c1");
    expect(noSlug.prefLabel.en).toBeUndefined();
    const blankSlug = categoryToSkosConcept(cat({ slug: "   " }), []);
    expect(blankSlug.uri).toBe("https://navhub.local/categories/c1");
  });

  it("自定义 baseUri；父子层级：启用的子分类进 narrower，禁用的不进", () => {
    const parent = cat({ id: "p1", parentId: "root" });
    const concept = categoryToSkosConcept(
      parent,
      [
        cat({ id: "child1", parentId: "p1", enabled: true }),
        cat({ id: "child2", parentId: "p1", enabled: false }),
        cat({ id: "other", parentId: "someone-else", enabled: true }),
      ],
      "https://example.com/cats/",
    );
    expect(concept.uri).toBe("https://example.com/cats/p1");
    expect(concept.broader).toBe("root");
    expect(concept.narrower).toEqual(["child1"]);
  });

  it("relatedCategories 与缺失的可选字段", () => {
    const concept = categoryToSkosConcept(
      cat({ relatedCategories: ["c2", "c3"], description: "", altLabels: undefined }),
      [],
    );
    expect(concept.related).toEqual(["c2", "c3"]);
    expect(concept.altLabel).toEqual([]);
    expect(concept.definition).toBeUndefined();
  });
});

describe("normalizeSiteRelation", () => {
  it("缺少目标标题或 URL 时返回 null（含纯空白）", () => {
    expect(normalizeSiteRelation({})).toBeNull();
    expect(normalizeSiteRelation({ targetTitle: "X" })).toBeNull();
    expect(normalizeSiteRelation({ targetUrl: "https://x.com" })).toBeNull();
    expect(normalizeSiteRelation({ targetTitle: "  ", targetUrl: "https://x.com" })).toBeNull();
    expect(normalizeSiteRelation({ targetTitle: "X", targetUrl: "   " })).toBeNull();
  });

  it("最小输入走默认值：related、非开源、confidence 1.0", () => {
    expect(
      normalizeSiteRelation({ targetTitle: " Penpot ", targetUrl: " https://penpot.app " }),
    ).toEqual({
      id: undefined,
      sourceSiteId: undefined,
      targetSiteId: null,
      targetTitle: "Penpot",
      targetUrl: "https://penpot.app",
      relationType: "related",
      isFreeOrOpenSource: false,
      note: undefined,
      confidence: 1.0,
      createdAt: undefined,
      updatedAt: undefined,
    });
  });

  it("显式关系类型：合法的保留，非法的回退 related", () => {
    const base = { targetTitle: "X", targetUrl: "https://x.com" };
    expect(normalizeSiteRelation({ ...base, relationType: "alternative" })?.relationType).toBe("alternative");
    expect(normalizeSiteRelation({ ...base, relationType: "part_of" })?.relationType).toBe("part_of");
    expect(normalizeSiteRelation({ ...base, relationType: "nonsense" as never })?.relationType).toBe("related");
  });

  it("confidence 钳制到 [0,1]，非数字时默认 1.0；note 去空白", () => {
    const base = { targetTitle: "X", targetUrl: "https://x.com" };
    expect(normalizeSiteRelation({ ...base, confidence: 2 })?.confidence).toBe(1);
    expect(normalizeSiteRelation({ ...base, confidence: -0.5 })?.confidence).toBe(0);
    expect(normalizeSiteRelation({ ...base, confidence: 0.75 })?.confidence).toBe(0.75);
    expect(normalizeSiteRelation({ ...base, confidence: "high" as never })?.confidence).toBe(1.0);
    expect(normalizeSiteRelation({ ...base, note: "  很好用  " })?.note).toBe("很好用");
    // 注意：纯空白 note 是真值，trim 后得到 "" 而不是 undefined（与 title/url 的
    // 空白即 null 不同）；此处锁定现状，不改行为。
    expect(normalizeSiteRelation({ ...base, note: "   " })?.note).toBe("");
    expect(
      normalizeSiteRelation({ ...base, isFreeOrOpenSource: true, id: "r1", sourceSiteId: "s1" }),
    ).toMatchObject({ isFreeOrOpenSource: true, id: "r1", sourceSiteId: "s1" });
  });
});
