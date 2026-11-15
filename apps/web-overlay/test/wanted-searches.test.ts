/**
 * 待找两出口（搜索容错纠错 · 第 5 项）前端。
 *
 * 纯函数直接测；组件接线用读源码断言（本仓无 jsdom，与
 * search-zero-result-rescue.test.ts 同一范式）。
 *
 * 锁：
 * 1. queryToTitleAndUrl：域名形补 https://；中文词只有 title、无 url
 *    （绝不编 URL）；title 截断 80；
 * 2. wanted-actions 岛：存为待找（登录调 API / 匿名 localStorage +
 *    明示登录后才能通知）、新建收藏（AddSiteDialog 预填 + createCustomSite
 *    + toggle 联动）；
 * 3. /me/wanted 列表页存在且进用户中心导航。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { queryToTitleAndUrl, CUSTOM_SITE_TITLE_MAX } from "../src/lib/submit-prefill";
import { normalizeWantedQuery, WANTED_STORAGE_KEY } from "../src/lib/wanted-searches";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

describe("queryToTitleAndUrl", () => {
  it("域名形补 https://，title 取域名", () => {
    expect(queryToTitleAndUrl("github.com/foo")).toEqual({ title: "github.com", url: "https://github.com/foo" });
    expect(queryToTitleAndUrl("https://foo.dev/x")).toEqual({ title: "foo.dev", url: "https://foo.dev/x" });
  });

  it("中文词只有 title、无 url（绝不编 URL）", () => {
    expect(queryToTitleAndUrl("哔哩哔哩")).toEqual({ title: "哔哩哔哩" });
    expect(queryToTitleAndUrl("免费修图")).toEqual({ title: "免费修图" });
  });

  it("title 截断到 80（custom-sites 上限，取严的）", () => {
    expect(CUSTOM_SITE_TITLE_MAX).toBe(80);
    expect(queryToTitleAndUrl("修".repeat(100)).title.length).toBe(80);
  });

  it("空查询返回空 title", () => {
    expect(queryToTitleAndUrl("   ")).toEqual({ title: "" });
  });
});

describe("normalizeWantedQuery", () => {
  it("折叠空白、截断 256", () => {
    expect(normalizeWantedQuery("  知  乎  ")).toBe("知 乎");
    expect(normalizeWantedQuery("x".repeat(300)).length).toBe(256);
  });
});

describe("待找两出口客户端岛 wanted-actions.tsx", () => {
  const src = overlaySource("src/components/search/wanted-actions.tsx");

  it("存为待找按钮 + 已存态 + 查看我的待找链接", () => {
    expect(src).toContain("存为待找");
    expect(src).toContain("已存为待找 ✓");
    expect(src).toContain('href="/me/wanted"');
    expect(src).toContain("saveWantedSearch(q, corrected)");
  });

  it("匿名回退：本地-only 并明示登录后才能通知", () => {
    expect(src).toContain("已存在本地待找，登录后才能在收录时通知你");
  });

  it("重复存提示「已在待找里了」", () => {
    expect(src).toContain("已在待找里了");
  });

  it("新建收藏：AddSiteDialog 预填 + createCustomSite + toggle 联动", () => {
    expect(src).toContain("新建收藏");
    expect(src).toContain("queryToTitleAndUrl(corrected ?? q)");
    expect(src).toContain("createCustomSite({ title, url: href");
    expect(src).toContain("toggle({ siteId: item.id");
    expect(src).toContain("去我的站点查看");
  });

  it("匿名新建收藏走本地直存（custom: + hash），前提是用户贴了真实 URL", () => {
    expect(src).toContain("customFavoriteId(title, href)");
    expect(src).toContain("已存进本地收藏（未登录，仅保存在当前设备）");
  });

  it("纠正过才在 note 里填原搜索词", () => {
    expect(src).toContain("原搜索词：");
  });
});

describe("待找客户端库 lib/wanted-searches.ts", () => {
  const src = overlaySource("src/lib/wanted-searches.ts");

  it("匿名 localStorage 键 navhub.wanted.v1", () => {
    expect(WANTED_STORAGE_KEY).toBe("navhub.wanted.v1");
    expect(src).toContain("navhub.wanted.v1");
  });

  it("登录态调 API，401 才落本地（不把 401 当普通失败吞掉）", () => {
    expect(src).toContain("saveWanted(q, correctedQuery ?? null)");
    expect(src).toContain("status !== 401");
  });
});

describe("我的待找列表页", () => {
  it("/me/wanted 页面存在，进用户中心导航", () => {
    const page = overlaySource("src/app/me/wanted/page.tsx");
    expect(page).toContain("我的待找");
    const nav = overlaySource("src/components/user-center/user-center-nav.tsx");
    expect(nav).toContain("{ href: '/me/wanted', label: '我的待找' }");
  });

  it("列表视图：已通知行保留到删除，重新待找 = 删后重存", () => {
    const view = overlaySource("src/components/user-center/wanted-searches-view.tsx");
    expect(view).toContain("已收录 · 已通知");
    expect(view).toContain("等待收录");
    expect(view).toContain("deleteWantedSearch");
  });
});

describe("零结果面板新动作分发（search-palette）", () => {
  const src = overlaySource("src/components/search-palette.tsx");

  it("runPanelAction 有 save-wanted / save-favorite 分支", () => {
    expect(src).toContain("action.kind === 'save-wanted'");
    expect(src).toContain("action.kind === 'save-favorite'");
    expect(src).toContain("saveWantedSearch(q, correction?.corrected ?? null)");
  });

  it("save-favorite 打开独立的 AddSiteDialog（不复用 DIY 提交落点）", () => {
    expect(src).toContain("handleCreateFavoriteSubmit");
    expect(src).toContain('dialogTitle="新建收藏"');
  });
});
