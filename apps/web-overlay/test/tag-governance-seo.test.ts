import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeTagData,
  applyTagStyle,
  canonicalizeTagName,
  checkGovernance,
  normalizeTagKey,
  slugifyTag,
} from "../../../scripts/normalize-tags.mjs";
import {
  isTagSynonymAlias,
  resolveCanonicalTagSlug,
} from "../src/lib/seo/tag-taxonomy";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("标签规范词典：大小写/空格与同义词单一口径", () => {
  it.each([
    ["ai编程", "AI 编程"],
    ["AI 编程", "AI 编程"],
    ["ai搜索", "AI 搜索"],
    ["rag架构", "RAG 架构"],
    ["RAG", "RAG 架构"],
    ["Postgres", "PostgreSQL"],
    ["postgresql", "PostgreSQL"],
    ["自建", "自托管"],
    ["高性价比", "性价比"],
    ["桌面", "桌面端"],
    ["跨端", "跨平台"],
    ["边缘", "边缘计算"],
    ["大语言模型", "大模型"],
    ["配音", "AI 配音"],
    ["智能配音", "AI 配音"],
    ["语音合成", "AI 配音"],
    ["TTS", "AI 配音"],
    ["ai赋能", "AI 赋能"],
    ["k12 与升学", "K12 与升学"],
    ["ui 资源素材", "UI 资源素材"],
    ["bi 与报表", "BI 与报表"],
    ["seo 与增长", "SEO 与增长"],
    ["e2e", "E2E"],
    ["mcp体系", "MCP 体系"],
    ["3d 与 ar 设计", "3D 与 AR 设计"],
  ])("canonicalizeTagName(%s) === %s", (raw, expected) => {
    expect(canonicalizeTagName(raw)).toBe(expected);
  });

  it("品牌名不被缩写词典误伤，且归一化幂等", () => {
    expect(applyTagStyle("OpenAI")).toBe("OpenAI");
    expect(applyTagStyle("PostgreSQL")).toBe("PostgreSQL");
    for (const raw of ["ai编程", "AI 视频", "rag架构", "k12 与升学", "e2e"]) {
      const once = canonicalizeTagName(raw);
      expect(canonicalizeTagName(once)).toBe(once);
    }
  });

  it("旧 slug 解析到规范 slug；规范形态不再产生别名跳转", () => {
    expect(resolveCanonicalTagSlug("ai编程")).toBe("ai-编程");
    expect(resolveCanonicalTagSlug("Postgres")).toBe("postgresql");
    expect(resolveCanonicalTagSlug("rag架构")).toBe("rag-架构");
    expect(resolveCanonicalTagSlug("postgresql")).toBeNull();
    expect(isTagSynonymAlias("ai编程")).toBe(true);
  });

  it("slugifyTag 与 store slugify 同构（保留中文）", () => {
    expect(slugifyTag("AI 编程")).toBe("ai-编程");
    expect(slugifyTag("天气")).toBe("天气");
    expect(slugifyTag("")).toBe("tag");
    expect(normalizeTagKey(" #AI-编程 ")).toBe("ai编程");
  });
});

