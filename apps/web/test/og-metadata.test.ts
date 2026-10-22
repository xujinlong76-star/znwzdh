import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * G1：分享卡元信息统一（2026-10-22）。
 *
 * 根因：Next 对 openGraph 是整体替换不是深合并——页面级 `openGraph: { url }`
 * 会把根布局的 type/siteName/locale/images 整体顶掉，9 个主要模板 0 个
 * og:image。修复：页面级一律经 pageShareMetadata()，默认图必须真实存在。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OVERLAY = resolve(HERE, "..");

function overlayFile(rel: string): string {
  const p = resolve(OVERLAY, rel);
  if (!existsSync(p)) throw new Error("找不到 overlay 文件：" + p);
  return readFileSync(p, "utf8");
}

const MIGRATED = [
  "page.tsx",
  "algorithms/page.tsx",
  "graph/page.tsx",
  "hot/page.tsx",
  "videos/page.tsx",
  "category/page.tsx",
  "category/[id]/page.tsx",
  "collections/layout.tsx",
  "collections/[slug]/page.tsx",
  "submit/page.tsx",
  "sites/page.tsx",
  "site/[id]/page.tsx",
];

describe("分享元信息（G1）", () => {
  it("默认分享图真实存在，PNG 头宽高为 1200×630", () => {
    const p = resolve(OVERLAY, "public/og-default.png");
    expect(existsSync(p), "public/og-default.png 缺失会让 og:image 404").toBe(true);
    const buf = readFileSync(p);
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
  });

  it("helper 始终带 type/siteName/locale/images，并输出大图卡 twitter", () => {
    const src = overlayFile("src/lib/seo/metadata.ts");
    expect(src).toContain("type: 'website'");
    expect(src).toContain("siteName,");
    expect(src).toContain("locale: 'zh_CN'");
    expect(src).toContain("images: [");
    expect(src).toContain("card: 'summary_large_image'");
    expect(src).toContain("/og-default.png");
  });

  it("已迁移页面全部走 pageShareMetadata，不再裸写 openGraph 对象", () => {
    for (const rel of MIGRATED) {
      const src = overlayFile("src/app/" + rel);
      expect(src, rel + " 未接入 pageShareMetadata").toContain("pageShareMetadata({");
      expect(src, rel + " 仍有裸 openGraph 字面量").not.toMatch(/^\s*openGraph:\s*\{/m);
    }
  });
});
