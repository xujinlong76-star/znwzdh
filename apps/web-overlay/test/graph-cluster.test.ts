/**
 * Cluster-First 抽样（lib/graph-cluster.ts）：
 * 旧抽样 `sampleUniform` 步长均匀抽 24 站——站点散开、共享标签的边却要求
 * 两站同时被抽中，于是超过一半节点是孤岛。本轮改成高连通子簇优先抽样。
 *
 * 这里守五件事（全部用真实数据或贴近真实的夹具断言，不编数字）：
 *   1. 边只从真实数据推导：平替边 = 共享标签，生态边 = 同一子分类；
 *   2. 抽样 24–36 站，孤立占比 ≤15%，至少 3 个子簇、每簇 ≥3 站且簇内连通；
 *   3. 同一 round 输出完全确定；换一批（round+1）换一批子簇、约束仍成立；
 *   4. 全站检索搜的是全部收录站点，不只当前抽样的 24 站；
 *   5. 平替雷达 = 中心 + 一跳邻居，中心无邻居时只返回中心、不假装有关系。
 *
 * 另有接线断言：组件真的用上了 Cluster-First（而不是还调 sampleUniform），
 * 场景胶囊在分类域里也展示，图例是可点过滤器，搜索有下拉 + 雷达，底部文案
 * 与交互一致。注意：graph-category.test.ts 里「sampleUniform(scopeFlat,
 * MAX_NODES)」那条接线断言已按新行为改写（见该文件注释），不是删掉。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildGraphEdges,
  connectedComponents,
  egoSubgraph,
  sampleClusterFirst,
  searchGraphSites,
  type ClusterSiteInput,
} from "../src/lib/graph-cluster";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + ")");
  return hit;
}

const ROOT = overlayRoot();

function overlaySource(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function mkSite(
  id: string,
  tags: string[],
  categoryId = "c1",
  title?: string,
): ClusterSiteInput {
  return { id, title: title ?? id, href: `https://${id}.example.com`, tags, categoryId };
}

/** 4 个标签簇（每簇 8 站）+ 6 个孤立站：贴近真实数据的密度结构。 */
function clusteredFixture(): ClusterSiteInput[] {
  const sites: ClusterSiteInput[] = [];
  const groups: Array<[string, string]> = [
    ["alpha", "c1"],
    ["beta", "c1"],
    ["gamma", "c2"],
    ["delta", "c2"],
  ];
  for (const [tag, cat] of groups) {
    for (let i = 0; i < 8; i++) {
      // 每簇第 0 站再带一个跨簇标签，让簇与簇之间也有真实连线。
      const extra = tag === "alpha" && i === 0 ? ["beta"] : tag === "gamma" && i === 0 ? ["delta"] : [];
      sites.push(mkSite(`${tag}-${i}`, [tag, ...extra], cat));
    }
  }
  for (let i = 0; i < 6; i++) {
    sites.push(mkSite(`iso-${i}`, [`only-${i}`], `iso-cat-${i}`));
  }
  return sites;
}

/**
 * 8 簇 × 6 站 = 48 站（> 上限 36，走主路径）：每轮只取 4 簇，
 * round+1 轮转候选顺序才真正换一批集合。每簇独立分类，避免跨簇生态边
 * 干扰簇内边数排序；每簇 6 站共享一标签，簇内 15 条平替边。
 */
function manyClusterFixture(): ClusterSiteInput[] {
  const sites: ClusterSiteInput[] = [];
  const tags = ["tag-a", "tag-b", "tag-c", "tag-d", "tag-e", "tag-f", "tag-g", "tag-h"];
  for (const tag of tags) {
    for (let i = 0; i < 6; i++) {
      sites.push(mkSite(`${tag}-${i}`, [tag], `cat-${tag}`));
    }
  }
  return sites;
}

