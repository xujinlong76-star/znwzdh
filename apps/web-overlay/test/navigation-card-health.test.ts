import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  ALL_SITES_ACCESSIBLE_EMPTY_TEXT,
  FailingOnlyToggle,
  NavigationCard,
} from "../src/components/navigation-card";
import { TooltipProvider } from "../src/components/ui/tooltip";
import type { NavigationSubItem } from "../src/types/navigation";

/**
 * 卡片健康徽标渲染测试（03 §9 验收第 5 条）。
 *
 * 渲染层走 renderToString（不跑 effect、不走真实网络，见 drama-rankings-section.test.ts
 * 同款体例）：卡片级 Hook 用 vi.mock 注入固定值，只钉徽标本身——
 * 有 health 画徽标、无 health 不占位、title 含状态码与巡检日期、零新增网络请求。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
  toast: () => {},
}));

vi.mock("@/lib/modular/feature-mask-store", () => ({
  useFeatureMask: () => ({
    effectiveCardElements: {
      showDescription: true,
      showTags: true,
      showPinnedBadge: true,
      showQuickLookBadge: false,
    },
    isFeatureHidden: () => false,
    removeFeature: () => {},
  }),
}));

vi.mock("@/components/diy/diy-drag-context", () => ({
  useDiyDragHandleRef: () => null,
  useDiyDragActive: () => false,
}));

vi.mock("@/lib/user-preferences", () => ({
  useExternalLinkTarget: (fallback: "_blank" | "_self" = "_blank") => fallback,
}));

vi.mock("@/components/favorite-button", () => ({
  FavoriteButton: () => null,
}));

afterAll(() => {
  vi.resetModules();
});

const CHECKED = Date.UTC(2026, 10, 19, 8, 0, 0);

/**
 * 测试用 health：NavigationSubItem['health'] 声明里还没有 audit 字段
 * （audit 字段透传是 W1 的 data-loader/types 项），运行时对象可多带
 * 它们，siteHealthState() 按 SiteHealthInput 读；这里只做类型层面的
 * 显式放宽，不改生产类型。
 */
type TestHealth = NonNullable<NavigationSubItem["health"]> & {
  auditStatus?: "HEALTHY" | "SUSPICIOUS_PARKED" | "SOFT_404" | "THIN_CONTENT";
  auditConfidence?: number;
  consecutiveFailures?: number;
};

function itemWithHealth(health?: TestHealth): NavigationSubItem {
  return {
    id: "nav-da02af4f6414",
    title: "示例站",
    href: "https://example.com/",
    description: "示例描述",
    enabled: true,
    ...(health ? { health: health as NavigationSubItem["health"] } : {}),
  };
}

function renderCard(
  item: NavigationSubItem,
  extraProps: { cardDisplayMode?: "compact" | "standard" | "rich"; showFailingOnly?: boolean } = {},
): string {
  // 卡片根节点就是 <Tooltip>：Radix 要求包在 TooltipProvider 里（生产由应用根节点提供）
  return renderToString(
    createElement(TooltipProvider, null, createElement(NavigationCard, { item, ...extraProps })),
  );
}

describe("卡片健康徽标渲染（§9 第 5 条）", () => {
  it("有巡检 health 的卡片画徽标：状态词 + Token 点色；延迟只进 title 不进正文", () => {
    const html = renderCard(
      itemWithHealth({ ok: true, httpStatus: 200, latencyMs: 123, lastCheckedAt: CHECKED }),
    );
    expect(html).toContain("可访问");
    // 2026-11-25 P1-4：延迟数字不再进徽标正文（React SSR 会插 <!-- -->，同样先去掉再断言）
    expect(html.replace(/<!-- -->/g, "")).not.toContain("(123ms)");
    // 点色断言钉 span 本身（操作栏另有 hover:bg-success/10 之类的交互类，不能整串断言）
    expect(html).toContain("rounded-full bg-success");
    expect(html).toContain('title="HTTP 200 · 123ms · 巡检于 2026-11-19"');
    expect(html).not.toContain("看存档");
  });

  it("延迟分档：>3s 转「响应缓慢」+ 琥珀点，且不进「只看失效」侧", () => {
    const sluggish = itemWithHealth({ ok: true, httpStatus: 200, latencyMs: 7035, lastCheckedAt: CHECKED });
    const html = renderCard(sluggish);
    expect(html).toContain("响应缓慢");
    expect(html).not.toContain("rounded-full bg-success");
    expect(html).toContain("rounded-full bg-pinned");
    expect(html.replace(/<!-- -->/g, "")).not.toContain("(7035ms)");
    expect(html).toContain('title="HTTP 200 · 7035ms · 巡检于 2026-11-19"');
    // 慢 ≠ 失效：开关打开时慢站整卡不渲染（与可访问同口径）
    expect(renderCard(sluggish, { showFailingOnly: true })).toBe("");
  });

  it("延迟分档：1–3s 转「响应较慢」+ 琥珀点", () => {
    const html = renderCard(
      itemWithHealth({ ok: true, httpStatus: 200, latencyMs: 1500, lastCheckedAt: CHECKED }),
    );
    expect(html).toContain("响应较慢");
    expect(html).toContain("rounded-full bg-pinned");
    expect(html).not.toContain("rounded-full bg-success");
  });

  it("已失效卡片画「已失效 · 看存档」+ 看存档链接（* 回落最新快照）", () => {
    const html = renderCard(
      itemWithHealth({ ok: false, httpStatus: 404, lastCheckedAt: CHECKED, consecutiveFailures: 2 }),
    );
    expect(html).toContain("已失效 · 看存档");
    expect(html).toContain("看存档");
    expect(html).toContain("https://web.archive.org/web/*/https://example.com/");
    expect(html).toContain('title="查看最近存档快照"');
    expect(html).toContain('title="HTTP 404 · 巡检于 2026-11-19"');
  });

  it("疑似失效卡片画「疑似失效 · 看存档」+ 看存档链接", () => {
    const html = renderCard(
      itemWithHealth({
        ok: true,
        httpStatus: 200,
        lastCheckedAt: CHECKED,
        auditStatus: "SOFT_404",
        auditConfidence: 0.95,
      }),
    );
    expect(html).toContain("疑似失效 · 看存档");
    expect(html).toContain("看存档");
  });

  it("无 health 的卡片不占位：无徽标文案、无占位文案", () => {
    const html = renderCard(itemWithHealth());
    expect(html).not.toContain("可访问");
    expect(html).not.toContain("疑似");
    expect(html).not.toContain("已失效");
    expect(html).not.toContain("近期检测异常");
    expect(html).not.toContain("看存档");
    expect(html).not.toContain("检测中");
    expect(html).not.toContain("巡检于");
    expect(html).toContain("示例站");
  });

  it("紧凑与丰富形态同样画徽标", () => {
    const healthy = itemWithHealth({ ok: true, httpStatus: 200, latencyMs: 87, lastCheckedAt: CHECKED });
    expect(renderCard(healthy, { cardDisplayMode: "compact" })).toContain("可访问");
    expect(renderCard(healthy, { cardDisplayMode: "rich" })).toContain("可访问");
  });

  it("徽标零新增网络请求：渲染过程不调用 fetch", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      renderCard(itemWithHealth({ ok: true, httpStatus: 200, latencyMs: 123, lastCheckedAt: CHECKED }));
      renderCard(itemWithHealth());
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
    // 源码级守卫：卡片文件里没有任何 fetch 调用
    expect(overlayFile("src/components/navigation-card.tsx")).not.toContain("fetch(");
  });
});

