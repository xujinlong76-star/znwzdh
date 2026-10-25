import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 品牌名收敛 + 缺 origin 时不输出分享图（2026-10-22）。
 *
 * 两件实测出来的事：
 * 1. **品牌漂移不是数据问题，是取数可达性问题**。`site.json` 的 `basic.title`
 *    有两条来源：中枢（后台可配）与 vendor 落下来的上游基线（值是上游品牌
 *    `NavSphere导航`）。同一套 title 模板因此在一轮全量审计里产出
 *    263 页「- NavHub 导航」与 288 页「- NavSphere导航」，`og:site_name` 一起漂。
 *    上游基线文件不在 git 里，改数据改不动，只能在代码里收敛。
 * 2. **缺 `NAVHUB_SITE_URL` 时 Next 用 `http://localhost:3000` 兜底 metadataBase**，
 *    于是 og:image 被绝对化成别人机器上的地址。带 `revalidate` 的页一个周期自愈，
 *    `revalidate=false` 的静态页是永久快照（实测 `/algorithms` 三连 HIT）。
 *    所以缺 origin 时宁可不输出图，也不要一个指向本机的图。
 */

vi.mock("@/lib/github", () => ({
  // 不给真实实现：测试环境默认 STORAGE_ADAPTER=http，真读一次会打 :8787，
  // 中枢在不在会让 siteName 的取值随环境漂移。
  getFileContent: vi.fn(async () => ({ basic: { title: "NavSphere导航" } })),
}));

const { FALLBACK_BRAND, normalizeBrandName, pageShareMetadata } = await import("../src/lib/seo/metadata");

const HERE = dirname(fileURLToPath(import.meta.url));
const OVERLAY = resolve(HERE, "..");

function overlayFile(rel: string): string {
  const p = resolve(OVERLAY, rel);
  if (!existsSync(p)) throw new Error("找不到 overlay 文件：" + p);
  return readFileSync(p, "utf8");
}

const ORIGINAL_SITE_URL = process.env.NAVHUB_SITE_URL;

afterEach(() => {
  if (ORIGINAL_SITE_URL === undefined) delete process.env.NAVHUB_SITE_URL;
  else process.env.NAVHUB_SITE_URL = ORIGINAL_SITE_URL;
});

describe("品牌名收敛", () => {
  it("上游品牌与空值一律回落到统一口径", () => {
    expect(FALLBACK_BRAND).toBe("NavHub 导航");
    expect(normalizeBrandName("NavSphere导航")).toBe(FALLBACK_BRAND);
    expect(normalizeBrandName(" NavSphere 导航 ")).toBe(FALLBACK_BRAND);
    expect(normalizeBrandName("navsphere")).toBe(FALLBACK_BRAND);
    expect(normalizeBrandName("")).toBe(FALLBACK_BRAND);
    expect(normalizeBrandName(undefined)).toBe(FALLBACK_BRAND);
    expect(normalizeBrandName(null)).toBe(FALLBACK_BRAND);
  });

  it("后台真配的品牌名原样透出（收敛只针对漂移，不是覆盖人工配置）", () => {
    expect(normalizeBrandName("示例导航")).toBe("示例导航");
    expect(normalizeBrandName(" 示例导航 ")).toBe("示例导航");
  });

  it("取数结果为上游品牌时，工厂给出的 siteName 也是收敛后的值", async () => {
    process.env.NAVHUB_SITE_URL = "https://nav.example";
    const md = await pageShareMetadata({ url: "https://nav.example/sites", title: "站点目录", description: "描述" });
    expect(md.openGraph.siteName).toBe(FALLBACK_BRAND);
  });
});

describe("缺 NAVHUB_SITE_URL 时不输出分享图", () => {
  it("没有 origin：og/twitter 都不带 images，但四个根字段仍在", async () => {
    delete process.env.NAVHUB_SITE_URL;
    const md = await pageShareMetadata({ url: "/sites", title: "站点目录", description: "描述" });
    expect(md.openGraph.images).toBeUndefined();
    expect(md.twitter.images).toBeUndefined();
    // 整体替换语义的防线仍在：type/siteName/locale 不能因为「没图」一起消失
    expect(md.openGraph.type).toBe("website");
    expect(md.openGraph.locale).toBe("zh_CN");
    expect(md.openGraph.siteName).toBeTruthy();
    expect(md.twitter.card).toBe("summary_large_image");
  });

  it("配了 origin：出图，且逐页动态图 URL 优先于默认图", async () => {
    process.env.NAVHUB_SITE_URL = "https://nav.example";
    const withDefault = await pageShareMetadata({ url: "/sites", title: "站点目录", description: "描述" });
    expect(withDefault.openGraph.images?.[0]?.url).toBe("/og-default.png");
    expect(withDefault.twitter.images?.[0]?.url).toBe("/og-default.png");

    const withDynamic = await pageShareMetadata({
      url: "/site/abc",
      title: "某站点",
      description: "描述",
      imageUrl: "/site/abc/opengraph-image",
      imageAlt: "某站点 分享图",
    });
    expect(withDynamic.openGraph.images?.[0]?.url).toBe("/site/abc/opengraph-image");
    expect(withDynamic.openGraph.images?.[0]?.alt).toBe("某站点 分享图");
    expect(withDynamic.twitter.images?.[0]?.url).toBe("/site/abc/opengraph-image");
  });

  it("非法 origin（带路径/查询）不算有配置——避免拼出错误绝对地址", async () => {
    process.env.NAVHUB_SITE_URL = "https://nav.example/app?x=1";
    const md = await pageShareMetadata({ url: "/sites", title: "站点目录", description: "描述" });
    expect(md.openGraph.images).toBeUndefined();
  });
});

describe("源码钉子", () => {
  it("/algorithms 必须带 revalidate：否则坏快照没有自愈周期", () => {
    const src = overlayFile("src/app/algorithms/page.tsx");
    expect(src).toMatch(/export const revalidate = \d+/);
  });

  it("根布局与工厂都按 origin 门控图片，不无条件输出", () => {
    expect(overlayFile("src/lib/seo/metadata.ts")).toContain("configuredSiteOrigin() ? image : null");
    expect(overlayFile("src/app/layout.tsx")).toMatch(/\.\.\.\(origin \? \{ images:/);
  });
});

// mock 卫生（D2）：清除本文件的模块 mock 缓存，避免驻留同 worker 的后续文件
afterAll(() => {
  vi.resetModules();
});
