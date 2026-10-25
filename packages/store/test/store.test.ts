import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryVectorStore, SqliteVecStore, hashSiteId, normalize } from "../src/vector/index.ts";

import { SqliteFtsStore } from "../src/fts.ts";
import { SearchEngine } from "../src/search.ts";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

/* ------------------------------------------------------------------ *
 * 向量存储：两种实现必须行为一致
 * ------------------------------------------------------------------ */

const DIM = 64;
function rnd(seed: number): Float32Array {
  let s = seed;
  const a = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    a[i] = (s / 2147483648) * 2 - 1;
  }
  return normalize(a);
}

describe("MemoryVectorStore", () => {
  it("按余弦距离返回最近邻", async () => {
    const store = new MemoryVectorStore(DIM);
    const v1 = rnd(1);
    await store.upsert([
      { key: hashSiteId("a"), siteId: "a", vector: v1 },
      { key: hashSiteId("b"), siteId: "b", vector: rnd(2) },
    ]);
    const hits = await store.search(v1, 2);
    expect(hits[0]!.siteId).toBe("a");
    expect(hits[0]!.distance).toBeLessThan(1e-5);
  });

  it("upsert 幂等，不产生重复", async () => {
    const store = new MemoryVectorStore(DIM);
    const r = { key: hashSiteId("a"), siteId: "a", vector: rnd(1) };
    await store.upsert([r]);
    await store.upsert([r]);
    expect(await store.count()).toBe(1);
  });

  it("维度不符时明确报错，而不是静默截断", async () => {
    const store = new MemoryVectorStore(DIM);
    await expect(store.upsert([{ key: 1, siteId: "x", vector: new Float32Array(8) }])).rejects.toThrow(/维度/);
  });

  it("remove 之后不再命中", async () => {
    const store = new MemoryVectorStore(DIM);
    await store.upsert([{ key: hashSiteId("a"), siteId: "a", vector: rnd(1) }]);
    await store.remove(["a"]);
    expect(await store.search(rnd(1), 5)).toEqual([]);
  });
});

describe("hashSiteId", () => {
  it("同一 siteId 永远映射到同一正整数（重建索引不漂移）", () => {
    const a1 = hashSiteId("site-alpha");
    const a2 = hashSiteId("site-alpha");
    expect(a1).toBe(a2);
    expect(a1).toBeGreaterThan(0);
    expect(Number.isInteger(a1)).toBe(true);
  });

  it("不同 siteId 基本不碰撞", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(hashSiteId("site-" + i));
    expect(seen.size).toBeGreaterThan(1995);
  });
});


/* ------------------------------------------------------------------ *
 * 回归：vec0 表存 site_id（2026-10 修复语义检索静默失效）
 * ------------------------------------------------------------------ */

