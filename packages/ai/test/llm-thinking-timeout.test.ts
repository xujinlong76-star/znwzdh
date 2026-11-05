import { afterEach, describe, expect, it } from "vitest";
import {
  LlmError,
  THINKING_TIMEOUT_FLOOR_MS,
  chatCompletion,
  chatStream,
  resolveRequestTimeout,
  resetLlmCapabilityCache,
  type LlmProvider,
} from "../src/llm.ts";

const BASE = "http://127.0.0.1:9/v1";

function provider(over: Partial<LlmProvider> = {}): LlmProvider {
  return {
    baseUrl: BASE,
    model: "timeout-test-model",
    apiKey: "sk-test-1234567890",
    allowPrivateNetwork: true,
    timeoutMs: 100,
    ...over,
  };
}

function okBody(content: string) {
  return {
    model: "timeout-test-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  };
}

/** 延迟 delayMs 才回包，并在 abort 时像真实 fetch 一样拒绝（超时/取消都必须能被观察到） */
function slowFetch(delayMs: number, make: () => Response): typeof fetch {
  return async (_input: unknown, init?: RequestInit) => {
    await new Promise<void>((resolve, reject) => {
      const signal = init?.signal ?? null;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException("This operation was aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, delayMs);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
    return make();
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function sseResponse(text: string): Response {
  return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const SSE_OK = 'data: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n';
const MESSAGES = [{ role: "user" as const, content: "hi" }];

afterEach(() => {
  resetLlmCapabilityCache();
});

describe("resolveRequestTimeout：思考态放宽只让位于「有人真填过的超时」", () => {
  it("(a) 未显式配置 ⇒ 思考态抬到内置下限", () => {
    expect(resolveRequestTimeout({ timeoutMs: 20_000 }, true)).toBe(THINKING_TIMEOUT_FLOOR_MS);
    expect(resolveRequestTimeout({ timeoutMs: 20_000, timeoutMsExplicit: false }, true)).toBe(60_000);
  });

  it("(b) 显式 25s ⇒ 一字不改用 25s，管理面板的数字不是装饰", () => {
    expect(resolveRequestTimeout({ timeoutMs: 25_000, timeoutMsExplicit: true }, true)).toBe(25_000);
    // 收紧到比下限更大也要照配置（不能被 max 反向放宽）
    expect(resolveRequestTimeout({ timeoutMs: 90_000, timeoutMsExplicit: true }, true)).toBe(90_000);
  });

  it("(c) 没下发思维链 ⇒ 原值，与显式性无关", () => {
    expect(resolveRequestTimeout({ timeoutMs: 20_000 }, false)).toBe(20_000);
    expect(resolveRequestTimeout({ timeoutMs: 25_000, timeoutMsExplicit: true }, false)).toBe(25_000);
  });

  it("内置下限是 60s：低于它的显式值同样不再被抬高", () => {
    expect(THINKING_TIMEOUT_FLOOR_MS).toBe(60_000);
    expect(resolveRequestTimeout({ timeoutMs: 30_000, timeoutMsExplicit: true }, true)).toBe(30_000);
  });

  it("缺省/非正数超时回落到内置 20s，再按思考态决定是否放宽", () => {
    expect(resolveRequestTimeout({ timeoutMs: 0 }, true)).toBe(THINKING_TIMEOUT_FLOOR_MS);
    expect(resolveRequestTimeout({ timeoutMs: 0, timeoutMsExplicit: true }, false)).toBe(20_000);
  });
});

describe("非流式调用点：显式性真的参与超时", () => {
  it("显式 100ms 且回包要 400ms ⇒ 按 100ms 失败（不再被抬到 60s）", async () => {
    const startedAt = Date.now();
    const err = await chatCompletion(provider({ timeoutMsExplicit: true }), {
      messages: MESSAGES,
      thinking: true,
      fetchImpl: slowFetch(400, () => jsonResponse(okBody("不该到达"))),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe("timeout");
    expect((err as Error).message).toContain("（100ms）");
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("同一个 100ms、没显式配置 ⇒ 思考态仍在 60s 下限内等到回包（保住实测的长推理成功）", async () => {
    const result = await chatCompletion(provider(), {
      messages: MESSAGES,
      thinking: true,
      fetchImpl: slowFetch(400, () => jsonResponse(okBody("思考后的回答"))),
    });
    expect(result.content).toBe("思考后的回答");
  });

  it("关掉思考 ⇒ 显式与否都按配置值，100ms 就失败", async () => {
    for (const explicit of [true, false]) {
      const err = await chatCompletion(provider({ timeoutMsExplicit: explicit }), {
        messages: MESSAGES,
        thinking: false,
        fetchImpl: slowFetch(400, () => jsonResponse(okBody("不该到达"))),
      }).catch((e) => e);
      expect((err as LlmError).code, `explicit=${String(explicit)}`).toBe("timeout");
      expect((err as Error).message).toContain("（100ms）");
    }
  });
});

describe("流式调用点：与非流式同口径", () => {
  async function drain(explicit: boolean | undefined) {
    const events: string[] = [];
    let error: unknown = null;
    try {
      for await (const e of chatStream(provider({ timeoutMsExplicit: explicit }), {
        messages: MESSAGES,
        thinking: true,
        fetchImpl: slowFetch(400, () => sseResponse(SSE_OK)),
      })) {
        if (e.type === "delta") events.push(e.text);
      }
    } catch (err) {
      error = err;
    }
    return { text: events.join(""), error };
  }

  it("显式 100ms ⇒ 流式也按 100ms 报超时", async () => {
    const { text, error } = await drain(true);
    expect(text).toBe("");
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).code).toBe("timeout");
    expect((error as Error).message).toContain("流式调用超时（100ms）");
  });

  it("未显式配置 ⇒ 思考态放宽后流式照常产出正文", async () => {
    const { text, error } = await drain(undefined);
    expect(error).toBe(null);
    expect(text).toBe("好");
  });
});
