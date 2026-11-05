/**
 * 拼音通道的两条口径。
 *
 * 一、**中文查询压根不进拼音通道**。拼音列是给「用拉丁字母打中文」用的（`qdjb` → 启动脚本）；
 * 中文查询在 exact 通道已经按标题/描述原文 contains 过，再转成拼音去 LIKE 只会撞上
 * `pinyin_full` 跨词界连写出来的子串。前提（用例 1 锁住）：库里拉丁标题的 pinyin_initials
 * 存的就是整串小写标题——`buildIndexFields` 取 `pinyinTraits(title).initials`，而 pinyinTraits 用
 * `nonZh: "consecutive"`，于是 "Hetzner" → `hetzner`、"StackBlitz" → `stackblitz`、
 * "Forest 专注森林" → `forestzzsl`（与生产库实测同形）。
 * 真库 88 条真实中文查询实测：跳过之后 7 条结果集变化，丢掉的 9 条命中全是乱撞
 * （`梯子`→Fontsource、`小说`→XState、`书签`→SQLite、`面试`→MSI Afterburner），
 * 没有一条本来是对的命中。
 *
 * 二、拉丁查询的 fuzzy「包含」放宽对首字母串要设**长度门槛**（3 字母）：
 * 2 字母模式（`tz`）于是跨过词界乱撞，而 `tqw` 这类「命中落在中段」的查询仍要能召回。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

let db: Db;
let repo: Repository;
/** siteId -> 标题，断言按标题写，读起来才是「哪个站点被端出来了」 */
const titleById = new Map<string, string>();

beforeAll(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
  const cat = await repo.createCategory({ title: "拼音门槛" });
  const seeds: Array<[string, string]> = [
    ["hetzner", "Hetzner"],
    ["stackblitz", "StackBlitz"],
    ["forest", "Forest 专注森林"],
    ["fastify", "Fastify"],
    ["dify", "Dify"],
    // 首字母 htqwz：tqw 落在中段，前缀匹配取不到，只有包含放宽能召回
    ["qiuwang", "回头球网站"],
    ["translator", "翻译助手"],
    // 纯中文标题：拼音通道存在的正牌理由（用户用首字母打它）
    ["script", "启动脚本"],
  ];
  for (const [key, title] of seeds) {
    const site = await repo.createSite({
      url: `https://pinyin-gate.example.com/${key}`,
      title,
      categoryId: cat.id,
    });
    titleById.set(site.id, title);
  }
});

afterAll(async () => {
  await db.close();
});

const engine = () =>
  new SearchEngine({ db, repo, fts: null, vectors: null, embed: null }, { earlyExitExactHits: 0 });

/** 命中标题，用于逐条断言而不是只看数量 */
async function titles(q: string): Promise<string[]> {
  const result = await engine().search({ q, limit: 10, disablePersonal: true, disableSemantic: true });
  return Promise.all(
    result.hits.map(async (h) => {
      const known = titleById.get(h.siteId);
      if (known) return known;
      const site = await repo.getSite(h.siteId);
      return site?.title ?? h.siteId;
    }),
  );
}

describe("拼音通道：中文查询不参与、拉丁查询的包含放宽带长度门槛", () => {
  it("前提：拉丁标题的 pinyin_initials 就是小写标题本身（放宽口径依赖这一事实）", async () => {
    const rows = await repo.raw<{ title: string; pi: string }>(
      "SELECT title, pinyin_initials AS pi FROM sites WHERE deleted_at IS NULL",
    );
    const byTitle = new Map(rows.map((r) => [r.title, String(r.pi ?? "")]));
    expect(byTitle.get("Hetzner")).toBe("hetzner");
    expect(byTitle.get("StackBlitz")).toBe("stackblitz");
    // 中英混排：拉丁词整段保留 + 汉字取首字母，跨词界因此可能发生
    expect(byTitle.get("Forest 专注森林")).toBe("forestzzsl");
  });

  it("中文查询不碰拼音列：q=梯子 不许端出 Hetzner / StackBlitz / Forest", async () => {
    const hits = await titles("梯子");
    expect(hits).not.toContain("Hetzner");
    expect(hits).not.toContain("StackBlitz");
    expect(hits).not.toContain("Forest 专注森林");
    // 库里确实没有「梯子」相关条目 → 该空就空，别用噪声占满第 1 页
    expect(hits).toEqual([]);
  });

  it("合法中文查询靠原文 contains 召回：q=翻译 命中「翻译助手」，且不带出 Fastify / Dify", async () => {
    const hits = await titles("翻译");
    expect(hits).toContain("翻译助手");
    expect(hits).not.toContain("Fastify");
    expect(hits).not.toContain("Dify");
  });

  it("中文查询即使拼音串落在中段也不召回：q=天气网 不许端出「回头球网站」", async () => {
    // 回头球网站的 pinyin_initials=htqwz，「天气网」(tqw) 是跨词界连写出来的子串，
    // 站点本身与天气无关。曾经这条靠 3 字母包含放宽被召回——那正是噪声。
    const hits = await titles("天气网");
    expect(hits).not.toContain("回头球网站");
  });

  it("拉丁输入才走拼音：q=tqw（3 字母）仍按包含放宽召回「回头球网站」", async () => {
    // 用户真的在用首字母打字时，命中落在中段是合法的（前缀匹配取不到它）
    const hits = await titles("tqw");
    expect(hits).toContain("回头球网站");
  });

  it("拉丁输入的正牌用途还在：q=qdjb 召回中文标题「启动脚本」", async () => {
    // 这条才是拼音通道存在的理由——用户首字母打字，标题里一个拉丁字母都没有
    const hits = await titles("qdjb");
    expect(hits).toContain("启动脚本");
  });
});
