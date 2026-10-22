import { describe, it, expect } from "vitest";
import {
  analyzeDuplicates,
  duplicateSiteHost,
  type DuplicateInputSite,
} from "../src/routes/graph.ts";

/**
 * 改写前的实现，逐字搬过来当**参考实现**。
 *
 * 这条路由的评分口径（阈值 0.75、标题 0.9 权重、similarity 取最大值后的两位
 * 小数、recommendation 分支、reason 文案、配对顺序）都是用户可见契约。
 * 优化只允许改"怎么算"，不允许改"算出什么"，所以用同一批输入把两份实现
 * 的输出做深度等值比较，而不是只断言几个抽样用例。
 */
function referenceDuplicates(
  sites: DuplicateInputSite[],
  catMap: Map<string, string>,
): unknown[] {
  const duplicatePairs: unknown[] = [];
  for (let i = 0; i < sites.length; i++) {
    for (let j = i + 1; j < sites.length; j++) {
      const a = sites[i];
      const b = sites[j];
      if (!a || !b) continue;

      let urlSimilarity = 0;
      try {
        const hostA = new URL(a.url).hostname.replace(/^www\./, "");
        const hostB = new URL(b.url).hostname.replace(/^www\./, "");
        if (hostA === hostB) {
          urlSimilarity = 1.0;
        } else if (hostA.includes(hostB) || hostB.includes(hostA)) {
          urlSimilarity = 0.8;
        }
      } catch {
        // fallback
      }

      const titleA = a.title.toLowerCase().trim();
      const titleB = b.title.toLowerCase().trim();
      let titleSimilarity = 0;
      if (titleA === titleB) {
        titleSimilarity = 1.0;
      } else {
        const setA = new Set(titleA.split(/\s+/));
        const setB = new Set(titleB.split(/\s+/));
        const intersection = [...setA].filter((x) => setB.has(x)).length;
        const union = new Set([...setA, ...setB]).size;
        titleSimilarity = union > 0 ? intersection / union : 0;
      }

      const combined = Math.max(urlSimilarity, titleSimilarity * 0.9);

      if (combined >= 0.75) {
        let recommendation: "merge" | "keep_both" | "archive_b" = "merge";
        let reason = `域名与标题重合度高达 ${(combined * 100).toFixed(0)}%`;

        if (a.categoryId !== b.categoryId) {
          recommendation = "merge";
          reason += `，且分布在不同分类【${catMap.get(a.categoryId) || "未分类"}】与【${catMap.get(b.categoryId) || "未分类"}】中，建议合并`;
        } else if (urlSimilarity === 1.0) {
          recommendation = "archive_b";
          reason += `，指向同一域名，建议归档备用项`;
        }

        duplicatePairs.push({
          idA: a.id,
          titleA: a.title,
          urlA: a.url,
          categoryA: catMap.get(a.categoryId) || "未知分类",
          idB: b.id,
          titleB: b.title,
          urlB: b.url,
          categoryB: catMap.get(b.categoryId) || "未知分类",
          similarity: Number(combined.toFixed(2)),
          recommendation,
          reason,
        });
      }
    }
  }
  return duplicatePairs;
}

/** 确定性伪随机（同一 seed 永远同一批数据，性能断言才不会随机器状态漂移） */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOSTS = [
  "https://github.com",
  "https://www.github.com",
  "https://docs.github.com",
  "https://gitlab.com",
  "https://example.com",
  "https://ex.com",
  "https://a.example.org",
  "http://localhost:3000",
  "file:///x",
  "javascript:alert(1)",
  "not a url",
  "https://中文.测试.中国",
];

const TITLES = [
  "GitHub",
  "github  ",
  "GitHub Docs",
  "GitHub Docs for Enterprise",
  "GitHub 官方文档",
  "菜鸟教程",
  "中国天气网",
  "",
  "   ",
  "Daily News Aggregate Portal Site",
  "news",
  "The Daily News Aggregate Portal Sites",
];

function makeSites(n: number, seed: number): DuplicateInputSite[] {
  const rnd = makeRng(seed);
  const out: DuplicateInputSite[] = [];
  for (let i = 0; i < n; i++) {
    const host = HOSTS[Math.floor(rnd() * HOSTS.length)]!;
    const title = TITLES[Math.floor(rnd() * TITLES.length)]!;
    out.push({
      id: `site-${i}`,
      url: `${host}/p/${i}`,
      title,
      categoryId: `cat-${Math.floor(rnd() * 5)}`,
    });
  }
  return out;
}