describe("「只看失效」开关（§7）", () => {
  it("开关打开时只留失效侧卡片：可访问与未巡检整卡不渲染", () => {
    expect(
      renderCard(itemWithHealth({ ok: true, httpStatus: 200, lastCheckedAt: CHECKED }), {
        showFailingOnly: true,
      }),
    ).toBe("");
    expect(renderCard(itemWithHealth(), { showFailingOnly: true })).toBe("");
    expect(
      renderCard(
        itemWithHealth({ ok: false, httpStatus: 404, lastCheckedAt: CHECKED, consecutiveFailures: 2 }),
        { showFailingOnly: true },
      ),
    ).toContain("已失效 · 看存档");
  });

  it("开关默认关闭：不传 showFailingOnly 时全站卡片都渲染", () => {
    expect(renderCard(itemWithHealth())).toContain("示例站");
  });

  it("开关组件渲染「只看失效」+ role=switch；空态文案为“全部站点均可访问”", () => {
    expect(ALL_SITES_ACCESSIBLE_EMPTY_TEXT).toBe("全部站点均可访问");
    const html = renderToString(
      createElement(FailingOnlyToggle, { checked: false, onChange: () => {} }),
    );
    expect(html).toContain("只看失效");
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    const onHtml = renderToString(
      createElement(FailingOnlyToggle, { checked: true, onChange: () => {} }),
    );
    expect(onHtml).toContain('aria-checked="true"');
  });

  it("源码守卫：开关状态不进 URL、不持久化", () => {
    const src = overlayFile("src/components/navigation-card.tsx");
    expect(src).toContain("showFailingOnly");
    expect(src).toContain("不进 URL、不持久化");
    // 卡片文件里开关不读写 URL 参数与本地存储
    expect(src).not.toContain("useSearchParams");
    expect(src).not.toContain("localStorage");
  });
});

describe("维护中卡片（2026-11-27 Gutenberg 临时标注）", () => {
  // Gutenberg live 健康对象形态：巡检被 SSRF guard 拦在站外，无状态码
  const gutenbergItem = (): NavigationSubItem => ({
    ...itemWithHealth({ ok: false, httpStatus: null, latencyMs: 1, lastCheckedAt: CHECKED }),
    hubId: "nav-508848075e00",
    title: "Project Gutenberg",
    href: "https://www.gutenberg.org/",
  });

  it("Gutenberg 卡片画「维护中」+ 琥珀点、无「看存档」链接", () => {
    const html = renderCard(gutenbergItem());
    expect(html).toContain("维护中");
    expect(html).not.toContain("近期检测异常");
    expect(html).toContain("rounded-full bg-pinned");
    expect(html).not.toContain("看存档");
    expect(html).toContain('title="维护中 · 巡检于 2026-11-19"');
  });

  it("维护中卡片进「只看失效」侧", () => {
    expect(renderCard(gutenbergItem(), { showFailingOnly: true })).toContain("维护中");
  });

  it("标注过期后同一卡片恢复「近期检测异常」", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-29T02:26:01+08:00"));
      const html = renderCard(gutenbergItem());
      expect(html).toContain("近期检测异常");
      expect(html).not.toContain("维护中");
    } finally {
      vi.useRealTimers();
    }
  });
});