/** 真实 navigation.json 展平（与组件同一展平口径：直属 + 子分类，禁用的跳过）。 */
function realFlatSites(): ClusterSiteInput[] {
  const nav = JSON.parse(
    readFileSync(join(ROOT, "src/navsphere/content/navigation.json"), "utf8"),
  ) as { navigationItems?: unknown };
  const flat: ClusterSiteInput[] = [];
  const items = Array.isArray(nav.navigationItems) ? nav.navigationItems : [];
  const pushItems = (arr: unknown, catId: string) => {
    for (const raw of Array.isArray(arr) ? arr : []) {
      const it = raw as Record<string, unknown>;
      if (!it || it.enabled === false || !it.href || !it.title) continue;
      flat.push({
        id: String(it.id),
        title: String(it.title),
        href: String(it.href),
        description: typeof it.description === "string" ? it.description : undefined,
        tags: Array.isArray(it.tags) ? (it.tags as unknown[]).map(String) : [],
        categoryId: catId,
      });
    }
  };
  for (const raw of items) {
    const cat = raw as Record<string, unknown>;
    if (!cat || cat.enabled === false) continue;
    pushItems(cat.items, String(cat.id));
    for (const sub of Array.isArray(cat.subCategories) ? cat.subCategories : []) {
      const s = sub as Record<string, unknown>;
      if (!s || s.enabled === false) continue;
      pushItems(s.items, String(s.id));
    }
  }
  return flat;
}

function realAiScope(flat: ClusterSiteInput[]): ClusterSiteInput[] {
  const nav = JSON.parse(
    readFileSync(join(ROOT, "src/navsphere/content/navigation.json"), "utf8"),
  ) as { navigationItems?: unknown };
  const items = Array.isArray(nav.navigationItems) ? nav.navigationItems : [];
  const top = (items as Array<Record<string, unknown>>).find((c) => c.id === "reg-ai-tools");
  if (!top) throw new Error("navigation.json 里找不到 reg-ai-tools");
  const memberIds = new Set<string>([String(top.id)]);
  for (const sub of Array.isArray(top.subCategories) ? top.subCategories : []) {
    const s = sub as Record<string, unknown>;
    if (s.id) memberIds.add(String(s.id));
  }
  return flat.filter((s) => memberIds.has(s.categoryId ?? ""));
}

/** 簇内诱导子图是否连通（簇成员 ≥3 且只含一个连通分量）。 */
function clusterIsConnected(
  clusterSiteIds: readonly string[],
  edges: ReturnType<typeof buildGraphEdges>,
): boolean {
  if (clusterSiteIds.length < 3) return false;
  const comps = connectedComponents(clusterSiteIds, edges);
  return comps.length === 1;
}

describe("buildGraphEdges：边只从真实数据推导", () => {
  it("共享标签 → 平替边，label 为共享:tag", () => {
    const edges = buildGraphEdges([
      mkSite("a", ["视频", "免费"]),
      mkSite("b", ["视频"]),
      mkSite("c", ["免费"]),
    ]);
    expect(edges).toContainEqual({ source: "a", target: "b", type: "alternative", label: "共享:视频" });
    expect(edges).toContainEqual({ source: "a", target: "c", type: "alternative", label: "共享:免费" });
  });

  it("同一子分类 → 生态边；已有平替边的不重复连", () => {
    const edges = buildGraphEdges([
      mkSite("a", ["x"], "sub-1"),
      mkSite("b", ["y"], "sub-1"),
      mkSite("c", ["x"], "sub-1"),
    ]);
    // a-c 已有平替边（共享 x），不再补生态边；a-b、b-c 各一条生态边。
    expect(edges.filter((e) => e.type === "ecosystem")).toHaveLength(2);
    expect(edges.filter((e) => e.type === "alternative")).toHaveLength(1);
  });

  it("生态边每节点封顶 2 条，同一子分类再大也不团簇爆炸", () => {
    const sites = Array.from({ length: 10 }, (_, i) => mkSite(`s${i}`, [`only-${i}`], "big-sub"));
    const edges = buildGraphEdges(sites);
    const degree = new Map<string, number>();
    for (const e of edges.filter((x) => x.type === "ecosystem")) {
      degree.set(e.source, (degree.get(e.source) || 0) + 1);
      degree.set(e.target, (degree.get(e.target) || 0) + 1);
    }
    expect(Math.max(...degree.values())).toBeLessThanOrEqual(2);
  });

  it("同一输入永远同一输出", () => {
    const sites = clusteredFixture();
    expect(buildGraphEdges(sites)).toEqual(buildGraphEdges(sites));
  });
});

