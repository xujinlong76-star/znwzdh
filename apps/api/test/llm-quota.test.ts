/**
 * LLM 额度闸门（`llm-quota.ts` + `repo.sumLlmUsage`）与「额度到顶之后说真话」。
 *
 * 要锁住的是两类语义，缺一类都会退回事故现场：
 *  1. **计数口径**。身份 / 无身份合池 / 运维者预算（排除用户自带 key）三档各自独立，
 *     口径错一位就会「误伤正常用户」或「放过脚本」——比如把用户自带 key 的消耗
 *     也计进系统预算，一个人多用就能吃完全站额度。
 *  2. **拒绝之后的响应必须诚实**。有非模型答案的入口降级并标注来源
 *     （`degraded` / `aiSkipped` / `aiDegraded`），没有的入口给 429 + Retry-After；
 *     两条都不许把「额度用完了」渲染成「模型坏了」，也不许冒充模型回答。
 *
 * 额度默认值在测试环境全是 0（= 关闭），所以下面每个用例都显式注入上限。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig, type AppConfig } from "../src/config.ts";
import { checkLlmQuota, LlmQuotaError } from "../src/llm-quota.ts";

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

describe("checkLlmQuota 三档独立", () => {
  it("默认（测试环境全 0）不拦任何调用", async () => {
    await seedUsage({ identity: "user-a" });
    expect((await checkLlmQuota(ctx, "user-a")).ok).toBe(true);
    expect((await checkLlmQuota(ctx, null)).ok).toBe(true);
  });

  it("身份档命中次数上限：报 identity/calls，且不没收别人的额度", async () => {
    setQuota({ identityDailyCalls: 2 });
    await seedUsage({ identity: "user-a" });
    await seedUsage({ identity: "user-a" });
    await seedUsage({ identity: "user-b" });

    const res = await checkLlmQuota(ctx, "user-a");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBeInstanceOf(LlmQuotaError);
    expect(res.error.scope).toBe("identity");
    expect(res.error.metric).toBe("calls");
    expect(res.error.limit).toBe(2);
    expect(res.error.used).toBe(2);
    expect((await checkLlmQuota(ctx, "user-b")).ok).toBe(true);
  });

  it("token 档命中：报 metric=tokens（次数还没超也要拦）", async () => {
    setQuota({ identityDailyTokens: 1000 });
    await seedUsage({ identity: "user-a", promptTokens: 600, completionTokens: 500 });

    const res = await checkLlmQuota(ctx, "user-a");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.metric).toBe("tokens");
    expect(res.error.used).toBe(1100);
  });

  it("无身份流量合池：两条不同的 NULL 记录累加到 anonymous 档", async () => {
    setQuota({ anonymousDailyCalls: 2 });
    await seedUsage({ identity: null });
    await seedUsage({ identity: null });

    const res = await checkLlmQuota(ctx, null);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.scope).toBe("anonymous");
  });

  it("系统预算：用户自带 key 的消耗不吃运维额度，但非 user 源的会", async () => {
    setQuota({ systemDailyCalls: 1 });
    await seedUsage({ identity: "user-a", source: "user" });
    expect((await checkLlmQuota(ctx, "user-a")).ok).toBe(true);

    await seedUsage({ identity: "user-a", source: "system" });
    const res = await checkLlmQuota(ctx, "user-a");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.scope).toBe("system");
    expect(res.error.used).toBe(1);
  });

  it("Retry-After 由窗口内最早一条推出，不给假的「24 小时后」", async () => {
    setQuota({ identityDailyCalls: 1 });
    const elevenHoursAgo = Date.now() - 11 * 60 * 60 * 1000;
    await seedUsage({ identity: "user-a", createdAt: elevenHoursAgo });

    const res = await checkLlmQuota(ctx, "user-a");
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
    const res = await checkLlmQuota(ctx, "user-a");
    if (res.ok) throw new Error("应当被拦");
    const body = res.error.toResponseBody();
    expect(body.code).toBe("llm_quota");
    expect(body.quota).toMatchObject({ scope: "identity", metric: "calls", limit: 1, used: 1 });
    expect(body.quota.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(res.error.statusCode).toBe(429);
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
    // 兜底是站内关键词匹配，不能报一个模型名冒充来源
    expect(body.model).toBe("local-heuristic-match");
    expect(body.degraded).toBe("quota");
    expect(body.quota).toMatchObject({ scope: "identity", metric: "calls", limit: 1, used: 1 });
    expect(res.headers["retry-after"]).toBeTruthy();
    // 正文开头就要交代这不是模型生成的，否则用户会把「没匹配到」读成「AI 认为没有」
    expect(body.reply).toContain("站内关键词匹配");
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
});
