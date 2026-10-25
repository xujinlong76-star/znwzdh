/**
 * 检索写入失败必须留痕（run54）。
 *
 * 改前 search.ts 有四处降级写入把异常压成 `() => undefined` / 空 catch：
 * `search` 事件、`zero_result` 事件、个人搜索历史、通道耗时观测。后果是
 * 「写失败」与「这次搜索本来就没数据」在响应（都是 200）与库里（都没有行）
 * 完全同形——运维只能等用户发现历史不见了才知道库写入坏了。
 *
 * 本轮只加**有界基数**的进程内计数（四个固定组件），主链路仍降级继续；
 * 断言全部走 `/api/metrics`（生产可观测面）：注入 repo 抛错 → 搜索仍 200 →
 * 对应 counter +1，且不误伤其他三个组件。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SearchResult } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

const SECRET = "test-secret-please-rotate";
const USER = "github:u-search-writefail";
const COMPONENTS = ["event_search", "event_zero_result", "history", "channels"] as const;
type Component = (typeof COMPONENTS)[number];
type FailureCounts = Record<Component, number>;

const base = {
  mode: "lite" as const,
  embedding: {
    model: "Xenova/bge-small-zh-v1.5",
    endpoint: "https://hf-mirror.com",
    dtype: "q8",
    dim: 512,
    enabled: false,
  },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const signed = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

async function metricsBody(): Promise<string> {
  const res = await app.inject({ method: "GET", url: "/api/metrics" });
  expect(res.statusCode).toBe(200);
  return res.body;
}

/** 从生产指标面读取四类失败计数；缺任一序列直接判失败（不做 0 兜底） */
async function failureCounts(): Promise<FailureCounts> {
  const body = await metricsBody();
  const out = {} as FailureCounts;
  for (const component of COMPONENTS) {
    const re = new RegExp(`^navhub_search_write_failures_total\\{component="${component}"\\} (\\d+)$`, "m");
    const m = re.exec(body);
    expect(m, `缺少指标序列 ${component}`).not.toBeNull();
    out[component] = Number(m![1]);
  }
  return out;
}

async function search(q: string) {
  return app.inject({ method: "GET", url: `/api/search?q=${encodeURIComponent(q)}`, headers: signed(USER) });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-search-writefail-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "writefail.db"), identitySecret: SECRET }));
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "写入失败观测类目" });
  await ctx.repo.createSite({ url: "https://searchfail-run54.example.com", title: "searchfail 可命中站点", categoryId: cat.id });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("检索写入失败的可见性", () => {
  it("健康请求：四个失败计数都不动，且历史/事件照常写", async () => {
    const before = await failureCounts();
    const res = await search("searchfail baseline");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { hits: unknown[] }).hits.length).toBeGreaterThan(0);
    expect(await failureCounts()).toEqual(before);

    const rows = (await ctx.repo.raw("SELECT COUNT(*) AS c FROM search_history WHERE query = ?", ["searchfail baseline"])) as Array<{ c: number }>;
    expect(rows[0].c).toBe(1);
  });

  it("search 事件写失败：搜索仍 200，只给 event_search 计数，历史不受牵连", async () => {
    const original = ctx.repo.recordEvent.bind(ctx.repo);
    const spy = vi.spyOn(ctx.repo, "recordEvent").mockImplementation(async (kind, payload) => {
      if (kind === "search") throw new Error("simulated events insert failure");
      return original(kind, payload);
    });
    try {
      const before = await failureCounts();
      const res = await search("searchfail 事件失败");
      expect(res.statusCode).toBe(200);
      expect((res.json() as { hits: unknown[] }).hits.length).toBeGreaterThan(0);
      const after = await failureCounts();
      expect(after.event_search - before.event_search).toBe(1);
      expect(after.event_zero_result - before.event_zero_result).toBe(0);
      expect(after.history - before.history).toBe(0);
      // 历史写入不受事件失败牵连：行仍然在
      const rows = (await ctx.repo.raw("SELECT COUNT(*) AS c FROM search_history WHERE query = ?", ["searchfail 事件失败"])) as Array<{ c: number }>;
      expect(rows[0].c).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("zero_result 写失败：只给 event_zero_result 计数", async () => {
    const original = ctx.repo.recordEvent.bind(ctx.repo);
    const spy = vi.spyOn(ctx.repo, "recordEvent").mockImplementation(async (kind, payload) => {
      if (kind === "zero_result") throw new Error("simulated zero_result insert failure");
      return original(kind, payload);
    });
    try {
      const before = await failureCounts();
      const res = await search("zzzz-no-such-run54");
      expect(res.statusCode).toBe(200);
      expect((res.json() as { hits: unknown[] }).hits.length).toBe(0);
      const after = await failureCounts();
      expect(after.event_zero_result - before.event_zero_result).toBe(1);
      expect(after.event_search - before.event_search).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("搜索历史写失败：只给 history 计数，搜索与事件不受影响", async () => {
    const spy = vi.spyOn(ctx.repo, "recordSearch").mockRejectedValue(new Error("simulated history insert failure"));
    try {
      const before = await failureCounts();
      const res = await search("searchfail 历史失败");
      expect(res.statusCode).toBe(200);
      const after = await failureCounts();
      expect(after.history - before.history).toBe(1);
      expect(after.event_search - before.event_search).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("通道耗时报错：响应仍 200，channels 计数 +1", async () => {
    const original = ctx.search.search.bind(ctx.search);
    const spy = vi.spyOn(ctx.search, "search").mockImplementation(async (input): Promise<SearchResult> => {
      const result = await original(input);
      // 只抛一次：recordSearchChannels 在 try 内第一次取字段即触发；
      // 之后响应序列化还会读同一对象，继续抛会变成 500（那是另一种缺陷）
      let thrown = false;
      const hostile = new Proxy(
        { exactMs: 0, ftsMs: 0, pinyinMs: 0, semanticMs: 0, skippedSemantic: false },
        {
          get(target, prop, receiver) {
            if (!thrown) {
              thrown = true;
              throw new Error("simulated channel timing failure");
            }
            return Reflect.get(target, prop, receiver);
          },
        },
      );
      return { ...result, channelTimings: hostile };
    });
    try {
      const before = await failureCounts();
      const res = await search("searchfail 通道失败");
      expect(res.statusCode).toBe(200);
      const after = await failureCounts();
      expect(after.channels - before.channels).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("/api/metrics 暴露四类序列（含 0），并带 HELP/TYPE", async () => {
    const body = await metricsBody();
    expect(body).toContain("# HELP navhub_search_write_failures_total");
    expect(body).toContain("# TYPE navhub_search_write_failures_total counter");
    for (const component of COMPONENTS) {
      expect(body).toContain(`navhub_search_write_failures_total{component="${component}"}`);
    }
  });
});
