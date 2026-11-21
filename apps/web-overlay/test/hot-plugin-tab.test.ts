/**
 * /hot 插件 tab（P2-10）：
 *
 * 缺陷：/hot 只有 fetchTrendingMeta(30)/fetchNewSites(30) 两路站点数据，
 * tab 只有 trending/new，全文件 0 处 plugin/marketplace——插件排行
 * 在热榜页完全不可见，进市场的入口也没有。
 *
 * 修复：/hot 加「插件排行」tab，复用市场已有的四组排行（与市场首页
 * 同 endpoint、同 limit=5）：
 *   trending = 市场默认排序「7 天飙升榜」（sort=trending）
 *   popular  = 安装榜（sort=popular）
 *   rating   = 口碑榜（sort=rating）
 *   fresh    = 新作榜（sort=new）
 * 行内指标走市场共用的 rankingMetric（trending 与 popular 同口径报
 * 真实安装数，不编造飙升分）；行点击进市场详情页 /marketplace/{slug}，
 * 空态与底部都有「去插件市场 / 查看全部插件」入口。
 *
 * 锁：
 *  1. 服务端 page.tsx 取四组插件排行并下发给 HotView；
 *  2. HotView 有 plugins tab（?tab=plugins 可分享/可返回），四组
 *     标题 + rankingMetric + 详情内链俱全；
 *  3. 插件 tab 内容 forceMount：排行内链与空态回市场入口进首屏 HTML，
 *     不等点击才出现；
 *  4. 插件取数失败只影响插件 tab（pluginDegraded），不污染站点榜 degraded。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { rankingMetric } from "../src/lib/plugins/marketplace-rankings";
import type { HubPluginItem } from "../src/lib/navhub-api";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

function fakePlugin(overrides: Partial<HubPluginItem>): HubPluginItem {
  return {
    id: "p1",
    slug: "fake-pack",
    name: "Fake Pack",
    description: "测试用插件",
    version: "1.0.0",
    source: "seed",
    status: "published",
    installCount: 0,
    starCount: 0,
    reportCount: 0,
    createdAt: 0,
    updatedAt: 0,
    manifest: {},
    ...overrides,
  } as unknown as HubPluginItem;
}

describe("P2-10：服务端取市场四组排行", () => {
  const src = overlaySource("src/app/hot/page.tsx");

  it("四组与市场首页同 endpoint、同 limit=5", () => {
    for (const sort of ["trending", "popular", "rating", "new"]) {
      expect(src).toContain(`/api/plugins?sort=${sort}&limit=\${PLUGIN_RANK_LIMIT}`);
    }
    expect(src).toMatch(/PLUGIN_RANK_LIMIT = 5/);
  });

  it("四组下发给 HotView，插件失败只记 pluginDegraded、不污染站点榜 degraded", () => {
    expect(src).toContain("initialPluginRankings={pluginRankings}");
    expect(src).toContain("pluginDegraded={pluginDegraded}");
    expect(src).toContain("degraded: trendingRes === null || freshRes === null");
    expect(src).toContain("pluginTrendingRes === null");
  });
});

describe("P2-10：插件 tab 与四组排行渲染", () => {
  const src = overlaySource("src/app/hot/hot-view.tsx");

  it("有 plugins tab，?tab=plugins 可分享、可返回", () => {
    expect(src).toContain('<TabsTrigger value="plugins"');
    expect(src).toContain("插件排行");
    expect(src).toContain("t === 'plugins'");
    expect(src).toContain("params.set('tab', 'plugins')");
  });

  it("四组标题与 rankingMetric 口径俱全", () => {
    for (const [key, title] of [
      ["trending", "飙升榜"],
      ["popular", "安装榜"],
      ["rating", "口碑榜"],
      ["fresh", "新作榜"],
    ] as const) {
      expect(src).toContain(`'${title}'`);
      expect(src).toContain(`rankingMetric('${key}'`);
    }
  });

  it("行点击进市场详情页（站内链），不是外链", () => {
    expect(src).toContain("href={`/marketplace/${encodeURIComponent(p.slug)}`}");
  });

it("插件 tab 为互斥视图（2026-11-21 移除 forceMount）", () => {
  /*
   * 原 forceMount 让未切到插件 tab 时页面底部仍完整铺出四榜，
   * 与「热门/最新/插件」三个 Tab 语义重叠、首屏被拉长。
   * 现改为互斥视图；站点榜底部用导流条引导。
   */
  expect(src).not.toMatch(/<TabsContent value="plugins"[^>]*forceMount/)
  expect(src).toContain('探索插件市场热门排行')

  });
  it("空态与底部都有回市场入口", () => {
    expect(src).toContain("去插件市场");
    expect(src).toContain("查看全部插件");
    expect(src).toContain('href="/marketplace"');
  });

  it("重试时客户端重取四组（与服务端同口径）", () => {
    for (const sort of ["trending", "popular", "rating", "new"]) {
      expect(src).toContain(`fetchPlugins({ sort: '${sort}', limit: 5 }`);
    }
  });
});

describe("P2-10：trending 指标口径（marketplace-rankings）", () => {
  it("RankingGroupKey 与四组类型包含 trending", () => {
    const src = overlaySource("src/lib/plugins/marketplace-rankings.ts");
    expect(src).toContain("'trending' | 'popular' | 'rating' | 'fresh'");
    for (const key of ["trending", "popular", "rating", "fresh"]) {
      expect(src).toContain(`${key}: HubPluginItem[]`);
    }
  });

  it("trending 行指标报真实安装数，与 popular 同口径、不编飙升分", () => {
    expect(rankingMetric("trending", fakePlugin({ installCount: 0 }))).toBe("暂无安装");
    expect(rankingMetric("trending", fakePlugin({ installCount: 3 }))).toBe("3 次安装");
  });
});