describe("connectedComponents：并查集", () => {
  it("两簇 + 一个孤立点", () => {
    const comps = connectedComponents(
      ["a", "b", "c", "d", "e"],
      [
        { source: "a", target: "b", type: "alternative", label: "共享:x" },
        { source: "c", target: "d", type: "alternative", label: "共享:y" },
      ],
    );
    expect(comps).toHaveLength(3);
    expect(comps[0]).toEqual(["a", "b"]);
    expect(comps[1]).toEqual(["c", "d"]);
    expect(comps[2]).toEqual(["e"]);
  });
});

describe("sampleClusterFirst：高连通子簇优先抽样", () => {
  it("夹具：24 站、≥3 簇、每簇 ≥3 站且簇内连通、孤立 ≤15%", () => {
    const sites = clusteredFixture();
    const r = sampleClusterFirst(sites, { round: 0 });
    expect(r.sites.length).toBeGreaterThanOrEqual(24);
    expect(r.sites.length).toBeLessThanOrEqual(36);
    expect(r.clusters.length).toBeGreaterThanOrEqual(3);
    expect(r.clusters.length).toBeLessThanOrEqual(5);
    for (const c of r.clusters) {
      expect(c.siteIds.length).toBeGreaterThanOrEqual(3);
      expect(clusterIsConnected(c.siteIds, r.edges)).toBe(true);
    }
    expect(r.isolatedRatio).toBeLessThanOrEqual(0.15);
  });

  it("同一 round 输出完全确定", () => {
    const sites = clusteredFixture();
    expect(sampleClusterFirst(sites, { round: 0 })).toEqual(sampleClusterFirst(sites, { round: 0 }));
  });

  it("换一批：round+1 换一批子簇，约束仍成立", () => {
    // 注意：clusteredFixture 只有 4 个候选簇、全部能塞进 24 站预算，轮转只
    // 改变顺序不改变集合——这里用 8 簇 × 6 站（48 站 > 上限，走主路径），
    // 每轮只取 4 簇，round+1 才真正换一批。
    const sites = manyClusterFixture();
    const r0 = sampleClusterFirst(sites, { round: 0 });
    const r1 = sampleClusterFirst(sites, { round: 1 });
    const keys0 = r0.clusters.map((c) => c.key).sort().join(",");
    const keys1 = r1.clusters.map((c) => c.key).sort().join(",");
    expect(keys1).not.toBe(keys0);
    expect(r1.isolatedRatio).toBeLessThanOrEqual(0.15);
    expect(r1.clusters.length).toBeGreaterThanOrEqual(3);
  });

  it("连通节点不够时不拿孤立站凑满 24：总量可不足，但孤立占比仍 ≤15%", () => {
    const sites = [
      ...Array.from({ length: 10 }, (_, i) => mkSite(`c${i}`, ["core"], "c1")),
      ...Array.from({ length: 20 }, (_, i) => mkSite(`iso${i}`, [`only-${i}`], `iso-${i}`)),
    ];
    const r = sampleClusterFirst(sites, { round: 0 });
    expect(r.isolatedRatio).toBeLessThanOrEqual(0.15);
    expect(r.sites.length).toBeLessThan(24);
  });

  it("母体 ≤ 上限时全量返回（不丢站点）", () => {
    const sites = clusteredFixture().slice(0, 12);
    const r = sampleClusterFirst(sites, { round: 0 });
    expect(r.sites).toHaveLength(12);
  });

  it("真实数据全局域：24 站、0 孤立、≥3 簇且簇内连通", () => {
    const flat = realFlatSites();
    expect(flat.length).toBeGreaterThanOrEqual(300);
    const r = sampleClusterFirst(flat, { round: 0 });
    expect(r.sites).toHaveLength(24);
    expect(r.isolatedCount).toBe(0);
    expect(r.isolatedRatio).toBe(0);
    expect(r.clusters.length).toBeGreaterThanOrEqual(3);
    for (const c of r.clusters) {
      expect(c.siteIds.length).toBeGreaterThanOrEqual(3);
      expect(clusterIsConnected(c.siteIds, r.edges)).toBe(true);
    }
    expect(r.edges.length).toBeGreaterThan(20);
  });

  it("真实数据 AI 分类域（reg-ai-tools）：24 站、0 孤立、≥3 簇", () => {
    const flat = realFlatSites();
    const ai = realAiScope(flat);
    expect(ai.length).toBeGreaterThan(24);
    const r = sampleClusterFirst(ai, { round: 0 });
    expect(r.sites).toHaveLength(24);
    expect(r.isolatedRatio).toBeLessThanOrEqual(0.15);
    expect(r.clusters.length).toBeGreaterThanOrEqual(3);
    for (const c of r.clusters) {
      expect(c.siteIds.length).toBeGreaterThanOrEqual(3);
      expect(clusterIsConnected(c.siteIds, r.edges)).toBe(true);
    }
  });

  it("真实数据换一批：簇不同、约束仍成立", () => {
    const flat = realFlatSites();
    const r0 = sampleClusterFirst(flat, { round: 0 });
    const r1 = sampleClusterFirst(flat, { round: 1 });
    const keys0 = r0.clusters.map((c) => c.key).sort().join(",");
    const keys1 = r1.clusters.map((c) => c.key).sort().join(",");
    expect(keys1).not.toBe(keys0);
    expect(r1.isolatedRatio).toBeLessThanOrEqual(0.15);
    expect(r1.clusters.length).toBeGreaterThanOrEqual(3);
  });
});

