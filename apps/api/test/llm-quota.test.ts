/**
 * LLM 额度闸门（`llm-quota.ts` + `repo.reserveLlmQuota`）与「额度到顶之后说真话」。
 *
 * 要锁住的是三类语义，缺一类都会退回事故现场：
 *  1. **计数口径**。身份 / 无身份合池 / 运维者预算（排除用户自带 key）三档各自独立，
 *     口径错一位就会「误伤正常用户」或「放过脚本」——比如把用户自带 key 的消耗
 *     也计进系统预算，一个人多用就能吃完全站额度。
 *  2. **判定与占位同事务**（P0-3）。闸门不能是「先读用量、再在 JS 里比上限」：
 *     两步之间隔着 await，N 个并发会同时看到「还没超」并全部放行。所以这里跑
 *     真并发（20 抢 5），并要求被拒的请求**不落预留行**、结算后立刻放开名额。
 *  3. **拒绝之后的响应必须诚实**。有非模型答案的入口降级并标注来源
 *     （`degraded` / `aiSkipped` / `aiDegraded`），没有的入口给 429 + Retry-After；
 *     两条都不许把「额度用完了」渲染成「模型坏了」，也不许冒充模型回答。
 *
 * 额度默认值在测试环境全是 0（= 关闭），所以下面每个用例都显式注入上限。
 * 只有 `reserveTokens` / `reserveTtlMs` 保持非 0：并发用例要真的撞上限。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig, type AppConfig } from "../src/config.ts";
import { LlmQuotaError, reserveLlmQuota, settleLlmQuota, type LlmQuotaHold } from "../src/llm-quota.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let baseQuota: AppConfig["llmQuota"];

/** 造一条用量记录；identity/source/tokens 都可控，用于精确摆出上限两侧 */
async function seedUsage(input: {
  identity?: string | null;
  source?: string;
  scenario?: string;
  promptTokens?: number;
  completionTokens?: number;
  ok?: boolean;
  createdAt?: number;
}) {
  await ctx.repo.run(
    "INSERT INTO llm_usage (id, scenario, source, model, identity, prompt_tokens, completion_tokens, latency_ms, ok, error_code, thinking, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      crypto.randomUUID(),
      input.scenario ?? "copilot",
      input.source ?? "system",
      "test-model",
      input.identity ?? null,
      input.promptTokens ?? 0,
      input.completionTokens ?? 0,
      120,
      input.ok ?? true,
      null,
      false,
      input.createdAt ?? Date.now(),
    ],
  );
}

function setQuota(patch: Partial<AppConfig["llmQuota"]>) {
  ctx.config.llmQuota = { ...baseQuota, ...patch };
}

/**
 * 走一次闸门。通过就立刻结算：预留行代表「这次调用占住了额度」，
 * 不结算的话它会在后面的用例里继续占位，把一个「只数已落账用量」的断言
 * 变成「用量 + 上一行的残留」——那种失败看起来像额度算错，其实是夹具没归零。
 */
async function gate(identity: string | null, options?: Parameters<typeof reserveLlmQuota>[2]) {
  const res = await reserveLlmQuota(ctx, identity, options);
  if (res.ok) await settleLlmQuota(ctx, res.hold);
  return res;
}

async function reservationCount(): Promise<number> {
  const row = (await ctx.repo.raw("SELECT COUNT(*) AS c FROM llm_quota_reservations"))[0];
  return Number(row?.c ?? 0);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-llm-quota-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
    // 一个「看起来可用」的模型端点：有密钥即 llmProviderReady=true，
    // 但它指向本机丢弃端口，任何真实调用都会连接失败并落一条 ok=false 的用量。
    // 「闸门拦住了」因此可以用「llm_usage 里没有新行」来证明。
    llm: { baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk-quota-test", model: "quota-test-model" },
  });
  ctx = await createContext(config);
  baseQuota = { ...ctx.config.llmQuota };
  app = await buildServer(ctx);
  await app.ready();

  const cat = await ctx.repo.createCategory({ title: "效率工具", slug: "quota-eff" });
  await ctx.repo.createSite({
    title: "Quota Peer One",
    url: "https://example.com/peer-one",
    description: "同类候选站点一",
    categoryId: cat.id,
    tags: ["效率"],
  });
  await ctx.repo.createSite({
    title: "Quota Target",
    url: "https://example.com/quota-target",
    description: "被推荐替代的站点",
    categoryId: cat.id,
    tags: ["效率"],
  });
});

