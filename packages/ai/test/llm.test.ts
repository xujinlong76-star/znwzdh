import { describe, expect, it, vi } from "vitest";
import {
  AGNES_BASE_URL,
  AGNES_MODEL,
  LlmError,
  assertLlmEndpoint,
  chatCompletion,
  chatCompletionsUrl,
  chatStream,
  extractSseDelta,
  maskApiKey,
  parseRetryAfterMs,
  resetLlmCapabilityCache,
  type LlmProvider,
  type LlmStreamEvent,
} from "../src/llm.ts";

/** 端口不参与请求（fetch 全部注入 mock），只用于通过断言里的 URL 形态 */
const BASE = "http://127.0.0.1:9/v1";

function provider(over: Partial<LlmProvider> = {}): LlmProvider {
  return {
    baseUrl: BASE,
    model: "test-model",
    apiKey: "sk-test-1234567890",
    allowPrivateNetwork: true,
    timeoutMs: 800,
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function okBody(content: string) {
  return {
    model: "test-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  };
}

type Capture = { url: string; auth: string | undefined; body: Record<string, unknown> };

function captureFetch(respond: (call: number, body: Record<string, unknown>) => Response) {
  const calls: Capture[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url: String(input), auth: headers.Authorization, body });
    return respond(calls.length, body);
  };
  return { calls, fetchImpl };
}

describe("网关：URL 与密钥", () => {
  it("baseUrl 归一化为 /chat/completions（容忍尾斜杠与完整终点）", () => {
    expect(chatCompletionsUrl("https://api.agnes-ai.cn/v1")).toBe("https://api.agnes-ai.cn/v1/chat/completions");
    expect(chatCompletionsUrl("https://api.agnes-ai.cn/v1/")).toBe("https://api.agnes-ai.cn/v1/chat/completions");
    expect(chatCompletionsUrl("https://api.agnes-ai.cn/v1/chat/completions")).toBe(
      "https://api.agnes-ai.cn/v1/chat/completions",
    );
  });

  it("密钥只回显掩码，短密钥/空值不泄露", () => {
    expect(maskApiKey("sk-abcdefghijklmnop")).toBe("sk-****mnop");
    expect(maskApiKey("abc")).toBe("****bc");
    expect(maskApiKey("")).toBe("");
    expect(maskApiKey(null)).toBe("");
  });

  it("Agnes 默认常量与文档一致", () => {
    expect(AGNES_BASE_URL).toBe("https://api.agnes-ai.cn/v1");
    expect(AGNES_MODEL).toBe("agnes-3.0-flash");
  });
});

describe("网关：SSRF 把关", () => {
  it("默认拒绝环回/私网地址", async () => {
    await expect(assertLlmEndpoint("http://127.0.0.1:11434/v1", false)).rejects.toMatchObject({
      name: "LlmError",
      code: "ssrf",
    });
    await expect(assertLlmEndpoint("http://192.168.1.10:8000/v1", false)).rejects.toMatchObject({ code: "ssrf" });
  });

  it("显式放行后才允许私网（本地 Ollama）", async () => {
    await expect(assertLlmEndpoint("http://127.0.0.1:11434/v1", true)).resolves.toBeUndefined();
  });

  it("非 http/https 协议按配置错误拒绝", async () => {
    await expect(assertLlmEndpoint("file:///etc/passwd", true)).rejects.toMatchObject({ code: "config" });
  });
});

describe("网关：chatCompletion", () => {
  it("发送标准 OpenAI 兼容请求并解析内容与 usage", async () => {
    const { calls, fetchImpl } = captureFetch(() => jsonResponse(okBody("你好")));
    const res = await chatCompletion(provider(), {
      messages: [{ role: "user", content: "hi" }],
      json: true,
      fetchImpl,
    });

    expect(res.content).toBe("你好");
    expect(res.model).toBe("test-model");
    expect(res.usage).toEqual({ promptTokens: 3, completionTokens: 2, totalTokens: 5 });
    expect(res.jsonModeUsed).toBe("response_format");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(BASE + "/chat/completions");
    expect(calls[0].auth).toBe("Bearer sk-test-1234567890");
    expect(calls[0].body.model).toBe("test-model");
    expect(calls[0].body.stream).toBe(false);
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
  });

  it("响应 content 为内容块数组时拼接文本", async () => {
    const { fetchImpl } = captureFetch(() =>
      jsonResponse({
        choices: [{ message: { content: [{ type: "text", text: "甲" }, { type: "text", text: "乙" }] } }],
      }),
    );
    const res = await chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], fetchImpl });
    expect(res.content).toBe("甲乙");
  });

  it("jsonMode=prompt 时从不携带 response_format", async () => {
    const { calls, fetchImpl } = captureFetch(() => jsonResponse(okBody('{"ok":true}')));
    const res = await chatCompletion(provider({ jsonMode: "prompt" }), {
      messages: [{ role: "user", content: "hi" }],
      json: true,
      fetchImpl,
    });
    expect(calls[0].body.response_format).toBeUndefined();
    expect(res.jsonModeUsed).toBe("prompt");
  });

  it("400 且错误指向 response_format 时自动去参重试，并记住该端点不支持", async () => {
    resetLlmCapabilityCache();
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      bodies.push(body);
      if (bodies.length === 1) {
        return jsonResponse({ error: { message: "unknown field: response_format" } }, 400);
      }
      return jsonResponse(okBody('{"ok":true}'));
    };

    const first = await chatCompletion(provider(), {
      messages: [{ role: "user", content: "hi" }],
      json: true,
      fetchImpl,
    });
    expect(first.jsonModeUsed).toBe("prompt");
    expect(bodies).toHaveLength(2);
    expect(bodies[0].response_format).toBeDefined();
    expect(bodies[1].response_format).toBeUndefined();

    // 能力记忆：后续调用直接走提示词约束，不再先撞一次 400
    const second = await chatCompletion(provider(), {
      messages: [{ role: "user", content: "again" }],
      json: true,
      fetchImpl,
    });
    expect(second.jsonModeUsed).toBe("prompt");
    expect(bodies).toHaveLength(3);
    expect(bodies[2].response_format).toBeUndefined();
  });

  it("400 但错误与 response_format 无关时不重试", async () => {
    resetLlmCapabilityCache();
    let count = 0;
    const fetchImpl: typeof fetch = async () => {
      count++;
      return jsonResponse({ error: { message: "model not found" } }, 400);
    };
    await expect(
      chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], json: true, fetchImpl }),
    ).rejects.toMatchObject({ code: "http", status: 400 });
    expect(count).toBe(1);
  });

  it("401 → auth，429 → rate_limit", async () => {
    const unauthorized: typeof fetch = async () => jsonResponse({ error: "bad key" }, 401);
    await expect(
      chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], fetchImpl: unauthorized }),
    ).rejects.toMatchObject({ code: "auth", status: 401 });

    const limited: typeof fetch = async () => jsonResponse({ error: "slow down" }, 429);
    await expect(
      chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], fetchImpl: limited }),
    ).rejects.toMatchObject({ code: "rate_limit", status: 429 });
  });

  it("超时归为 timeout（不把 AbortError 原样抛出）", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });

    await expect(
      chatCompletion(provider({ timeoutMs: 30 }), {
        messages: [{ role: "user", content: "hi" }],
        fetchImpl: hanging,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("缺少 content 视为 invalid_response", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse({ choices: [{ message: {} }] }));
    await expect(
      chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], fetchImpl }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("上游把取消当正常回答返回 ⇒ cancelled，不把「用户已取消」当模型内容", async () => {
    const { fetchImpl } = captureFetch(() =>
      jsonResponse({ choices: [{ message: { content: "用户已取消" } }] }),
    );
    await expect(
      chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], fetchImpl }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("长回答里提到「用户已取消」不算取消（只认整段相等）", async () => {
    const text = "用户已取消后，恢复任务会停在分片边界，不会继续写入。";
    const { fetchImpl } = captureFetch(() => jsonResponse({ choices: [{ message: { content: text } }] }));
    const res = await chatCompletion(provider(), {
      messages: [{ role: "user", content: "hi" }],
      fetchImpl,
    });
    expect(res.content).toBe(text);
  });
});

describe("网关：流式解析", () => {
  function sseResponse(chunks: string[], status = 200): Response {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      { status, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  async function collect(gen: AsyncGenerator<LlmStreamEvent, void, unknown>) {
    const events: LlmStreamEvent[] = [];
    for await (const event of gen) events.push(event);
    return events;
  }

  it("extractSseDelta 只认 data 行，忽略 [DONE] 与坏 JSON", () => {
    expect(extractSseDelta('data: {"choices":[{"delta":{"content":"你"}}]}')).toBe("你");
    expect(extractSseDelta("data: [DONE]")).toBeNull();
    expect(extractSseDelta("event: ping")).toBeNull();
    expect(extractSseDelta("data: {oops")).toBeNull();
  });

  it("chatStream 逐段产出正文，并在末尾带上模型名与真实用量", async () => {
    const sse =
      'data: {"model":"stream-model","choices":[{"delta":{"content":"你"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}\n\n' +
      "data: [DONE]\n\n";
    const { calls, fetchImpl } = captureFetch(() => sseResponse([sse]));

    const events = await collect(chatStream(provider(), { messages: [{ role: "user", content: "hi" }], fetchImpl }));

    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("你好");
    expect(events.at(-1)).toEqual({
      type: "end",
      model: "stream-model",
      usage: { promptTokens: 7, completionTokens: 2, totalTokens: 9 },
      thinkingApplied: false,
    });
    expect(calls[0].body.stream).toBe(true);
    // 拿真实用量：请求必须显式要求 include_usage（OpenAI 兼容口径）
    expect(calls[0].body.stream_options).toEqual({ include_usage: true });
  });

  it("stream_options 被端点拒收时去参重试一次，并记住不再带（用量记 0 也不让流失败）", async () => {
    const { calls, fetchImpl } = captureFetch((call) =>
      call === 1
        ? jsonResponse({ error: { message: "Unsupported parameter: stream_options" } }, 400)
        : sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n']),
    );
    const strict = provider({ model: "stream-usage-strict" });

    const events = await collect(chatStream(strict, { messages: [{ role: "user", content: "hi" }], fetchImpl }));
    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(calls[0].body.stream_options).toEqual({ include_usage: true });
    expect(calls[1].body.stream_options).toBeUndefined();

    // 能力记忆生效：下一次直接不带，不再白撞一次 400
    await collect(chatStream(strict, { messages: [{ role: "user", content: "hi" }], fetchImpl }));
    expect(calls).toHaveLength(3);
    expect(calls[2].body.stream_options).toBeUndefined();
  });

  it("能力记忆按 baseUrl|model 隔离：A 端点拒收不代表 B 端点也拒收", async () => {
    const calls: Array<{ model: string; stream_options?: unknown }> = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { model: string; stream_options?: unknown };
      calls.push(body);
      if (body.model === "iso-a" && body.stream_options) {
        return jsonResponse({ error: { message: "Unsupported parameter: stream_options" } }, 400);
      }
      return sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n']);
    }) as unknown as typeof fetch;

    const a = { ...provider({ model: "iso-a" }) };
    const b = { ...provider({ model: "iso-b" }), baseUrl: "http://203.0.113.9/v1" };

    await collect(chatStream(a, { messages: [{ role: "user", content: "hi" }], fetchImpl }));
    await collect(chatStream(a, { messages: [{ role: "user", content: "hi" }], fetchImpl }));
    expect(calls[0].stream_options).toEqual({ include_usage: true });
    // 第一次 400 后去参重试（calls[1]），第二次请求直接不带（calls[2]）
    expect(calls[1].stream_options).toBeUndefined();
    expect(calls[2].stream_options).toBeUndefined();

    // 另一个端点不受 A 的记忆影响：仍然先尝试要 usage
    await collect(chatStream(b, { messages: [{ role: "user", content: "hi" }], fetchImpl }));
    expect(calls[3].stream_options).toEqual({ include_usage: true });
  });

  it("reasoning_content 进入独立事件，bug 不混进正文", async () => {
    const sse =
      'data: {"choices":[{"delta":{"reasoning_content":"先想"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"答案"}}]}\n\n' +
      "data: [DONE]\n\n";
    const { fetchImpl } = captureFetch(() => sseResponse([sse]));

    const events = await collect(chatStream(provider(), { messages: [{ role: "user", content: "hi" }], fetchImpl }));
    expect(events.filter((e) => e.type === "reasoning").map((e) => (e as { text: string }).text).join("")).toBe("先想");
    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("答案");
  });

  it("内联 <think> 标签被切在两个分块里也不漏进正文", async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"<thi"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"nk>暗中推理</thi"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"nk>最终答案"}}]}\n\n' +
      "data: [DONE]\n\n";
    const { fetchImpl } = captureFetch(() => sseResponse([sse]));

    const events = await collect(chatStream(provider(), { messages: [{ role: "user", content: "hi" }], fetchImpl }));
    expect(events.filter((e) => e.type === "reasoning").map((e) => (e as { text: string }).text).join("")).toBe("暗中推理");
    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("最终答案");
  });
});

