/**
 * `scripts/lib/search-recall.mjs` + `scripts/check-search-recall.mjs#loadCorpus` 的回归。
 *
 * 为什么单独钉判据层：真库上的结果会随站点增删漂移，判据本身写错的话，
 * 回归集会**静默地一直通过**——那比没有回归集更糟，它给出「已经有人管这条查询」的假象。
 * 2026-10-31 一天里找出的三个检索缺陷全靠临时探针，这层测试就是把探针变成账。
 *
 * 用假 engine / 假 loadSites：判据不该依赖 `packages/store`，
 * 否则拼音通道在途的那几行一改，这里就先红，而红的其实是被测对象的邻居。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error —— .mjs 无类型声明
import { hostOf, matchAny, matchNone, matchSite, runCase } from "./search-recall.mjs";
// @ts-expect-error —— .mjs 无类型声明
import { loadCorpus } from "../check-search-recall.mjs";

const SITES = [
  { id: "1", url: "https://www.docker.com/", title: "Docker 官方" },
  { id: "2", url: "https://docs.docker.com/engine/", title: "Docker 文档" },
  { id: "3", url: "https://notdocker.com", title: "冒牌货" },
  { id: "4", url: "https://example.com/stack", title: "StackBlitz 在线 IDE" },
  { id: "5", url: "https://example.com/note", title: "有道云笔记" },
];

const asMap = (ids) => new Map(SITES.filter((s) => ids.includes(s.id)).map((s) => [s.id, s]));
const loadSites = async (ids) => asMap(ids);

/** 固定结果的假引擎，同时把收到的查询记下来供断言。 */
function fakeEngine(ids, extra = {}) {
  const seen = [];
  return {
    seen,
    search: async (query) => {
      seen.push(query);
      return { hits: ids.map((siteId) => ({ siteId })), channelsUsed: ["exact"], ...extra };
    },
  };
}

const dirs = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "navhub-recall-test-"));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** 写一份语料文件给 loadCorpus 读。 */
function corpusFile(cases) {
  const dir = scratch();
  const file = join(dir, "corpus.json");
  writeFileSync(file, JSON.stringify({ cases }), "utf8");
  return file;
}

describe("host 匹配按后缀", () => {
  it("hostOf：补 scheme、取 hostname、小写", () => {
    expect(hostOf("https://Docs.Docker.com/engine?x=1")).toBe("docs.docker.com");
    expect(hostOf("docker.com")).toBe("docker.com");
    expect(hostOf("")).toBe("");
    expect(hostOf(null)).toBe("");
  });

  it("docker.com 收到 www./docs.，但不收到 notdocker.com 和 docker.com.evil.io", () => {
    const m = { host: "docker.com" };
    expect(matchSite(SITES[0], m)).toBe(true);
    expect(matchSite(SITES[1], m)).toBe(true);
    expect(matchSite(SITES[2], m)).toBe(false);
    expect(matchSite({ id: "x", url: "https://docker.com.evil.io", title: "" }, m)).toBe(false);
  });

  it("host 写歪（大小写、带空格）也按同一口径比", () => {
    expect(matchSite(SITES[0], { host: " WWW.Docker.com " })).toBe(true);
  });

  it("title 按小写子串；host/title 都缺的匹配项永不命中", () => {
    expect(matchSite(SITES[4], { title: "云笔记" })).toBe(true);
    expect(matchSite(SITES[4], { title: "CLOUD" })).toBe(false);
    expect(matchSite(SITES[0], {})).toBe(false);
    expect(matchSite(null, { host: "docker.com" })).toBe(false);
  });

  it("matchAny 找第一个命中项、matchNone 全不命中才真", () => {
    const top = [SITES[2]];
    expect(matchAny(top, [{ host: "docker.com" }, { host: "notdocker.com" }])).toEqual({ host: "notdocker.com" });
    expect(matchAny(top, [{ host: "docker.com" }])).toBeNull();
    expect(matchNone(top, [{ host: "docker.com" }])).toBe(true);
    expect(matchNone(top, [])).toBe(true);
    // 判据缺省（没写 forbid）不能炸：调用方传 undefined 是常态
    expect(matchAny(top, undefined)).toBeNull();
    expect(matchNone([], [{ host: "notdocker.com" }])).toBe(true);
  });
});

