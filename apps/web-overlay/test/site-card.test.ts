import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { SiteCard } from "../src/components/site-card";

/**
 * SiteCard 三变体守卫（2026-11-25 UI 评审 P0-1 阶段 B）。
 *
 * 背景：/hot 与 /sites 此前各画一套卡片解剖（40px 图标网格卡 / 24px 图标列表行），
 * 字段与壳配方互不相认。本守卫钉住：
 *   1) 两个真实消费方（hot 网格卡、sites 行卡）都走 SiteCard，不再自绘解剖；
 *   2) 三变体（grid / row / compact）在同一个文件里定义，壳/图标/标题/描述配方单源；
 *   3) 渲染契约：标题内链、描述、meta/actions 槽位、无 href 时标题退化为纯文本；
 *   4) 站内详情链文案（href={`/site/${...}`}）留在调用方源码——collection-detail
 *      测试按字面量扫 hot-view。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

describe("SiteCard 结构收编", () => {
  it("hot 网格卡走 SiteCard grid，不再自绘卡片壳", () => {
    const src = overlayFile("src/app/hot/hot-view.tsx");
    expect(src).toContain("from '@/components/site-card'");
    expect(src).toContain('variant="grid"');
    expect(src, "网格卡壳配方已收进原语").not.toContain("hover:-translate-y-0.5 p-[var(--density-card-padding,0.875rem)]");
    // collection-detail 钉子：站内详情链字面量留在调用方
    expect(src).toContain("href={`/site/${encodeURIComponent(site.id)}`}");
  });

  it("/sites 行卡走 SiteCard row，不再自绘行壳", () => {
    const src = overlayFile("src/components/sites-directory-filterable-grid.tsx");
    expect(src).toContain("from '@/components/site-card'");
    expect(src).toContain('variant="row"');
    expect(src, "行卡壳配方已收进原语").not.toContain("rounded-xl border border-border/70 p-2.5 hover:bg-muted/40");
  });

  it("三变体配方单源：壳/图标/标题/描述只在 site-card.tsx 定义", () => {
    const src = overlayFile("src/components/site-card.tsx");
    expect(src).toContain("export type SiteCardVariant = 'grid' | 'row' | 'compact'");
    expect(src).toContain("grid:");
    expect(src).toContain("row:");
    expect(src).toContain("compact:");
    // 密度 Token 而非魔法数字
    expect(src).toContain("var(--density-card-padding");
    // grid 标题 hover 走 text-link（站内详情链，a11y-token-contrast 口径）
    expect(src).toContain("group-hover:text-link");
    // compact 壳与 NavigationCard compact 档同配方（nav-card-deferred）
    expect(src).toContain("nav-card-deferred");
  });
});

describe("SiteCard 渲染契约", () => {
  it("grid：标题内链 + 描述 clamp + meta/actions 槽位", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        href: "/site/abc",
        title: "示例站点",
        description: "示例描述",
        icon: createElement("img", { alt: "" }),
        meta: createElement("span", null, "热度占位"),
        actions: createElement("a", { href: "/x" }, "外链占位"),
      }),
    );
    expect(html).toContain('href="/site/abc"');
    expect(html).toContain("示例站点");
    expect(html).toContain("示例描述");
    expect(html).toContain("line-clamp-2");
    expect(html).toContain("热度占位");
    expect(html).toContain("外链占位");
  });

  it("row：单行描述 truncate + 标题链接", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "row",
        href: "/site/abc",
        title: "行卡站点",
        description: "行卡描述",
        icon: createElement("img", { alt: "" }),
      }),
    );
    expect(html).toContain('href="/site/abc"');
    expect(html).toContain("行卡描述");
    expect(html).toContain("truncate");
  });

  it("compact：单行标题 + 无描述时不渲染描述节点", () => {
    const html = renderToString(
      createElement(SiteCard, { variant: "compact", href: "/site/abc", title: "紧凑站点" }),
    );
    expect(html).toContain("紧凑站点");
    expect(html).toContain('href="/site/abc"');
  });

  it("无 href 时标题退化为纯文本，meta 槽位仍保留", () => {
    const html = renderToString(createElement(SiteCard, {
      variant: "row",
      title: "纯文本站点",
      meta: createElement("span", null, "元信息"),
    }));
    expect(html).toContain("纯文本站点");
    expect(html).toContain("元信息");
    expect(html).not.toContain('href="/site/');
  });

  it("overlay 模式：整卡外链是兄弟节点（z-0），标题内链 pointer-events-auto，内容层穿透", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        surface: "glass",
        overlayHref: "https://example.com/",
        overlayLabel: "访问示例站 官网",
        overlayTarget: "_blank",
        overlayRel: "noopener noreferrer nofollow",
        href: "/site/abc",
        title: "示例站",
        description: "描述",
        icon: createElement("img", { alt: "" }),
        actions: createElement("button", null, "收藏"),
      }),
    );
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('aria-label="访问示例站 官网"');
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('href="/site/abc"');
    expect(html).toContain("pointer-events-auto");
    expect(html).toContain("pointer-events-none");
    // 玻璃面生效
    expect(html).toContain("glass-surface");
    expect(html).toContain("subtle-mesh");
    // 兄弟节点顺序：覆盖层 → 标题内链 → 收藏（绝不嵌套）
    expect(html.indexOf('href="https://example.com/"')).toBeLessThan(html.indexOf('href="/site/abc"'));
    expect(html.indexOf('href="/site/abc"')).toBeLessThan(html.indexOf("收藏"));
  });

  it("非 overlay 的 grid 保持「整块内容即内链」原结构（不给热榜/目录换点击模型）", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        href: "/site/abc",
        title: "标题站",
        icon: createElement("img", { alt: "" }),
      }),
    );
    expect(html.match(/href="\/site\/abc"/g)?.length).toBe(1);
    expect(html).not.toContain("pointer-events-none");
  });

  it("面层开关：默认 card 面带 nav-card-deferred，glass 面不带", () => {
    const card = renderToString(createElement(SiteCard, { variant: "grid", title: "x" }));
    expect(card).toContain("nav-card-deferred");
    const glass = renderToString(createElement(SiteCard, { variant: "grid", surface: "glass", title: "x" }));
    expect(glass).not.toContain("nav-card-deferred");
  });
});

describe("tag 结果页接入（2026-11-25）", () => {
  it("tag-results-board 走 SiteCard overlay + glass 面，不再自绘整卡外链", () => {
    const src = overlayFile("src/components/tag-results-board.tsx");
    expect(src).toContain("from '@/components/site-card'");
    expect(src).toContain("<SiteCard");
    expect(src).toContain('surface="glass"');
    expect(src).toContain("overlayHref={safeHref(site.url)}");
    // 整卡外链覆盖层与玻璃壳的配方已收进原语
    expect(src).not.toContain("absolute inset-0 z-0 rounded-xl focus-visible:ring-2");
    expect(src).not.toContain("glass-surface subtle-mesh p-4 transition-all");
  });
});

describe("S1 首页迁移槽位（2026-11-26 施工单 P0-1 §3）", () => {
  const src = overlayFile("src/components/site-card.tsx");

  it("rootProps 展开到壳 div：data 属性透传，事件类 props 由源码展开钉住", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        title: "根属性站",
        rootProps: { "data-navhub-site-id": "site-1", "data-card-variant": "standard" },
      }),
    );
    expect(html).toContain('data-navhub-site-id="site-1"');
    expect(html).toContain('data-card-variant="standard"');
    // onKeyDown 等事件 SSR 不落 HTML，钉住源码层面的展开点
    expect(src).toContain("{...rootRest}");
    expect(src).toContain("rootClassName");
  });

  it("overlayProps 合并进覆盖层锚点：默认 href/aria-label/类不丢，附加 aria/prefetch/peer 全透传", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        overlayHref: "https://example.com/",
        overlayProps: {
          "aria-keyshortcuts": "Control+Shift+1",
          "data-prefetch-target": "true",
          className: "peer",
        },
        title: "覆盖层站",
      }),
    );
    // 默认属性仍在
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('aria-label="访问 覆盖层站 官网"');
    expect(html).toContain("absolute inset-0 z-0");
    // 附加属性全部透传
    expect(html).toContain('aria-keyshortcuts="Control+Shift+1"');
    expect(html).toContain('data-prefetch-target="true"');
    // peer 类与默认类合入同一个 class
    expect(html).toMatch(/class="[^"]*absolute inset-0 z-0[^"]*peer/);
  });

  it("banner 槽插在覆盖层之后、内容之前，pointer-events-none z-10", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        overlayHref: "https://example.com/",
        banner: createElement("div", null, "横幅占位"),
        title: "横幅站",
      }),
    );
    expect(html).toContain("横幅占位");
    expect(src).toContain('pointer-events-none relative z-10');
    expect(html.indexOf('href="https://example.com/"')).toBeLessThan(html.indexOf("横幅占位"));
    // 标题在覆盖层 aria-label 与内容层各出现一次；取内容层（最后一次）出现位置，
    // 断言顺序：覆盖层 → 横幅 → 内容（标题）
    expect(html.indexOf("横幅占位")).toBeLessThan(html.lastIndexOf("横幅站"));
  });

  it("iconWrapClassName 覆盖默认图标盒尺寸（cn 合入而非替换）", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        title: "小图标站",
        icon: createElement("img", { alt: "" }),
        iconWrapClassName: "w-9 h-9",
      }),
    );
    expect(html).toContain("w-9 h-9");
    expect(html, "默认 40px 盒被覆盖").not.toContain("w-10 h-10");
    // 合入口钉在源码：iconWrapClassName 走 cn
    expect(src).toContain("cn(ICON_WRAP[variant], iconWrapClassName)");
  });

  it("titleExtra 槽位贴标题右侧；不传时标题 DOM 结构不变", () => {
    const withExtra = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        title: "健康站",
        titleExtra: createElement("span", null, "健康占位"),
      }),
    );
    expect(withExtra).toContain("健康占位");
    expect(withExtra.indexOf("健康站")).toBeLessThan(withExtra.indexOf("健康占位"));
    const plain = renderToString(createElement(SiteCard, { variant: "grid", title: "普通站" }));
    expect(plain, "默认路径无附加包裹").not.toContain("items-start gap-1.5");
  });

  it("actionBar 底部通栏由组件统一贴底（覆盖层式全宽，容器不吞点击）", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        title: "底栏站",
        actionBar: createElement("div", null, "底栏占位"),
      }),
    );
    expect(html).toContain("底栏占位");
    expect(src).toContain("pointer-events-none absolute inset-x-0 bottom-0 z-10");
    expect(html.indexOf("底栏站")).toBeLessThan(html.indexOf("底栏占位"));
  });

  it("titleLinkProps 合并进标题内链（tabIndex/title 等行为属性透传）", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        overlayHref: "https://example.com/",
        href: "/site/abc",
        title: "标题属性站",
        titleLinkProps: { tabIndex: -1, title: "标题属性站" },
      }),
    );
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('title="标题属性站"');
    expect(html).toContain('href="/site/abc"');
  });

  it("actionsAlwaysVisible 覆盖 hover 渐隐（首页收藏星标非悬浮可点）", () => {
    const persistent = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        title: "常驻站",
        actions: createElement("button", null, "星标"),
        actionsAlwaysVisible: true,
      }),
    );
    expect(persistent).toContain("opacity-100");
    expect(persistent).not.toContain("sm:group-hover:opacity-100");
    const hoverFade = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        title: "悬浮站",
        actions: createElement("button", null, "星标"),
      }),
    );
    expect(hoverFade).toContain("sm:group-hover:opacity-100");
  });

  it("decorations 装饰层独立 z 序、不吞点击", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "grid",
        title: "装饰站",
        decorations: createElement("span", null, "置顶占位"),
      }),
    );
    expect(html).toContain("置顶占位");
    expect(src).toContain("pointer-events-none absolute inset-0 z-10");
  });

  it("compact overlay 分支：覆盖层 z-0 与内容互为兄弟，标题内链 pointer-events-auto", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "compact",
        overlayHref: "https://example.com/",
        href: "/site/abc",
        title: "紧凑覆盖站",
        actions: createElement("button", null, "操作"),
      }),
    );
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('href="/site/abc"');
    expect(html.indexOf('href="https://example.com/"')).toBeLessThan(html.indexOf('href="/site/abc"'));
    expect(html).toContain("pointer-events-auto");
    expect(html).toContain("pointer-events-none");
    // 覆盖层圆角与紧凑壳一致（rounded-lg，不是 grid 的 rounded-xl）
    expect(html).toContain("rounded-lg");
  });

  it("compact titleExtra 槽位贴标题右侧（置顶 Pin / 星数 / 健康徽标），titleLinkProps 合并进标题链", () => {
    const html = renderToString(
      createElement(SiteCard, {
        variant: "compact",
        overlayHref: "https://example.com/",
        href: "/site/abc",
        title: "紧凑附加站",
        titleLinkProps: { tabIndex: -1, title: "紧凑附加站" },
        titleExtra: createElement("span", null, "星数占位"),
      }),
    );
    expect(html).toContain("星数占位");
    // 顺序：覆盖层 → 标题 → titleExtra
    expect(html.indexOf('href="https://example.com/"')).toBeLessThan(html.indexOf("紧凑附加站"));
    expect(html.indexOf("紧凑附加站")).toBeLessThan(html.indexOf("星数占位"));
    // titleLinkProps 行为属性透传（tabIndex=-1 不加 Tab 停留点）
    expect(html).toContain('tabindex="-1"');
    // ACTIONS 容器不设 relative：compact 渐隐浮层的 absolute 定位须相对卡片根
    expect(src).not.toMatch(/compact: 'relative z-10/);
  });

  it("三变体默认渲染不含任何新槽位痕迹（hot/sites/tag 零感知）", () => {
    for (const variant of ["grid", "row", "compact"] as const) {
      const html = renderToString(createElement(SiteCard, { variant, title: "默认站" }));
      expect(html).not.toContain("pointer-events-none");
      expect(html).not.toContain("sr-only");
    }
  });
});