describe("网关：总预算（deadlineAt）", () => {
  it("预算已耗尽时连请求都不发，直接按超时失败", async () => {
    const { calls, fetchImpl } = captureFetch(() => jsonResponse(okBody("不该被调用")));
    await expect(
      chatCompletion(provider(), {
        messages: [{ role: "user", content: "hi" }],
        deadlineAt: Date.now() - 1,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(calls).toHaveLength(0);
  });

  it("单请求超时被钳进剩余预算（provider 30s，预算 80ms）", async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (signal?.aborted) fail();
        else signal?.addEventListener("abort", fail, { once: true });
      });
    const startedAt = Date.now();
    await expect(
      chatCompletion(provider({ timeoutMs: 30_000 }), {
        messages: [{ role: "user", content: "hi" }],
        deadlineAt: startedAt + 80,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });

  it("chatStream 同样受总预算约束", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("不应发起流式请求");
    };
    const gen = chatStream(provider(), {
      messages: [{ role: "user", content: "hi" }],
      deadlineAt: Date.now() - 1,
      fetchImpl,
    });
    await expect(gen.next()).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("网关：错误类型", () => {
  it("LlmError 携带 code/status/detail", () => {
    const err = new LlmError("http", "boom", 500, "upstream");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("http");
    expect(err.status).toBe(500);
    expect(err.detail).toBe("upstream");
    // 没下发等待建议时保持 undefined，不能用 0 冒充「服务端说可以立刻重试」
    expect(err.retryAfterMs).toBeUndefined();
  });
});

describe("网关：Retry-After 解析", () => {
  const NOW = Date.parse("2026-10-30T04:00:00.000Z");
  const H = (init: Record<string, string>) => new Headers(init);

  it("retry-after 的秒数形态（整数 / 0 / 小数）", () => {
    expect(parseRetryAfterMs(H({ "retry-after": "30" }), NOW)).toBe(30_000);
    expect(parseRetryAfterMs(H({ "retry-after": "0" }), NOW)).toBe(0);
    expect(parseRetryAfterMs(H({ "retry-after": "2.5" }), NOW)).toBe(2_500);
    expect(parseRetryAfterMs(H({ "retry-after": " 12 " }), NOW)).toBe(12_000);
  });

  it("retry-after-ms 给毫秒粒度且优先于 retry-after（网关两者同时下发的既有口径）", () => {
    expect(parseRetryAfterMs(H({ "retry-after-ms": "2000", "retry-after": "30" }), NOW)).toBe(2_000);
    // 毫秒头是脏值时退回秒头，而不是直接判定「没有建议」
    expect(parseRetryAfterMs(H({ "retry-after-ms": "abc", "retry-after": "10" }), NOW)).toBe(10_000);
  });

  it("HTTP 日期按绝对时间点折算；已经过去的时间点折算为 0", () => {
    expect(parseRetryAfterMs(H({ "retry-after": new Date(NOW + 45_000).toUTCString() }), NOW)).toBe(45_000);
    expect(parseRetryAfterMs(H({ "retry-after": new Date(NOW - 60_000).toUTCString() }), NOW)).toBe(0);
  });

  it("脏值一律 undefined：缺失、空、负数、科学计数法、超过 3 天", () => {
    expect(parseRetryAfterMs(H({}), NOW)).toBeUndefined();
    for (const v of ["", "   ", "-5", "abc", "1e9", "not-a-date", "300000", "259201"]) {
      expect(parseRetryAfterMs(H({ "retry-after": v }), NOW)).toBeUndefined();
    }
    // 3 天整仍在界限内（判据是「超过」而不是「达到」）
    expect(parseRetryAfterMs(H({ "retry-after": "259200" }), NOW)).toBe(259_200_000);
  });

  it("非 IMF-fixdate 形态的日期不端给 Date.parse（V8 会把 -5 也解析成年份）", () => {
    // 同样超 3 天的 HTTP-date 与超 3 天的秒数同口径：按脏数据处理
    expect(parseRetryAfterMs(H({ "retry-after": new Date(NOW + 4 * 86_400_000).toUTCString() }), NOW)).toBeUndefined();
    expect(parseRetryAfterMs(H({ "retry-after": "Wednesday, 30-Oct-26 04:00:45 GMT" }), NOW)).toBeUndefined();
  });

  it("429 把等待建议挂在 LlmError 上（备用池轮换的等待判据来源）", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "slow down" }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "20" },
      });
    const err = await chatCompletion(provider(), {
      messages: [{ role: "user", content: "hi" }],
      fetchImpl,
    }).catch((e) => e as LlmError);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.code).toBe("rate_limit");
    expect(err.retryAfterMs).toBe(20_000);
  });

  it("503 带等待建议；401 即便下发该头也不带（不可重试的状态码不该诱导等待）", async () => {
    const gated: typeof fetch = async () =>
      new Response("{}", { status: 503, headers: { "retry-after": "7" } });
    const blocked = await chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], fetchImpl: gated }).catch(
      (e) => e as LlmError,
    );
    expect(blocked.retryAfterMs).toBe(7_000);

    const unauthorized: typeof fetch = async () =>
      new Response("{}", { status: 401, headers: { "retry-after": "99" } });
    const auth = await chatCompletion(provider(), {
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: unauthorized,
    }).catch((e) => e as LlmError);
    expect(auth.code).toBe("auth");
    expect(auth.retryAfterMs).toBeUndefined();
  });

  it("流式分支同口径：429 的 retry-after 也挂在抛出的 LlmError 上", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "slow down" }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after-ms": "1500" },
      });
    const gen = chatStream(provider(), { messages: [{ role: "user", content: "hi" }], fetchImpl });
    const err = await gen
      .next()
      .then(() => null)
      .catch((e) => e as LlmError);
    expect(err).not.toBeNull();
    expect(err?.code).toBe("rate_limit");
    expect(err?.retryAfterMs).toBe(1_500);
  });
});