describe("runCase 的判据", () => {
  it("expect 命中即绿，并把命中写进 expected", async () => {
    const r = await runCase(fakeEngine(["1"]), loadSites, {
      query: "docker",
      expect: [{ host: "docker.com" }],
      note: "n",
    });
    expect(r.ok).toBe(true);
    expect(r.expectOk).toBe(true);
    expect(r.expected).toContain("docker.com");
    expect(r.top[0]).toBe("Docker 官方（www.docker.com）");
  });

  it("只算前 k 条：站点被挤出第 1 页就算没召回", async () => {
    const r = await runCase(fakeEngine(["1", "2", "4"]), loadSites, {
      query: "笔记",
      k: 2,
      expect: [{ title: "有道云笔记" }],
      note: "n",
    });
    expect(r.ok).toBe(false);
    expect(r.hits).toBe(2);
    expect(r.expected).toBe("缺 标题含「有道云笔记」");
  });

  it("expect 多项是「或」：任一命中就绿", async () => {
    const r = await runCase(fakeEngine(["5"]), loadSites, {
      query: "笔记",
      expect: [{ host: "docker.com" }, { title: "云笔记" }],
      note: "n",
    });
    expect(r.ok).toBe(true);
  });

  it("forbid 越界要点名是哪一项，多条越界都列出来", async () => {
    const r = await runCase(fakeEngine(["4", "1"]), loadSites, {
      query: "梯子",
      forbid: [{ host: "stackblitz.com" }, { title: "StackBlitz" }, { host: "docker.com" }],
      note: "n",
    });
    expect(r.ok).toBe(false);
    expect(r.forbidOk).toBe(false);
    // 站点 4 的 url 是 example.com，所以 host 那条没越界、命中的是 title 那条：
    // 点名要点的是「哪条判据被踩」，不是「哪个站点冒出来」
    expect(r.violated).toEqual(["标题含「StackBlitz」", "docker.com"]);
  });

  it("零结果让 forbid 通过：该空就空，不用为「没噪声」编造命中", async () => {
    const r = await runCase(fakeEngine([]), loadSites, {
      query: "梯子",
      forbid: [{ host: "hetzner.com" }],
      note: "n",
    });
    expect(r.ok).toBe(true);
    expect(r.hits).toBe(0);
    expect(r.top).toEqual([]);
  });

  it("只有 expect 的用例，forbid 缺省不判红；只有 forbid 的用例，expect 缺省不判红", async () => {
    const a = await runCase(fakeEngine(["1"]), loadSites, { query: "docker", expect: [{ host: "docker.com" }], note: "n" });
    const b = await runCase(fakeEngine(["1"]), loadSites, { query: "docker", forbid: [{ host: "evil.io" }], note: "n" });
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(a.expected).toContain("docker.com");
    expect(b.expected).toBe("");
  });

  it("didYouMean 比的是 trim + 小写后的全文，且允许多个可接受写法", async () => {
    const r = await runCase(fakeEngine([], { didYouMean: " Docker " }), loadSites, {
      query: "dockr",
      didYouMean: ["docker"],
      note: "n",
    });
    expect(r.suggestionOk).toBe(true);
    expect(r.ok).toBe(true);
    const miss = await runCase(fakeEngine([]), loadSites, { query: "dockr", didYouMean: ["docker"], note: "n" });
    expect(miss.suggestionOk).toBe(false);
    expect(miss.ok).toBe(false);
    expect(miss.didYouMean).toBeNull();
  });

  it("三条判据全绿才算 ok；任一条红都要在行里留下可读的原因", async () => {
    const r = await runCase(fakeEngine(["1"], { didYouMean: "Kubernetes" }), loadSites, {
      query: "docker",
      expect: [{ title: "不存在的东西" }],
      forbid: [{ host: "docker.com" }],
      didYouMean: ["Docker"],
      note: "n",
    });
    expect(r.ok).toBe(false);
    expect([r.expectOk, r.forbidOk, r.suggestionOk]).toEqual([false, false, false]);
  });
});

