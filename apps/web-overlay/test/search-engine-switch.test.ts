/**
 * /search 搜索框旁一级引擎切换（W4-0622-1 缺口 ①）。
 *
 * 本仓测试跑在 node 环境，没有 jsdom，组件挂载类测试不在这里做，
 * 改为「纯函数行为断言 + 读源码断言关键接线存在」（与
 * spotlight-external-search.test.ts 同一范式）。
 *
 * 锁：
 * 1. 切换只复用 defaultSearchEngine 偏好键，不另立引擎状态、不写新存储键；
 * 2. 选站外引擎提交时拦截并新标签打开 externalSearchUrl 的地址，空查询不拦截；
 * 3. 选「站内聚合」不拦截，表单照常 GET 到 /search；
 * 4. 下拉选项与设置页同源（SEARCH_ENGINE_OPTIONS），地址不手写；
 * 5. /search 表单里真的渲染了切换组件。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SEARCH_ENGINE_OPTIONS, externalSearchUrl } from "../src/lib/user-settings";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const SWITCH = "src/components/search/search-engine-switch.tsx";
const RESULTS = "src/app/search/search-results.tsx";

describe("引擎切换：选项与设置页同源（8 档，含百度/搜狗）", () => {
  it("SEARCH_ENGINE_OPTIONS 有 8 档，值与短名一一对应", () => {
    expect(SEARCH_ENGINE_OPTIONS.map((o) => o.value)).toEqual([
      "internal",
      "google",
      "baidu",
      "bing",
      "sogou",
      "duckduckgo",
      "github",
      "perplexity",
    ]);
  });

  it("每个站外引擎都有可跳的 https 地址（切换后提交有地方去）", () => {
    for (const opt of SEARCH_ENGINE_OPTIONS) {
      if (opt.value === "internal") {
        expect(externalSearchUrl(opt.value, "考研")).toBeNull();
      } else {
        const url = externalSearchUrl(opt.value, "考研");
        expect(url, opt.value).not.toBeNull();
        expect(url!.startsWith("https://"), opt.value).toBe(true);
      }
    }
  });
});

describe("引擎切换：只复用 defaultSearchEngine，不另立状态", () => {
  const src = overlaySource(SWITCH);

  it("读偏好用 useUserPreference('defaultSearchEngine')", () => {
    expect(src).toContain("useUserPreference('defaultSearchEngine')");
  });

  it("写偏好用 updateUserPreferences({ defaultSearchEngine: … })", () => {
    expect(src).toContain("updateUserPreferences({ defaultSearchEngine:");
  });

  it("不写新存储键：不碰 localStorage、不出现 navhub_ 新键", () => {
    expect(src).not.toContain("localStorage");
    expect(src).not.toContain("navhub_");
    expect(src).not.toContain("setItem");
  });
});

describe("引擎切换：提交拦截只发生在站外引擎 + 非空查询", () => {
  const src = overlaySource(SWITCH);

  it("监听就近表单的 submit，站内档直接放行", () => {
    expect(src).toContain("closest('form')");
    expect(src).toContain("addEventListener('submit'");
    expect(src).toContain("if (engine === 'internal') return");
  });

  it("空查询不拦截（不跳出一个空搜索结果页）", () => {
    expect(src).toContain("if (!query) return");
  });

  it("拦截后经 safeWindowOpen 新标签打开 externalSearchUrl 的地址，带 noopener", () => {
    expect(src).toContain("e.preventDefault()");
    expect(src).toContain("externalSearchUrl(engine, query)");
    expect(src).toContain("import { safeWindowOpen } from '@/lib/safe-url'");
    expect(src).toContain("safeWindowOpen(url)");
    expect(src).toContain("if (!opened) return");
    expect(src).not.toContain("window.open(url");
  });

  it("地址不手写：组件里没有引擎域名", () => {
    for (const host of ["baidu.com", "google.com", "bing.com", "sogou.com", "duckduckgo.com"]) {
      expect(src).not.toContain(host);
    }
  });

  it("下拉可达：有 aria-label，选项按 SEARCH_ENGINE_OPTIONS 渲染", () => {
    expect(src).toContain('aria-label="搜索引擎"');
    expect(src).toContain("SEARCH_ENGINE_OPTIONS.map((opt) => (");
  });
});

describe("引擎切换：/search 表单里真的渲染了", () => {
  const src = overlaySource(RESULTS);

  it("search-results 引入并渲染 SearchEngineSwitch", () => {
    expect(src).toContain("import { SearchEngineSwitch } from '@/components/search/search-engine-switch'");
    expect(src).toContain("<SearchEngineSwitch />");
  });

  it("切换放在搜索表单内、输入框之前（搜索框旁）", () => {
    const formAt = src.indexOf('<form action="/search" method="get"');
    expect(formAt).toBeGreaterThan(-1);
    const switchAt = src.indexOf("<SearchEngineSwitch />", formAt);
    const inputAt = src.indexOf('id="site-search-q"', formAt);
    expect(switchAt).toBeGreaterThan(formAt);
    expect(switchAt).toBeLessThan(inputAt);
  });

  it("原生 GET 表单还在（无 JS 仍能站内搜，切换只是渐进增强）", () => {
    expect(src).toContain('<form action="/search" method="get" role="search"');
  });
});