describe("searchGraphSites：全站检索", () => {
  it("标题开头优先于标题包含，标题包含优先于标签包含", () => {
    const sites = [
      mkSite("a", ["视频"], "c1", "爱剪辑"),
      mkSite("b", ["视频剪辑"], "c1", "剪辑助手"),
      mkSite("c", ["剪辑"], "c1", "小工具"),
    ];
    const hits = searchGraphSites(sites, "剪辑");
    expect(hits[0]?.id).toBe("b");
    expect(hits.map((s) => s.id)).toContain("a");
    expect(hits.map((s) => s.id)).toContain("c");
  });

  it("真实数据：搜到不在当前抽样里的站点（检索池是全站，不是 24 站）", () => {
    const flat = realFlatSites();
    const sampled = new Set(sampleClusterFirst(flat, { round: 0 }).sites.map((s) => s.id));
    // 任取一个不在抽样内的真实站点，用它的完整标题搜，必须找得到。
    const outside = flat.find((s) => !sampled.has(s.id))!;
    expect(outside).toBeDefined();
    const hits = searchGraphSites(flat, outside.title);
    expect(hits.map((h) => h.id)).toContain(outside.id);
    // Hugging Face 本身也要能搜到（它是用户在分类页点进来的典型站点）。
    const hf = searchGraphSites(flat, "Hugging");
    expect(hf.length).toBeGreaterThan(0);
    expect(hf[0]?.title).toBe("Hugging Face");
  });

  it("无匹配返回空数组；空查询返回空数组", () => {
    const sites = clusteredFixture();
    expect(searchGraphSites(sites, "zzzz不存在")).toEqual([]);
    expect(searchGraphSites(sites, "   ")).toEqual([]);
  });
});

