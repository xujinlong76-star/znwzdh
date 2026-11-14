import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURED_COLLECTION_EDITORIALS, coverSiteUrls, getFeaturedEditorial, issueLabel, normalizeSiteUrl, orderUrlsByAct, validateFeaturedEditorial } from "../src/lib/featured-collections";

const HERE = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(resolve(HERE, "..", "..", "api", "src", "seed-data.json"), "utf-8")) as {
  sites: Array<{ url: string; title: string }>;
  collections: Array<{ slug: string; title: string; sites: Array<string | { site?: string; url?: string; note?: string; sort?: number }> }>;
};

function seedCollection(slug: string) {
  return seed.collections.find((c) => c.slug === slug);
}

function seedSiteUrls(col: NonNullable<ReturnType<typeof seedCollection>>): string[] {
  return col.sites.map((s) => (typeof s === "string" ? s : (s.site ?? s.url ?? "")));
}

describe("精选专题编辑层（第 1 笔：列表页 A 壳 + 前 2 个新合集）", () => {
  it("两个新合集都有策展文案且校验通过", () => {
    expect(FEATURED_COLLECTION_EDITORIALS.map((e) => e.slug)).toEqual(["drama-guide", "exam-sprint"]);
    for (const e of FEATURED_COLLECTION_EDITORIALS) {
      expect(validateFeaturedEditorial(e)).toEqual([]);
      expect(e.title.trim().length).toBeGreaterThan(0);
      expect([...e.valueProposition].length).toBeLessThanOrEqual(20);
      expect(e.issueNo).toBe(1);
      expect(issueLabel(e)).toBe("第 1 期");
      expect(e.correctionHref.startsWith("https://github.com/xujinlong76-star/znwzdh/issues/new?title=")).toBe(true);
      expect(getFeaturedEditorial(e.slug)).toBe(e);
    }
  });
  it("策展文案的站点与种子合集的站点一一对应", () => {
    for (const e of FEATURED_COLLECTION_EDITORIALS) {
      const col = seedCollection(e.slug);
      expect(col).toBeDefined();
      expect(col?.title).toBe(e.title);
      const seedUrls = seedSiteUrls(col!);
      const editorialUrls = coverSiteUrls(e);
      expect([...editorialUrls].sort()).toEqual([...seedUrls].sort());
      expect(editorialUrls.length).toBeGreaterThanOrEqual(6);
    }
  });
  it("种子合集的每站都有一句收录理由，且站点都在种子站点表中", () => {
    const known = new Set(seed.sites.map((s) => normalizeSiteUrl(s.url)));
    for (const e of FEATURED_COLLECTION_EDITORIALS) {
      const col = seedCollection(e.slug)!;
      for (const s of col.sites) {
        const url = typeof s === "string" ? s : (s.site ?? s.url ?? "");
        expect(known.has(normalizeSiteUrl(url))).toBe(true);
        if (typeof s !== "string") {
          expect((s.note ?? "").trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
  it("按幕排序不丢站点、不改站数，且第一幕排在第二幕之前", () => {
    for (const e of FEATURED_COLLECTION_EDITORIALS) {
      const col = seedCollection(e.slug)!;
      const ordered = orderUrlsByAct(e, seedSiteUrls(col).map((url) => ({ url })));
      expect(ordered.map((s) => s.url).sort()).toEqual([...seedSiteUrls(col)].sort());
      const firstActFirst = e.acts[0].siteUrls[0];
      const secondActFirst = e.acts[1].siteUrls[0];
      expect(ordered.findIndex((s) => s.url === firstActFirst)).toBeLessThan(ordered.findIndex((s) => s.url === secondActFirst));
    }
  });
  it("列表页 A 壳：今日首映与海报行已接入", () => {
    const board = readFileSync(resolve(HERE, "..", "src", "components", "collection-board.tsx"), "utf-8");
    expect(board).toContain("今日首映");
    expect(board).toContain("精选海报行");
    expect(board).toContain("coverSiteUrls");
    expect(board).toContain("SiteFavicon");
  });
  it("详情页 A 壳：头图带、吸顶目录、按幕分组、编辑手记、相关合集与纠错入口已接入", () => {
    const detail = readFileSync(resolve(HERE, "..", "src", "app", "collections", "[slug]", "collection-detail-view.tsx"), "utf-8");
    expect(detail).toContain("精选专题头图");
    expect(detail).toContain("专题目录");
    expect(detail).toContain("sticky top-0");
    expect(detail).toContain("按幕分组");
    expect(detail).toContain("编辑手记");
    expect(detail).toContain("相关合集");
    expect(detail).toContain('id="correction"');
    expect(detail).toContain("orderedSites");
    expect(detail).toContain("getFeaturedEditorial");
  });
});