describe("SqliteVecStore：site_id 列（跨进程语义检索不失效）", () => {
  it("不依赖进程内映射，重新实例化后 search 仍返回正确 siteId", async () => {
    const Database = (await import("better-sqlite3")).default;
    const sqliteVec = await import("sqlite-vec");
    const raw = new Database(":memory:");
    sqliteVec.load(raw as never);

    const mk = () => new SqliteVecStore({ db: raw as never, dim: DIM });
    const a = mk();
    await a.upsert([
      { key: hashSiteId("site-aaa"), siteId: "site-aaa", vector: rnd(1) },
      { key: hashSiteId("site-bbb"), siteId: "site-bbb", vector: rnd(2) },
    ]);

    // 关键回归场景：模拟进程重启 —— 全新实例（空映射），不调用 rehydrate。
    // 旧实现里 siteId 会退化成 String(key)（哈希数字），匹配不到任何站点。
    const b = mk();
    const hits = await b.search(rnd(1), 2);
    expect(hits[0]!.siteId).toBe("site-aaa");
    expect(hits.map((h) => h.siteId)).toContain("site-bbb");
    // 确认返回的确实是站点 id，而不是哈希值字符串
    expect(hits[0]!.siteId).toMatch(/^site-/);
  });

  it("旧 schema（无 site_id 列）会被迁移，且 rehydrate 后语义检索可用", async () => {
    const Database = (await import("better-sqlite3")).default;
    const sqliteVec = await import("sqlite-vec");
    const raw = new Database(":memory:");
    sqliteVec.load(raw as never);

    // 1) 先建"旧 schema"（与历史版本一致：只有 site_key + embedding）
    raw.exec(`CREATE VIRTUAL TABLE sites_vec USING vec0(site_key INTEGER PRIMARY KEY, embedding float[${DIM}])`);
    const insOld = raw.prepare("INSERT INTO sites_vec(site_key, embedding) VALUES (?, ?)");
    const v1 = rnd(7);
    insOld.run(BigInt(hashSiteId("legacy-1")), v1);

    // 2) 用新版 store init（应触发迁移：DROP + 重建带 site_id 的表）
    const store = new SqliteVecStore({ db: raw as never, dim: DIM });
    store.init();

    // 3) 迁移后表为空，rehydrate 用 embeddings 向量重灌
    store.rehydrate([{ key: hashSiteId("legacy-1"), siteId: "legacy-1", vector: v1 }]);

    // 4) 语义检索应命中且返回正确 siteId
    const hits = await store.search(v1, 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.siteId).toBe("legacy-1");
  });

  it("rehydrate 空集时必须清空残留向量（持久层已删/换模型）", async () => {
    const Database = (await import("better-sqlite3")).default;
    const sqliteVec = await import("sqlite-vec");
    const raw = new Database(":memory:");
    sqliteVec.load(raw as never);

    const store = new SqliteVecStore({ db: raw as never, dim: DIM });
    await store.upsert([{ key: hashSiteId("stale-1"), siteId: "stale-1", vector: rnd(3) }]);
    expect(await store.count()).toBe(1);

    store.rehydrate([]);
    expect(await store.count()).toBe(0);
    expect(await store.search(rnd(3), 5)).toEqual([]);
  });

  it("remove 按 site_id 直接删，不依赖映射", async () => {
    const Database = (await import("better-sqlite3")).default;
    const sqliteVec = await import("sqlite-vec");
    const raw = new Database(":memory:");
    sqliteVec.load(raw as never);
    const store = new SqliteVecStore({ db: raw as never, dim: DIM });
    await store.upsert([{ key: hashSiteId("rm-me"), siteId: "rm-me", vector: rnd(3) }]);
    await store.remove(["rm-me"]);
    expect(await store.count()).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 集成：真实 SQLite + FTS5 + sqlite-vec + 混合检索
 * ------------------------------------------------------------------ */

describe("SQLite 集成：FTS5 + sqlite-vec + 混合检索", () => {
  let dir: string;
  let db: Db;
  let repo: Repository;
  let vectors: SqliteVecStore;
  let fts: SqliteFtsStore;
  let engine: SearchEngine;

  interface Seed { url: string; title: string; desc: string; cat: string; tags: string[]; seed: number }

  const SEEDS: Seed[] = [
    { url: "https://github.com/features/copilot", title: "GitHub Copilot", desc: "AI 代码补全与编程助手，支持 VS Code", cat: "cat-ai", tags: ["ai", "coding"], seed: 11 },
    { url: "https://cursor.com", title: "Cursor", desc: "AI 驱动的代码编辑器，用自然语言写代码", cat: "cat-ai", tags: ["ai", "coding"], seed: 12 },
    { url: "https://claude.ai", title: "Claude", desc: "Anthropic 的大语言模型对话助手", cat: "cat-ai", tags: ["ai"], seed: 13 },
    { url: "https://figma.com", title: "Figma", desc: "在线 UI 设计与原型协作工具", cat: "cat-design", tags: ["design"], seed: 14 },
    { url: "https://unsplash.com", title: "Unsplash", desc: "免费高清图片素材库", cat: "cat-design", tags: ["design", "image"], seed: 15 },
    { url: "https://weather.com.cn", title: "中国天气网", desc: "全国天气预报查询", cat: "cat-life", tags: ["weather"], seed: 16 },
    { url: "https://example.com/startup", title: "启动脚本", desc: "服务启动脚本编写与运行管理", cat: "cat-dev", tags: ["devops"], seed: 17 },
    { url: "https://npmjs.com", title: "npm", desc: "JavaScript 包管理器，依赖安装与发布", cat: "cat-dev", tags: ["devops"], seed: 18 },
    { url: "https://hub.docker.com", title: "Docker Hub", desc: "容器镜像仓库，部署与编排", cat: "cat-dev", tags: ["devops"], seed: 19 },
    { url: "https://excalidraw.com", title: "Excalidraw", desc: "在线手绘风格白板，画流程图", cat: "cat-design", tags: ["design", "diagram"], seed: 20 },
  ];

  const byTitle = (t: string) => SEEDS.find((s) => s.title === t)!;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-store-"));
    db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "test.db") });

    // 加载 sqlite-vec 扩展
    const sqliteVec = await import("sqlite-vec");
    sqliteVec.load(db.sqlite as never);

    vectors = new SqliteVecStore({ db: db.sqlite as never, dim: DIM });
    fts = new SqliteFtsStore(db.sqlite as never);
    fts.init(false);

    repo = new Repository(db);
    await repo.createCategory({ id: "cat-ai", title: "AI 工具" });
    await repo.createCategory({ id: "cat-design", title: "设计资源" });
    await repo.createCategory({ id: "cat-life", title: "生活服务" });
    await repo.createCategory({ id: "cat-dev", title: "开发运维" });
    // 子类目：验证物化路径与「含后代」过滤
    await repo.createCategory({ id: "cat-ai-img", title: "AI 绘图", parentId: "cat-ai" });

    for (const s of SEEDS) {
      const site = await repo.createSite({
        url: s.url, title: s.title, description: s.desc, categoryId: s.cat, tags: s.tags, source: "seed",
      });
      await vectors.upsert([{ key: hashSiteId(site.id), siteId: site.id, vector: rnd(s.seed) }]);
      await repo.saveEmbedding(site.id, "test", rnd(s.seed));
    }
    await fts.rebuild();

    // 语义通道用「按标题查种子向量」模拟真实 embedding，避免测试依赖模型下载
    const embed = async (text: string): Promise<Float32Array> => {
      const hit = SEEDS.find((s) => text.includes(s.title) || s.title.includes(text));
      if (hit) return rnd(hit.seed);
      // 未命中则用确定性哈希做伪向量
      let h = 0;
      for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 2147483647;
      return rnd(h);
    };

    engine = new SearchEngine({ db, fts, vectors, embed });
  });

  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("仓储写入时同步生成 CJK 分词与拼音线索", async () => {
    const site = await repo.findSiteByUrl("https://weather.com.cn");
    expect(site).not.toBeNull();
    const row = (db.sqlite!.prepare("SELECT fts_tokens, pinyin_full, pinyin_initials FROM sites WHERE id = ?").get(site!.id)) as Record<string, string>;
    expect(row.fts_tokens).toContain("天气");
    expect(row.pinyin_full).toContain("zhongguotianqiwang");
    expect(row.pinyin_initials).toContain("zgtqw");
  });

  it("FTS5 能命中中文子串（unicode61 原生做不到）", async () => {
    const hits = await fts.search("天气", 5);
    expect(hits.length).toBeGreaterThan(0);
    const site = await repo.getSite(hits[0]!.siteId);
    expect(site?.title).toBe("中国天气网");
  });

  it("停用站点不会从 FTS / 语义通道泄漏（enabled 过滤跨通道一致）", async () => {
    const site = await repo.findSiteByUrl("https://unsplash.com");
    expect(site).not.toBeNull();
    await repo.updateSite(site!.id, { enabled: false });
    try {
      // 直连 FTS：SQLite 侧此前只过滤 deleted_at，停用站点仍会命中
      const ftsHits = await fts.search("Unsplash", 5);
      expect(ftsHits.map((h) => h.siteId)).not.toContain(site!.id);

      // 混合检索：fts / semantic 两路都不得回流
      const r = await engine.search({ q: "Unsplash", limit: 10 });
      expect(r.hits.map((h) => h.siteId)).not.toContain(site!.id);
    } finally {
      await repo.updateSite(site!.id, { enabled: true });
    }
  });

  it("拼音全拼与首字母都能命中", async () => {
    for (const q of ["qidong", "qdjb", "zgtqw"]) {
      const r = await engine.search({ q, limit: 5 });
      expect(r.hits.length).toBeGreaterThan(0);
    }
    const byInitial = await engine.search({ q: "zgtqw", limit: 3 });
    const top = await repo.getSite(byInitial.hits[0]!.siteId);
    expect(top?.title).toBe("中国天气网");
  });

  it("精确子串优先命中「启动脚本」", async () => {
    const r = await engine.search({ q: "启动", limit: 5 });
    const top = await repo.getSite(r.hits[0]!.siteId);
    expect(top?.title).toBe("启动脚本");
  });

  it("英文前缀命中（curs -> Cursor）", async () => {
    const r = await engine.search({ q: "curs", limit: 5 });
    const titles: string[] = [];
    for (const h of r.hits) titles.push((await repo.getSite(h.siteId))!.title);
    expect(titles).toContain("Cursor");
  });

  it("多通道命中同一站点时会被 coverage 加权排前", async () => {
    // "启动" 同时命中 exact / fts / pinyin 三路
    const r = await engine.search({ q: "启动", limit: 5 });
    const top = await repo.getSite(r.hits[0]!.siteId);
    const contrib = r.hits[0]!.contributions;
    expect(top?.title).toBe("启动脚本");
    expect(Object.keys(contrib).length).toBeGreaterThanOrEqual(2);
  });

  it("通道耗时按各通道自身墙钟计量（fts/pinyin 不再同值等于语义等待）", async () => {
    // 故意让 embedding 慢 40ms：旧实现把整批 await 时间同值记给 fts/pinyin/semantic，
    // 新实现下 fts/pinyin 只计自己的时间；semantic 仍如实包含推理等待。
    const slowEmbed = async (): Promise<Float32Array> => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return rnd(99);
    };
    const slowEngine = new SearchEngine({ db, fts, vectors, embed: slowEmbed });
    // 无精确命中 → planner 不 early-exit，三通道全跑
    const r = await slowEngine.search({ q: "zzzznomatch", limit: 5 });
    const t = r.channelTimings!;
    expect(t.skippedSemantic).toBe(false);
    expect(t.semanticMs).toBeGreaterThanOrEqual(30);

    /**
     * 判据从「绝对值 < 30ms」改成「与基线的差值 < 30ms」。
     *
     * 原来的写法把「本机查一次要多久」当成了前提：高负载下 exactMs 实测 75ms
     * （而 30ms 这个数字的本意是「必须小于注入的 40ms 等待」），于是这条断言
     * 在 CI/并行开发时会随机假红——本轮就因为它在提交前被挡了一次，
     * 单独复跑 68/68 又全绿。
     *
     * 差值判据与机器速度无关：自身慢，基线与慢版一起慢，差值仍接近 0；
     * 而旧实现（把整批 await 同值记给三通道）会让差值 ≈ 40ms，照样被抓。
     */
    const baseEngine = new SearchEngine({ db, fts, vectors, embed: async () => rnd(99) });
    const base = (await baseEngine.search({ q: "zzzznomatch", limit: 5 })).channelTimings!;
    for (const [name, slowMs, baseMs] of [
      ["fts", t.ftsMs, base.ftsMs],
      ["pinyin", t.pinyinMs, base.pinyinMs],
      ["exact", t.exactMs, base.exactMs],
    ] as Array<[string, number, number]>) {
      expect(
        slowMs - baseMs,
        `${name}Ms 不应包含 semantic 的等待（慢版 ${slowMs}ms vs 基线 ${baseMs}ms）`,
      ).toBeLessThan(30);
    }
  });

  it("类目过滤包含子类目", async () => {
    await repo.createSite({ url: "https://example.com/midjourney", title: "Midjourney", description: "AI 绘图", categoryId: "cat-ai-img", tags: ["ai"] });
    const r = await engine.search({ q: "", categoryId: "cat-ai", limit: 50 });
    const titles: string[] = [];
    for (const h of r.hits) titles.push((await repo.getSite(h.siteId))!.title);
    expect(titles).toContain("Midjourney");
    expect(titles).toContain("Cursor");
  });

  it("标签过滤生效", async () => {
    const r = await engine.search({ q: "", tag: "weather", limit: 20 });
    const titles: string[] = [];
    for (const h of r.hits) titles.push((await repo.getSite(h.siteId))!.title);
    expect(titles).toEqual(["中国天气网"]);
  });

  it("空查询走浏览模式，不返回 error", async () => {
    const r = await engine.search({ q: "", limit: 5 });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.channelsUsed).toEqual([]);
  });

  it("关闭语义通道时不报错，且如实上报 semanticAvailable", async () => {
    const noVec = new SearchEngine({ db, fts, vectors: null, embed: null });
    const r = await noVec.search({ q: "天气", limit: 5 });
    expect(r.semanticAvailable).toBe(false);
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it("检索结果在 limit 内且分数降序", async () => {
    const r = await engine.search({ q: "AI", limit: 4 });
    expect(r.hits.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < r.hits.length; i++) {
      expect(r.hits[i - 1]!.score).toBeGreaterThanOrEqual(r.hits[i]!.score);
    }
  });

  it("站点改名后检索线索同步更新（防静默失效）", async () => {
    const site = await repo.findSiteByUrl("https://claude.ai");
    await repo.updateSite(site!.id, { title: "Claude 助手" });
    const row = (db.sqlite!.prepare("SELECT fts_tokens FROM sites WHERE id = ?").get(site!.id)) as Record<string, string>;
    expect(row.fts_tokens).toContain("助手");
    const r = await engine.search({ q: "助手", limit: 5 });
    const titles: string[] = [];
    for (const h of r.hits) titles.push((await repo.getSite(h.siteId))!.title);
    expect(titles).toContain("Claude 助手");
  });

  it("删除站点后不再出现在结果中", async () => {
    const site = await repo.findSiteByUrl("https://excalidraw.com");
    await repo.deleteSite(site!.id);
    const r = await engine.search({ q: "Excalidraw", limit: 10 });
    const ids: string[] = r.hits.map((h) => h.siteId);
    expect(ids).not.toContain(site!.id);
  });

  it("统计接口返回真实计数", async () => {
    const s = await repo.stats();
    expect(s.categories).toBeGreaterThanOrEqual(5);
    expect(s.sites).toBeGreaterThan(0);
    expect(s.tags).toBeGreaterThan(0);
  });

  it("审计与事件可写入并落库", async () => {
    await repo.audit({ actor: "tester", action: "site.create", target: "x", diff: { a: 1 } });
    await repo.recordEvent("search", { query: "天气" });
    const logs = (db.sqlite!.prepare("SELECT COUNT(*) AS c FROM audit_logs").get()) as Record<string, number>;
    const events = (db.sqlite!.prepare("SELECT COUNT(*) AS c FROM events").get()) as Record<string, number>;
    expect(Number(logs.c)).toBeGreaterThan(0);
    expect(Number(events.c)).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * 集成：零结果兜底（两级放宽）
 * ------------------------------------------------------------------ */

describe("SQLite 集成：零结果兜底", () => {
  let dir: string;
  let db: Db;
  let repo: Repository;
  let engine: SearchEngine;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-fallback-"));
    db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "test.db") });
    repo = new Repository(db);
    await repo.createCategory({ id: "c-dev", title: "开发" });
    await repo.createCategory({ id: "c-life", title: "生活" });
    await repo.createSite({ url: "https://example.com/startup", title: "启动脚本", description: "服务启动脚本", categoryId: "c-dev", tags: ["devops"] });
    await repo.createSite({ url: "https://npmjs.com", title: "npm", description: "JavaScript 包管理器", categoryId: "c-dev", tags: ["devops"] });
    // fts/vectors 全关：纯 exact 通道，验证兜底重试本身而非搭 FTS 的便车
    engine = new SearchEngine({ db, fts: null, vectors: null, embed: null });
  });

  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("第 1 级：类目过滤太窄时放宽过滤并标记 fallback=filter", async () => {
    // 「启动」在 c-dev；限定 c-life 后为零 → 放宽到全库
    const r = await engine.search({ q: "启动", categoryId: "c-life", limit: 10 });
    expect(r.fallback).toBe("filter");
    const titles: string[] = [];
    for (const h of r.hits) titles.push((await repo.getSite(h.siteId))!.title);
    expect(titles).toContain("启动脚本");
  });

  it("第 2 级：英文多词整串不中时按词拆分 OR 并标记 fallback=fuzzy", async () => {
    // 整串 "%javascript package%" 不匹配任何 title/url/desc；
    // fuzzy 拆词后 "javascript" 命中 npm 描述
    const r = await engine.search({ q: "javascript package", limit: 10 });
    expect(r.fallback).toBe("fuzzy");
    expect(r.hits.length).toBeGreaterThan(0);
    const top = await repo.getSite(r.hits[0]!.siteId);
    expect(top?.title).toBe("npm");
  });

  it("拼音归一化 + 包含匹配兜住非前缀输入（fuzzy 第 2 级内）", async () => {
    // "Dong Jiao"：exact 的 "%dong jiao%" 不中（pinyin_full 无空格），
    // pinyin 通道归一化为 "dongjiao" 但前缀匹配 "qidongjiaoben" 也不中
    // → 第 1 轮零结果 → fuzzy 包含匹配命中启动脚本
    const r = await engine.search({ q: "Dong Jiao", limit: 10 });
    expect(r.fallback).toBe("fuzzy");
    const titles: string[] = [];
    for (const h of r.hits) titles.push((await repo.getSite(h.siteId))!.title);
    expect(titles).toContain("启动脚本");
  });

  it("过滤存在且查询真不存在时：不兜底、如实返回空", async () => {
    const r = await engine.search({ q: "纯属虚构zzz", categoryId: "c-life", limit: 10 });
    expect(r.hits).toEqual([]);
    expect(r.fallback).toBeUndefined();
  });

  it("有正常结果时 fallback 字段缺席（前端无需判断）", async () => {
    const r = await engine.search({ q: "启动", limit: 10 });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.fallback).toBeUndefined();
  });

  it("放宽过滤发生在模糊匹配之前（级别顺序不乱）", async () => {
    // 类目不匹配 + 整串英文不中：第 1 级放宽过滤就能出结果 → 应标 filter 而非 fuzzy
    const r = await engine.search({ q: "javascript", categoryId: "c-life", limit: 10 });
    expect(r.fallback).toBe("filter");
    expect(r.hits.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * 集成：搜索分页（offset + hasMore）
 * ------------------------------------------------------------------ */

describe("SQLite 集成：搜索分页", () => {
  let dir: string;
  let db: Db;
  let repo: Repository;
  let engine: SearchEngine;

  /** 15 个中文站点，压成固定 3 页（limit=5） */
  const SEEDS = Array.from({ length: 15 }, (_, i) => ({
    url: "https://page-" + i + ".example.com",
    title: "分页站点" + String(i + 1).padStart(2, "0"),
    description: "用于分页测试的站点",
    categoryId: "c-all",
    tags: ["分页"],
  }));

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-paging-"));
    db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "test.db") });
    repo = new Repository(db);
    await repo.createCategory({ id: "c-all", title: "全部" });
    for (const s of SEEDS) await repo.createSite(s);
    engine = new SearchEngine({ db, fts: null, vectors: null, embed: null });
  });

  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("第 1 页返回 limit 条且 hasMore=true；翻页拼接与一次取全一致", async () => {
    const p1 = await engine.search({ q: "分页站点", limit: 5, offset: 0 });
    expect(p1.hits.length).toBe(5);
    expect(p1.hasMore).toBe(true);
    expect(p1.offset).toBe(0);

    const p2 = await engine.search({ q: "分页站点", limit: 5, offset: 5 });
    expect(p2.hits.length).toBe(5);
    expect(p2.hasMore).toBe(true);

    const p3 = await engine.search({ q: "分页站点", limit: 5, offset: 10 });
    expect(p3.hits.length).toBe(5);
    expect(p3.hasMore).toBe(false);

    // 三页拼接 == 一次取 15 条（RRF 确定性：同输入同输出）
    const full = await engine.search({ q: "分页站点", limit: 15, offset: 0 });
    const joined = [...p1.hits, ...p2.hits, ...p3.hits].map((h) => h.siteId);
    expect(joined).toEqual(full.hits.map((h) => h.siteId));
    // 无重复
    expect(new Set(joined).size).toBe(joined.length);
  });

  it("offset 超过总量时返回空且 hasMore=false（不报错）", async () => {
    const r = await engine.search({ q: "分页站点", limit: 5, offset: 999 });
    expect(r.hits).toEqual([]);
    expect(r.hasMore).toBe(false);
  });

  it("浏览模式（空查询）同样分页，hasMore 探针准确", async () => {
    const p1 = await engine.search({ q: "", limit: 10, offset: 0 });
    expect(p1.hits.length).toBe(10);
    expect(p1.hasMore).toBe(true);

    const p2 = await engine.search({ q: "", limit: 10, offset: 10 });
    expect(p2.hits.length).toBe(5);       // 只剩 5 条
    expect(p2.hasMore).toBe(false);       // 第 11 条探针不存在

    const p3 = await engine.search({ q: "", limit: 10, offset: 20 });
    expect(p3.hits).toEqual([]);
    expect(p3.hasMore).toBe(false);
  });

  it("浏览末页多取 1 条的探针不会漏（15 条 / limit=14 → 第 1 页 hasMore）", async () => {
    const p1 = await engine.search({ q: "", limit: 14, offset: 0 });
    expect(p1.hits.length).toBe(14);
    expect(p1.hasMore).toBe(true);
    const p2 = await engine.search({ q: "", limit: 14, offset: 14 });
    expect(p2.hits.length).toBe(1);
    expect(p2.hasMore).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 集成：新增能力（分类管理 / 标签 / 收藏 / 画像 / 历史 / 用户 / 任务 / 迁移）
 * ------------------------------------------------------------------ */

describe("SQLite 集成：软删除回收站", () => {
  let dir: string;
  let db: Db;
  let repo: Repository;
  let engine: SearchEngine;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-trash-"));
    db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "test.db") });
    repo = new Repository(db);
    await repo.createCategory({ id: "c-trash", title: "回收站测试" });
    engine = new SearchEngine({ db, fts: null, vectors: null, embed: null });
  });

  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("删除是软删：行仍在，deletedAt 被打戳，且不出现在常规查询", async () => {
    const site = await repo.createSite({ url: "https://trash-1.example.com", title: "软删站点一", categoryId: "c-trash", tags: ["软删"] });
    await repo.deleteSite(site.id);

    // getSite / listSites / findSiteByUrl 都排除
    expect(await repo.getSite(site.id)).toBeNull();
    expect(await repo.getSite(site.url)).toBeNull();
    expect(await repo.findSiteByUrl(site.url)).toBeNull();
    expect((await repo.listSites()).map((s) => s.id)).not.toContain(site.id);

    // 行还在，且带 deletedAt
    const deleted = await repo.getDeletedSite(site.id);
    expect(deleted).not.toBeNull();
    expect(typeof deleted!.deletedAt).toBe("number");
    expect(deleted!.title).toBe("软删站点一");

    // 检索（exact 通道）也排除
    const r = await engine.search({ q: "软删站点一", limit: 10 });
    expect(r.hits.map((h) => h.siteId)).not.toContain(site.id);
  });

  it("删除后同 URL 可以立即重新添加（部分唯一索引生效）", async () => {
    const url = "https://trash-2.example.com";
    const first = await repo.createSite({ url, title: "旧站", categoryId: "c-trash" });
    await repo.deleteSite(first.id);
    // 旧库里 sites_url_idx 是全表唯一 → 这里会被 UNIQUE 约束挡下
    const second = await repo.createSite({ url, title: "新站", categoryId: "c-trash" });
    expect(second.url).toBe(url);
    expect(second.title).toBe("新站");
    expect(second.id).not.toBe(first.id);
    // 新站在常规查询里可见，旧站在回收站里
    expect((await repo.getSite(url))!.title).toBe("新站");
    expect((await repo.getDeletedSite(first.id))!.title).toBe("旧站");
  });

  it("恢复：清 deletedAt，站点回到常规查询；向量/标签语义保留", async () => {
    const site = await repo.createSite({ url: "https://trash-3.example.com", title: "待恢复站", categoryId: "c-trash", tags: ["恢复"] });
    await repo.deleteSite(site.id);
    const restored = await repo.restoreSite(site.id);
    expect(restored).not.toBeNull();
    expect(restored!.deletedAt).toBeNull();
    expect((await repo.getSite(site.id))!.title).toBe("待恢复站");
    expect(await repo.getDeletedSite(site.id)).toBeNull();
    // 标签保留（软删不动 site_tags）
    expect((await repo.getSite(site.id))!.tags).toContain("恢复");
  });

  it("恢复时若同 URL 已有新站点，API 层拒绝（409）——仓储层只提供信息", async () => {
    const url = "https://trash-4.example.com";
    const oldSite = await repo.createSite({ url, title: "旧站4", categoryId: "c-trash" });
    await repo.deleteSite(oldSite.id);
    await repo.createSite({ url, title: "新站4", categoryId: "c-trash" });
    // 仓储层不拦截，但 getDeletedSite 仍能取到旧记录（供 API 层做 clash 判断）
    expect(await repo.getDeletedSite(oldSite.id)).not.toBeNull();
  });

  it("purge：彻底删除行与关联（site_tags / embeddings）", async () => {
    const site = await repo.createSite({ url: "https://trash-5.example.com", title: "永久删除站", categoryId: "c-trash", tags: ["彻底"] });
    await repo.saveEmbedding(site.id, "test", new Float32Array([1, 2, 3]));
    await repo.deleteSite(site.id);

    await repo.purgeSite(site.id);
    expect(db.sqlite!.prepare("SELECT COUNT(*) AS c FROM sites WHERE id = ?").get(site.id)).toMatchObject({ c: 0 });
    expect(db.sqlite!.prepare("SELECT COUNT(*) AS c FROM site_tags WHERE site_id = ?").get(site.id)).toMatchObject({ c: 0 });
    expect(db.sqlite!.prepare("SELECT COUNT(*) AS c FROM embeddings WHERE site_id = ?").get(site.id)).toMatchObject({ c: 0 });
    expect(await repo.getDeletedSite(site.id)).toBeNull();
  });

  it("stats：软删站点不计入 sites，trashed 计数回收站", async () => {
    const before = await repo.stats();
    const site = await repo.createSite({ url: "https://trash-6.example.com", title: "统计站", categoryId: "c-trash" });
    const mid = await repo.stats();
    expect(mid.sites).toBe(before.sites + 1);
    const trashedBefore = mid.trashed;
    await repo.deleteSite(site.id);
    const after = await repo.stats();
    expect(after.sites).toBe(before.sites);       // 删掉后回到原值
    expect(after.trashed).toBe(trashedBefore + 1); // 但回收站 +1
  });

  it("listDeletedSites：只含软删站点，倒序（新的在前）", async () => {
    const a = await repo.createSite({ url: "https://trash-7a.example.com", title: "倒序A", categoryId: "c-trash" });
    await repo.deleteSite(a.id);
    await new Promise((r) => setTimeout(r, 5));   // 保证时间戳不同
    const b = await repo.createSite({ url: "https://trash-7b.example.com", title: "倒序B", categoryId: "c-trash" });
    await repo.deleteSite(b.id);

    const list = await repo.listDeletedSites(500);
    const ids = list.map((s) => s.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));   // b 后删，排更前
    // 列表里全是软删的（不含正常站点）
    for (const s of list) expect(typeof s.deletedAt).toBe("number");
  });

  it("同 id 复活：createSiteWithId 遇到软删同 id 行时复活而非主键冲突", async () => {
    const id = "fixed-id-revive";
    const first = await repo.createSiteWithId({ id, url: "https://trash-8.example.com", title: "原站", categoryId: "c-trash" });
    await repo.deleteSite(first.id);

    // 模拟快照写回用原 id 重建
    const revived = await repo.createSiteWithId({ id, url: "https://trash-8.example.com", title: "快照重建站", categoryId: "c-trash", source: "navsphere" });
    expect(revived.id).toBe(id);
    expect(revived.title).toBe("快照重建站");
    expect(revived.deletedAt).toBeNull();
    expect(revived.source).toBe("navsphere");
    expect(await repo.getDeletedSite(id)).toBeNull();
  });
});

