/**
 * 搜索建议回灌的 HTTP 面守卫（run129 · search gap[0] 服务端半件）。
 *
 * 本机库 13:21:55 只读实测：`react vs vue` 26 行 / **1 个身份**、`{"name":"navhub"}`
 * 21 行 / 1 个身份，而 `代码` 24 行来自 16 个身份 —— 旧口径按行数排，示例 chip 的重复
 * 写入被当成「26 个人在搜」再回灌建议位，形成自我强化。store 层已锁住门槛与形状
 * （packages/store/test/suggestable-top-queries.test.ts），这里只补 HTTP 面的四件事：
 *   1. 用户可见：单人刷量的词不出现在别人的 suggestions/popular，多人搜过的词会出现在榜首；
 *   2. 契约一致：popular 与 suggestions 一样排除本次查询词（run56 记录的不对称）；
 *   3. 口径解耦：搜索路径不再调用 topQueries（管理后台 stats.ts:68/:231 仍是原口径）；
 *   4. 写后读隔离：读榜单时带上请求开头的时刻，本次写入不进本次榜单。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const base = {
  mode: "lite" as const,
  embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", dim: 512, enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

/** 两个人各搜一次的词：应进榜 */
const ORGANIC = "多人搜过热词";
/** 一个人（同一个 anonId）连发 6 次的词：面板/脚本刷量形状，必须进不了榜 */
const SPAM = "单人刷量词";
/** 没有任何站点命中的探针词：只有它为零结果才会带 suggestions/popular（FTS 是二元组 OR，必须整体不存在） */
const PROBE = "zzprobe" + Date.now().toString(36) + "x";
/** 有命中的词：避免它落进 zero_result 集合，从而能与 zeroSet 过滤区分开 */
const HITWORD = "有命中词";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

async function search(q: string, anonId?: string) {
  const url = `/api/search?q=${encodeURIComponent(q)}${anonId ? `&anonId=${encodeURIComponent(anonId)}` : ""}`;
  return app.inject({ method: "GET", url });
}

type SuggestBody = { hits: unknown[]; suggestions: string[]; popular: string[]; suggestionsDegraded?: boolean };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-search-board-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "board.db") }));
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "热榜解耦测试类目" });
  await ctx.repo.createSite({ url: "https://organic-run129.example.com", title: `${ORGANIC} 官方站点`, categoryId: cat.id });
  await ctx.repo.createSite({ url: "https://spam-run129.example.com", title: `${SPAM} 官方站点`, categoryId: cat.id });
  await ctx.repo.createSite({ url: "https://hitword-run129.example.com", title: `${HITWORD} 文档站`, categoryId: cat.id });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("建议榜与运维热榜解耦（HTTP 面）", () => {
  it("单人重复刷量的词不进 suggestions/popular，两人各搜一次的词居首", async () => {
    for (let i = 0; i < 6; i++) await search(SPAM, "only-one");
    await search(ORGANIC, "person-a");
    await search(ORGANIC, "person-b");

    const res = await search(PROBE, "person-c");
    expect(res.statusCode).toBe(200);
    const body = res.json() as SuggestBody;
    expect(body.hits).toEqual([]);
    expect(body.suggestions).toContain(ORGANIC);
    expect(body.suggestions).not.toContain(SPAM);
    expect(body.popular).toContain(ORGANIC);
    expect(body.popular).not.toContain(SPAM);
    // 榜首必须是「多人搜过」而不是「某人搜得多」：SPAM 行数（6）远大于 ORGANIC（2）
    expect(body.popular[0]).toBe(ORGANIC);
  });

  it("popular 与 suggestions 一样排除本次查询词（run56 记录的口径不对称）", async () => {
    const spy = vi.spyOn(ctx.repo, "suggestableTopQueries").mockResolvedValue([
      { query: PROBE, count: 9, identities: 5 },
      { query: HITWORD, count: 4, identities: 2 },
    ]);
    const zeroSpy = vi.spyOn(ctx.repo, "zeroResultQueries").mockResolvedValue([]);
    try {
      const res = await search(PROBE, "person-d");
      expect(res.statusCode).toBe(200);
      const body = res.json() as SuggestBody;
      expect(body.suggestions).toEqual([HITWORD]);
      expect(body.popular).toEqual([HITWORD]);
      expect(body.suggestions).not.toContain(PROBE);
      expect(body.popular).not.toContain(PROBE);
    } finally {
      spy.mockRestore();
      zeroSpy.mockRestore();
    }
  });

  it("搜索路径不再调用 topQueries：运维口径变了也不影响建议位", async () => {
    const spy = vi.spyOn(ctx.repo, "topQueries").mockImplementation(() => {
      throw new Error("搜索路径不应再读运维热榜 topQueries");
    });
    try {
      const res = await search(PROBE, "person-e");
      expect(res.statusCode).toBe(200);
      const body = res.json() as SuggestBody;
      expect(body.suggestionsDegraded).toBeUndefined();
      expect(body.suggestions).toContain(ORGANIC);
    } finally {
      spy.mockRestore();
    }
  });

  it("读榜单带上请求开头的时刻：本次写入不进本次榜单", async () => {
    const spy = vi.spyOn(ctx.repo, "suggestableTopQueries");
    try {
      const started = Date.now();
      const res = await search(PROBE, "person-f");
      expect(res.statusCode).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
      const opts = spy.mock.calls[0]![2];
      expect(typeof opts?.before).toBe("number");
      // 上界取自请求开头：本次写入（created_at ≥ 上界）一律不进本次榜单
      expect(opts!.before).toBeGreaterThanOrEqual(started);
      expect(opts!.before).toBeLessThanOrEqual(Date.now());
    } finally {
      spy.mockRestore();
    }
  });

  it("有命中时不读建议榜（HEAD 探活与预取不再灌榜）", async () => {
    const spy = vi.spyOn(ctx.repo, "suggestableTopQueries");
    try {
      const res = await search(HITWORD, "person-g");
      expect(res.statusCode).toBe(200);
      expect((res.json() as SuggestBody).hits.length).toBeGreaterThan(0);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
