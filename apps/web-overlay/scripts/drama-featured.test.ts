import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectDramaSites } from "../src/lib/drama-sites";
import {
  featuredDramaKey,
  loadDramaFeatured,
  parseDramaFeatured,
} from "../src/lib/drama-featured";
import { dramaKeyFor } from "../src/lib/watchlist";
import baselineNavigation from "../src/navsphere/content/navigation.json";

const goodEntry = {
  title: "示例剧",
  platformSiteId: "nav-557388e01d50",
  platformTitle: "红果短剧",
  url: "https://example.com/drama",
  linkNote: "剧目页",
  episodesKnown: 10,
  totalEpisodes: null,
  check: { kind: "none", reason: "示例：剧目页不含集数" },
};

describe("parseDramaFeatured", () => {
  it("收有效行、跳过坏行并计数", () => {
    const bad = [
      { ...goodEntry, title: "" },
      { ...goodEntry, url: "not-a-url" },
      { ...goodEntry, linkNote: "正片" },
      { ...goodEntry, check: { kind: "none" } },
      { ...goodEntry, check: { kind: "ranking" } },
      { ...goodEntry, episodesKnown: 20, totalEpisodes: 10 },
      { ...goodEntry, check: { kind: "bogus", url: "https://example.com" } },
    ];
    const { dramas, skipped } = parseDramaFeatured({
      version: 1,
      updatedAt: "2026-11-12",
      dramas: [goodEntry, ...bad],
    });
    expect(dramas).toHaveLength(1);
    expect(dramas[0].title).toBe("示例剧");
    expect(skipped).toBe(7);
  });

  it("首屏最多 12 部，顶层损坏时返回空列表", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({
      ...goodEntry,
      title: `示例剧 ${i + 1}`,
    }));
    expect(parseDramaFeatured({ dramas: many }).dramas).toHaveLength(12);
    expect(parseDramaFeatured(null)).toEqual({ dramas: [], skipped: 0 });
    expect(parseDramaFeatured({})).toEqual({ dramas: [], skipped: 0 });
  });

  it("剧目键与追剧清单同一把键", () => {
    const { dramas } = parseDramaFeatured({ dramas: [goodEntry] });
    expect(featuredDramaKey(dramas[0])).toBe(
      dramaKeyFor("nav-557388e01d50", "示例剧"),
    );
  });
});

describe("loadDramaFeatured", () => {
  it("随仓库发布的剧目文件能校验通过", () => {
    const { dramas, skipped } = loadDramaFeatured();
    expect(skipped).toBe(0);
    expect(dramas).toHaveLength(12);
    const kinds = new Map<string, number>();
    for (const d of dramas) kinds.set(d.check.kind, (kinds.get(d.check.kind) ?? 0) + 1);
    expect(kinds.get("ranking")).toBe(3);
    expect(kinds.get('none')).toBe(9);
    const titles = dramas.map((d) => d.title);
    expect(titles).toContain('悍妻当家，靠美食扶起一家软骨头');
    expect(titles.some((t) => t.includes('念记老卤'))).toBe(false);
    const hanqi = dramas.find((d) => d.title.includes('悍妻当家'));
    expect(hanqi?.episodesKnown).toBe(177);
    expect(hanqi?.totalEpisodes).toBe(177);
    expect(hanqi?.platformSiteId).toBe('nav-557388e01d50');
    for (const drama of dramas) {
      expect(drama.url).toMatch(/^https:\/\//);
      if (drama.check.kind !== "none") {
        expect(drama.check.url).toMatch(/^https:\/\//);
      } else {
        expect(drama.check.reason).toBeTruthy();
      }
    }
  });
});
describe("drama page structure", () => {
  it("平台区收满 12 条，7 家 App-only 文案写了需在 App 内观看", () => {
    const sites = collectDramaSites(baselineNavigation.navigationItems);
    expect(sites).toHaveLength(12);
    const appOnly = sites.filter((s) =>
      (s.description ?? "").includes("需在") &&
      (s.description ?? "").includes("App 内观看"),
    );
    expect(appOnly).toHaveLength(7);
    for (const site of sites) {
      expect(site.href).toMatch(/^https:\/\//);
    }
  });

  it("专区页是服务端组件取数 + 客户端岛 + revalidate 60", () => {
    const page = readFileSync(
      fileURLToPath(new URL("../src/app/drama/page.tsx", import.meta.url)),
      "utf-8",
    );
    expect(page).toContain("export const revalidate = 60");
    expect(page).toContain("collectDramaSites");
    expect(page).toContain("loadDramaFeatured");
    expect(page).toContain("DramaContentLazy");
    expect(page).toContain("getFileContent");
  });

  it("footer、sitemap、影院入口都指向 /drama", () => {
    const read = (rel: string) =>
      readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");
    expect(read("../src/components/footer.tsx")).toContain('href="/drama"');
    expect(read("../src/lib/seo/sitemap-entries.ts")).toContain("/drama");
    expect(read("../src/components/home-drama-cinema.tsx")).toContain(
      'href="/drama"',
    );
  });

  it("关注按钮预填剧名、剧目区挂关注按钮", () => {
    const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");
    const button = read("../src/components/watchlist-add-button.tsx");
    expect(button).toContain("defaultTitle");
    expect(button).toContain("useState(defaultTitle ?? '')");
    const content = read("../src/components/drama-content.tsx");
    expect(content).toContain("WatchListAddButton");
    expect(content).toContain("defaultTitle={drama.title}");
    expect(content).toContain("featuredDramaKey");
  });
});
