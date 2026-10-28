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
const standardSrc = src.slice(standardStart);

describe("卡片 #tag 内链化（rich 模式）", () => {
  it("切片定位成功（守卫自身没失效）", () => {
    expect(richStart).toBeGreaterThan(-1);
    expect(standardStart).toBeGreaterThan(richStart);
  });

  it("#tag 渲染成真 <Link>，href 走 /tags/{slug}", () => {
    expect(richSrc).toContain("href={'/tags/' + encodeURIComponent(tagSlug(tag))}");
    // 视觉形态不能丢：还是原来那个 10px mono 小芯片（只加 hover 反馈）
    expect(richSrc).toContain("text-[10px] px-1.5 py-0.5 rounded bg-muted/70 text-muted-foreground font-mono");
    expect(richSrc).toContain("hover:bg-primary/10 hover:text-primary transition-colors");
  });

  it("外链是自闭合覆盖层：CardHeader 不在 <a> 里——结构上杜绝 <a> 嵌 <a>", () => {
    const overlayAnchor = richSrc.indexOf("href={safeHref(item.href)}");
    const anchorOpen = richSrc.lastIndexOf("<a", overlayAnchor);
    const anchorClose = richSrc.indexOf("/>", overlayAnchor);
    const headerOpen = richSrc.indexOf("<CardHeader");
    expect(overlayAnchor).toBeGreaterThan(-1);
    expect(anchorOpen).toBeGreaterThan(-1);
    // 覆盖层在 CardHeader 之前就自闭合：它没有包住任何内容
    expect(anchorClose).toBeGreaterThan(overlayAnchor);
    expect(anchorClose).toBeLessThan(headerOpen);
    expect(richSrc.slice(anchorOpen, anchorClose)).not.toContain("</a>");
  });

  it("标签池在 CardHeader 之后（手序上不可能嵌进外链或标题内链）", () => {
    const headerClose = richSrc.indexOf("</CardHeader>");
    const tagLink = richSrc.indexOf("href={'/tags/'");
    expect(headerClose).toBeGreaterThan(-1);
    expect(tagLink).toBeGreaterThan(headerClose);
  });

  it("内容层 pointer-events-none，只有真可点元素放行（点空白仍走外链）", () => {
    expect(richSrc).toContain("relative z-10 pointer-events-none");
    // 标题内链
    const titleLink = richSrc.indexOf("href={siteDetailHref}");
    expect(titleLink).toBeGreaterThan(-1);
    const titleTag = richSrc.slice(richSrc.lastIndexOf("<Link", titleLink), richSrc.indexOf(">", titleLink));
    expect(titleTag).toContain("pointer-events-auto");
    // 标签芯片
    expect(richSrc).toContain("pointer-events-auto inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-muted/70");
  });

  it("外链覆盖层绝对定位铺满且不带 h-full（不参与网格同行拉伸）", () => {
    const overlayAnchor = richSrc.indexOf("href={safeHref(item.href)}");
    const anchorTag = richSrc.slice(richSrc.lastIndexOf("<a", overlayAnchor), richSrc.indexOf(">", overlayAnchor));
    expect(anchorTag).toContain('className="absolute inset-0');
    expect(anchorTag).not.toContain("h-full");
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

  it("紧凑/标准模式不渲染标签（三密度保持现状）", () => {
    expect(standardSrc).not.toContain("href={'/tags/'");
    expect(standardSrc).not.toContain("tagSlug");
  });

  it("tagSlug 助手存在且与 store slugify 同构的契约有测试", () => {
    expect(slugHelper).toContain("export function tagSlug");
    expect(slugHelper).toContain("packages/store/src/repository/dialect.ts");
    // Parity 测试在 scripts/ 层直接对跑两侧实现
    const parity = resolve(HERE, "..", "..", "..", "scripts/tag-slug-parity.test.ts");
    expect(existsSync(parity)).toBe(true);
  });
});
