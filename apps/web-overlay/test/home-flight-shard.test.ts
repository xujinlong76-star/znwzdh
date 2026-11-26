/**
 * 首页 flight 分片（2026-11-26 perf/flight-shard-1126）。
 *
 * 契约：
 * 1. 轻量索引只含元数据（id/标题/站点数/子分类结构），绝不含站点记录；
 * 2. 索引占位（stub）的站点数与占位高度与真实分类一致
 *    （countCategorySites / estimateTruncatedSectionHeight 读 totalCount）；
 * 3. 服务端只把前 initialCategoryLimit 个分类的全量数据放进 flight，
 *    其余分类经 GET /api/home/navigation?category=<id> 按需取数；
 * 4. 按需取数的分类与首页 navigationData 里的条目逐字等值
 *    （同一套 process + filter）。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { countCategorySites, estimateTruncatedSectionHeight } from "../src/lib/modular/category-counts";
import {
  buildHomeCategoryIndex,
  categoryIndexToStub,
  isCategoryIndexStub,
} from "../src/lib/modular/category-index";
import { filterNavigationData, processNavigationData } from "../src/lib/data-loader";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 同时支持从 apps/web-overlay/test 与 apps/web/test（镜像副本）运行 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.replace(/\\/g, "/").includes("/web-overlay/") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8");
}

const item = (id: string) => ({ id, title: id, href: "https://example.com/" + id });

/** 两个分类：AI 工具（2 直接 + 子一 3 + 子二 1 = 6）与设计（子一 2 = 2） */
const categories = [
  {
    id: "reg-ai-tools",
    title: "AI 工具",
    icon: "/ai.svg",
    enabled: true,
    items: [item("a1"), item("a2")],
    subCategories: [
      { id: "s1", title: "子一", items: [item("b1"), item("b2"), item("b3")] },
      { id: "s2", title: "子二", items: [item("c1")] },
    ],
  },
  {
    id: "reg-design",
    title: "设计",
    enabled: true,
    items: [],
    subCategories: [{ id: "d1", title: "子一", items: [item("e1"), item("e2")] }],
  },
];

describe("buildHomeCategoryIndex：轻量索引只含元数据", () => {
  it("每条含 id/标题/站点数/子分类结构，且不含任何站点记录", () => {
    const index = buildHomeCategoryIndex(categories as never);
    expect(index).toHaveLength(2);
    expect(index[0]).toEqual({
      id: "reg-ai-tools",
      title: "AI 工具",
      enabled: true,
      icon: "/ai.svg",
      totalCount: 6,
      subCategories: [
        { id: "s1", title: "子一", totalCount: 3 },
        { id: "s2", title: "子二", totalCount: 1 },
      ],
    });
    expect(index[1].totalCount).toBe(2);
    // 索引里不出现任何站点 id / href / 描述
    const serialized = JSON.stringify(index);
    expect(serialized).not.toContain("a1");
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("items");
  });

  it("空分类的 totalCount 为 0（未分类不进占位渲染）", () => {
    const index = buildHomeCategoryIndex([{ id: "cat-uncategorized", title: "未分类" }] as never);
    expect(index[0].totalCount).toBe(0);
    expect(index[0].subCategories).toEqual([]);
  });
});

describe("categoryIndexToStub / isCategoryIndexStub：索引占位", () => {
  it("占位无站点记录、只有 totalCount + 结构，且被识别为占位", () => {
    const index = buildHomeCategoryIndex(categories as never);
    const stub = categoryIndexToStub(index[0]);
    expect(stub.id).toBe("reg-ai-tools");
    expect(stub.totalCount).toBe(6);
    expect(stub.items).toEqual([]);
    // 子分类 items 为 undefined（不是 []）：侧栏用 !sub.items 过滤，[] 会把子分类滤掉
    expect(stub.subCategories?.[0].items).toBeUndefined();
    expect(stub.subCategories?.[0].totalCount).toBe(3);
    expect(isCategoryIndexStub(stub)).toBe(true);
  });

  it("已加载的分类不是占位；空分类（totalCount 0）也不是占位", () => {
    expect(isCategoryIndexStub(categories[0] as never)).toBe(false);
    const empty = categoryIndexToStub(
      buildHomeCategoryIndex([{ id: "cat-uncategorized", title: "未分类" }] as never)[0],
    );
    // totalCount 为 0 的占位仍算占位（无条目可加载），但渲染层按 count>0 过滤
    expect(isCategoryIndexStub(empty)).toBe(true);
    expect(isCategoryIndexStub(undefined)).toBe(false);
    expect(isCategoryIndexStub(null)).toBe(false);
  });
});

