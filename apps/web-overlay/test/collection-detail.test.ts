import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 合集详情与 /hot 服务端化（2026-10-21）。
 *
 * 两个页面共同的退化风险：客户端整页取数 → 站点卡片与 `/site/{id}` 内链
 * 不进 SSR HTML（孤岛问题的来源）；以及 notFound() 之前先流式刷出 200 壳
 * （软 404）。
 *
 * 锁：
 *   1. page 是服务端组件，metadata / 面包屑 / JSON-LD / 首屏数据都在服务端；
 *   2. 客户端岛只承接交互，首帧吃 props（SSR 内链进 HTML）；
 *   3. `/collections` 及其子路由不得有 loading.tsx——实测它会让不存在的
 *      合集先返回 200（软 404），与 /site/[id] 同一根因；
 *   4. 旧的 layout 壳已删除，metadata 不再有两处来源。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel + "（候选：" + candidates.join(" | ") + "）");
  return readFileSync(hit, "utf8");
}

function overlayExists(rel: string): boolean {
  return [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)].some(
    (p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p),
  );
}

describe("/collections/[slug]：服务端壳 + 客户端岛", () => {
  it("page 不再 'use client'，metadata 与首屏数据在服务端", () => {
    const src = overlayFile("src/app/collections/[slug]/page.tsx");
    expect(src).not.toMatch(/^['"]use client['"]/m);
    expect(src).toMatch(/export\s+async\s+function\s+generateMetadata\b/);
    expect(src).toContain("hubGetProbe");
    expect(src).toMatch(/probe\.status\s*===\s*'miss'\)\s*notFound\(\)/);
    expect(src).toMatch(/<CollectionDetailView\s+slug=\{safeSlug\}/);
    expect(src).toContain("initialCollection={collection}");
    expect(src).toContain("initialSites={sites}");
  });

  it("服务端输出面包屑与 ItemList（爬虫首轮可见）", () => {
    const src = overlayFile("src/app/collections/[slug]/page.tsx");
    expect(src).toContain("<Breadcrumbs");
    expect(src).toContain("itemListLd(");
    expect(src).toContain("<JsonLd");
  });

  it("客户端岛首帧吃 props，且站点卡片带 /site/{id} 内链", () => {
    const src = overlayFile("src/app/collections/[slug]/collection-detail-view.tsx");
    expect(src).toMatch(/^['"]use client['"]/m);
    expect(src).toContain("initialCollection");
    expect(src).toContain("initialSites");
    expect(src).toContain("reloadToken === 0");
    expect(src).toContain("href={`/site/${encodeURIComponent(site.id)}`}");
  });

  it("旧 layout 已删除（metadata 不再双来源）", () => {
    expect(overlayExists("src/app/collections/[slug]/layout.tsx")).toBe(false);
  });
});

describe("/collections 段不得有 loading.tsx（软 404 根因回归锁）", () => {
  it("合集索引与详情路由都没有骨架屏边界", () => {
    // 实测（2026-10-21 dev + curl）：父级 loading.tsx 会先流式刷 200，
    // 之后 generateMetadata 里的 notFound() 改不了状态码，
    // /collections/does-not-exist 返回 200 + not-found 内容。
    expect(overlayExists("src/app/collections/loading.tsx")).toBe(false);
    expect(overlayExists("src/app/collections/[slug]/loading.tsx")).toBe(false);
  });
});

describe("/hot：服务端壳 + 客户端岛", () => {
  it("page 是服务端组件并挂岛，metadata 从 layout 迁回 page", () => {
    const src = overlayFile("src/app/hot/page.tsx");
    expect(src).not.toMatch(/^['"]use client['"]/m);
    // 静态与动态两种 metadata 形式都算「迁回 page」——页面在 00:16 改为
    // generateMetadata（服务端），断言原只认静态字面量导致误红
    expect(src).toMatch(/export (const metadata|async function generateMetadata)/);
    expect(src).toContain("<HotView");
    expect(src).toContain("initialTrending={trending}");
    expect(src).toContain("initialFresh={fresh}");
    expect(overlayExists("src/app/hot/layout.tsx")).toBe(false);
  });

  it("HotView 首帧吃 props，站点卡片带 /site/{id} 内链", () => {
    const src = overlayFile("src/app/hot/hot-view.tsx");
    expect(src).toMatch(/^['"]use client['"]/m);
    expect(src).toContain("reloadToken === 0");
    expect(src).toContain("href={`/site/${encodeURIComponent(site.id)}`}");
    // 降级行为仍随岛（提示条 + 重试）
    expect(src).toContain("HubDegradedNotice");
    expect(src).toContain("describeDegrade(error, '榜单数据')");
  });
});
