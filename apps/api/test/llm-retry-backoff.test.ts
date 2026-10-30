/**
 * 备用池轮换的退避（run128）。
 *
 * 锁三层，缺一层就退回「429 之后零退避」的原状：
 *  ① `planLlmRetryWait` 的判据：服务端 `Retry-After` 优先且不被缩短；没下发头时
 *     指数 + 抖动；端到端预算放不下「等待 + 余量」时停止轮换。
 *  ② `sleepAbortable`：等待用的是用户等待时间，必须能被「停止」打断，且不泄漏监听器。
 *  ③ `callLlm` / `callLlmStream` 的真实形状：等了几次、每次多久、取消后还打不打下一家、
 *     最后一次失败有没有白等。等待与抖动都走注入接缝 ⇒ 断言的是「等了多久」这个
 *     决策值，不是墙钟（墙钟断言是这类用例唯一的抖源）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listenerCount } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { callLlm, callLlmStream, planLlmRetryWait, sleepAbortable } from "../src/llm-usage.ts";
import { type ResolvedLlm } from "../src/llm-config.ts";
import { RetryBudget } from "@navhub/ai";

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-llm-backoff-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      corsOrigins: ["*"],
    }),
  );
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** provider 用 127.0.0.1 + allowPrivateNetwork（与 copilot-cancel.test 同口径），免得被 SSRF 闸门先拦掉 */
function pool(tag: string, fallbackCount = 1): ResolvedLlm {
  const mk = (n: number) => ({
    name: "fake-" + tag + "-" + n,
    baseUrl: "http://127.0.0.1:1143" + n + "/v1",
    model: "fake-" + tag + "-" + n,
    apiKey: "sk-fake",
    allowPrivateNetwork: true,
  });
  return {
    provider: mk(0),
    fallbacks: Array.from({ length: fallbackCount }, (_, i) => mk(i + 1)),
    source: "system",
  } as unknown as ResolvedLlm;
}

async function usageRows(scenario: string) {
  return ctx.repo.raw("SELECT ok, error_code FROM llm_usage WHERE scenario = ?", [scenario]) as Promise<
    Array<{ ok: number; error_code: string | null }>
  >;
}

