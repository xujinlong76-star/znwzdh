/**
 * `/graph?category=` 分类域模式：首页分类区的「查看该领域技术生态图谱」按钮
 * 带着 `?category={分类 id}` 跳来，图谱必须只展示该分类自己的站点。
 *
 * 旧实现（2125ad08）按分类标题关键词映射到图谱内部分类并预选桶：14 个一级
 * 分类里 7 个没有任何关键词能命中，点进来仍是「全部」，等于假跳转；命中的
 * 7 个也只是全局抽样后再按桶过滤，看到的并不是该分类自己的站点。
 *
 * 这里守三件事：
 *   1. 参数按 id 精确匹配一级/二级分类，不猜标题关键词；
 *   2. 匹配不上、分类被禁用、分类在 live 数据里 0 站点时不假装过滤成功；
 *   3. 抽样规则分类域与全局域共用同一均匀步长，不只反映列表前段。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveGraphCategory, sampleUniform } from "../src/lib/graph-category";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();

function overlaySource(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 贴近真实目录的最小夹具：id 与 title 均取 navigation.json 的真实值。 */
const NAV = [
  {
    id: "reg-ai-tools",
    title: "AI 工具",
    subCategories: [
      { id: "reg-chat-assistants", title: "对话助手" },
      { id: "reg-ai-drama-creation", title: "AI 短剧与漫剧创作" },
    ],
  },
  {
    id: "reg-short-drama",
    title: "短剧",
    subCategories: [
      { id: "reg-short-drama-free", title: "免费短剧" },
      { id: "reg-short-drama-platform", title: "平台短剧" },
    ],
  },
  { id: "reg-disabled", title: "已禁用", enabled: false, subCategories: [] },
];

describe("resolveGraphCategory：按 id 精确匹配，不猜标题", () => {
  it("一级分类 id 命中：memberIds 覆盖顶级 + 全部二级", () => {
    const focus = resolveGraphCategory("reg-short-drama", NAV);
    expect(focus?.id).toBe("reg-short-drama");
    expect(focus?.topId).toBe("reg-short-drama");
    expect(focus?.title).toBe("短剧");
    expect(focus?.memberIds).toEqual(["reg-short-drama", "reg-short-drama-free", "reg-short-drama-platform"]);
  });

  it("二级分类 id 命中：只圈该二级自己，topId 指回父级", () => {
    const focus = resolveGraphCategory("reg-chat-assistants", NAV);
    expect(focus?.id).toBe("reg-chat-assistants");
    expect(focus?.topId).toBe("reg-ai-tools");
    expect(focus?.title).toBe("对话助手");
    expect(focus?.memberIds).toEqual(["reg-chat-assistants"]);
  });

  it("14 个一级分类里原先 7 个关键词命中不了的，现在按 id 都能命中", () => {
    // 运维与安全/学习成长/学术科研/资讯媒体/影音娱乐/消费生活/公共服务/短剧
    // 在旧关键词映射里全部落空；这里用「短剧」为代表断言 id 匹配不依赖标题。
    expect(resolveGraphCategory("reg-short-drama", NAV)?.title).toBe("短剧");
  });

  it("传标题、传不存在的 id、传空值一律返回 null，不假装过滤成功", () => {
    expect(resolveGraphCategory("短剧", NAV)).toBeNull();
    expect(resolveGraphCategory("reg-not-exist", NAV)).toBeNull();
    expect(resolveGraphCategory("", NAV)).toBeNull();
    expect(resolveGraphCategory(null, NAV)).toBeNull();
    expect(resolveGraphCategory(undefined, NAV)).toBeNull();
  });

  it("被禁用的分类不参与匹配", () => {
    expect(resolveGraphCategory("reg-disabled", NAV)).toBeNull();
  });

  it("脏数据不炸：非数组、空数组、缺 id 的项都返回 null", () => {
    expect(resolveGraphCategory("reg-short-drama", null)).toBeNull();
    expect(resolveGraphCategory("reg-short-drama", [])).toBeNull();
    expect(resolveGraphCategory("reg-short-drama", [{ title: "没 id" }])).toBeNull();
  });
});

describe("sampleUniform：均匀抽样", () => {
  it("不超过上限时全量返回（不丢站点）", () => {
    const items = Array.from({ length: 12 }, (_, i) => `s${i}`);
    expect(sampleUniform(items, 24)).toEqual(items);
    expect(sampleUniform(items, 24)).not.toBe(items);
  });

  it("60 站抽 24：步长均匀，不只反映列表前段", () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    const sampled = sampleUniform(items, 24);
    expect(sampled).toHaveLength(24);
    expect(sampled[0]).toBe(0);
    expect(sampled[sampled.length - 1]).toBe(46);
    expect(sampled.every((v, i) => v === i * 2)).toBe(true);
  });

  it("同样输入永远同样输出", () => {
    const items = Array.from({ length: 298 }, (_, i) => i);
    expect(sampleUniform(items, 24)).toEqual(sampleUniform(items, 24));
  });

  it("边界：max <= 0 返回空数组", () => {
    expect(sampleUniform([1, 2, 3], 0)).toEqual([]);
    expect(sampleUniform([1, 2, 3], -1)).toEqual([]);
  });
});

describe("组件接线：分类域模式真的接上了", () => {
  const GRAPH = overlaySource("src/components/ecosystem-graph.tsx");
  const PAGE = overlaySource("src/app/graph/page.tsx");

  it("用 useSearchParams 读参数，而不是挂载时一次性读 window.location.search", () => {
    expect(GRAPH).toContain("useSearchParams");
    expect(GRAPH).toContain("searchParams.get('category')");
    expect(GRAPH).not.toContain("new URLSearchParams(window.location.search)");
  });

  it("参数变化重拉重算：effect 依赖 categoryParam", () => {
    expect(GRAPH).toContain("}, [categoryParam])");
  });

  it("命中分类时只抽样该分类的站点并记下 focusedCategory", () => {
    expect(GRAPH).toContain("resolveGraphCategory(categoryParam");
    expect(GRAPH).toContain("setFocusedCategory(activeFocus)");
    expect(GRAPH).toContain("sampleUniform(scopeFlat, MAX_NODES)");
  });

  it("分类域模式不混入预设示例节点、不带默认边", () => {
    // 注意：这两个断言 2026-11-10 23:56 写成「全局域混排预设、分类域只用真实节点」，
    // 但 2026-11-11 10:06 的 A5（ba5608c3）已把全局域也改成只画真实节点，
    // 并由 graph-live-purity.test.ts 把「live 分支不再 spread 预设」钉死。
    // 按 A5 后的口径重写：两个域都不混入预设；预设只在拿不到数据时作示例兜底。
    expect(GRAPH).not.toContain("[...DEFAULT_NODES, ...dynamicNodes]");
    expect(GRAPH).not.toContain("setEdges([...DEFAULT_EDGES");
  });

  it("分类域 UI：显示当前分类 + 「查看全部」回到全局", () => {
    expect(GRAPH).toContain("正在查看");
    expect(GRAPH).toContain("查看全部");
    expect(GRAPH).toContain('href="/graph"');
    expect(GRAPH).toContain("「{focusedCategory.title}」分类 · 展示 {liveCount} 站");
  });

  it("分类域不展示桶过滤（非技术类站点按关键词全落 dev 桶会筛空）", () => {
    expect(GRAPH).toContain("focusedCategory ? true : activeCategory === 'all'");
  });

  it("图谱页用 Suspense 包住组件（useSearchParams 构建期需要边界）", () => {
    expect(PAGE).toContain("<Suspense");
    expect(PAGE).toContain("<EcosystemGraph />");
  });
});
