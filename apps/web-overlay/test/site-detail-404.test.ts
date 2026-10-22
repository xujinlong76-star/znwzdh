import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 站点详情页软 404 消灭战的源码守卫（2026-10-21）。
 *
 * 背景：/site/<无效 id> 此前是整页 'use client'，无效 id 也返回
 * HTTP 200 + 「站点不存在」空态（软 404），link-graph 探针实测
 * /site/zz-probe-* 全部 200。修复形态：
 *   - page.tsx 降级为服务端壳：hubGetProbe 探中枢，确认不存在才 notFound()；
 *   - 原交互整体抽到 components/site-detail-view.tsx 客户端岛。
 *
 * 锁定四条不变量：
 *   1. 判定在 page 级（layout 渲染体抛 notFound 实测 dev 会回退 200）；
 *   2. 三态口径：只有 'miss'（API 确认 404）才 notFound()，
 *      'failed'（网络/中枢抖动）必须降级正常渲染，绝不误伤成 404；
 *   3. page 不再是 'use client'（服务端组件才能跑 hubGetProbe/notFound）；
 *   4. 客户端岛保留 'use client' 与原交互，接收 id 与服务端下发的首屏 initialSite。
 *
 * 另锁一条实测根因：本路由不得有 loading.tsx——骨架屏边界会先流式
 * 刷 HTTP 200，之后 notFound()（含 generateMetadata 里的）改不了状态码。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** 与 tag-metadata.test.ts 同款双候选解析：overlay 原位跑与 apps/web 镜像跑都能命中 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