const okJson = (content: string) =>
  new Response(JSON.stringify({ model: "fake", choices: [{ message: { role: "assistant", content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function statusJson(status: number, headers: Record<string, string> = {}) {
  return () => new Response(JSON.stringify({ error: "nope" }), { status, headers: { "content-type": "application/json", ...headers } });
}

/** 记录「等了几次、每次多久」的注入接缝；random 固定在区间端点，退避值可预测 */
function backoffProbe() {
  const waits: number[] = [];
  return {
    waits,
    // 每条用例一只新的预算：进程级那只的判定取决于窗口里残留了谁的重试（见 llm-usage 的说明）
    retryBudget: new RetryBudget({ ratio: 0.2, minRetries: 50 }),
    hooks: {
      sleep: async (ms: number) => {
        waits.push(ms);
        return true;
      },
      random: () => 1,
    },
  };
}

describe("planLlmRetryWait：服务端建议优先", () => {
  it("有 retryAfterMs 就按它等，不缩短也不加抖动", () => {
    expect(planLlmRetryWait({ retryAfterMs: 4000, failures: 1, random: () => 0 })).toEqual({
      proceed: true,
      waitMs: 4000,
      source: "server",
    });
  });

  it("Retry-After: 0 是「现在就能重试」，不是「读不到」", () => {
    expect(planLlmRetryWait({ retryAfterMs: 0, failures: 2, random: () => 0 })).toEqual({
      proceed: true,
      waitMs: 0,
      source: "server",
    });
  });

  it("建议值超出封顶 ⇒ 放弃轮换，而不是压成 10s 再打一次注定失败的请求", () => {
    expect(planLlmRetryWait({ retryAfterMs: 90_000, failures: 1 })).toEqual({ proceed: false, waitMs: 0, source: "stop" });
    expect(planLlmRetryWait({ retryAfterMs: 10_000, failures: 1 }).proceed).toBe(true);
  });

  it("没有头时按失败家数翻倍，封顶 10s", () => {
    const wait = (failures: number) => planLlmRetryWait({ failures, random: () => 1 }).waitMs;
    expect([wait(1), wait(2), wait(3), wait(4)]).toEqual([500, 1_000, 2_000, 4_000]);
    expect(wait(6)).toBe(10_000);
  });

  it("抖动只在 [0.5×, 1×] 区间取值 ⇒ 齐步走被打散，但不会退化成 0", () => {
    expect(planLlmRetryWait({ failures: 3, random: () => 0 }).waitMs).toBe(1_000);
    expect(planLlmRetryWait({ failures: 3, random: () => 0.5 }).waitMs).toBe(1_500);
  });

  it("预算放不下「等待 + 余量」时停止轮换（等待吃的是用户等待时间）", () => {
    const now = 1_000_000;
    expect(planLlmRetryWait({ failures: 1, deadlineAt: now + 800, now, random: () => 1 })).toEqual({
      proceed: false,
      waitMs: 0,
      source: "stop",
    });
    expect(planLlmRetryWait({ failures: 1, deadlineAt: now + 60_000, now, random: () => 1 })).toEqual({
      proceed: true,
      waitMs: 500,
      source: "backoff",
    });
  });

  it("服务端建议放不进剩余预算时同样停止，而不是把 8s 压成「刚好剩这么多」", () => {
    const now = 1_000_000;
    expect(planLlmRetryWait({ retryAfterMs: 8_000, failures: 1, deadlineAt: now + 8_500, now }).proceed).toBe(false);
    expect(planLlmRetryWait({ retryAfterMs: 8_000, failures: 1, deadlineAt: now + 30_000, now })).toEqual({
      proceed: true,
      waitMs: 8_000,
      source: "server",
    });
  });

  it("不传 deadlineAt 时不做预算判定", () => {
    expect(planLlmRetryWait({ retryAfterMs: 10_000, failures: 1 })).toEqual({ proceed: true, waitMs: 10_000, source: "server" });
  });
});

describe("sleepAbortable：等待可被「停止」打断", () => {
  it("正常到期返回 true", async () => {
    expect(await sleepAbortable(15)).toBe(true);
  });

  it("已经中止的信号不再等待", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await sleepAbortable(5_000, controller.signal)).toBe(false);
  });

  it("等待期间中止 ⇒ 立刻返回 false，不等满", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    setTimeout(() => controller.abort(), 10);
    expect(await sleepAbortable(5_000, controller.signal)).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("正常醒来后摘掉 abort 监听器（常驻进程不随请求数累积）", async () => {
    const controller = new AbortController();
    await sleepAbortable(5, controller.signal);
    expect(listenerCount(controller.signal, "abort")).toBe(0);
    await sleepAbortable(5, controller.signal);
    expect(listenerCount(controller.signal, "abort")).toBe(0);
  });

  it("0 毫秒不建计时器，但中止的信号仍然返回 false", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await sleepAbortable(0, controller.signal)).toBe(false);
    expect(await sleepAbortable(0)).toBe(true);
  });
});

describe("callLlm：轮换前的真实等待", () => {
  const messages = [{ role: "user" as const, content: "ping" }];

  it("429 带 Retry-After ⇒ 换下一家之前等满服务端建议的 4s", async () => {
    const probe = backoffProbe();
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return attempts === 1
        ? statusJson(429, { "retry-after": "4" })()
        : okJson("ok");
    }) as unknown as typeof fetch;

    const res = await callLlm(ctx, pool("server", 1), {
      scenario: "backoff-server",
      messages,
      fetchImpl,
      backoff: probe.hooks,
      retryBudget: probe.retryBudget,
    });

    expect(res.content).toBe("ok");
    expect(attempts).toBe(2);
    expect(probe.waits).toEqual([4_000]);
    const rows = await usageRows("backoff-server");
    expect(rows.map((r) => [r.ok, r.error_code])).toEqual([
      [0, "rate_limit"],
      [1, null],
    ]);
  });

  it("服务端建议 90s（超出封顶）⇒ 一家都不再打，等也不等", async () => {
    const probe = backoffProbe();
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return statusJson(429, { "retry-after": "90" })();
    }) as unknown as typeof fetch;

    await expect(
      callLlm(ctx, pool("toolong", 1), { scenario: "backoff-toolong", messages, fetchImpl, backoff: probe.hooks, retryBudget: probe.retryBudget }),
    ).rejects.toMatchObject({ code: "rate_limit" });

    expect(attempts).toBe(1);
    expect(probe.waits).toEqual([]);
    expect(await usageRows("backoff-toolong")).toHaveLength(1);
  });

  it("没有 Retry-After 的 500 ⇒ 走本地指数退避（random=1 ⇒ 500ms）", async () => {
    const probe = backoffProbe();
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return attempts === 1 ? statusJson(500)() : okJson("ok");
    }) as unknown as typeof fetch;

    await callLlm(ctx, pool("exp", 1), {
      scenario: "backoff-exp",
      messages,
      fetchImpl,
      backoff: probe.hooks,
      retryBudget: probe.retryBudget,
    });
    expect(probe.waits).toEqual([500]);
    expect(attempts).toBe(2);
  });

  it("401 既不等待也不轮换：换谁都一样，退避不该把它诱导回来", async () => {
    const probe = backoffProbe();
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return statusJson(401, { "retry-after": "3" })();
    }) as unknown as typeof fetch;

    await expect(
      callLlm(ctx, pool("auth", 2), { scenario: "backoff-auth", messages, fetchImpl, backoff: probe.hooks, retryBudget: probe.retryBudget }),
    ).rejects.toMatchObject({ code: "auth" });
    expect(attempts).toBe(1);
    expect(probe.waits).toEqual([]);
  });

  it("最后一家失败之后不白等：两连 429 只等 1 次（等待放在下一轮开头）", async () => {
    const probe = backoffProbe();
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return statusJson(429, { "retry-after": "4" })();
    }) as unknown as typeof fetch;

    await expect(
      callLlm(ctx, pool("both", 1), { scenario: "backoff-both", messages, fetchImpl, backoff: probe.hooks, retryBudget: probe.retryBudget }),
    ).rejects.toMatchObject({ code: "rate_limit" });
    expect(attempts).toBe(2);
    expect(probe.waits).toEqual([4_000]);
    expect(await usageRows("backoff-both")).toHaveLength(2);
  });

  it("等待期间按「停止」⇒ 不打下一家，失败用量仍只有已发生的那一行", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return statusJson(429, { "retry-after": "4" })();
    }) as unknown as typeof fetch;

    await expect(
      callLlm(ctx, pool("midabort", 1), {
        scenario: "backoff-midabort",
        messages,
        signal: controller.signal,
        fetchImpl,
        backoff: {
          sleep: async (_ms, signal) => {
            controller.abort();
            return !signal?.aborted;
          },
          random: () => 1,
        },
        retryBudget: new RetryBudget({ ratio: 0.2, minRetries: 50 }),
      }),
    ).rejects.toMatchObject({ code: "rate_limit" });

    expect(attempts).toBe(1);
    const rows = await usageRows("backoff-midabort");
    expect(rows.map((r) => [r.ok, r.error_code])).toEqual([[0, "rate_limit"]]);
  });
});

