/**
 * N2 B 段换榜验收测试（2026-11-25 04:22 轮 W8）。
 *
 * 数据口径（W2 0422 §5.2，已核实才写）：
 * - A 组抖音热播榜前十 + B 组搜短剧热播榜前五：数据日期 2026-11-18
 *   （搜短剧 2026-11-19 文章）；C 组红果真人新剧榜：只核实到 2026-11-16 版
 *   （电影界 2026-11-16 文章），不得写 11-18。
 * - 去重：少夫人 3、嫌疑人的秘密 2 在 A/C 两组重合，只收一次——
 *   18 槽位实收 17 部（DRAMA_FEATURED_MAX = 18 是上限不是定额）。
 * - 禁用：163 自媒体文“红果热播榜”与 8.1/9.5/9.2 评分；“双榜”两张榜说法；
 *   “今日榜单”“最新榜单”等暗示数据为今日的字样；第 4/5/7/8/10 名指数不得编。
 *
 * 渲染用 renderToString（node 环境、无 jsdom，effect 不跑），钩子与 next/link
 * 用 vi.mock 隔离（与 drama-due-badge.test.ts 同配方）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DramaContent } from "../src/components/drama-content";
import {
  loadDramaFeatured,
  parseDramaFeatured,
} from "../src/lib/drama-featured.ts";
import type { DramaSite } from "../src/lib/drama-sites";

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_TEXT = readFileSync(
  join(HERE, "..", "src/navsphere/content/drama-featured.json"),
  "utf8",
);

// next/link 在 node 测试环境没有 Next 运行时：替成直通 <a>，只保留 href/文案。
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: ({ href, children, ...props }: { href?: string; children?: React.ReactNode }) =>
      React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...props },
        children,
      ),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

const watchlistState = vi.hoisted(() => ({
  ready: true,
  entries: [] as never[],
  storageBlocked: null as string | null,
}));

vi.mock("@/hooks/useWatchlist", () => ({
  useWatchlist: () => ({
    ready: watchlistState.ready,
    entries: watchlistState.entries,
    storageBlocked: watchlistState.storageBlocked,
    isWatching: () => false,
    findByPlatformAndTitle: () => undefined,
    add: () => null,
    setEpisode: () => false,
    update: () => false,
    dismissToday: () => false,
    remove: () => undefined,
    replaceAll: () => false,
    resetLocal: () => ({ backedUp: true }),
  }),
}));

vi.mock("@/hooks/useDramaData", () => ({
  useDramaRankings: () => ({ kind: "loading" as const }),
  useDramaCalendar: () => ({ kind: "loading" as const }),
}));

vi.mock("@/hooks/useDramaCheckStates", () => ({
  useDramaCheckStates: () => ({ ready: true, byKey: new Map() }),
}));

afterAll(() => {
  vi.resetModules();
});

const SITES: DramaSite[] = [
  { id: "nav-557388e01d50", title: "红果短剧", href: "https://www.hongguo.com" },
];

function renderDrama(featuredUpdatedAt?: string | null): string {
  const { dramas } = loadDramaFeatured();
  return renderToString(
    createElement(DramaContent, { sites: SITES, dramas, featuredUpdatedAt }),
  );
}

describe("parseDramaFeatured updatedAt 透传", () => {
  it("真实文件透传 2026-11-18", () => {
    expect(loadDramaFeatured().updatedAt).toBe("2026-11-18");
  });

  it("缺失 updatedAt 时为 null，不编造日期", () => {
    const { updatedAt } = parseDramaFeatured({ dramas: [] });
    expect(updatedAt).toBeNull();
  });

  it("非法 updatedAt（非 YYYY-MM-DD / 非字符串）时为 null", () => {
    expect(parseDramaFeatured({ updatedAt: "2026/11/18", dramas: [] }).updatedAt).toBeNull();
    expect(parseDramaFeatured({ updatedAt: 20261118, dramas: [] }).updatedAt).toBeNull();
    expect(parseDramaFeatured({ updatedAt: "  ", dramas: [] }).updatedAt).toBeNull();
  });

  it("顶层不是对象时 updatedAt 为 null", () => {
    expect(parseDramaFeatured(null).updatedAt).toBeNull();
    expect(parseDramaFeatured("x").updatedAt).toBeNull();
  });
});

describe("换榜清单：标题与已核实来源一致（B1）", () => {
  const A_TOP10 = [
    "穿越八零，我把娘俩宠成宝",
    "持械入宋：第十一季",
    "全球死考：刚下刑场你让我去考试一季",
    "帐中香第二季",
    "和离后我带女儿横扫魔域",
    "少夫人来自东北 3",
    "聚宝仙盆之杂灵根才是真BOSS 第十六季",
    "烛九阴第九季",
    "嫌疑人的秘密2藏金生死线",
    "莞城人生",
  ];
  const B_TOP5 = [
    "王妈在顾家当保姆后全家只会搞笑了",
    "认下混混老爹，我一路青云",
    "卖掉养老房那天，我重获新生",
    "迟来的情缘，董事长的暖心妻",
    "高考出分后女儿劝我离婚",
  ];
  // C 组只新增这两部：少夫人 3、嫌疑人的秘密 2 已在 A 组，去重后不重复收录。
  const C_NEW = ["小镇是非多之同床异梦", "十八岁太奶奶驾到，重整家族荣耀 第五部"];

  it("17 部、标题无重复，A 组 10 + B 组 5 + C 组新增 2", () => {
    const { dramas, skipped } = loadDramaFeatured();
    expect(skipped).toBe(0);
    expect(dramas).toHaveLength(17);
    const titles = dramas.map((d) => d.title);
    expect(new Set(titles).size).toBe(17);
    for (const t of [...A_TOP10, ...B_TOP5, ...C_NEW]) {
      expect(titles).toContain(t);
    }
  });

  it("抖音榜前三在场：穿越八零 / 持械入宋 / 全球死考", () => {
    const titles = loadDramaFeatured().dramas.map((d) => d.title);
    expect(titles.slice(0, 3)).toEqual([
      "穿越八零，我把娘俩宠成宝",
      "持械入宋：第十一季",
      "全球死考：刚下刑场你让我去考试一季",
    ]);
  });

  it("季数已核对：聚宝仙盆为第十六季，清单内无第十五季；和离后未写季数", () => {
    const titles = loadDramaFeatured().dramas.map((d) => d.title);
    expect(titles).toContain("聚宝仙盆之杂灵根才是真BOSS 第十六季");
    expect(titles.join(" ")).not.toContain("第十五季");
    expect(titles).toContain("和离后我带女儿横扫魔域");
  });

  it("每部有来源链接与 check.reason（来源 + 数据日期写在 reason 里）", () => {
    const { dramas } = loadDramaFeatured();
    for (const d of dramas) {
      expect(d.url).toMatch(/^https?:\/\//);
      expect(d.check.kind).toBe("none");
      expect(d.check.reason ?? "").toMatch(/2026-11-1[68]/);
    }
    const byTitle = new Map(dramas.map((d) => [d.title, d.check.reason ?? ""]));
    // C 组两部的 reason 标 2026-11-16，不得写 11-18。
    expect(byTitle.get("小镇是非多之同床异梦")).toContain("2026-11-16");
    expect(byTitle.get("小镇是非多之同床异梦")).not.toContain("2026-11-18");
    expect(byTitle.get("十八岁太奶奶驾到，重整家族荣耀 第五部")).toContain("2026-11-16");
    expect(byTitle.get("十八岁太奶奶驾到，重整家族荣耀 第五部")).not.toContain("2026-11-18");
    // A/B 组条目标 2026-11-18。
    expect(byTitle.get("穿越八零，我把娘俩宠成宝")).toContain("2026-11-18");
    expect(byTitle.get("王妈在顾家当保姆后全家只会搞笑了")).toContain("2026-11-18");
  });
});

describe("禁用内容不在场（B6/B7）", () => {
  it("JSON 全文无 163 自媒体说法、无 8.1/9.5/9.2 评分、无双榜与今日/最新榜单字样", () => {
    expect(JSON_TEXT).not.toContain("红果热播榜");
    expect(JSON_TEXT).not.toContain("双榜");
    expect(JSON_TEXT).not.toContain("今日榜单");
    expect(JSON_TEXT).not.toContain("最新榜单");
    expect(JSON_TEXT).not.toContain("163.com");
    expect(JSON_TEXT).not.toContain("评分 8.1");
    expect(JSON_TEXT).not.toContain("评分 9.5");
    expect(JSON_TEXT).not.toContain("评分 9.2");
  });
});

describe("热门剧区渲染：数据日期 + 三榜口径（B2/B3）", () => {
  const CALIBER =
    "抖音热播榜、搜短剧热播榜、红果真人新剧榜是三套统计口径，第一名不是同一部剧";

  it("渲染数据日期 2026-11-18，新剧榜部分另标 2026-11-16", () => {
    const html = renderDrama("2026-11-18");
    expect(html).toContain("数据日期 2026-11-18");
    expect(html).toContain("红果真人新剧榜部分：数据日期 2026-11-16");
  });

  it("口径说明在场，逐字可验收", () => {
    const html = renderDrama("2026-11-18");
    expect(html).toContain(CALIBER);
    expect(html).toContain("《王妈》在搜短剧热播榜排第 1，在抖音榜只排第 95");
    expect(html).toContain("抖音 TOP100 里 AI 短剧 44 部、漫剧 41 部、真人剧仅 15 部");
    expect(html).toContain("在抖音榜标 AI 短剧，在红果站内标漫剧，两套标签都保留、不改判");
  });

  it("热门剧卡片渲染新榜标题与已核实集数", () => {
    const html = renderDrama("2026-11-18");
    expect(html).toContain("穿越八零，我把娘俩宠成宝");
    expect(html).toContain("全 317 集 · 已完结");
    expect(html).toContain("全 113 集 · 已完结");
    expect(html).toContain("全 785 集 · 已完结");
    expect(html).toContain("全 86 集 · 已完结");
    expect(html).toContain("已更 88 集");
    expect(html).toContain("已更 63 集");
    expect(html).toContain("集数未核实");
  });

  it("updatedAt 缺失时不渲染编造的 11-18 日期", () => {
    const html = renderDrama(null);
    expect(html).not.toContain("数据日期 2026-11-18");
  });

  it("渲染结果无禁用字样", () => {
    const html = renderDrama("2026-11-18");
    expect(html).not.toContain("双榜");
    expect(html).not.toContain("红果热播榜");
    expect(html).not.toContain("今日榜单");
    expect(html).not.toContain("最新榜单");
    expect(html).not.toContain("评分 8.1");
    expect(html).not.toContain("评分 9.5");
    expect(html).not.toContain("评分 9.2");
  });
});
