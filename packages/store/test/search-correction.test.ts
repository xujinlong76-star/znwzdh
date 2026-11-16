/**
 * 搜索自动纠正（搜索容错纠错 · 第 5 项，store 层）。
 *
 * 沿用既有 store search 测试的建库/种子 harness（:memory: SQLite，
 * fts/vectors 均 null，只走词法通道 + 纠正）。
 *
 * 锁：
 * 1. 零结果 + 可纠 → 返回纠正后 hits，且 correction.corrected 正确、
 *    correction.original 是原词；
 * 2. nocorrect=1（disableCorrection）时不纠正；
 * 3. 纠正后仍零 → correction 仍在、hits 为空、不递归；
 * 4. 有词法命中时原样返回、无 correction；
 * 5. 歧义时无 correction、有 didYouMean；
 * 6. 5000 站真实形态词典扫描：墙钟 < 10ms 且进 DP 的键数 ≤ 3000（性能断言；
 *    LIMIT 5000 截断本身是 pre-existing 已知限制，见 search.ts 注释，不在本轮修）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";
import { resolveQueryCorrection, buildCorrectionKeys, pinyinTraits, type CorrectionSiteKeys, type CorrectionStats } from "@navhub/core";

let db: Db;
let repo: Repository;
let engine: SearchEngine;
const siteIds: Record<string, string> = {};

beforeAll(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
  const cat = await repo.createCategory({ title: "纠正测试" });
  const seeds: Array<[string, string, string]> = [
    ["zhihu", "知乎", "https://www.zhihu.com/"],
    ["bilibili", "哔哩哔哩", "https://www.bilibili.com/"],
    ["github", "GitHub", "https://github.com/"],
    ["jianli", "简历", "https://jianli.example.com/"],
    ["githab", "Githab", "https://githab.example.com/"],
  ];
  for (const [key, title, url] of seeds) {
    const site = await repo.createSite({ url, title, categoryId: cat.id, description: "纠正测试站点" });
    siteIds[key] = site.id;
  }
  engine = new SearchEngine({ db, repo, fts: null, vectors: null, embed: null });
});

afterAll(async () => {
  await db.close();
});

async function hitTitles(result: { hits: Array<{ siteId: string }> }): Promise<string[]> {
  const sites = await repo.getSitesByIds(result.hits.map((h) => h.siteId));
  return result.hits.map((h) => sites.get(h.siteId)?.title ?? h.siteId);
}

describe("search() 自动纠正", () => {
  it("拼音打错 zhihhu → 知乎，返回纠正后 hits + correction", async () => {
    const result = await engine.search({ q: "zhihhu", limit: 10, disablePersonal: true });
    expect(await hitTitles(result)).toContain("知乎");
    expect(result.correction).toEqual({ original: "zhihhu", corrected: "知乎", reason: "pinyin-typo" });
    expect(result.didYouMean).toBeUndefined();
  });

  it("首字母错 blbb → 哔哩哔哩", async () => {
    const result = await engine.search({ q: "blbb", limit: 10, disablePersonal: true });
    expect(await hitTitles(result)).toContain("哔哩哔哩");
    expect(result.correction?.corrected).toBe("哔哩哔哩");
    // 纠正与 didYouMean 共存：correction 是已执行的改写，didYouMean 是对原查询
    // 的建议，store 层两个字段都保留（前端有 correction 时只渲染纠正横幅）。
    expect(result.didYouMean).toBe("哔哩哔哩");
  });

  it("中文错别字 简厉 → 简历", async () => {
    const result = await engine.search({ q: "简厉", limit: 10, disablePersonal: true });
    expect(await hitTitles(result)).toContain("简历");
    expect(result.correction).toMatchObject({ original: "简厉", corrected: "简历", reason: "chinese-typo" });
    // 同上：纠正执行的同时 didYouMean 仍保留为原查询的建议。
    expect(result.didYouMean).toBe("简历");
  });

  it("别名 b站 → 哔哩哔哩（gh 本已能经拼音前缀命中，走不到纠正，故用 b站作引擎级用例）", async () => {
    const result = await engine.search({ q: "b站", limit: 10, disablePersonal: true });
    expect(await hitTitles(result)).toContain("哔哩哔哩");
    expect(result.correction).toEqual({ original: "b站", corrected: "哔哩哔哩", reason: "alias" });
  });

  it("disableCorrection 时不纠正：zhihhu 保持零结果、无 correction", async () => {
    const result = await engine.search({ q: "zhihhu", limit: 10, disablePersonal: true, disableCorrection: true });
    expect(result.hits).toHaveLength(0);
    expect(result.correction).toBeUndefined();
  });

  it("纠正后仍零结果：correction 仍在、hits 为空、不递归", async () => {
    // 只有别名目标不在库里时才会走到这条路：gh → GitHub，但库里删掉 GitHub。
    const db2 = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    try {
      const repo2 = new Repository(db2);
      const cat = await repo2.createCategory({ title: "空库" });
      await repo2.createSite({ url: "https://example.com/", title: "与纠正无关的站", categoryId: cat.id });
      const engine2 = new SearchEngine({ db: db2, repo: repo2, fts: null, vectors: null, embed: null });
      const result = await engine2.search({ q: "gh", limit: 10, disablePersonal: true });
      expect(result.hits).toHaveLength(0);
      expect(result.correction).toEqual({ original: "gh", corrected: "GitHub", reason: "alias" });
      expect(result.didYouMean).toBeUndefined();
    } finally {
      await db2.close();
    }
  });

  it("有词法命中时原样返回、无 correction：搜 知乎", async () => {
    const result = await engine.search({ q: "知乎", limit: 10, disablePersonal: true });
    expect(await hitTitles(result)).toContain("知乎");
    expect(result.correction).toBeUndefined();
  });

  it("精确名查询因过滤零结果时不谎报纠正：知乎 + 空类目 → 过滤放宽可回站，但无 correction（B4）", async () => {
    // 空类目过滤下首轮零结果：纠正路径会跑（resolveQueryCorrection("知乎")），
    // 恒等 guard 须返回 null；随后过滤放宽（fallback:"filter"）把知乎带回，
    // 但全程不得出现 { corrected: "知乎" } 这种恒等“纠正”。
    const emptyCat = await repo.createCategory({ title: "空类目" });
    const result = await engine.search({ q: "知乎", limit: 10, disablePersonal: true, categoryId: emptyCat.id });
    expect(await hitTitles(result)).toContain("知乎");
    expect(result.correction).toBeUndefined();
  });

  it("歧义时无 correction、有 didYouMean：githxb 对 GitHub/Githab 同距", async () => {
    const result = await engine.search({ q: "githxb", limit: 10, disablePersonal: true });
    expect(result.hits).toHaveLength(0);
    expect(result.correction).toBeUndefined();
    expect(result.didYouMean).toBeTruthy();
  });

  it("短词 / 无关词不纠：ai 零结果、无 correction", async () => {
    const result = await engine.search({ q: "ai", limit: 10, disablePersonal: true });
    expect(result.correction).toBeUndefined();
  });
});

describe("纠正词典扫描性能", () => {
  it("5000 站真实形态键的扫描：墙钟 < 10ms 且进 DP 的键数 ≤ 3000", () => {
    // 数据集：真实生产形态——每站的键由 buildCorrectionKeys 按生产构造派生
    // （见 dialect.ts buildIndexFields）：pinyin_full 是标题+描述+标签整串的
    // 拼音（本数据集 53–75 字符，中位 66），pinyin_initials 只取标题；
    // 5000 站 × 每站 ~5 键，共 24,990 键，另加知乎站 4 键，扫描总数 24,994 键。旧数据集的键全是短串（≤16 字符），
    // 真实库里的长 pinyin_full 根本没进来——于是“去掉剪枝 + 全量无界
    // Levenshtein 扫全部键”也只要 16–17ms，50ms 阈值相对 5ms 基线有 10 倍
    // 余量，剪枝退化测不出来；旧注释还声称“剪枝被删时最小值同样会超 50ms”，
    // 已被独立探针证伪，那句保证已删除，改由下面的确定性预算守剪枝。
    //
    // 两道防线（/tmp/perf-probe2.mjs 对照实测，3 轮 min-of-5）：
    // - 墙钟：当前实现 1.98–2.55ms，阈值 10ms ≈ 实测最小值的 4 倍；
    //   去剪枝 + 无界全量扫描约 24–25ms，超阈值（被墙钟抓到）。
    // - 确定性预算：当前实现进 DP 的键数是 1551（确定性值，不抖），
    //   预算 3000 ≈ 实测的 2 倍；只去长度分桶剪枝、保留有界 DP 时墙钟
    //   反而更快（0.6–1.4ms，有界 DP 靠内部长度检查直接返回，建桶开销
    //   也省了），墙钟抓不到它，但进 DP 的键数膨胀到全量 24,994，
    //   预算抓到。剪枝退化的主防线是预算，墙钟只是辅助。
    const titles = [
      "在线工具合集", "开发者导航", "免费设计资源", "高效办公助手", "编程学习平台",
      "图片素材库", "视频剪辑工具", "写作助手", "数据查询中心", "生活服务指南",
    ];
    const descriptions = [
      "提供免费在线工具与效率服务", "收录优质开发文档与教程", "精选设计素材免费下载",
      "提升办公效率的实用工具", "从入门到进阶的编程课程", "海量高清图片素材库",
      "简单好用的在线剪辑工具", "智能写作与校对助手", "实时数据查询与分析",
      "覆盖生活的便民服务导航",
    ];
    const tags = [["工具", "效率"], ["开发", "文档"], ["设计", "素材"], ["办公", "效率"], ["编程", "学习"],
      ["图片", "素材"], ["视频", "剪辑"], ["写作", "工具"], ["数据", "查询"], ["生活", "服务"]];
    const keys: CorrectionSiteKeys[] = Array.from({ length: 5000 }, (_, i) => {
      const title = `${titles[i % 10]}${i}`;
      const description = descriptions[i % 10]!;
      const siteTags = tags[i % 10]!;
      return {
        title,
        keys: buildCorrectionKeys({
          title,
          url: `https://example${i}.com/`,
          pinyinFull: pinyinTraits([title, description, ...siteTags].join(" ")).full,
          pinyinInitials: pinyinTraits(title).initials,
        }),
      };
    });
    keys.push({
      title: "知乎",
      keys: buildCorrectionKeys({
        title: "知乎",
        url: "https://www.zhihu.com/",
        pinyinFull: pinyinTraits(["知乎", "中文问答社区", "问答", "社区"].join(" ")).full,
        pinyinInitials: pinyinTraits("知乎").initials,
      }),
    });
    // Warm-up（不计时）：第一次调用要走冷 JIT（boundedLevenshtein/建桶循环
    // 的编译）+ 首轮 GC。
    // 计量取 15 次的最小墙钟（performance.now()，毫秒以下精度）：
    // 单样本墙钟在并行 worker 负载下量的是调度等待而不是算法——13 文件并行
    // 时单样本曾测到 57ms / 290ms，而同一调用单独跑热身后只有 2–3ms；
    // process.cpuUsage 同样不干净（计入 V8 后台线程，同一调用在 vitest 内
    // 测到 5–32ms 抖动）。最小值滤掉调度与后台线程噪声，量到的才是剪枝后
    // DP 本身的成本。15 次而非 5 次的原因：CI #957 上 5 个样本全部落在
    // 一次持续调度 burst 里，最小值仍有 10.14ms、超 10ms 预算 0.14ms；
    // 本地重放（全量 store 套件并行 + 5 个探针并发）复现到最小值 15.39ms。
    // 样本数 ×3 后全部样本都被 burst 污染的概率大幅下降；阈值保持 10ms
    // 不动——放宽到 15ms 仍会抖（本地复现 15.39ms），放宽到 25ms 则失去
    // 灵敏度（去剪枝实测 24–25ms/样本，会漏过回归）。真实回归下 15 个
    // 样本的最小值仍在 24ms 量级，墙钟照样抓到；但最小值只能滤噪声、不能
    // 补灵敏度：只删剪枝时最小值不升反降，所以墙钟之外另有确定性预算
    // （stats.dpCalls）守剪枝，dpCalls 仍是主防线，墙钟只是辅助。
    // 不升反降，所以墙钟之外另有确定性预算（stats.dpCalls）守剪枝。
    const stats: CorrectionStats = { dpCalls: 0 };
    resolveQueryCorrection("zhihhu", keys, { stats });
    let took = Number.POSITIVE_INFINITY;
    let res: ReturnType<typeof resolveQueryCorrection> | null = null;
    for (let i = 0; i < 15; i += 1) {
      const t0 = performance.now();
      res = resolveQueryCorrection("zhihhu", keys, { stats });
      took = Math.min(took, performance.now() - t0);
    }
    expect(res?.corrected).toBe("知乎");
    expect(took).toBeLessThan(10);
    // 确定性预算：长度分桶剪枝后只有长度 5–8 的键才进 DP，实测 1551；
    // 剪枝被删时进 DP 的是全量 24,994 键。预算 3000 ≈ 实测 2 倍。
    expect(stats.dpCalls).toBeLessThanOrEqual(3000);
  });
});