describe("egoSubgraph：平替雷达", () => {
  it("中心在首位，邻居是一跳（平替优先、再按连接度）", () => {
    const flat = realFlatSites();
    const hits = searchGraphSites(flat, "Hugging");
    const ego = egoSubgraph(flat, hits[0]!.id);
    expect(ego).not.toBeNull();
    expect(ego!.centerId).toBe(hits[0]!.id);
    expect(ego!.sites[0]!.id).toBe(hits[0]!.id);
    expect(ego!.sites.length).toBeGreaterThan(1);
    expect(ego!.edges.length).toBeGreaterThan(0);
    // 所有边两端都在子图内。
    const ids = new Set(ego!.sites.map((s) => s.id));
    for (const e of ego!.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it("中心不存在返回 null；中心无邻居时只返回中心本身", () => {
    const sites = clusteredFixture();
    expect(egoSubgraph(sites, "no-such-id")).toBeNull();
    const ego = egoSubgraph(sites, "iso-0");
    expect(ego).not.toBeNull();
    expect(ego!.sites).toHaveLength(1);
    expect(ego!.edges).toHaveLength(0);
  });
});

describe("组件接线：Cluster-First 真的接上了", () => {
  const GRAPH = overlaySource("src/components/ecosystem-graph.tsx");
  const PAGE = overlaySource("src/app/graph/page.tsx");

  it("抽样走 sampleClusterFirst（不再调 sampleUniform），换一批按钮存在", () => {
    expect(GRAPH).toContain("sampleClusterFirst(scopeFlat");
    expect(GRAPH).toContain("sampleRound");
    expect(GRAPH).toContain("换一批生态簇");
    expect(GRAPH).not.toContain("sampleUniform(scopeFlat");
  });

  it("场景胶囊在分类域里也展示（不再用 !focusedCategory 整个藏起来）", () => {
    expect(GRAPH).not.toContain("{!focusedCategory && (");
    expect(GRAPH).toContain("handleSceneClick");
    expect(GRAPH).toContain("场景切换");
  });

  it("图例是可点过滤器（toggle，再点取消）", () => {
    expect(GRAPH).toContain("setLegendFilter");
    expect(GRAPH).toContain("aria-pressed={legendFilter ===");
    expect(GRAPH).toContain("只看开源");
  });

  it("搜索是全站检索 + 下拉 + 雷达（选中后以该站为中心）", () => {
    expect(GRAPH).toContain("searchGraphSites(allSites");
    expect(GRAPH).toContain('role="listbox"');
    expect(GRAPH).toContain("egoSubgraph(allSites");
    expect(GRAPH).toContain("退出雷达");
    expect(GRAPH).toContain("平替雷达");
  });

  it("底部文案与交互一致：抽样方式、场景、过滤器、换簇、雷达都有说明", () => {
    expect(PAGE).toContain("抽样方式：生态簇优先");
    expect(PAGE).toContain("换一批生态簇");
    expect(PAGE).toContain("平替雷达");
    expect(PAGE).toContain("研发全栈");
    expect(PAGE).toContain("UI &amp; 设计");
    expect(PAGE).toContain("AI 实验室");
    expect(PAGE).toContain("效率创作");
    expect(PAGE).toContain("只看开源");
    expect(PAGE).not.toContain("顶部搜索框按名称过滤节点");
  });

  it("顶部控制栏固定 2 行：行容器不换行、组内横向滚动", () => {
    // 两行容器都没有 flex-wrap（换行会顶成 3 行、挤压画布）。
    const toolbar = GRAPH.slice(GRAPH.indexOf("顶部控制栏"));
    expect(toolbar).not.toContain("flex flex-wrap items-center justify-between");
  });
});