afterEach(async () => {
  setQuota({});
  await ctx.repo.run("DELETE FROM llm_usage");
  // 预留行是「在途」状态的数据：上一轮用例如果没结算，会把下一轮的 used 抬高 1
  await ctx.repo.run("DELETE FROM llm_quota_reservations");
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows 上 SQLite 文件可能被短暂占用
  }
});

describe("sumLlmUsage 计数口径", () => {
  it("身份档只数同一个身份，且 identity 为 NULL 的行走独立合池", async () => {
    await seedUsage({ identity: "user-a", promptTokens: 100, completionTokens: 50 });
    await seedUsage({ identity: "user-a", promptTokens: 100, completionTokens: 50 });
    await seedUsage({ identity: "user-b", promptTokens: 10 });
    await seedUsage({ identity: null, promptTokens: 7 });

    expect(await ctx.repo.sumLlmUsage({ since: 0, identity: "user-a" })).toMatchObject({
      calls: 2,
      tokens: 300,
    });
    expect(await ctx.repo.sumLlmUsage({ since: 0, identity: "user-b" })).toMatchObject({ calls: 1, tokens: 10 });
    expect(await ctx.repo.sumLlmUsage({ since: 0, identity: null })).toMatchObject({ calls: 1, tokens: 7 });
    // 不传 identity = 全量（观测面板用同一份口径）
    expect(await ctx.repo.sumLlmUsage({ since: 0 })).toMatchObject({ calls: 4, tokens: 317 });
  });

  it("excludeUserSource 只数花运维者 key 的消耗", async () => {
    await seedUsage({ identity: "user-a", source: "user", promptTokens: 900 });
    await seedUsage({ identity: null, source: "system", promptTokens: 100 });
    await seedUsage({ identity: "user-a", source: "env", promptTokens: 50 });

    const system = await ctx.repo.sumLlmUsage({ since: 0, excludeUserSource: true });
    expect(system).toMatchObject({ calls: 2, tokens: 150 });
  });

  it("窗口外的行不计入，firstAt 取窗口内最早一条", async () => {
    const old = Date.now() - 25 * 60 * 60 * 1000;
    await seedUsage({ identity: "user-a", createdAt: old, promptTokens: 500 });
    await seedUsage({ identity: "user-a", promptTokens: 20 });

    const win = await ctx.repo.sumLlmUsage({ since: Date.now() - 24 * 60 * 60 * 1000, identity: "user-a" });
    expect(win.calls).toBe(1);
    expect(win.tokens).toBe(20);
    expect(win.firstAt).toBeGreaterThan(old);
    // 空窗口：0 次、0 token、firstAt 为 null（不是 0 —— 「没有数据」不等于「最早时间戳是 0」）
    const empty = await ctx.repo.sumLlmUsage({ since: Date.now() + 60_000 });
    expect(empty).toMatchObject({ calls: 0, tokens: 0, firstAt: null });
  });

  it("失败调用同样计数：额度是「花费」口径，不是「成功」口径", async () => {
    await seedUsage({ identity: "user-a", ok: false });
    expect((await ctx.repo.sumLlmUsage({ since: 0, identity: "user-a" })).calls).toBe(1);
  });
});

