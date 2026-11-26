/**
 * 卡片 #tag 内链化（Batch C）。
 *
 * 改的是什么：rich 模式卡片原先把 `#{tag}` 渲染成 <span>，且整个标签池
 * 在卡片外链 <Link> 内部——既没有内链价值，也不能直接套 <Link>
 * （<a> 嵌 <a> 是非法 HTML，浏览器自动闭合外层，整卡点击当场坏掉，
 * 与 tag-results-board 双模式卡片同一纪律）。
 *
 * 现在（#14）卡片改为「自闭合外链覆盖层 + 内容层 + 操作层」三兄弟结构：
 * 外链是空锚铺满整卡，标题内链、标签池、操作按钮都在它之外。
 *
 * 这里锁四件事：
 *   1. rich 模式的 #tag 是真 <Link>，href 走 /tags/{slug}（tagSlug 与
 *      store slugify 同构——URL 形态与 sitemap、标签云一致，杜绝双 URL）；
 *   2. 标签池、标题内链与外链覆盖层是**兄弟节点**：外链自闭合在 CardHeader
 *      之前，结构上不存在 <a> 嵌 <a>；
 *   3. 多选模式下标签点击与整卡同语义（不导航、只切换选中）；
 *   4. 紧凑/标准模式不渲染标签（首页三密度保持现状，不顺手加）。
 *
 * 四条交互（拖拽 / 多选 / 置顶 / peek）的回归由 batch-selection、
 * keyboard-activation、pwa-offline 三个既有守卫覆盖，本文件不重复。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

const src = overlayFile("src/components/navigation-card.tsx");
const slugHelper = overlayFile("src/lib/seo/tag-slug.ts");

/** rich 模式分支切片：从分支判断到标准模式注释之前 */
const richStart = src.indexOf("cardDisplayMode === 'rich'");
const standardStart = src.indexOf("// 3. 标准现代卡片");
const richSrc = src.slice(richStart, standardStart);

describe("卡片 #tag 内链化（rich 模式，S4 迁移后双源口径）", () => {
  // S4 迁移（2026-11-26）：rich 档解剖收进 SiteCard（banner 槽落 grid），
  // 手写的覆盖层/CardHeader/标签池结构断言移交原语契约；调用方只断言
  // 槽位字面量（标签芯片 / 平替 / 深链）与迁移完成度（Card 系列归零）。
  const siteCardSrc = overlayFile("src/components/site-card.tsx");

  it("切片定位成功（守卫自身没失效）", () => {
    expect(richStart).toBeGreaterThan(-1);
    expect(standardStart).toBeGreaterThan(richStart);
  });

  it("#tag 渲染成真 <Link>，href 走 /tags/{slug}", () => {
    expect(richSrc).toContain("href={'/tags/' + encodeURIComponent(tagSlug(tag))}");
    // 视觉形态不能丢：10px mono 圆角胶囊（最多 2 个）+ hover 反馈。
    expect(richSrc).toContain("text-[10px] px-1.5 py-0.5 rounded-full bg-muted/70 text-muted-foreground font-mono");
    expect(richSrc).toContain("hover:bg-primary/10 hover:text-primary transition-colors");
  });

  it("rich 段不再自绘解剖：shadcn Card 系列与手写 <a> 全部归零", () => {
    // 注意：CardThumbnailVisual / CardHealthBadge 是槽位内容组件（Card 前缀巧合），
    // 不在本断言范围；精确匹配 shadcn Card 系列标签。
    expect(richSrc).not.toMatch(/<Card[\s/>]/);
    expect(richSrc).not.toContain("<CardHeader");
    expect(richSrc).not.toContain("<CardTitle");
    expect(richSrc).not.toContain("<CardDescription");
    // 覆盖层锚点也移交原语：richSrc 不再手写 <a，改经 overlayProps 透传
    expect(richSrc).not.toMatch(/<a\s/);
    expect(richSrc).toContain("'data-prefetch-target': 'true'");
  });

  it("外链覆盖层是自闭合兄弟锚点（SiteCard 原语契约：无 <a> 嵌 <a>）", () => {
    // 原语侧：覆盖层与内容层互为兄弟，内容层 pointer-events-none
    expect(siteCardSrc).toContain("absolute inset-0 z-0");
    expect(siteCardSrc).toContain("pointer-events-none relative z-10");
    // 调用方侧：rich 槽内容里可点元素显式 pointer-events-auto（标签芯片）
    expect(richSrc).toContain("pointer-events-auto inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-muted/70");
  });

  it("外链覆盖层绝对定位铺满且不带 h-full（不参与网格同行拉伸）", () => {
    const anchorCls = siteCardSrc.slice(siteCardSrc.indexOf("absolute inset-0 z-0"));
    expect(anchorCls).toContain("absolute inset-0 z-0");
    expect(anchorCls.slice(0, 200)).not.toContain("h-full");
  });

  it("多选模式下标签点击与整卡同语义：不导航，只切换选中", () => {
    expect(src).toContain("const handleTagClick");
    expect(src).toContain("onClick={handleTagClick}");
    // 非多选直接放行（Link 默认导航）；多选才 preventDefault
    const idx = src.indexOf("const handleTagClick");
    const body = src.slice(idx, idx + 320);
    expect(body).toContain("if (!selectable) return");
    expect(body.indexOf("if (!selectable) return")).toBeLessThan(body.indexOf("preventDefault"));
    expect(body).toContain("onToggleSelect?.(item.id)");
  });

  /**
   * 2026-11-08 更新：当前实现里**标准模式也渲染标签栏**（带
   * 「保持双列网格垂直重心平衡」设计注释），这是有意的产品改动，不是回归。
   * 旧断言「标准模式不得含 /tags/」会把合理演进误判成缺陷。
   *
   * 真正要守住的是 a11y 契约：卡片内**唯一 Tab 停留点是主链接**。
   * 因此换成更强的断言——所有 /tags/ 标签链接都必须退出 Tab 序列，
   * 且对 rich 段与标准段同时成立（E2E card-keyboard.spec.ts 实测计数=1）。
   */
  it("所有 #tag 标签链接都退出 Tab 序列（卡片单一 Tab 入口）", () => {
    const tagLinkBlocks: string[] = [];
    let cursor = 0;
    while (true) {
      const start = src.indexOf("href={'/tags/'", cursor);
      if (start < 0) break;
      const end = src.indexOf("</Link>", start);
      tagLinkBlocks.push(src.slice(start, end < 0 ? start + 240 : end));
      cursor = end < 0 ? start + 1 : end + 1;
    }
    const allTagLinks = tagLinkBlocks;
    expect(allTagLinks.length).toBeGreaterThanOrEqual(2); // rich + 标准各一处
    for (const link of allTagLinks) {
      expect(link).toContain("tabIndex={-1}");
    }
    // 紧凑模式分支确实不渲染标签（切片在 rich 分支之前）
    expect(src.slice(0, richStart)).not.toContain("href={'/tags/'");
  });

  it("tagSlug 助手存在且与 store slugify 同构的契约有测试", () => {
    expect(slugHelper).toContain("export function tagSlug");
    expect(slugHelper).toContain("packages/store/src/repository/dialect.ts");
    // Parity 测试在 scripts/ 层直接对跑两侧实现
    const parity = resolve(HERE, "..", "..", "..", "scripts/tag-slug-parity.test.ts");
    expect(existsSync(parity)).toBe(true);
  });
});