describe("SQLite 集成：导航增强能力", () => {
  let dir: string;
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-store2-"));
    db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "test.db") });
    repo = new Repository(db);
    await repo.createCategory({ id: "c1", title: "开发" });
    await repo.createCategory({ id: "c2", title: "设计", parentId: "c1" });
    await repo.createCategory({ id: "c3", title: "子类", parentId: "c2" });
    await repo.createSite({ url: "https://a.com", title: "站点A", categoryId: "c3", tags: ["工具"] });
    await repo.createSite({ url: "https://b.com", title: "站点B", categoryId: "c1", tags: ["工具", "开发"] });
  });

  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /* ------------------------- 分类管理 ------------------------- */

  it("移动类目时全部后代的 anchor 同步级联更新", async () => {
    await repo.createCategory({ id: "root-x", title: "另一个根" });
    const moved = await repo.moveCategory("c1", "root-x");
    expect(moved).not.toBeNull();
    expect(moved!.anchor).toBe("root-x/c1");
    const c2 = await repo.getCategory("c2");
    const c3 = await repo.getCategory("c3");
    expect(c2!.anchor).toBe("root-x/c1/c2");
    expect(c3!.anchor).toBe("root-x/c1/c2/c3");
    expect(c2!.parentId).toBe("c1");
  });

  it("拒绝把类目移动到它自己或它的子类目下面（防成环）", async () => {
    await expect(repo.moveCategory("c1", "c1")).rejects.toThrow(/自己/);
    await expect(repo.moveCategory("c1", "c3")).rejects.toThrow(/子类目/);
  });

  it("合并类目：源子树的站点迁入目标，源子树被删除", async () => {
    await repo.createCategory({ id: "m1", title: "合并源" });
    await repo.createCategory({ id: "m2", title: "合并源子", parentId: "m1" });
    await repo.createSite({ url: "https://m1.com", title: "合并站1", categoryId: "m1" });
    await repo.createSite({ url: "https://m2.com", title: "合并站2", categoryId: "m2" });
    await repo.createCategory({ id: "m-target", title: "合并目标" });

    const result = await repo.mergeCategories("m1", "m-target");
    expect(result.movedSites).toBe(2);
    expect(result.removedCategories).toBe(2);
    expect(await repo.getCategory("m1")).toBeNull();
    expect(await repo.getCategory("m2")).toBeNull();
    const s1 = await repo.findSiteByUrl("https://m1.com");
    expect(s1!.categoryId).toBe("m-target");
    const s2 = await repo.findSiteByUrl("https://m2.com");
    expect(s2!.categoryId).toBe("m-target");
  });

  it("删除类目时站点被移入「未分类」而不是被级联删除", async () => {
    const siteA = await repo.findSiteByUrl("https://a.com");
    expect(siteA!.categoryId).toBe("c3");
    await repo.deleteCategory("c3");
    const after = await repo.findSiteByUrl("https://a.com");
    expect(after).not.toBeNull();
    const fallback = await repo.getCategory((await repo.listCategories()).find((c) => c.title === "未分类")!.id);
    expect(after!.categoryId).toBe(fallback!.id);
    // 子类目被提升，没有成孤儿
    expect(await repo.getCategory("c3")).toBeNull();
  });

  /* ------------------------- 标签 ------------------------- */

  it("标签云返回真实计数", async () => {
    const tags = await repo.listTagsWithCounts();
    expect(tags.length).toBeGreaterThan(0);
    const gongju = tags.find((t) => t.name === "工具");
    expect(gongju).toBeTruthy();
    expect(gongju!.count).toBeGreaterThanOrEqual(2);
  });

  it("重命名标签会同步 slug", async () => {
    const before = (await repo.listTagsWithCounts()).find((t) => t.name === "工具")!;
    await repo.renameTag(before.id, "工具箱");
    const after = (await repo.listTagsWithCounts()).find((t) => t.id === before.id)!;
    expect(after.name).toBe("工具箱");
    expect(after.slug).toBe("工具箱");
  });

  it("合并标签把关联迁到目标并删源", async () => {
    const tags = await repo.listTagsWithCounts();
    const dev = tags.find((t) => t.name === "开发")!;
    const box = tags.find((t) => t.name === "工具箱")!;
    const result = await repo.mergeTags(box.id, dev.id);
    expect(result.moved).toBeGreaterThanOrEqual(0);
    expect((await repo.listTagsWithCounts()).find((t) => t.id === box.id)).toBeUndefined();
  });

  it("删除标签解除关联、站点 tags 同步剔除，并刷新站点检索索引", async () => {
    // 造一个只属于某站点的专属标签，保证删除前后可对比
    const site = (await repo.findSiteByUrl("https://a.com"))!;
    await repo.setSiteTags(site.id, [...site.tags, "孤独特有标签"]);
    const before = (await repo.getSite(site.id))!;
    expect(before.tags).toContain("孤独特有标签");

    const tag = (await repo.listTagsWithCounts()).find((t) => t.name === "孤独特有标签")!;
    const result = await repo.deleteTag(tag.id);
    expect(result.unbound).toBeGreaterThanOrEqual(1);
    // 标签行没了、站点侧同步剔除
    expect((await repo.listTagsWithCounts()).find((t) => t.id === tag.id)).toBeUndefined();
    const after = (await repo.getSite(site.id))!;
    expect(after.tags).not.toContain("孤独特有标签");
    // 索引语料已重算：fts_tokens 不再含被删标签（否则搜它还会命中，静默不一致）
    expect(after).not.toBeNull();
    const rows = await (repo as unknown as { raw(sql: string, p: unknown[]): Promise<Record<string, unknown>[]> })
      .raw("SELECT fts_tokens FROM sites WHERE id = ?", [site.id]);
    expect(String(rows[0]!.fts_tokens)).not.toContain("孤独特有标签");
    // 不存在的标签 → 报错而不是静默成功
    await expect(repo.deleteTag(tag.id)).rejects.toThrow(/不存在/);
  });

  /* ------------------------- 收藏夹 ------------------------- */

  it("收藏幂等：重复收藏返回 existed 而不是报错或重复行", async () => {
    const site = await repo.findSiteByUrl("https://b.com");
    const first = await repo.addFavorite({ userId: "u1", siteId: site!.id });
    expect(first.existed).toBe(false);
    const second = await repo.addFavorite({ userId: "u1", siteId: site!.id });
    expect(second.existed).toBe(true);
    const list = await repo.listFavorites("u1");
    expect(list.length).toBe(1);
    expect(list[0]!.siteId).toBe(site!.id);
  });

  it("取消收藏与文件夹管理", async () => {
    const site = await repo.findSiteByUrl("https://b.com");
    const folder = await repo.createFavoriteFolder("u1", "常用");
    await repo.addFavorite({ userId: "u1", siteId: site!.id, folderId: folder.id });
    const folders = await repo.listFavoriteFolders("u1");
    expect(folders.length).toBe(1);
    // 删文件夹：收藏变未分组但不消失
    await repo.deleteFavoriteFolder("u1", folder.id);
    const list = await repo.listFavorites("u1");
    expect(list.length).toBe(1);
    expect(list[0]!.folderId).toBeNull();
    // 取消收藏
    expect(await repo.removeFavorite("u1", site!.id)).toBe(true);
    expect(await repo.removeFavorite("u1", site!.id)).toBe(false);
    expect((await repo.listFavorites("u1")).length).toBe(0);
  });

  /* ------------------------- 个性化画像 ------------------------- */

  it("画像写入与读回 roundtrip", async () => {
    await repo.saveUserProfile("u1", {
      topCategories: ["c1"], topTags: ["devops"], visitedSiteIds: ["x", "y"], favoriteSiteIds: ["z"], searchCount: 3,
    });
    const p = await repo.getUserProfile("u1");
    expect(p).not.toBeNull();
    expect(p!.topCategories).toEqual(["c1"]);
    expect(p!.visitedSiteIds).toEqual(["x", "y"]);
    expect(p!.searchCount).toBe(3);
    // 覆盖写（ON CONFLICT）而不是插第二条
    await repo.saveUserProfile("u1", {
      topCategories: ["c2"], topTags: [], visitedSiteIds: [], favoriteSiteIds: [], searchCount: 4,
    });
    const p2 = await repo.getUserProfile("u1");
    expect(p2!.topCategories).toEqual(["c2"]);
    expect(p2!.searchCount).toBe(4);
  });

  it("画像 JSON 损坏时返回空数组而不是抛错", async () => {
    db.sqlite!.prepare("INSERT OR REPLACE INTO user_profiles (user_id, top_categories, top_tags, visited_site_ids, favorite_site_ids, search_count, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("broken", "not-json", "", "", "", 0, Date.now());
    const p = await repo.getUserProfile("broken");
    expect(p!.topCategories).toEqual([]);
  });

  /* ------------------------- 搜索历史 ------------------------- */

  it("搜索历史记录 / 列表 / 清空", async () => {
    await repo.recordSearch("u1", "  天气  ", 3);
    await repo.recordSearch("u1", "", 0); // 空查询被忽略
    await repo.recordSearch("u1", "设计", 1);
    const items = await repo.listSearchHistory("u1", 10);
    expect(items.length).toBe(2);
    expect(items[0]!.query).toBe("设计");
    expect(items[1]!.query).toBe("天气"); // trim 过
    await repo.clearSearchHistory("u1");
    expect((await repo.listSearchHistory("u1")).length).toBe(0);
  });

  it("查询词长度全链路同源：256 字可入库，257 字显式拒绝且不落行", async () => {
    const max = "长".repeat(256);
    await repo.recordSearch("u-limit", max, 1);
    const items = await repo.listSearchHistory("u-limit", 10);
    expect(items.length).toBe(1);
    expect(items[0]!.query.length).toBe(256);

    // 不做静默截断：超长说明调用方漏了入口校验，必须响亮失败
    await expect(repo.recordSearch("u-limit", "长".repeat(257), 1)).rejects.toThrow(/256/);
    expect((await repo.listSearchHistory("u-limit", 10)).length).toBe(1);
  });

  /* ------------------------- 终端用户 ------------------------- */

  it("OAuth 用户 upsert：按 username 归一，不再按 email 绑定", async () => {
    const created = await repo.upsertOauthUser({ id: "github:1", username: "alice", email: "alice@example.com" });
    expect(created.role).toBe("user");
    expect(created.source).toBe("github");

    // 同一 username 再登录：更新资料而不是新建
    const again = await repo.upsertOauthUser({ username: "alice", email: "alice@example.com", avatar: "https://a.png" });
    expect(again.id).toBe(created.id);
    expect(again.avatar).toBe("https://a.png");

    // 换 username 但同 email：**不再**归一到同一用户（email 可伪造，静默绑定=账号接管面）。
    // 新行会撞 users_email_unique_idx，于是降级为不写 email，而不是让登录失败。
    const byEmail = await repo.upsertOauthUser({ username: "alice2", email: "alice@example.com" });
    expect(byEmail.id).not.toBe(created.id);
    expect(byEmail.email).toBeNull();

    const fetched = await repo.getUser("alice");
    expect(fetched!.email).toBe("alice@example.com");
  });

  /* ------------------------- 行为统计 ------------------------- */

  it("点击计数与热度分写入", async () => {
    const site = (await repo.findSiteByUrl("https://a.com"))!;
    await repo.bumpVisit(site.id);
    await repo.bumpVisit(site.id);
    const after = await repo.findSiteByUrl("https://a.com");
    expect(after!.visitCount).toBe(2);
    expect(after!.lastVisitedAt).toBeGreaterThan(0);

    await repo.setTrendScores([{ id: site.id, trendScore: 9.5 }]);
    const hot = await repo.hotSites(10);
    expect(hot[0]!.id).toBe(site.id);
    expect(hot[0]!.trendScore).toBeCloseTo(9.5);

    const newest = await repo.newestSites(1);
    expect(newest.length).toBe(1);
  });

  /* ------------------------- 任务队列 ------------------------- */

  it("任务入队 / 抢占 / 完成 / 列表", async () => {
    const id = await repo.enqueueJob("health_check", { siteId: "x" });
    expect(id).toBeTruthy();
    const claimed = await repo.claimNextJob();
    expect(claimed).not.toBeNull();
    expect(claimed!.kind).toBe("health_check");
    expect(claimed!.attempts).toBe(1);
    expect(claimed!.payload).toEqual({ siteId: "x" });
    // 没有更多 pending
    expect(await repo.claimNextJob()).toBeNull();
    await repo.completeJob(claimed!.id, null);
    const done = (await repo.listJobs("done", 10)).find((j) => j.id === claimed!.id);
    expect(done).toBeTruthy();
    // completeJob 是 CAS 到 running：已完成的任务不会被迟到的失败结果改写。
    // 要验证失败落库，先把任务恢复成 running（模拟重新认领）。
    await repo.run("UPDATE jobs SET status = 'running' WHERE id = ?", [claimed!.id]);
    expect(await repo.completeJob(claimed!.id, "boom")).toBe(true);
    const failed = (await repo.listJobs("failed", 10)).find((j) => j.id === claimed!.id);
    expect(failed!.error).toBe("boom");
    // 再次回写同一任务（已不在 running）必须被忽略
    expect(await repo.completeJob(claimed!.id, "late")).toBe(false);
    expect((await repo.getJob(claimed!.id))?.error).toBe("boom");
  });

  /* ------------------------- 迁移幂等 ------------------------- */

  it("列迁移幂等：第二次执行返回空", async () => {
    const { migrateColumns } = await import("../src/migrate.ts");
    const added = await migrateColumns(db);
    expect(added).toEqual([]);
    // 新列真实存在
    const cols = (db.sqlite!.prepare("PRAGMA table_info(sites)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("visit_count");
    expect(cols).toContain("trend_score");
    expect(cols).toContain("last_visited_at");
    const tables = (db.sqlite!.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name);
    for (const t of ["favorites", "favorite_folders", "user_profiles", "search_history", "user_vault_sync", "plugins", "plugin_installs", "plugin_stars"]) {
      expect(tables).toContain(t);
    }
  });

  it("用户端侧加密金库云端持久化 (user_vault_sync)：支持保存、读回、版本自增与删除", async () => {
    const testUserId = "user-test-e2ee-vault";
    const initialPayload = JSON.stringify({ ciphertext: "encrypted_abc", iv: "iv_123" });

    // 初始读取为空
    const empty = await repo.getUserVault(testUserId);
    expect(empty).toBeNull();

    // 首次保存
    const saved1 = await repo.saveUserVault(testUserId, initialPayload);
    expect(saved1.version).toBe(1);
    expect(saved1.updatedAt).toBeGreaterThan(0);

    const fetched1 = await repo.getUserVault(testUserId);
    expect(fetched1).not.toBeNull();
    expect(fetched1?.userId).toBe(testUserId);
    expect(fetched1?.payload).toBe(initialPayload);
    expect(fetched1?.version).toBe(1);

    // 二次保存更新，版本自增
    const updatedPayload = JSON.stringify({ ciphertext: "encrypted_xyz_updated", iv: "iv_456" });
    const saved2 = await repo.saveUserVault(testUserId, updatedPayload);
    expect(saved2.version).toBe(2);

    const fetched2 = await repo.getUserVault(testUserId);
    expect(fetched2?.payload).toBe(updatedPayload);
    expect(fetched2?.version).toBe(2);

    // 删除
    const deleted = await repo.deleteUserVault(testUserId);
    expect(deleted).toBe(true);
    expect(await repo.getUserVault(testUserId)).toBeNull();
  });

  it("旧库（缺新列）在 openDb 时被自动补齐", async () => {
    // 用「旧 DDL」建一个缺列的库，再走 openDb，验证自动迁移
    const oldDir = mkdtempSync(join(tmpdir(), "navhub-olddb-"));
    const oldPath = join(oldDir, "old.db");
    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(oldPath);
    raw.exec("CREATE TABLE sites (id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, category_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', enabled INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0, weight REAL NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0, source TEXT, fts_tokens TEXT NOT NULL DEFAULT '', pinyin_full TEXT NOT NULL DEFAULT '', pinyin_initials TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    raw.exec("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', created_at INTEGER NOT NULL)");
    raw.close();

    const db2 = await openDb({ dialect: "sqlite", sqlitePath: oldPath });
    const cols = (db2.sqlite!.prepare("PRAGMA table_info(sites)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("visit_count");
    const ucols = (db2.sqlite!.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(ucols).toContain("email");
    expect(ucols).toContain("source");
    await db2.close();
    rmSync(oldDir, { recursive: true, force: true });
  });

  it("events.identity：新事件落独立列，历史行从 meta 回填，等值查询/删除生效", async () => {
    // 1) 新写入：recordEvent 从 payload/meta 提取 identity 落列
    await repo.recordEvent("click", { siteId: (await repo.listSites({ limit: 1 }))[0]?.id, meta: { identity: "user-roundtrip" } });
    const row = db.sqlite!.prepare("SELECT identity FROM events WHERE meta LIKE '%user-roundtrip%'").get() as { identity: string | null };
    expect(row.identity).toBe("user-roundtrip");

    // 2) 历史行回填：模拟旧库——identity 列为 NULL、身份藏在 meta JSON 里
    db.sqlite!.prepare("UPDATE events SET identity = NULL WHERE meta LIKE '%user-roundtrip%'").run();
    const { migrateEventIdentity } = await import("../src/migrate.ts");
    const backfilled = await migrateEventIdentity(db);
    expect(backfilled).toBeGreaterThan(0);
    const after = db.sqlite!.prepare("SELECT identity FROM events WHERE meta LIKE '%user-roundtrip%'").get() as { identity: string | null };
    expect(after.identity).toBe("user-roundtrip");

    // 3) 等值查询命中（不再依赖 meta LIKE）
    const events = await repo.behaviorEvents("user-roundtrip", 0);
    expect(events.length).toBeGreaterThan(0);

    // 4) 等值删除只删该身份
    db.sqlite!.prepare("UPDATE events SET identity = 'other-user' WHERE meta LIKE '%user-roundtrip%' AND id <> (SELECT MAX(id) FROM events WHERE meta LIKE '%user-roundtrip%')").run();
    const removed = await repo.deleteBehaviorEvents("user-roundtrip");
    expect(removed).toBe(1);
    expect((await repo.behaviorEvents("user-roundtrip", 0)).length).toBe(0);
    // 幂等：重复回填第二次不应再改行（identity 已非 NULL）
    expect(await migrateEventIdentity(db)).toBe(0);
  });

  it("旧库 jobs 表缺 next_run_at 列时 openDb 不崩（索引先于迁移的启动阻断）", async () => {
    // 真实故障复现：老库 jobs 表已存在但无 next_run_at，
    // DDL 的 CREATE INDEX ON jobs(status, next_run_at) 先崩，服务无法启动。
    const oldDir = mkdtempSync(join(tmpdir(), "navhub-oldjobs-"));
    const oldPath = join(oldDir, "old.db");
    const Database = (await import("better-sqlite3")).default;
    const raw = new Database(oldPath);
    raw.exec("CREATE TABLE jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    raw.close();

    const db2 = await openDb({ dialect: "sqlite", sqlitePath: oldPath });
    const cols = (db2.sqlite!.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("next_run_at");
    // 索引在重放后真实存在（不只是列补了、索引跳过）
    const idx = (db2.sqlite!.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'jobs_next_run_idx'").all() as Array<{ name: string }>);
    expect(idx.length).toBe(1);
    // 队列在该库上可正常使用
    const repo2 = new Repository(db2);
    const id = await repo2.enqueueJob("recompute_rank", {});
    expect((await repo2.claimNextJob())?.id).toBe(id);
    await db2.close();
    rmSync(oldDir, { recursive: true, force: true });
  });

  it("API Token 治理：软吊销、前缀、轮换不冲刷创建时间、按分钟节流 touch", async () => {
    const rawHash1 = "hash-token-111111111111111111111111";
    const rawHash2 = "hash-token-222222222222222222222222";
    const token = await repo.createApiToken({
      name: "自动化测试 Token",
      tokenHash: rawHash1,
      scopes: "read,write",
      tokenPrefix: "nh_1a2b",
    });

    expect(token.id).toBeTruthy();
    expect(token.tokenPrefix).toBe("nh_1a2b");
    expect(token.revokedAt).toBeNull();
    expect(token.rotatedAt).toBeNull();

    // 1. 正常查询可用
    const found = await repo.findApiTokenByHash(rawHash1);
    expect(found?.id).toBe(token.id);

    // 2. touch 节流：同 ID 连续 touch 不重复写入数据库
    await repo.touchApiToken(token.id);
    const row1 = (await repo.listApiTokens()).find((t) => t.id === token.id)!;
    expect(row1.lastUsedAt).toBeTruthy();

    // 3. 轮换：换新 hash，更新 rotatedAt，但不修改 createdAt
    const rotated = await repo.rotateApiToken(token.id, rawHash2, null, "nh_3c4d");
    expect(rotated?.tokenPrefix).toBe("nh_3c4d");
    expect(rotated?.createdAt).toBe(token.createdAt);
    expect(rotated?.rotatedAt).toBeTruthy();
    expect(rotated?.lastUsedAt).toBeNull();

    // 旧 hash 查不到，新 hash 可查
    expect(await repo.findApiTokenByHash(rawHash1)).toBeNull();
    expect((await repo.findApiTokenByHash(rawHash2))?.id).toBe(token.id);

    // 4. 软吊销：设置 revokedAt，不可被查到，但记录保留供审计追溯
    const revoked = await repo.revokeApiToken(token.id);
    expect(revoked?.revokedAt).toBeTruthy();
    expect(await repo.findApiTokenByHash(rawHash2)).toBeNull();

    const listed = await repo.listApiTokens();
    const retained = listed.find((t) => t.id === token.id);
    expect(retained?.revokedAt).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ *
 * 快照层用：listAllSites 不分页、不受 1000 上限裁剪
 * ------------------------------------------------------------------ */

describe("SQLite 集成：全量站点（快照层专用）", () => {
  const TOTAL = 105;
  let dir: string;
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-listall-"));
    db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "test.db") });
    repo = new Repository(db);
    await repo.createCategory({ id: "c-all", title: "全部" });
    for (let i = 0; i < TOTAL; i++) {
      await repo.createSite({ url: "https://all-" + i + ".example.com", title: "全量站点" + i, categoryId: "c-all" });
    }
  });

  afterAll(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("listSites 默认截断 100（普通列表语义），listAllSites 返回全量", async () => {
    expect((await repo.listSites()).length).toBe(100); // 普通列表的分页语义保持不变
    expect((await repo.listAllSites()).length).toBe(TOTAL); // 快照层拿全量
    expect((await repo.listAllSites(3)).length).toBe(3); // 上限参数仍可生效
    // 软删站点不参与（用 listAllSites 找目标：listSites 只回前 100，创建时间相同的情况下
    // 最老的站点未必在窗口内，用普通列表找会导致用例随排序抖动而失败）
    const victim = (await repo.listAllSites()).find((s) => s.title === "全量站点0")!;
    await repo.deleteSite(victim.id);
    expect((await repo.listAllSites()).length).toBe(TOTAL - 1);
  });
});