describe("标签治理分析：纯函数可用于数据门禁", () => {
  const snapshot = {
    rootCategoryTitles: ["消费生活", "AI 工具"],
    activeSiteIds: ["s1", "s2", "s3"],
    tags: [
      { id: "t1", name: "消费生活", slug: "消费生活" },
      { id: "t2", name: "AI 工具", slug: "ai-工具" },
      { id: "t3", name: "ai编程", slug: "ai编程" },
      { id: "t4", name: "AI 编程", slug: "ai-编程" },
      { id: "t5", name: "ai赋能", slug: "ai赋能" },
    ],
    siteTags: [
      { siteId: "s1", tagId: "t1", categoryTitle: "消费生活" },
      { siteId: "s2", tagId: "t1", categoryTitle: "消费生活" },
      { siteId: "s3", tagId: "t1", categoryTitle: "AI 工具" },
      { siteId: "s1", tagId: "t2", categoryTitle: "AI 工具" },
      { siteId: "s1", tagId: "t3", categoryTitle: "AI 工具" },
      { siteId: "s2", tagId: "t4", categoryTitle: "消费生活" },
      { siteId: "s2", tagId: "t5", categoryTitle: "消费生活" },
      // 同一站点同一标签的重复关联（site_tags 没有唯一约束）
      { siteId: "s2", tagId: "t5", categoryTitle: "消费生活" },
    ],
  };

  it("剥离所属一级大类同名标签，并合并同义词/大小写分裂", () => {
    const analysis = analyzeTagData(snapshot);
    expect(analysis.summary.rootCategories).toBe(2);
    expect(analysis.summary.categoryDuplicateAssociations).toBe(4);
    expect(analysis.summary.mergeGroups).toBe(1);
    expect(analysis.summary.duplicateAssociations).toBe(1);
    expect(analysis.summary.tagsBefore).toBe(5);
    expect(analysis.summary.tagsAfter).toBe(4);

    const aiGroup = [...analysis.groups.values()].find((g: any) => g.key === "ai编程");
    expect(aiGroup?.canonicalName).toBe("AI 编程");
    expect(String(aiGroup?.target.id)).toBe("t4");
    expect(analysis.afterCounts.get("t4")).toBe(2);
    expect(analysis.merges[0]).toMatchObject({ from: "ai编程", to: "AI 编程" });
  });

  it("checkGovernance 在治理前报违规、治理后无违规", () => {
    const before = checkGovernance(analyzeTagData(snapshot));
    expect(before.categoryDuplicates.length).toBeGreaterThan(0);
    expect(before.merges.length).toBeGreaterThan(0);
    expect(before.normalizations.length).toBeGreaterThan(0);

    const clean = analyzeTagData({
      rootCategoryTitles: ["消费生活"],
      activeSiteIds: ["s1"],
      tags: [{ id: "a", name: "Rust", slug: "rust" }],
      siteTags: [{ siteId: "s1", tagId: "a", categoryTitle: "前端开发" }],
    });
    const after = checkGovernance(clean);
    expect(after.categoryDuplicates).toHaveLength(0);
    expect(after.merges).toHaveLength(0);
    expect(after.normalizations).toHaveLength(0);
  });
});

describe("标签页 SEO 防薄页与规范 URL", () => {
  it("索引门槛为 3，页面与 sitemap 共用同一个常量", () => {
    const thresholds = overlayFile("src/lib/seo/thresholds.ts");
    expect(thresholds).toMatch(/export const MIN_SITES_FOR_TAG_INDEX = 3\b/);
    expect(overlayFile("src/app/sitemap.ts")).toContain(
      "tagEntries(origin, tags ?? [], MIN_SITES_FOR_TAG_INDEX)",
    );
    expect(overlayFile("src/lib/seo/sitemap-entries.ts")).toContain("count < minSites");
  });

  it("薄标签输出 noindex,follow，并保留 follow 传递内链权重", () => {
    const page = overlayFile("src/app/tags/[slug]/page.tsx");
    expect(page).toContain("robots: { index: false, follow: true }");
    expect(page).toMatch(/sites\.length\s*>=\s*MIN_SITES_FOR_TAG_INDEX/);
  });

  it("旧同义词 URL 走 308 规范重定向，且重定向早于 0 命中 404", () => {
    const page = overlayFile("src/app/tags/[slug]/page.tsx");
    expect(page).toContain("permanentRedirect");
    expect(page).toContain("isTagSynonymAlias(safeSlug)");
    expect(page).toMatch(/resolveCanonicalTagSlug\(safeSlug\)/);
    const redirectAt = page.indexOf("permanentRedirect(`/tags/");
    const notFoundAt = page.indexOf("if (res !== null && sites.length === 0) notFound()");
    expect(redirectAt).toBeGreaterThan(-1);
    expect(notFoundAt).toBeGreaterThan(redirectAt);
  });
});