describe("reserveLlmQuota 三档独立", () => {
  it("默认（测试环境全 0）不拦任何调用，也一行预留都不写", async () => {
    await seedUsage({ identity: "user-a" });
    // 三档全关时连事务都不开：留一行没人结算的预留，只会把观测上的 active 变成噪音
    expect(await reserveLlmQuota(ctx, "user-a")).toEqual({ ok: true, hold: null });
    expect(await reserveLlmQuota(ctx, null)).toEqual({ ok: true, hold: null });
    expect(await reservationCount()).toBe(0);
  });

  it("放行换到一行预留，结算即删行", async () => {
    setQuota({ identityDailyCalls: 5 });
    const res = await reserveLlmQuota(ctx, "user-a");
    if (!res.ok || !res.hold) throw new Error("空账本下应当放行并拿到句柄");
    expect(res.hold).toMatchObject({ identity: "user-a", source: "system", reservedCalls: 1 });
    expect(await reservationCount()).toBe(1);
    expect((await ctx.repo.listLlmQuotaReservations(10)).map((r) => r.id)).toEqual([res.hold.id]);
    expect(await settleLlmQuota(ctx, res.hold)).toBe(true);
    // 结算=删行（真实数字由 llm_usage 说话）：留行会让同一笔消耗被记两次
    expect(await reservationCount()).toBe(0);
    expect(await settleLlmQuota(ctx, res.hold)).toBe(false);
  });

  it("身份档命中次数上限：报 identity/calls，且不没收别人的额度", async () => {
    setQuota({ identityDailyCalls: 2 });
    await seedUsage({ identity: "user-a" });
    await seedUsage({ identity: "user-a" });
    await seedUsage({ identity: "user-b" });

    const res = await gate("user-a");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(LlmQuotaError);
    expect(res.error.scope).toBe("identity");
    expect(res.error.metric).toBe("calls");
    expect(res.error.limit).toBe(2);
    expect(res.error.used).toBe(2);
    expect(res.error.blockedBy).toBe("usage");
    expect((await gate("user-b")).ok).toBe(true);
  });

  it("token 档命中：报 metric=tokens（次数还没超也要拦）", async () => {
    setQuota({ identityDailyTokens: 1000 });
    await seedUsage({ identity: "user-a", promptTokens: 600, completionTokens: 500 });

    const res = await gate("user-a");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.metric).toBe("tokens");
    expect(res.error.used).toBe(1100);
  });

  it("预估值夹到该档剩余空间：上限小于预估也不会把自己锁死", async () => {
    // 老配置形态：token 上限 60、单次预估 1500。若预估值参与「超限」判据，
    // 第一次调用（用量 0）就会被自己的预估挡住 —— 闸门从拦并发退化成拦死。
    setQuota({ identityDailyTokens: 60, reserveTokens: 1500 });
    const first = await reserveLlmQuota(ctx, "user-a");
    if (!first.ok) throw new Error("空账本下第一次必须放行");
    expect(first.hold?.reservedTokens).toBe(60);

    const second = await reserveLlmQuota(ctx, "user-a");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatchObject({ metric: "tokens", limit: 60, used: 60, blockedBy: "reservation" });
    await settleLlmQuota(ctx, first.hold);
  });

  it("无身份流量合池：两条不同的 NULL 记录累加到 anonymous 档", async () => {
    setQuota({ anonymousDailyCalls: 2 });
    await seedUsage({ identity: null });
    await seedUsage({ identity: null });

    const res = await gate(null);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.scope).toBe("anonymous");
  });

  it("系统预算：用户自带 key 的消耗不吃运维额度，也不生成系统档", async () => {
    setQuota({ systemDailyCalls: 1 });
    await seedUsage({ identity: "user-a", source: "user" });
    expect((await gate("user-a", { source: "system" })).ok).toBe(true);

    await seedUsage({ identity: "user-a", source: "system" });
    const res = await gate("user-a");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.scope).toBe("system");
    expect(res.error.used).toBe(1);

    // 自带 key 的请求：系统档根本不参与判定（别人花光预算，不能连你自己的 key 都不能用）
    expect(await reserveLlmQuota(ctx, "user-a", { source: "user" })).toEqual({ ok: true, hold: null });
  });

  it("Retry-After 由窗口内最早一条推出，不给假的「24 小时后」", async () => {
    setQuota({ identityDailyCalls: 1 });
    const elevenHoursAgo = Date.now() - 11 * 60 * 60 * 1000;
    await seedUsage({ identity: "user-a", createdAt: elevenHoursAgo });

    const res = await gate("user-a");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // 最早一条再过 ~13h 滚出窗口，就腾出一个额度
    const hours = res.error.retryAfterMs / (60 * 60 * 1000);
    expect(hours).toBeGreaterThan(12);
    expect(hours).toBeLessThan(13.5);
  });

  it("响应体带结构化额度信息，前端才能区分「限制」与「故障」", async () => {
    setQuota({ identityDailyCalls: 1 });
    await seedUsage({ identity: "user-a" });
    const res = await gate("user-a");
    if (res.ok) throw new Error("应当被拦");
    const body = res.error.toResponseBody();
    expect(body.code).toBe("llm_quota");
    expect(body.quota).toMatchObject({ scope: "identity", metric: "calls", limit: 1, used: 1, blockedBy: "usage" });
    expect(body.quota.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(res.error.statusCode).toBe(429);
  });
});

/**
 * P0-3 的核心：闸门必须拦得住并发。
 *
 * 「先查后写」的实现每一步单看都对，串行用例永远绿；只有把 N 个请求同时打进去，
 * 才会看到上限 5 放出 20 次调用。下面这几条就是为此存在的——把 reserve 退回
 * check-then-act（读挪到事务外），第一条立刻变红。
 */