describe("站点详情页软 404 判定（/site/<无效 id> 必须真 404）", () => {
  it("page 是服务端组件：含 hubGetProbe 存在性探针（/api/sites/:id，带 60s 缓存）", () => {
    const src = overlayFile("src/app/site/[id]/page.tsx");
    expect(src).not.toMatch(/^\s*['"]use client['"]/m);
    expect(src).toContain("import { hubGetProbe } from '@/lib/server/hub'");
    expect(src).toMatch(/hubGetProbe(?:<[^>]+>)?\(\s*['"]\/api\/sites\/['"]\s*\+\s*encodeURIComponent\(safeId\)\s*,\s*60\s*\)/);
  });

  it("只有 'miss'（中枢确认 404）才 notFound()，'failed' 降级渲染不误伤", () => {
    const src = overlayFile("src/app/site/[id]/page.tsx");
    expect(src).toContain("notFound()");
    // 铁律：判定必须精确匹配 'miss'，不能用 !== 'ok'（那会把 failed 也打成 404）
    expect(src).toMatch(/probe\.status\s*===\s*['"]miss['"]\s*\)\s*notFound\(\)/);
    expect(src).not.toMatch(/probe\.status\s*!==\s*['"]ok['"]/);
  });

  it("判定落在 page 渲染体（方案铁律）；标题改由 page 级 generateMetadata 逐站产出", () => {
    const src = overlayFile("src/app/site/[id]/page.tsx");
    expect(src).toMatch(/export\s+default\s+async\s+function\s+SiteDetailPage\b/);
    // 静态 metadata 仍不许导出：1013 个详情页会共享同一标题；
    // 必须走 generateMetadata 读运行时站点数据。
    expect(src).not.toMatch(/export\s+const\s+metadata\b/);
    expect(src).toMatch(/export\s+async\s+function\s+generateMetadata\b/);
  });

  it("每站独立 title/description/canonical；'failed' 只降级标题，不编造站点名", () => {
    const src = overlayFile("src/app/site/[id]/page.tsx");
    // 2026-10-22：标题后缀从固定的「站点详情」改为分类名——既补关键词，
    // 也消歧 71 组「同标题、不同 URL」的历史站点（ChatGPT / Cursor 官网迁移）。
    // 取不到分类时才退回原后缀，绝不编造。
    expect(src).toMatch(/title = `\$\{site\.title\} · \$\{categoryName \?\? '站点详情'\}`/);
    expect(src).toContain("alternates: { canonical }");
    expect(src).toContain("pageShareMetadata({ url: canonical, title, description })");
    expect(src).toContain("if (probe.status === 'failed')");
  });

  it("layout 不再保有静态 metadata（页面级元信息才是唯一来源）", () => {
    const src = overlayFile("src/app/site/[id]/layout.tsx");
    expect(src).not.toMatch(/export\s+const\s+metadata\b/);
    expect(src).not.toMatch(/export\s+(?:async\s+)?function\s+generateMetadata\b/);
  });

  it("本路由不得有 loading.tsx——骨架屏边界会先流式刷 200，notFound 就改不了状态码（实测根因）", () => {
    const candidates = [
      resolve(HERE, "..", "src/app/site/[id]/loading.tsx"),
      resolve(HERE, "..", "..", "web-overlay", "src/app/site/[id]/loading.tsx"),
    ];
    for (const p of candidates) {
      if (p.replace(/\\/g, "/").includes("/web-overlay/")) {
        expect(existsSync(p), `${p} 不应存在（软 404 根因回归锁）`).toBe(false);
      }
    }
  });

  it("客户端岛承接交互，并由壳下发 id + 首屏 initialSite（SSR 直出 h1 与正文）", () => {
    const pageSrc = overlayFile("src/app/site/[id]/page.tsx");
    expect(pageSrc).toContain("import { SiteDetailView } from '@/components/site-detail-view'");
    expect(pageSrc).toMatch(/<SiteDetailView\s+id=\{safeId\}\s+initialSite=\{site\}/);

    const islandSrc = overlayFile("src/components/site-detail-view.tsx");
    expect(islandSrc).toMatch(/^\s*['"]use client['"]/m);
    expect(islandSrc).toContain("export function SiteDetailView({");
    expect(islandSrc).toContain("initialSite = null");
    expect(islandSrc).toContain("initialRelated = []");
    // 首屏有服务端数据时不得再请求一次；重试仍走客户端
    expect(islandSrc).toContain("if (initialSite && reloadToken === 0) return");
  });
});

/**
 * F2：详情页站内内链闭环（2026-10-22）。
 *
 * 背景：/site/<id> 曾是内链死胡同——HTML 里 0 条 /site/、0 条 /category、
 * 0 个 JSON-LD，KNN 推荐全是客户端外链。修复：
 *   - 服务端按分类取同分类站点，首批 6 条 /site 内链直出；
 *   - BreadcrumbList 与可见面包屑同源（Breadcrumbs 服务端组件）；
 *   - 分类入口只在站点数达 MIN_SITES_FOR_CATEGORY_INDEX 时出现——分类页对薄分类
 *     直接 404，不能把爬虫送进死链。
 */
describe("站点详情页内链闭环（F2）", () => {
  it("服务端壳取同分类站点并下发，不依赖客户端 useEffect", () => {
    const src = overlayFile("src/app/site/[id]/page.tsx");
    expect(src).toContain("loadCategorySites(categoryId, RELATED_LIMIT + 1, 0, 300)");
    expect(src).toContain("initialRelated={context.related}");
    expect(src).toContain("await loadSiteContext(site)");
  });

  it("面包屑用服务端 Breadcrumbs（可见 DOM 与 BreadcrumbList 同源）", () => {
    const src = overlayFile("src/app/site/[id]/page.tsx");
    expect(src).toContain("import { Breadcrumbs } from '@/components/breadcrumbs'");
    expect(src).toContain("<Breadcrumbs items={crumbs}");
    expect(src).toContain("breadcrumb={<Breadcrumbs");
    expect(src).toContain("{ label: '全部站点', path: '/sites' }");
  });

  it("分类入口只链达标分类（低于分类门槛的页面是 404）", () => {
    const src = overlayFile("src/app/site/[id]/page.tsx");
    // 阈值已按权威树分档：分类走 MIN_SITES_FOR_CATEGORY_INDEX（12），
    // 与 sitemap / 分类页同源，避免这里用标签门槛把薄分类也链出去。
    expect(src).toContain("import { MIN_SITES_FOR_CATEGORY_INDEX } from '@/lib/seo/thresholds'");
    expect(src).toMatch(/categoryCount\s*>=\s*MIN_SITES_FOR_CATEGORY_INDEX/);
    // counts 取数失败（null）时不得赌分类存在
    expect(src).toMatch(/counts\s*!==\s*null/);
    expect(src).toContain("canLinkCategory={context.canLinkCategory}");
  });

  it("岛内把同分类站点渲染成站内 /site 链接，分类入口按 canLinkCategory 门控", () => {
    const src = overlayFile("src/components/site-detail-view.tsx");
    expect(src).toContain("initialRelated.length > 0");
    expect(src).toContain("href={`/site/${encodeURIComponent(s.id)}`}");
    expect(src).toContain("category && canLinkCategory");
    expect(src).toContain("href={`/category/${encodeURIComponent(category.slug)}`}");
  });
});