describe("runCase 打给引擎的查询", () => {
  it("默认关语义与个性化、limit=k、offset=0", async () => {
    const engine = fakeEngine(["1"]);
    await runCase(engine, loadSites, { query: "docker", expect: [{ host: "docker.com" }], note: "n" }, { k: 7 });
    expect(engine.seen[0]).toEqual({ q: "docker", limit: 7, offset: 0, disableSemantic: true, disablePersonal: true });
  });

  it("用例级 k 压过 defaults.k，没声明才用 defaults", async () => {
    const a = await runCase(fakeEngine(["1"]), loadSites, { query: "x", k: 3, forbid: [], note: "n" }, { k: 9 });
    expect(a.k).toBe(3);
    const b = await runCase(fakeEngine(["1"]), loadSites, { query: "x", forbid: [], note: "n" }, { k: 9 });
    expect(b.k).toBe(9);
    const c = await runCase(fakeEngine(["1"]), loadSites, { query: "x", forbid: [], note: "n" });
    expect(c.k).toBe(5);
  });

  it("中枢筛选条件透传：tag / categoryId / facets / mode / status → statuses 数组", async () => {
    const engine = fakeEngine(["1"]);
    await runCase(engine, loadSites, {
      query: "docker",
      tag: "devops",
      categoryId: "cat-1",
      facets: { status: "ok" },
      mode: "fuzzy",
      status: "verified",
      disableSemantic: false,
      expect: [{ host: "docker.com" }],
      note: "n",
    });
    const q = engine.seen[0];
    expect(q).toMatchObject({ tag: "devops", categoryId: "cat-1", facets: { status: "ok" }, mode: "fuzzy", statuses: ["verified"] });
    // 回归集要确定性，但个别用例就是来评语义通道的 —— 用例级开关能压过默认
    expect(q.disableSemantic).toBe(false);
  });

  it("label：显式写法优先，其次 #tag 查询，最后裸查询", async () => {
    const base = { query: "docker", forbid: [], note: "n" };
    expect((await runCase(fakeEngine([]), loadSites, { ...base, label: "自定义标签" })).label).toBe("自定义标签");
    expect((await runCase(fakeEngine([]), loadSites, { ...base, tag: "devops" })).label).toBe("#devops docker");
    expect((await runCase(fakeEngine([]), loadSites, base)).label).toBe("docker");
  });
});

describe("pending 的记账", () => {
  it("带 pending 的用例把「等哪条改动」原样带出（trim 后）", async () => {
    const r = await runCase(fakeEngine([]), loadSites, {
      query: "梯子",
      forbid: [{ host: "hetzner.com" }],
      pending: "  中文查询不进拼音通道（packages/store/src/search.ts 在途）  ",
      note: "n",
    });
    expect(r.pending).toBe("中文查询不进拼音通道（packages/store/src/search.ts 在途）");
  });

  it("红了的 pending 用例 ok=false —— 拦不拦是调用方的决定，判据层不改结论", async () => {
    const r = await runCase(fakeEngine(["4"]), loadSites, {
      query: "梯子",
      forbid: [{ title: "StackBlitz" }],
      pending: "中文查询不进拼音通道",
      note: "n",
    });
    expect(r.ok).toBe(false);
    expect(r.pending).toBeTruthy();
  });

  it("没声明 / 空串 / 非字符串都不算 pending", async () => {
    const base = { query: "docker", forbid: [], note: "n" };
    expect((await runCase(fakeEngine([]), loadSites, base)).pending).toBeNull();
    expect((await runCase(fakeEngine([]), loadSites, { ...base, pending: "   " })).pending).toBeNull();
    expect((await runCase(fakeEngine([]), loadSites, { ...base, pending: 42 })).pending).toBeNull();
  });
});

