/**
 * 热榜管道 + 每日简报的端到端约束（临时库 + 注入假取数，响应体用真实录制 fixture）：
 *  0. 用例彼此独立：前置的 fixture 刷新在 beforeAll 里做完，任何 it
 *     单跑（-t）、乱序跑都不依赖其他 it 先跑；正点版任务注入假取数，
 *     全程不碰真实外网——否则缓存是否被线上榜单换掉全看机器网络通断。
 *  1. 刷新把五源真实榜单写进缓存，/api/hotlist 如实下发（含未覆盖源及原因）；
 *  2. 单源失败只标 stale 并保留上次条目，不清空、不拖垮整轮；
 *  3. 简报组版只用真实素材：热榜精选来自缓存、新收录来自 sites.created_at
 *     （今天有新增才标 today），开场白在无模型时走模板且锚定真实条目；
 *  4. 模型开场白必须过锚定校验：编造的句子被丢弃并回落模板；
 *  5. 在追提醒分身份：无身份 watch=null；有身份按其追剧清单现算 due/check；
 *  6. 简报按天缓存：重复请求不重生成；往期 ?date= 可回看、不存在如实 404。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { refreshHotlist, type HotlistFetch } from "../src/hotlist/refresh.ts";
import { handleDailyBrief } from "../src/jobs/tasks/daily-brief.task.ts";
import {
  anchoredOpening,
  briefDateKey,
  generateDailyBrief,
  type BriefPayload,
} from "../src/brief/brief.ts";

const here = dirname(fileURLToPath(import.meta.url));
function fixtureBody(name: string): string {
  return readFileSync(join(here, "fixtures", "hotlist", name), "utf8");
}

const FIXTURE_BY_HOST: Array<[string, string]> = [
  ["weibo.com", "weibo.json"],
  ["top.baidu.com", "baidu.json"],
  ["toutiao.com", "toutiao.json"],
  ["douyin.com", "douyin.json"],
  ["api.bilibili.com", "bilibili.json"],
];

function fakeFetch(failHost?: string): HotlistFetch {
  return async (url) => {
    const hit = FIXTURE_BY_HOST.find(([host]) => url.includes(host));
    if (!hit) return { status: 404, body: "" };
    if (failHost && url.includes(failHost)) return { status: 500, body: "boom" };
    return { status: 200, body: fixtureBody(hit[1]) };
  };
}

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
const USER = "github:brief-tester";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-brief-"));
  ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
  app = await buildServer(ctx);
  await app.ready();

  const cat = await ctx.repo.createCategory({ title: "效率办公", slug: "brief-office" });
  await ctx.repo.createSite({
    url: "https://brief.example.com/new-tool",
    title: "简报测试新工具站",
    description: "今天刚收录的测试站点",
    tags: ["测试"],
    categoryId: cat.id,
  });

  // 追剧：一部每日更新（今天必到期）、一部节奏未标注（进 check）
  await ctx.repo.applyWatchOps(USER, [
    {
      op: "add",
      key: "plat-a::每日一剧",
      title: "每日一剧",
      platformSiteId: "plat-a",
      platformTitle: "甲平台",
      playUrl: "https://plat-a.example.com/play/1",
      episode: 3,
      cadence: { kind: "daily" },
      remind: true,
      createdAt: Date.now() - 86_400_000 * 3,
      at: Date.now() - 1000,
    },
    {
      op: "add",
      key: "plat-b::没标节奏的剧",
      title: "没标节奏的剧",
      platformSiteId: "plat-b",
      platformTitle: "乙平台",
      playUrl: "https://plat-b.example.com/play/2",
      episode: 0,
      cadence: { kind: "unknown" },
      remind: true,
      createdAt: Date.now() - 86_400_000 * 2,
      at: Date.now() - 1000,
    },
  ]);

  // 前置刷新进 beforeAll（见文件头约束 0）：第一个 it 不再是全文件的
  // 隐式前置——单跑、乱序时后面的 it 仍有完整的 fixture 缓存可用。
  const seeded = await refreshHotlist(ctx, { fetchImpl: fakeFetch() });
  expect(seeded.okCount).toBe(5);
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("热榜刷新与缓存降级", () => {
  it("五源真实榜单入库，/api/hotlist 全量下发并带未覆盖登记", async () => {
    const summary = await refreshHotlist(ctx, { fetchImpl: fakeFetch() });
    expect(summary.okCount).toBe(5);

    const res = await app.inject({ method: "GET", url: "/api/hotlist" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.generatedAt).toBeGreaterThan(0);
    const byId = new Map(body.sources.map((s: { id: string }) => [s.id, s]));
    for (const id of ["weibo", "baidu", "toutiao", "douyin", "bilibili"]) {
      const source = byId.get(id) as { status: string; items: unknown[]; fetchedAt: number };
      expect(source.status, `${id} 应为 ok`).toBe("ok");
      expect(source.items.length, `${id} 应有条目`).toBeGreaterThanOrEqual(5);
      expect(source.fetchedAt).toBeGreaterThan(0);
    }
    const uncovered = body.uncovered as Array<{ id: string; reason: string }>;
    expect(uncovered.map((u) => u.id)).toEqual(["zhihu", "kuaishou"]);
    expect(uncovered[0]?.reason).toContain("401");
  });

  it("单源失败标 stale 且保留上次条目，其余源不受影响", async () => {
    const before = await ctx.repo.listHotlistEntries("weibo");
    expect(before.length).toBeGreaterThanOrEqual(5);

    const summary = await refreshHotlist(ctx, { fetchImpl: fakeFetch("weibo.com") });
    expect(summary.entries.find((e) => e.source === "weibo")?.ok).toBe(false);
    expect(summary.okCount).toBe(4);

    const after = await ctx.repo.listHotlistEntries("weibo");
    expect(after.map((i) => i.title)).toEqual(before.map((i) => i.title));

    const res = await app.inject({ method: "GET", url: "/api/hotlist" });
    const weibo = (res.json().sources as Array<{ id: string; status: string }>).find((s) => s.id === "weibo");
    expect(weibo?.status).toBe("stale");
  });
});

describe("每日简报组版", () => {
  it("GET /api/brief/today：精选来自缓存、新收录标 today、模板开场白锚定真实条目、无身份 watch=null", async () => {
    const res = await app.inject({ method: "GET", url: "/api/brief/today" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.date).toBe(briefDateKey(Date.now()));
    expect(body.isToday).toBe(true);
    expect(body.hotPicks.length).toBeGreaterThanOrEqual(20);
    expect(body.hotPicks.some((p: { title: string }) => p.title === "商场看中羽绒服网上便宜一千")).toBe(true);
    expect(body.newSitesScope).toBe("today");
    expect(body.newSites.some((s: { title: string }) => s.title === "简报测试新工具站")).toBe(true);
    // 测试环境无模型配置：必须走模板，且模板句要锚定真实的第一条热榜
    expect(body.openingMode).toBe("template");
    expect(body.opening).toContain(body.hotPicks[0].title.slice(0, 6));
    expect(body.watch).toBeNull();
  });

  it("简报落库后重复请求不重生成（generatedAt 不变）", async () => {
    const first = (await app.inject({ method: "GET", url: "/api/brief/today" })).json();
    const second = (await app.inject({ method: "GET", url: "/api/brief/today" })).json();
    expect(second.generatedAt).toBe(first.generatedAt);
    const stored = await ctx.repo.getDailyBrief(first.date);
    expect(stored?.opening).toBe(first.opening);
  });

  it("带身份请求按其追剧清单现算 due/check", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/brief/today",
      headers: { "x-navhub-user-id": USER },
    });
    const body = res.json();
    expect(body.watch).not.toBeNull();
    expect(body.watch.due.map((i: { title: string }) => i.title)).toEqual(["每日一剧"]);
    expect(body.watch.check.map((i: { title: string }) => i.title)).toEqual(["没标节奏的剧"]);
  });

  it("往期回看：不存在的日期如实 404；生成过的日期可取回", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/brief/today?date=2020-01-01" });
    expect(missing.statusCode).toBe(404);

    const past = new Date(Date.now() - 86_400_000);
    await generateDailyBrief(ctx, { now: past, openingCaller: async () => null });
    const pastKey = briefDateKey(past.getTime());
    const res = await app.inject({ method: "GET", url: `/api/brief/today?date=${pastKey}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().date).toBe(pastKey);
    expect(res.json().isToday).toBe(false);
  });
});

describe("正点版任务语义", () => {
  it("daily_brief 任务强制重组：凌晨抢先生成的早期版会被覆盖，不冻结一整天", async () => {
    const today = briefDateKey(Date.now());
    // 模拟凌晨被请求抢先生成的早期版（哨兵开场白）
    await ctx.repo.upsertDailyBrief({
      date: today,
      generatedAt: 1,
      opening: "哨兵早期版开场白",
      openingMode: "template",
      payload: JSON.stringify({ date: today, hotPicks: [], newSitesScope: "recent", newSites: [] }),
    });
    // 注入 fakeFetch：handleDailyBrief 会先全源刷新热榜；不注入会走真网，
    // 把 fixture 种子换成实时榜单，导致后续开场白锚定校验找不到锚点条目。
    await handleDailyBrief(ctx, { fetchImpl: fakeFetch() });
    const stored = await ctx.repo.getDailyBrief(today);
    expect(stored?.opening).not.toBe("哨兵早期版开场白");
    expect(stored?.generatedAt).toBeGreaterThan(1);
    expect(JSON.parse(stored!.payload).hotPicks.length).toBeGreaterThanOrEqual(20);
  });
});

describe("开场白锚定校验", () => {
  const payload: BriefPayload = {
    date: "2026-11-11",
    hotPicks: [
      {
        source: "weibo",
        sourceName: "微博热搜",
        rank: 1,
        title: "商场看中羽绒服网上便宜一千",
        url: "https://s.weibo.com/weibo?q=x",
        hotValue: 1123390,
        fetchedAt: 1,
      },
    ],
    newSitesScope: "recent",
    newSites: [],
  };

  it("提及真实条目的句子通过", () => {
    expect(anchoredOpening("早上好喵，今天大家都在聊商场看中羽绒服网上便宜一千这件事，简报整理好啦", payload)).not.toBeNull();
  });

  it("编造条目的句子被丢弃", () => {
    expect(anchoredOpening("早上好喵，今天最火的是某明星宣布结婚的消息，快去看看吧", payload)).toBeNull();
  });

  it("带链接/过长的输出被丢弃", () => {
    expect(anchoredOpening("看这里 https://example.com 商场看中羽绒服网上便宜一千", payload)).toBeNull();
    expect(anchoredOpening("商场看中羽绒服网上便宜一千".repeat(10), payload)).toBeNull();
  });

  it("注入的模型调用编造时，生成结果回落模板（mode=template）", async () => {
    const brief = await generateDailyBrief(ctx, {
      now: new Date(Date.now() - 2 * 86_400_000),
      openingCaller: async () => "今天最火的是火星发现外星人，大家快去看呀呀呀",
    });
    expect(brief.openingMode).toBe("template");
    const anchored = await generateDailyBrief(ctx, {
      now: new Date(Date.now() - 3 * 86_400_000),
      openingCaller: async () => "早上好喵，商场看中羽绒服网上便宜一千正热着呢，今日简报来啦",
    });
    expect(anchored.openingMode).toBe("ai");
  });
});
