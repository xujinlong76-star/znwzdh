/**
 * 知乎热榜刷新层：官方接口取数 + 缺密钥 fail-closed（真实临时库 + 注入假取数，
 * 全程不碰真实外网）：
 *  1. 缺密钥时不发请求、不写坏数据，该源记 failed；
 *  2. 正常路径：桩取数返回真实录制 fixture，30 条入库且热度全 null、链接干净；
 *  3. /api/hotlist 下发知乎 30 条，uncovered 只剩快手。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { makeGuardedHotlistFetch, refreshHotlistSource, type HotlistFetch } from "../src/hotlist/refresh.ts";
import { HOTLIST_TRUSTED_HOSTS, hotlistSourceById } from "../src/hotlist/sources.ts";

const here = dirname(fileURLToPath(import.meta.url));
function fixtureBody(name: string): string {
  return readFileSync(join(here, "fixtures", "hotlist", name), "utf8");
}

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-zhihu-refresh-"));
  ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** 密钥用假值，现设现撤，绝不用真实 Secret（async 感知：await 完再恢复） */
async function withFakeSecret<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.NAVHUB_ZHIHU_ACCESS_SECRET;
  process.env.NAVHUB_ZHIHU_ACCESS_SECRET = "test-secret-for-unit-test";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.NAVHUB_ZHIHU_ACCESS_SECRET;
    else process.env.NAVHUB_ZHIHU_ACCESS_SECRET = prev;
  }
}

async function withoutSecret<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.NAVHUB_ZHIHU_ACCESS_SECRET;
  delete process.env.NAVHUB_ZHIHU_ACCESS_SECRET;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.NAVHUB_ZHIHU_ACCESS_SECRET;
    else process.env.NAVHUB_ZHIHU_ACCESS_SECRET = prev;
  }
}