describe("loadCorpus 把写歪的语料挡在门外", () => {
  it("合法语料：接受裸数组与 {cases}，并原样返回用例", () => {
    const one = [{ query: "docker", expect: [{ host: "docker.com" }], note: "真库实测" }];
    const dir = scratch();
    const bare = join(dir, "bare.json");
    writeFileSync(bare, JSON.stringify(one), "utf8");
    expect(loadCorpus(bare)).toEqual(one);
    expect(loadCorpus(corpusFile(one))).toEqual(one);
  });

  it("判据缺失、query 为空、匹配项没 host 也没 title、缺 note、重复用例 → 全部报错", () => {
    const bad = (c) => () => loadCorpus(corpusFile([c]));
    expect(bad({ query: "docker", expect: [], note: "n" })).toThrow(/至少声明 expect \/ forbid \/ didYouMean 之一/);
    expect(bad({ query: "   ", expect: [{ host: "docker.com" }], note: "n" })).toThrow(/query 不能为空/);
    expect(bad("docker")).toThrow(/不是对象/);
    expect(bad({ query: "docker", expect: [{}], note: "n" })).toThrow(/必须给 host 或 title/);
    expect(bad({ query: "docker", forbid: [{ title: "  " }], note: "n" })).toThrow(/必须给 host 或 title/);
    expect(bad({ query: "docker", expect: [{ host: "docker.com" }] })).toThrow(/缺 note/);
    // 判据永远不可能失败的用例，比没有用例更糟
    expect(bad({ query: "docker", expect: [{ host: "docker.com" }], note: "  " })).toThrow(/缺 note/);
  });

  it("重复按 query+tag+mode 判：同 query 不同 tag/mode 是两条不同用例", () => {
    const dup = corpusFile([
      { query: "docker", tag: "a", expect: [{ host: "docker.com" }], note: "n" },
      { query: " Docker ", tag: "a", expect: [{ host: "docker.com" }], note: "n" },
    ]);
    expect(() => loadCorpus(dup)).toThrow(/与前面的用例重复/);
    const ok = corpusFile([
      { query: "docker", tag: "a", expect: [{ host: "docker.com" }], note: "n" },
      { query: "docker", tag: "b", expect: [{ host: "docker.com" }], note: "n" },
      { query: "docker", mode: "fuzzy", expect: [{ host: "docker.com" }], note: "n" },
    ]);
    expect(loadCorpus(ok)).toHaveLength(3);
  });

  it("cases 缺失或为空 → 报错（空账本别想冒充「全过」）", () => {
    const dir = scratch();
    const empty = join(dir, "empty.json");
    writeFileSync(empty, JSON.stringify({ cases: [] }), "utf8");
    expect(() => loadCorpus(empty)).toThrow(/非空 cases/);
    const none = join(dir, "none.json");
    writeFileSync(none, JSON.stringify({ note: "忘了 cases" }), "utf8");
    expect(() => loadCorpus(none)).toThrow(/非空 cases/);
  });

  it("仓库里那份真语料自己得过得了校验", () => {
    // 从 import.meta.url 走：测试可能被从别的 cwd 起，相对 process.cwd() 会指错
    const real = fileURLToPath(new URL("../fixtures/search-recall-corpus.json", import.meta.url));
    const raw = JSON.parse(readFileSync(real, "utf8"));
    expect(Array.isArray(raw.cases) ? raw.cases : raw).toHaveLength(loadCorpus(real).length);
    expect(loadCorpus(real).length).toBeGreaterThan(0);
  });
});
