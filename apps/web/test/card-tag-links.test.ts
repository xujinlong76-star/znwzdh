/**
 * 卡片 #tag 内链化（Batch C）。
 *
 * 改的是什么：rich 模式卡片原先把 `#{tag}` 渲染成 <span>，且整个标签池
 * 在卡片外链 <Link> 内部——既没有内链价值，也不能直接套 <Link>
 * （<a> 嵌 <a> 是非法 HTML，浏览器自动闭合外层，整卡点击当场坏掉，
 * 与 tag-results-board 双模式卡片同一纪律）。
 *
 * 这里锁四件事：
 *   1. rich 模式的 #tag 是真 <Link>，href 走 /tags/{slug}（tagSlug 与
 *      store slugify 同构——URL 形态与 sitemap、标签云一致，杜绝双 URL）；
 *   2. 标签池在卡片外链 </Link> 与 </CardHeader> **之后**（结构上不可能嵌套）；
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

  it("标签池在卡片外链 </Link> 与 </CardHeader> 之后——结构上杜绝 <a> 嵌 <a>", () => {
    const cardLinkOpen = richSrc.indexOf("href={safeHref(item.href)}");
    const cardLinkClose = richSrc.indexOf("</Link>", cardLinkOpen);
    const headerClose = richSrc.indexOf("</CardHeader>");
    const tagLink = richSrc.indexOf("href={'/tags/'");
    expect(cardLinkOpen).toBeGreaterThan(-1);
    expect(cardLinkClose).toBeGreaterThan(cardLinkOpen);
    // 嵌套序：</CardHeader> 先于 </Link>（Link 包着 CardHeader）
    expect(headerClose).toBeLessThan(cardLinkClose);
    // 标签链在两个闭合之后 → 手序上不可能嵌在卡片外链里
    expect(tagLink).toBeGreaterThan(headerClose);
    expect(tagLink).toBeGreaterThan(cardLinkClose);
  });

  it("卡片外链不再带 h-full（rich 网格同行拉伸会把手序标签池挤出 overflow-hidden）", () => {
    const cardLinkOpen = richSrc.indexOf("href={safeHref(item.href)}");
    // 只取 <Link 开标签的属性区——否则会误伤 CardHeader 里 favicon 的
    // `w-full h-full`（object-contain 图标）与注释文字里的 h-full
    const linkTag = richSrc.slice(richSrc.lastIndexOf("<Link", cardLinkOpen), richSrc.indexOf(">", cardLinkOpen));
    expect(linkTag).toContain('className="block"');
    expect(linkTag).not.toContain("h-full");
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
