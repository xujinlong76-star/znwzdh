/**
 * Spotlight 站外搜索出口（进化第 86 轮 S 线）。
 *
 * 缺陷：spotlight-modal.tsx:244-245 算出了 externalSearchHref /
 * externalSearchName，但全文件无任何 JSX 引用 —— 改过默认搜索引擎的
 * 用户在 Spotlight 里没有一键跳外部引擎的出口。
 *
 * 本仓测试跑在 node 环境，没有 jsdom，组件挂载类测试不在这里做，
 * 改为「纯函数行为断言 + 读源码断言关键接线存在」（与
 * search-correction-banner.test.ts 同一范式）。
 *
 * 锁：
 * 1. 有查询词时出口 href 等于配置引擎的 URL + 查询词（编过码的）；
 * 2. 换默认引擎后 href 跟着变（google → bing）；
 * 3. 无查询词 / 选「站内聚合」(internal) 时没有可点出口（URL 为 null）；
 * 4. 出口渲染成新标签链接：target=_blank、rel 含 noopener、有关闭弹窗的 onClick、
 *    有 aria-label「在 {引擎名} 中搜索」，且只在有查询词且配了外部引擎时出现。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { externalSearchEngineName, externalSearchUrl } from "../src/lib/user-settings";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const MODAL = "src/components/search/spotlight-modal.tsx";

describe("站外出口 URL：等于配置引擎的地址 + 查询词", () => {
  it("google + 查询词 → Google 搜索地址，查询词正确编码", () => {
    expect(externalSearchUrl("google", "考研")).toBe(
      "https://www.google.com/search?q=%E8%80%83%E7%A0%94",
    );
    expect(externalSearchEngineName("google")).toBe("Google");
  });

  it("换默认引擎后 href 跟着变：bing", () => {
    expect(externalSearchUrl("bing", "考研")).toBe(
      "https://www.bing.com/search?q=%E8%80%83%E7%A0%94",
    );
    expect(externalSearchEngineName("bing")).toBe("Bing");
  });

  it("换默认引擎后 href 跟着变：duckduckgo / github / perplexity", () => {
    expect(externalSearchUrl("duckduckgo", "react hooks")).toBe(
      "https://duckduckgo.com/?q=react%20hooks",
    );
    expect(externalSearchUrl("github", "navhub")).toBe("https://github.com/search?q=navhub");
    expect(externalSearchUrl("perplexity", "考研")).toBe(
      "https://www.perplexity.ai/search?q=%E8%80%83%E7%A0%94",
    );
  });

  it("查询词前后空白不进 URL", () => {
    expect(externalSearchUrl("google", "  考研  ")).toBe(
      "https://www.google.com/search?q=%E8%80%83%E7%A0%94",
    );
  });
});

describe("站外出口：无查询词 / 站内聚合时没有可点出口", () => {
  it("空查询词 → null（渲染条件 externalSearchHref 为假，不出现出口）", () => {
    expect(externalSearchUrl("google", "")).toBeNull();
    expect(externalSearchUrl("google", "   ")).toBeNull();
  });

  it("选「站内聚合」(internal) → null，且引擎名为 null（不被悄悄推给外部）", () => {
    expect(externalSearchUrl("internal", "考研")).toBeNull();
    expect(externalSearchEngineName("internal")).toBeNull();
  });

  it("未知引擎 id（旧页面读到新档位）→ null，不崩", () => {
    expect(externalSearchUrl("baidu" as never, "考研")).toBeNull();
    expect(externalSearchEngineName("baidu" as never)).toBeNull();
  });
});

describe("站外出口：Spotlight 弹窗里真的渲染了", () => {
  const src = overlaySource(MODAL);

  it("计算出的两个值被 JSX 引用了（不再是只算不用）", () => {
    const defs = src.indexOf("const externalSearchHref = externalSearchUrl(searchEngine, query)");
    expect(defs).toBeGreaterThan(-1);
    // href 直接用算好的值：定义之后出现 href={safeHref(externalSearchHref)}
    const hrefUse = src.indexOf("href={safeHref(externalSearchHref)}", defs + 1);
    expect(hrefUse).toBeGreaterThan(defs);
    // 引擎名出现在按钮文案里
    expect(src).toContain("在 {externalSearchName} 中搜索");
  });

  it("出口只在有 href 且有引擎名时出现", () => {
    expect(src).toContain("{externalSearchHref && externalSearchName && (");
  });

  it("新标签打开：target=_blank + rel=noopener noreferrer，点按后关弹窗", () => {
    const anchor = src.slice(src.indexOf("在 {externalSearchName} 中搜索") - 600, src.indexOf("在 {externalSearchName} 中搜索"));
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain('rel="noopener noreferrer"');
    expect(anchor).toContain("onClick={() => setOpen(false)}");
  });

  it("键盘可达、有 aria-label：文案含引擎名与当前查询词", () => {
    expect(src).toContain("aria-label={`在 ${externalSearchName} 中搜索「${query.trim()}」`}");
  });

  it("出口不编造引擎 URL、不改默认引擎逻辑：只用已有的两个值", () => {
    // 出口锚点的 href 只能来自 externalSearchHref，不能出现手写引擎地址
    const block = src.slice(
      src.indexOf("{externalSearchHref && externalSearchName && ("),
      src.indexOf("在 {externalSearchName} 中搜索") + 60,
    );
    expect(block).not.toContain("google.com");
    expect(block).not.toContain("bing.com");
    expect(block).not.toContain("setSearchEngine");
    expect(block).not.toContain("defaultSearchEngine");
  });
});