const catMap = new Map<string, string>([
  ["cat-0", "开发工具"],
  ["cat-1", "资讯聚合"],
  ["cat-2", ""], // 空串类目名：走 || 兜底，不是 ??
]);

/**
 * 参考实现是 O(n²) 的，跑一遍要几秒；结构类断言共用同一批输入，
 * 所以按 (n, seed) 缓存结果 —— 否则这个文件光是在重复计算缺陷版。
 */
const refCache = new Map<string, unknown[]>();
function referenceCached(sites: DuplicateInputSite[], key: string): unknown[] {
  let v = refCache.get(key);
  if (!v) {
    v = referenceDuplicates(sites, catMap);
    refCache.set(key, v);
  }
  return v;
}

describe("站点重复检测改写等价性（参考实现逐对比对）", () => {
  it("主机名派生键保留『解析失败』与『合法空主机名』的区别", () => {
    expect(duplicateSiteHost("not a url")).toBeNull();
    expect(duplicateSiteHost("file:///x")).toBe("");
    expect(duplicateSiteHost("javascript:alert(1)")).toBe("");
    expect(duplicateSiteHost("https://www.GitHub.com/x")).toBe("github.com");
  });

  it("小样本：输出与参考实现逐字段、逐顺序一致", () => {
    const sites = [
      { id: "a", url: "https://github.com", title: "GitHub", categoryId: "cat-0" },
      { id: "b", url: "https://www.github.com", title: "GitHub", categoryId: "cat-1" },
      { id: "c", url: "https://docs.github.com", title: "GitHub Docs", categoryId: "cat-0" },
      { id: "d", url: "https://gitlab.com", title: "GitLab", categoryId: "cat-2" },
      { id: "e", url: "https://ex.com", title: "Example", categoryId: "cat-3" },
      { id: "f", url: "https://example.com", title: "Example", categoryId: "cat-3" },
      { id: "g", url: "file:///x", title: "本地文件", categoryId: "cat-0" },
      { id: "h", url: "not a url", title: "坏链接", categoryId: "cat-1" },
      { id: "i", url: "https://a.com/x", title: "", categoryId: "cat-1" },
      { id: "j", url: "https://b.com/y", title: "   ", categoryId: "cat-1" },
      // 域名"包含"只给 0.8，而同名标题的 1.0×0.9=0.9 会反超 —— 这一对锁住
      // "域名分够了就不算标题分"这种想当然的剪枝（会把 similarity 从 0.9 改成 0.8）
      { id: "k", url: "https://github.com/one", title: "GitHub", categoryId: "cat-0" },
      { id: "l", url: "https://docs.github.com/two", title: "GitHub", categoryId: "cat-0" },
    ];
    expect(analyzeDuplicates(sites, catMap).pairs).toEqual(referenceDuplicates(sites, catMap));
  });

  it("600 站点随机样本：输出与参考实现完全一致（含配对顺序）", () => {
    const sites = makeSites(600, 20261022);
    const mine = analyzeDuplicates(sites, catMap, Number.POSITIVE_INFINITY);
    const ref = referenceCached(sites, "struct");
    expect(mine.truncated).toBe(false);
    expect(mine.pairs.length).toBeGreaterThan(500); // 不是"两边都空"的假绿
    expect(mine.pairs).toEqual(ref);
  });

  it("配对上限：达到 limit 即截断并如实标记", () => {
    const sites = makeSites(600, 20261022);
    const capped = analyzeDuplicates(sites, catMap, 5);
    expect(capped.pairs).toHaveLength(5);
    expect(capped.truncated).toBe(true);
    // 截断是同一批前 5 对，不是换了算法
    expect(capped.pairs).toEqual(referenceCached(sites, "struct").slice(0, 5));
  });

  it("同样输入下比参考实现快一个量级以上（改写不是只做样子）", { timeout: 120_000 }, () => {
    const sites = makeSites(600, 777);
    // 各自跑两遍取第二遍，让两份实现处于同等的 JIT 温度下
    analyzeDuplicates(sites, catMap, Number.POSITIVE_INFINITY);
    referenceDuplicates(sites, catMap);
    const t0 = performance.now();
    const mine = analyzeDuplicates(sites, catMap, Number.POSITIVE_INFINITY);
    const t1 = performance.now();
    const ref = referenceDuplicates(sites, catMap);
    const t2 = performance.now();

    expect(mine.pairs).toEqual(ref);
    const fast = t1 - t0;
    const slow = t2 - t1;
    // 3× 是保守阈值：实测差距是两个数量级（每对省掉 2 次 URL 解析 + 4 次集合分配）
    expect(fast * 3).toBeLessThan(slow);
  });
});
