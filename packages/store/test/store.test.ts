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