describe("callLlmStream：与非流式同一套等待口径", () => {
  const messages = [{ role: "user" as const, content: "ping" }];

  function sse(text: string) {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"model":"fake","choices":[{"delta":{"content":"' + text + '"}}]}\n\ndata: [DONE]\n\n'));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  }

  it("开流前 429 ⇒ 等满 Retry-After 再打下一家，正文正常产出", async () => {
    const probe = backoffProbe();
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return attempts === 1 ? statusJson(429, { "retry-after": "2" })() : sse("你好");
    }) as unknown as typeof fetch;

    const deltas: string[] = [];
    for await (const event of callLlmStream(ctx, pool("stream", 1), {
      scenario: "backoff-stream",
      messages,
      fetchImpl,
      backoff: probe.hooks,
      retryBudget: probe.retryBudget,
    })) {
      if (event.type === "delta") deltas.push(event.text);
    }

    expect(deltas.join("")).toBe("你好");
    expect(attempts).toBe(2);
    expect(probe.waits).toEqual([2_000]);
    const rows = await usageRows("backoff-stream");
    expect(rows.map((r) => r.ok)).toEqual([0, 1]);
  });

  it("流式取消即停：等待被打断 ⇒ 第二家一次都不打", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const fetchImpl = (async () => {
      attempts += 1;
      return statusJson(429, { "retry-after": "4" })();
    }) as unknown as typeof fetch;

    const gen = callLlmStream(ctx, pool("stream-abort", 1), {
      scenario: "backoff-stream-abort",
      messages,
      signal: controller.signal,
      fetchImpl,
      backoff: {
        sleep: async (_ms, signal) => {
          controller.abort();
          return !signal?.aborted;
        },
        random: () => 1,
      },
      retryBudget: new RetryBudget({ ratio: 0.2, minRetries: 50 }),
    });

    await expect(gen.next()).rejects.toMatchObject({ code: "rate_limit" });
    expect(attempts).toBe(1);
    expect(await usageRows("backoff-stream-abort")).toHaveLength(1);
  });
});