describe("并发：判定与占位在同一个事务里", () => {
  it("20 个并发抢 5 个名额：恰好 5 个通过，其余被在途预留挡住", async () => {
    setQuota({ identityDailyCalls: 5 });
    const holds: LlmQuotaHold[] = [];
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveLlmQuota(ctx, "burst")));
    for (const r of results) {
      if (r.ok) {
        // 放行却不带句柄 = 档位被静默关掉（三档全关才会这样），并发断言就成了假的绿
        if (!r.hold) throw new Error("额度开着时放行必须换来一个预留句柄");
        holds.push(r.hold);
      } else {
        expect(r.error).toMatchObject({ scope: "identity", metric: "calls", limit: 5, used: 5, blockedBy: "reservation" });
        // 被预留挡住等的是 TTL（秒级），报 24 小时会把「稍后再试」渲染成「今天没了」
        expect(r.error.retryAfterMs).toBeLessThanOrEqual(ctx.config.llmQuota.reserveTtlMs);
      }
    }
    expect(holds).toHaveLength(5);
    // 库里恰好 5 行：被拒的请求不留预留，通过的每一行都代表一次真实的在途调用
    expect(await reservationCount()).toBe(5);

    for (const hold of holds) await settleLlmQuota(ctx, hold);
    expect(await reservationCount()).toBe(0);
    expect((await reserveLlmQuota(ctx, "burst")).ok).toBe(true);
  });

  it("被上限挡住时不占名额：拒绝不落预留行", async () => {
    setQuota({ identityDailyCalls: 1 });
    await seedUsage({ identity: "solo" });
    const res = await reserveLlmQuota(ctx, "solo");
    expect(res.ok).toBe(false);
    expect(await reservationCount()).toBe(0);
  });

  it("在途预留挡住第二个并发请求，结算后立刻放开", async () => {
    setQuota({ identityDailyCalls: 1 });
    const first = await reserveLlmQuota(ctx, "seq");
    if (!first.ok) throw new Error("空账本下第一个应当放行");
    const second = await reserveLlmQuota(ctx, "seq");
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.blockedBy).toBe("reservation");
    // finally 里重复结算不能抛：SSE 断开与正常收尾可能都跑到这一句
    expect(await settleLlmQuota(ctx, first.hold)).toBe(true);
    expect(await settleLlmQuota(ctx, first.hold)).toBe(false);
    expect((await gate("seq")).ok).toBe(true);
  });

  it("来不及结算的行靠 TTL 自愈，不会永久吃掉额度", async () => {
    setQuota({ identityDailyCalls: 1, reserveTtlMs: 1000 });
    const held = await reserveLlmQuota(ctx, "crash");
    if (!held.ok) throw new Error("空账本下应当放行");
    // 故意不结算：模拟进程被 kill / SSE 半路断开
    expect((await reserveLlmQuota(ctx, "crash")).ok).toBe(false);

    await new Promise((r) => setTimeout(r, 1_100));
    const after = await reserveLlmQuota(ctx, "crash");
    expect(after.ok).toBe(true);
    // 只留下一行：上一轮的死行被这次预留顺手回收（不新增清理任务类型）
    expect(await reservationCount()).toBe(1);
    if (after.ok) await settleLlmQuota(ctx, after.hold);
  });
});

