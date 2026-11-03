import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 站点详情性能守卫（2026-10-22）。
 *
 * 详情页是 sitemap 里数量最多的一族（千级）：每个请求四路取数
 * （详情 + 同分类 + 分类表 + 计数），不缓存就会被爬虫反复打穿。
 * 这里锁住三条口径：
 *   1. 页面与首屏取数同为 60s 增量缓存，HTML 命中后不再重新渲染；
 *   2. 不得恢复 loading.tsx——骨架屏边界会让 notFound() 变成流式 200；
 *   3. 图标类图片必须带显式尺寸 + 异步解码，避免列表页布局抖动。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayPath(rel: string): string | null {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  return (
    candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p)) ?? null
  );
}

function overlayFile(rel: string): string {
  const path = overlayPath(rel);
  if (!path) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(path, "utf8");
}

describe("站点详情性能", () => {
  it("详情页开启 60s ISR，首屏取数与页面缓存窗口一致", () => {
    const page = overlayFile("src/app/site/[id]/page.tsx");
    expect(page).toContain("export const revalidate = 60");
    expect(page).toContain("hubGetProbe<HubSite>('/api/sites/'");
    expect(page).toMatch(/encodeURIComponent\(safeId\),\s*60\)/);
  });

  it("动态段提供空 generateStaticParams，否则只写 revalidate 不会进 ISR", () => {
    const page = overlayFile("src/app/site/[id]/page.tsx");
    expect(page).toMatch(/export async function generateStaticParams\(\)\s*\{\s*return \[\]/);
  });

  it("详情页没有 loading.tsx（否则软 404 会退化成 200）", () => {
    expect(overlayPath("src/app/loading.tsx")).toBeNull();
    expect(overlayPath("src/app/site/[id]/loading.tsx")).toBeNull();
  });

  it("SiteFavicon 图片具备懒加载与异步解码（尺寸由自适应容器负责）", () => {
    const favicon = overlayFile("src/components/site-favicon.tsx");
    expect(favicon).toContain('loading="lazy"');
    expect(favicon).toContain('decoding="async"');
    // 2026-11-03 起图标按 className 自适应（w-16/w-12 大容器，见 site-icon-redesign 守卫），
    // 不再写死 24×24：继续钉 width={24} 会与那条守卫正面对撞。
    // 防抖动改由调用方的固定尺寸容器保证（见下一个用例）。
    expect(favicon).not.toContain("width={24}");
  });

  it("搜索下拉与插件详情图标补齐显式尺寸", () => {
    const searchBar = overlayFile("src/components/search-bar.tsx");
    // 2026-11-03 架构调整：下拉图标统一收口到 SiteFavicon（它自己给 img 写死 24×24，
    // 并在内部拦掉远程裸 favicon），调用方不再内联 <img width={32} height={32}>。
    // 尺寸契约因此落在「图标位是固定 32px 容器」上：仍然要求显式尺寸，只是换了层，
    // 继续钉字面 width={32} 只会锁住已经删掉的旧实现。
    const sizedBoxes = searchBar.match(/flex-shrink-0 w-8 h-8/g) ?? [];
    expect(sizedBoxes.length).toBe(2);

    const pluginDetail = ["plugin-detail-view.tsx", "detail-tab-panels.tsx", "detail-modals.tsx"]
      .map((f) => overlayFile(`src/app/marketplace/[slug]/${f}`))
      .join(String.fromCharCode(10));
    expect(pluginDetail).toContain("width={16}");
    expect(pluginDetail).toContain("height={16}");
  });
});