describe("知乎刷新层（官方接口 + fail-closed）", () => {
  it("缺密钥：不发请求、不写坏数据，该源记 failed", async () => {
    const def = hotlistSourceById("zhihu")!;
    let calls = 0;
    const fetchImpl: HotlistFetch = async () => {
      calls += 1;
      return { status: 200, body: fixtureBody("zhihu.json") };
    };
    const entry = await withoutSecret(() => refreshHotlistSource(ctx, def, fetchImpl, Date.now()));
    expect(entry.ok).toBe(false);
    expect(entry.error).toContain("Access Secret");
    expect(calls).toBe(0);
    expect(await ctx.repo.listHotlistEntries("zhihu")).toHaveLength(0);
    const states = await ctx.repo.listHotlistSources();
    expect(states.find((s) => s.source === "zhihu")?.status).toBe("failed");
  });

  it("正常路径：桩取数返回 fixture，30 条入库、热度全 null、链接干净", async () => {
    const def = hotlistSourceById("zhihu")!;
    let calledUrl = "";
    let calledHeaders: Record<string, string> = {};
    const fetchImpl: HotlistFetch = async (url, headers) => {
      calledUrl = url;
      calledHeaders = headers;
      return { status: 200, body: fixtureBody("zhihu.json") };
    };
    const entry = await withFakeSecret(() => refreshHotlistSource(ctx, def, fetchImpl, Date.now()));
    expect(entry).toEqual({ source: "zhihu", ok: true, items: 30 });
    expect(calledUrl).toBe("https://developer.zhihu.com/api/v1/content/hot_list?Limit=30");
    expect(calledHeaders.Authorization).toBe("Bearer test-secret-for-unit-test");
    expect(calledHeaders["X-Request-Timestamp"]).toMatch(/^\d{10}$/);
    const stored = await ctx.repo.listHotlistEntries("zhihu");
    expect(stored).toHaveLength(30);
    for (const item of stored) {
      expect(item.hotValue).toBeNull();
      expect(item.hotLabel).toBeNull();
      expect(item.url).toMatch(/^https:\/\/www\.zhihu\.com\/question\/\d+$/);
      expect(item.url).not.toContain("utm_");
    }
    expect(stored.map((i) => i.rank)).toEqual(stored.map((_, idx) => idx + 1));
    // P0-1 步骤 A：摘要入库——与 fixture 的 Summary 逐条一致，空 Summary 落 null
    const fixture = JSON.parse(fixtureBody("zhihu.json")) as {
      Data: { Items: Array<{ Title: string; Summary: string }> };
    };
    const summaryByTitle = new Map(fixture.Data.Items.map((s) => [s.Title, s.Summary]));
    for (const item of stored) {
      const src = summaryByTitle.get(item.title);
      expect(src).toBeDefined();
      expect(item.summary).toBe(src === "" ? null : src);
    }
    // fixture 里恰 2 条 Summary 为空串（见 hotlist-sources.test.ts 同款断言）
    expect(stored.filter((i) => i.summary === null)).toHaveLength(2);
    expect(stored.filter((i) => i.summary !== null)).toHaveLength(28);
  });

  it("/api/hotlist 下发知乎 30 条且无数值热度，uncovered 只剩快手", async () => {
    // 本用例自己先刷一次，不依赖上一条的库状态
    const def = hotlistSourceById("zhihu")!;
    const fetchImpl: HotlistFetch = async () => ({ status: 200, body: fixtureBody("zhihu.json") });
    await withFakeSecret(() => refreshHotlistSource(ctx, def, fetchImpl, Date.now()));
    const res = await app.inject({ method: "GET", url: "/api/hotlist" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const zhihu = (
      body.sources as Array<{ id: string; status: string; items: Array<{ hotValue: unknown; url: string }> }>
    ).find((s) => s.id === "zhihu");
    expect(zhihu?.status).toBe("ok");
    expect(zhihu?.items).toHaveLength(30);
    for (const item of zhihu!.items) {
      expect(item.hotValue).toBeNull();
      expect(item.url).not.toContain("utm_");
    }
    expect((body.uncovered as Array<{ id: string }>).map((u) => u.id)).toEqual(["kuaishou"]);
  });
});

describe("makeGuardedHotlistFetch 白名单（U-284）", () => {
  it("HOTLIST_TRUSTED_HOSTS 恰为六个 covered 源的精确主机名", () => {
    expect([...HOTLIST_TRUSTED_HOSTS].sort()).toEqual(
      [
        "weibo.com",
        "top.baidu.com",
        "www.toutiao.com",
        "www.douyin.com",
        "api.bilibili.com",
        "developer.zhihu.com",
      ].sort(),
    );
  });

  it("白名单主机解析到被禁段时仍能取数入库（桩掉全局 fetch，不碰外网）", async () => {
    // 本机网关把 weibo.com 解析到 198.18.246.9，无白名单时 guardedFetch
    // 会在 resolveAndCheck 抛 SsrfBlockedError；白名单命中则跳过 DNS 校验。
    const def = hotlistSourceById("weibo")!;
    const fetchImpl = makeGuardedHotlistFetch(ctx);
    let calledUrl = "";
    vi.stubGlobal(
      "fetch",
      async (input: unknown) => {
        calledUrl = String(input);
        return new Response(fixtureBody("weibo.json"), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    try {
      const entry = await refreshHotlistSource(ctx, def, fetchImpl, Date.now());
      expect(entry.ok).toBe(true);
      expect(entry.items).toBeGreaterThanOrEqual(5);
      expect(calledUrl).toBe("https://weibo.com/ajax/side/hotSearch");
      const stored = await ctx.repo.listHotlistEntries("weibo");
      expect(stored).toHaveLength(entry.items!);
      expect(stored[0]?.title).toBe("商场看中羽绒服网上便宜一千");
      expect(stored[0]?.hotValue).toBe(1123390);
      const states = await ctx.repo.listHotlistSources();
      expect(states.find((s) => s.source === "weibo")?.status).toBe("ok");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