describe("额度到顶后的降级响应（诚实性）", () => {
  it("POST /api/copilot/chat：不再碰模型，兜底答案标注来源与恢复时间", async () => {
    setQuota({ identityDailyCalls: 1 });
    await seedUsage({ identity: "quota-anon" });

    const before = Number((await ctx.repo.raw("SELECT COUNT(*) AS c FROM llm_usage"))[0].c);
    const res = await app.inject({
      method: "POST",
      url: "/api/copilot/chat?anonId=quota-anon",
      payload: { message: "推荐效率工具" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    // 兜底是站内混合检索，不能报一个模型名冒充来源
    expect(body.model).toBe("local-heuristic-match");
    expect(body.degraded).toBe("quota");
    expect(body.quota).toMatchObject({ scope: "identity", metric: "calls", limit: 1, used: 1 });
    expect(res.headers["retry-after"]).toBeTruthy();
    // 正文开头就要交代这不是模型生成的，否则用户会把「没匹配到」读成「AI 认为没有」
    expect(body.reply).toContain("站内混合检索");
    expect(body.reply).not.toContain("我是 **Agnes 3.0 Flash**");
    // 拦住了 = 一条用量都没多（provider 是 ready 的，没拦必然会产生记录）
    const after = Number((await ctx.repo.raw("SELECT COUNT(*) AS c FROM llm_usage"))[0].c);
    expect(after).toBe(before);
  });

  it("POST /api/sites/:id/recommend-alternative：200 + 真实候选 + aiDegraded=quota", async () => {
    setQuota({ identityDailyCalls: 1 });
    await seedUsage({ identity: "quota-anon" });
    const target = await ctx.repo.findSiteByUrl("https://example.com/quota-target");
    expect(target).toBeTruthy();

    const res = await app.inject({
      method: "POST",
      url: `/api/sites/${target!.id}/recommend-alternative?anonId=quota-anon`,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.aiDegraded).toBe("quota");
    expect(body.model).toBe("fallback-heuristics");
    expect(body.quota).toMatchObject({ scope: "identity", metric: "calls" });
    expect(Array.isArray(body.recommendations)).toBe(true);
  });

  it("POST /api/enrich：降级成只抓取，响应带 aiSkipped=quota 且不产生用量", async () => {
    setQuota({ identityDailyCalls: 1 });
    await seedUsage({ identity: "quota-anon" });
    const before = Number((await ctx.repo.raw("SELECT COUNT(*) AS c FROM llm_usage"))[0].c);

    const res = await app.inject({
      method: "POST",
      url: "/api/enrich?anonId=quota-anon",
      payload: { url: "https://example.com/peer-one" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().aiSkipped).toBe("quota");
    expect(res.json().quota).toMatchObject({ scope: "identity" });
    const after = Number((await ctx.repo.raw("SELECT COUNT(*) AS c FROM llm_usage"))[0].c);
    expect(after).toBe(before);
  });

  it("POST /api/user/ai/chat：没有非模型答案，给 429 + Retry-After + llm_quota", async () => {
    setQuota({ identityDailyCalls: 1 });
    await seedUsage({ identity: "quota-anon" });

    const res = await app.inject({
      method: "POST",
      url: "/api/user/ai/chat?anonId=quota-anon",
      payload: { messages: [{ role: "user", content: "你好" }] },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBeTruthy();
    const body = res.json();
    expect(body.code).toBe("llm_quota");
    expect(body.quota).toMatchObject({ scope: "identity", metric: "calls", limit: 1, used: 1 });
  });
});

describe("额度配置的错误必须响亮（config 层）", () => {
  it("负数 / NaN / 小数一律拒绝启动，不静默当成「关闭该档」", () => {
    for (const bad of [-1, Number.NaN, 1.5, "30O" as unknown as number]) {
      expect(() =>
        loadConfig({
          mode: "lite",
          sqlitePath: join(dir, "never.db"),
          llmQuota: { identityDailyCalls: bad as number },
        }),
      ).toThrow(/LLM 额度|identityDailyCalls/);
    }
  });

  it("P0-3 新增的两个键同样吃整数守护", () => {
    for (const key of ["reserveTokens", "reserveTtlMs"] as const) {
      expect(() =>
        loadConfig({ mode: "lite", sqlitePath: join(dir, "never.db"), llmQuota: { [key]: -1 } }),
      ).toThrow(new RegExp(`LLM 额度 ${key}`));
    }
  });

  it("预留 TTL 短于 1 秒直接拒绝启动：那等于没有并发闸门", () => {
    // TTL 比一次真实生成还短 → 预留会在调用还在飞的时候过期，
    // 判定退回「先查后写」。这条退化没有任何日志，只能靠启动守护拦住。
    for (const tooShort of [1, 500, 999]) {
      expect(() =>
        loadConfig({
          mode: "lite",
          sqlitePath: join(dir, "never.db"),
          llmQuota: { reserveTtlMs: tooShort },
        }),
      ).toThrow(/reserveTtlMs 至少 1000/);
    }
    // 0 = 未配置（原语退回默认 5 分钟），1000 是守护的下边界，两者都合法
    expect(() =>
      loadConfig({ mode: "lite", sqlitePath: join(dir, "never.db"), llmQuota: { reserveTtlMs: 0 } }),
    ).not.toThrow();
    expect(() =>
      loadConfig({ mode: "lite", sqlitePath: join(dir, "never.db"), llmQuota: { reserveTtlMs: 1000 } }),
    ).not.toThrow();
  });
});
