/**
 * 插件详情死链 404（P2-7）：
 *
 * 缺陷实测（2026-11-17，dev server 3101）：
 *  - GET /marketplace/does-not-exist-slug 两次均为 HTTP 200；
 *  - SSR HTML 只有 loading 壳（「正在加载内容」），404 文案只在客户端渲染后出现；
 *  - 404 页只有「返回主页」，没有「返回插件市场」。
 *
 * 根因（与 /site/[id]、/collections/[slug] 已验证的同一根因）：
 *  - loading.tsx 边界让 Next 先流式刷出 HTTP 200 壳，之后 page /
 *    generateMetadata 里 notFound() 再抛也改不了状态码。实测抓包：
 *    可见 HTML 里是父级 /marketplace/loading.tsx 的 grid 骨架，
 *    RSC 流里 page 与 generateMetadata 都抛了 NEXT_HTTP_ERROR_FALLBACK;404，
 *    但状态码已锁定 200、404 文案始终没进 HTML。
 *  - 所以详情段上下两级 loading.tsx 必须一起去掉（只删 [slug] 那一级不够，
 *    父级边界同样先刷壳）；加载态由详情岛自带的骨架屏承接。
 *  - generateMetadata 里也不得抛 notFound()：实测它会把整个文档渲染一起
 *    abort，curl 只拿到 dev 错误模板（NEXT_HTTP_ERROR_FALLBACK;404），
 *    404 文案进不了 SSR HTML。状态码只由页面渲染体的 notFound() 负责；
 *    generateMetadata 对 miss/failed 一律回通用元信息兜底（404 不收录）。
 *  - 详情页自己的「插件未上架或不存在」态到不了：服务端 notFound() 先接走，
 *    404 页必须自带「返回插件市场」出口（走 recovery-links 数据，与其余出口同口径）。
 *
 * 锁：
 *  1. 两级 loading.tsx 都不存在；
 *  2. 只有页面渲染体在 probe 'miss' 时 notFound()，generateMetadata 不抛
 *     notFound（'failed' 仍降级渲染）；
 *  3. recovery-links 里有 /marketplace，404 页图标映射覆盖新图标键；
 *  4. 详情岛保留 loading 骨架屏与「插件未上架或不存在」兜底态。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { RECOVERY_LINKS } from "../src/lib/recovery-links";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const hit = candidates.find(
    (p) => p.replace(/\\/g, "/").endsWith("/web-overlay") && existsSync(join(p, "src", "app")),
  );
  if (!hit) throw new Error("无法定位 overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

function overlayFile(rel: string): string {
  return readFileSync(join(overlayRoot(), rel), "utf8");
}

function overlayExists(rel: string): boolean {
  return existsSync(join(overlayRoot(), rel));
}

describe("P2-7：死链详情页不得先刷 200 壳", () => {
  it("详情段上下两级 loading.tsx 都不存在（只删一级不够，父级边界同样先刷壳）", () => {
    expect(overlayExists("src/app/marketplace/[slug]/loading.tsx")).toBe(false);
    expect(overlayExists("src/app/marketplace/loading.tsx")).toBe(false);
  });

  it("只有页面渲染体在 probe 'miss' 时 notFound()，generateMetadata 不得抛", () => {
    const src = overlayFile("src/app/marketplace/[slug]/page.tsx");
    const misses = src.match(/probe\.status === 'miss'\)\s*notFound\(\)/g) ?? [];
    // 全文件仅一处：页面渲染体。generateMetadata 里抛会 abort 整个文档渲染
    //（实测 curl 只剩 dev 错误模板，404 文案进不了 SSR HTML）。
    expect(misses.length).toBe(1);
    const metaSection = src.slice(
      src.indexOf("export async function generateMetadata"),
      src.indexOf("export default"),
    );
    expect(metaSection).not.toMatch(/probe\.status === 'miss'/);
    expect(metaSection).toContain("probe.status !== 'ok'");
  });

  it("中枢抖动（'failed'）不走 notFound，页面仍降级渲染详情岛", () => {
    const src = overlayFile("src/app/marketplace/[slug]/page.tsx");
    expect(src).not.toMatch(/'failed'\)\s*notFound\(\)/);
    // 非 miss 时页面照常渲染岛（failed 时 initialPlugin=null，岛内 loading → 客户端重取）
    expect(src).toContain("initialPlugin={probe.status === 'ok' ? probe.data.plugin : null}");
  });

  it("详情岛保留 loading 骨架屏（去掉 loading.tsx 后加载体验的承接）", () => {
    const src = overlayFile("src/app/marketplace/[slug]/plugin-detail-view.tsx");
    expect(src).toContain("if (loading)");
    expect(src).toContain("animate-pulse");
  });

  it("详情岛保留「插件未上架或不存在」兜底态（客户端补取确认不存在时）", () => {
    const src = overlayFile("src/app/marketplace/[slug]/plugin-detail-view.tsx");
    expect(src).toContain("插件未上架或不存在");
    expect(src).toContain('href="/marketplace"');
  });
});

describe("P2-7：404 页有回插件市场出口", () => {
  it("recovery-links 里有 /marketplace（走数据，不写死在 404 页）", () => {
    const link = RECOVERY_LINKS.find((l) => l.href === "/marketplace");
    expect(link).toBeTruthy();
    expect(link!.label).toContain("插件市场");
    expect(link!.description.trim().length).toBeGreaterThan(0);
    expect(link!.icon).toBe("marketplace");
  });

  it("not-found.tsx 的图标映射覆盖 marketplace 键", () => {
    const src = overlayFile("src/app/not-found.tsx");
    expect(src).toMatch(/\bmarketplace:/);
    expect(src).toContain("RECOVERY_LINKS");
  });
});
