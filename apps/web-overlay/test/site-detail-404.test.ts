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
 *   4. 客户端岛保留 'use client' 与原交互，只接收 id。
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
    expect(src).toMatch(/hubGetProbe\(\s*['"]\/api\/sites\/['"]\s*\+\s*encodeURIComponent\(id\)\s*,\s*60\s*\)/);
  });

  it("只有 'miss'（中枢确认 404）才 notFound()，'failed' 降级渲染不误伤", () => {
    const src = overlayFile("src/app/site/[id]/page.tsx");
    expect(src).toContain("notFound()");
    // 铁律：判定必须精确匹配 'miss'，不能用 !== 'ok'（那会把 failed 也打成 404）
    expect(src).toMatch(/probe\.status\s*===\s*['"]miss['"]\s*\)\s*notFound\(\)/);
    expect(src).not.toMatch(/probe\.status\s*!==\s*['"]ok['"]/);
  });

  it("判定落在 page 渲染体（方案铁律），且不导出 metadata（标题仍在 layout，不顶掉 792d700）", () => {
    const src = overlayFile("src/app/site/[id]/page.tsx");
    expect(src).toMatch(/export\s+default\s+async\s+function\s+SiteDetailPage\b/);
    // page 不许再导出 metadata：route-titles 扫描 page 优先，会顶掉 layout 的标题来源
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

  it("客户端岛承接原交互：SiteDetailView 保留 'use client'，由壳下发 id", () => {
    const pageSrc = overlayFile("src/app/site/[id]/page.tsx");
    expect(pageSrc).toContain("import { SiteDetailView } from '@/components/site-detail-view'");
    expect(pageSrc).toMatch(/<SiteDetailView\s+id=\{id\}\s*\/>/);

    const islandSrc = overlayFile("src/components/site-detail-view.tsx");
    expect(islandSrc).toMatch(/^\s*['"]use client['"]/m);
    expect(islandSrc).toContain("export function SiteDetailView({ id }: { id: string })");
  });
});
