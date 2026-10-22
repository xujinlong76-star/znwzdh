import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OG_IMAGE_SIZE,
  ogAscii,
  ogBestLabel,
  ogHost,
  ogImageUrl,
  ogSlugLabel,
} from "../src/lib/seo/og-text";

/**
 * 逐页动态分享图（2026-10-22）。
 *
 * 两件被这里锁住的事实：
 * 1. **Next 的优先级是 Metadata API 覆盖 `opengraph-image` 文件约定**。
 *    实测：`/marketplace/{slug}` 早就有 `opengraph-image.tsx`，但页面 og:image
 *    出的是工厂给的 `/og-default.png` —— 动态图成了永远没人请求的死路由。
 *    所以「加了图文件」不等于「分享有图」，imageUrl 必须由 pageShareMetadata
 *    显式写进 og/twitter。
 * 2. Satori 无 CJK 字体：中文名必须过滤成 ASCII 并逐级回退（站名 → 域名 /
 *    标题 → slug → 站点数），否则分享卡是一片空白。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OVERLAY = resolve(HERE, "..");

function overlayFile(rel: string): string {
  const p = resolve(OVERLAY, rel);
  if (!existsSync(p)) throw new Error("找不到 overlay 文件：" + p);
  return readFileSync(p, "utf8");
}

describe("分享图文本口径（og-text）", () => {
  it("ogAscii 过滤非 ASCII、压缩空白并按上限截断", () => {
    expect(ogAscii("法务与合规组合包")).toBe("");
    expect(ogAscii("AI 编程工具链")).toBe("AI");
    expect(ogAscii("  Google   Fonts  ")).toBe("Google Fonts");
    expect(ogAscii(null)).toBe("");
    expect(ogAscii("aaaaaaaaaaaaaaaaaaaa", 10)).toBe("aaaaaaaaaa");
  });

  it("ogHost 给出可渲染的域名，非法 URL 返回空串而不是抛错", () => {
    expect(ogHost("https://fonts.google.com")).toBe("fonts.google.com");
    expect(ogHost("https://www.yuque.com/book/1")).toBe("yuque.com");
    expect(ogHost("not a url")).toBe("");
    expect(ogHost(undefined)).toBe("");
  });

  it("ogSlugLabel 把 slug 变成标签形态（连字符转空格 + 大写）", () => {
    expect(ogSlugLabel("ai-coding")).toBe("AI CODING");
    expect(ogSlugLabel("design")).toBe("DESIGN");
    expect(ogSlugLabel("大模型")).toBe("");
  });

  it("ogBestLabel 按「达标即止」挑主标题，而不是谁长用谁", () => {
    // 标题只剩 AI（<3）→ 用 slug；站名够长 → 不被更长的域名顶掉
    expect(ogBestLabel(["AI 编程工具链", "AI CODING"])).toBe("AI CODING");
    expect(ogBestLabel(["Google Fonts", "fonts.google.com"])).toBe("Google Fonts");
    // 全部偏短才退回第一个非空 ASCII：单候选 X（1 字符）仍上画面
    expect(ogBestLabel(["X"])).toBe("X");
    expect(ogBestLabel(["X", ""])).toBe("X");
    // 有达标的候选时，短候选不会赢回来（顺序判定，不是最长判定）
    expect(ogBestLabel(["X", "X TOOLS"])).toBe("X TOOLS");
    expect(ogBestLabel(["大模型", "大模型"])).toBe("");
  });

  it("ogImageUrl 与页面路径一一对应，并且先剥掉查询串", () => {
    expect(ogImageUrl("/site/abc")).toBe("/site/abc/opengraph-image");
    // 分类页第 2 页起 canonical 带 ?page=N，直接拼会产出打不开的 URL
    expect(ogImageUrl("/category/cat-ai?page=2")).toBe("/category/cat-ai/opengraph-image");
    expect(ogImageUrl("/tags/ai")).toBe("/tags/ai/opengraph-image");
  });

  it("卡片尺寸是 1200×630（og 大图卡口径）", () => {
    expect(OG_IMAGE_SIZE).toEqual({ width: 1200, height: 630 });
  });
});

describe("逐页分享图路由", () => {
  const ROUTES: Array<[string, string]> = [
    ["src/app/site/[id]/opengraph-image.tsx", "SITE DIRECTORY"],
    ["src/app/category/[slug]/opengraph-image.tsx", "CATEGORY HUB"],
    ["src/app/tags/[slug]/opengraph-image.tsx", "TAG BROWSING"],
    ["src/app/collections/[slug]/opengraph-image.tsx", "CURATED COLLECTION"],
    ["src/app/marketplace/[slug]/opengraph-image.tsx", "PLUGIN MARKETPLACE"],
  ];

  for (const [rel, section] of ROUTES) {
    it(`${rel}：导出尺寸/类型/alt 并走统一构图`, () => {
      const src = overlayFile(rel);
      expect(src, rel + " 缺 ImageResponse").toContain("new ImageResponse(");
      expect(src, rel + " 缺 ogShareCard（五张卡共用一套构图）").toContain("ogShareCard({");
      expect(src).toContain("export const size = OG_IMAGE_SIZE");
      expect(src).toContain("export const contentType = OG_IMAGE_CONTENT_TYPE");
      expect(src).toContain("export const alt");
      expect(src).toContain(`sectionLabel: '${section}'`);
    });

    it(`${rel}：零外网请求、零字体资产（D3 决策）`, () => {
      const src = overlayFile(rel);
      expect(src).not.toMatch(/fetch\(\s*['"`]https?:/);
      expect(src).not.toContain("next/font");
      expect(src).not.toMatch(/\bfonts\s*:/);
    });
  }

  it("构图只有一份：光斑装饰在 og-card.tsx，不再散落到各路由", () => {
    const card = overlayFile("src/lib/seo/og-card.tsx");
    expect(card).toContain("position: 'absolute'");
    expect(card).toContain("borderRadius: 999");
  });
});

describe("og:image 与 canonical 同源", () => {
  const PAGES = [
    "src/app/site/[id]/page.tsx",
    "src/app/category/[slug]/page.tsx",
    "src/app/tags/[slug]/page.tsx",
    "src/app/collections/[slug]/page.tsx",
    "src/app/marketplace/[slug]/page.tsx",
  ];

  for (const rel of PAGES) {
    it(`${rel}：把 imageUrl 写进 pageShareMetadata（文件约定会被 Metadata API 顶掉）`, () => {
      const src = overlayFile(rel);
      expect(src).toContain("imageUrl: ogImageUrl(canonical)");
      // 只在「拿到真实数据」那一处指图：降级分支不指，避免卡片写 0 站这类假信息
      const hits = src.match(/imageUrl: ogImageUrl\(canonical\)/g) ?? [];
      expect(hits, rel + " 出现多处 imageUrl，降级分支可能也带上了").toHaveLength(1);
    });
  }

  it("分类分页 p/{n} 例外：卡片指第 1 页的动态图，不自指（该目录没有 opengraph-image）", () => {
    const src = overlayFile("src/app/category/[slug]/p/[n]/page.tsx");
    expect(src).toContain("imageUrl: ogImageUrl(categoryHref(urlKey, 1))");
    expect(src).not.toContain("imageUrl: ogImageUrl(canonical)");
  });

  it("工厂在 imageUrl 缺省时才退回静态品牌卡", () => {
    const src = overlayFile("src/lib/seo/metadata.ts");
    expect(src).toContain("input.imageUrl || DEFAULT_OG_IMAGE.url");
    // 未配置 origin 时宁可不出图，也不把 localhost 烤进分享卡
    expect(src).toContain("const shareImage = configuredSiteOrigin() ? image : null");
    // og 与 twitter 必须同一张图：twitter 只写默认图会让两平台预览不一致
    expect(src).toContain("...(shareImage ? { images: [shareImage] } : {})");
    expect(src).toContain("...(shareImage ? { images: [{ url: shareImage.url, alt: shareImage.alt }] } : {})");
  });
});
