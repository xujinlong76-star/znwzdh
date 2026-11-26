/**
 * 搜索纠正横幅（搜索容错纠错 · 第 5 项）。
 *
 * 本仓测试跑在 node 环境，没有 jsdom，组件挂载类测试不在这里做，
 * 改为读源码断言关键接线存在（与 search-zero-result-rescue.test.ts
 * 同一范式）。
 *
 * 锁：
 * 1. /search 页：有 correction 显示「已替你纠正为：X」+「不是这个？
 *    搜原来的「原词」」（链接含原词 + nocorrect=1），role=status；
 * 2. 有 correction 时不显示「您是不是想搜」（两者二选一）；
 * 3. 无 correction 不显示纠正横幅；
 * 4. search-palette / spotlight-modal 同款横幅 + 回退（nocorrect 重查），
 *    三处文案不分裂。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

describe("纠正横幅：/search 页", () => {
  const src = overlaySource("src/app/search/search-results.tsx");

  it("有 correction 显示「已替你纠正为：X」，role=status", () => {
    expect(src).toContain("已替你纠正为：");
    expect(src).toContain("correction.corrected");
    const banner = src.slice(src.indexOf("已替你纠正为：") - 400, src.indexOf("已替你纠正为："));
    expect(banner).toContain('role="status"');
  });

  it("「不是这个」链接到原词 + nocorrect=1", () => {
    expect(src).toContain("搜原来的");
    expect(src).toContain("correction.original");
    expect(src).toContain("nocorrect: true");
    expect(src).toContain("searchHref({ q: correction.original");
  });

  it("有 correction 时不渲染旧的「您是不是想搜」块（两者二选一）", () => {
    // 三元分支：correction 优先，else 分支才渲染 didYouMean
    const idx = src.indexOf("已替你纠正为：");
    const branch = src.slice(idx, idx + 1500);
    expect(branch).toContain("didYouMean");
    expect(src).toContain(") : !failed && didYouMean ? (");
  });

  it("无 correction 不显示横幅：横幅只在 correction 分支内", () => {
    expect(src).toContain("{!failed && correction ? (");
  });

  it("纠正词本身是可点链接（点一下按纠正词搜）", () => {
    expect(src).toContain("searchHref({ q: correction.corrected");
  });
});

describe("纠正横幅：search-palette", () => {
  const src = overlaySource("src/components/search-palette.tsx");

  it("同款文案 + 回退按钮（nocorrect 重查）", () => {
    expect(src).toContain("已替你纠正为：");
    expect(src).toContain("搜原来的");
    expect(src).toContain("setNocorrectQuery(correction.original)");
    expect(src).toContain("setRetryToken((n) => n + 1)");
  });

  it("searchSites 透传 nocorrect（只在回退词等于当前查询时生效）", () => {
    expect(src).toContain("nocorrect: nocorrectQuery !== null && nocorrectQuery === q");
  });

  it("有 correction 时不显示 didYouMean（两者二选一）", () => {
    expect(src).toContain(") : didYouMean ? (");
    expect(src).toContain("setCorrection(res.correction)");
  });

  it("200ms 防抖与 AbortController 逻辑不动", () => {
    expect(src).toContain("const delay = skipDebounceRef.current ? 0 : 200");
    expect(src).toContain("}, delay)");
    expect(src).toContain("new AbortController()");
  });
});

describe("纠正横幅：spotlight-modal", () => {
  const src = overlaySource("src/components/search/spotlight-modal.tsx");

  it("同款文案 + 回退（nocorrect 重查）", () => {
    expect(src).toContain("已替你纠正为：");
    expect(src).toContain("搜原来的");
    expect(src).toContain("setNocorrectQuery(correction.original)");
    expect(src).toContain("setCorrection(sitesRes?.correction ?? null)");
  });

  it("有 correction 时不显示 didYouMean（两处渲染点都二选一）", () => {
    const hits = src.split("已替你纠正为：").length - 1;
    expect(hits).toBe(2);
  });
});

describe("nocorrect 透传链：search-page / navhub-api", () => {
  it("searchHref / searchApiPath 透传 nocorrect", () => {
    const page = overlaySource("src/lib/search-page.ts");
    expect(page).toContain("nocorrect?: boolean");
    expect(page).toContain("params.set('nocorrect', '1')");
  });

  it("searchSites 透传 nocorrect，HubSearchResult 含 correction", () => {
    const api = overlaySource("src/lib/navhub-api.ts");
    expect(api).toContain("nocorrect?: boolean");
    expect(api).toContain("query.set('nocorrect', '1')");
    expect(api).toContain("| 'correction'");
  });
});