describe("countCategorySites / estimateTruncatedSectionHeight：占位读 totalCount", () => {
  it("占位的站点数等于 totalCount（含直接条目，不只子分类之和）", () => {
    const index = buildHomeCategoryIndex(categories as never);
    const stub = categoryIndexToStub(index[0]);
    // 直接 2 + 子一 3 + 子二 1 = 6；若只加子分类会错算成 4
    expect(countCategorySites(stub)).toBe(6);
    expect(countCategorySites(categoryIndexToStub(index[1]))).toBe(2);
  });

  it("已加载的分类仍以 items 实测为准（totalCount 不覆盖真实条目）", () => {
    // 真实分类上 totalCount 恒为 undefined；即使被误写，也不覆盖 items
    const loaded = { ...categories[0], totalCount: 999 };
    expect(countCategorySites(loaded as never)).toBe(6);
  });

  it("占位的截断高度与真实分类一致（直接条目从总数推导）", () => {
    const index = buildHomeCategoryIndex(categories as never);
    const stub = categoryIndexToStub(index[0]);
    // 真实分类：直接 2 + 子一 3 + 子二 1，全 ≤ limit 4 → 6 卡、2 行、3 组 → 396
    expect(estimateTruncatedSectionHeight(categories[0] as never, 4)).toBe(396);
    expect(estimateTruncatedSectionHeight(stub as never, 4)).toBe(396);
  });
});

describe("按需取数的分类与首页条目逐字等值", () => {
  it("单分类经同一套 process + filter 后，与整包处理出的该分类一致", () => {
    const raw = { navigationItems: categories as never };
    const whole = filterNavigationData(processNavigationData(raw));
    const single = filterNavigationData(
      processNavigationData({ navigationItems: [categories[0]] as never }),
    );
    expect(single.navigationItems).toHaveLength(1);
    expect(single.navigationItems[0]).toEqual(whole.navigationItems[0]);
  });

  it("停用分类按需取数返回空（filter 摘掉，与整包口径一致）", () => {
    const disabled = { ...categories[0], enabled: false };
    const single = filterNavigationData(
      processNavigationData({ navigationItems: [disabled] as never }),
    );
    expect(single.navigationItems).toHaveLength(0);
  });
});

describe("服务端分片接线（page.tsx + 路由）", () => {
  it("page.tsx 只把前 initialCategoryLimit 个分类放进 flight，并传 categoryIndex", () => {
    const src = overlayFile("src/app/page.tsx");
    expect(src).toContain("buildHomeCategoryIndex");
    expect(src).toContain("initialNavigationData");
    expect(src).toContain("categoryIndex={categoryIndex}");
    expect(src).toContain("fullItems.slice(0, ssrCategoryLimit)");
    // 2026-11-21「暂不做分片」的裁决已标注过期
    expect(src).toContain("已过期并执行");
  });

  it("按需取数路由支持 ?category=，不存在返回 404，且整包口径不变", () => {
    const src = overlayFile("src/app/api/home/navigation/route.ts");
    expect(src).toContain("searchParams.get('category')");
    expect(src).toContain("loadNavigationCategoryById");
    expect(src).toContain("status: 404");
    // 无参仍走整包读（生态图谱 / 影院兜底 / 收藏页依赖它）
    expect(src).toContain("getFileContent(NAVIGATION_PATH)");
  });

  it("客户端在滚动到视口 / 切工作区 / 应用场景时取数，不在首屏全量取", () => {
    const src = overlayFile("src/components/navigation-content.tsx");
    expect(src).toContain("categoryIndex");
    expect(src).toContain("loadCategory");
    expect(src).toContain("onVisible");
    expect(src).toContain("loadAllCategories");
    // 工作区切到非 all 时先取齐全部分类再筛选
    expect(src).toContain("await loadAllCategories()");
    // 场景应用前先取齐
    const switcher = overlayFile("src/components/scene-switcher.tsx");
    expect(switcher).toContain("await ensureHomeCategoriesLoaded()");
  });
});
