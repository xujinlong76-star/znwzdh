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
  resetLlmCapabilityCache,
  type LlmProvider,
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
});

describe("网关：流式解析", () => {
  it("extractSseDelta 只认 data 行，忽略 [DONE] 与坏 JSON", () => {
    expect(extractSseDelta('data: {"choices":[{"delta":{"content":"你"}}]}')).toBe("你");
    expect(extractSseDelta("data: [DONE]")).toBeNull();
    expect(extractSseDelta("event: ping")).toBeNull();
    expect(extractSseDelta("data: {oops")).toBeNull();
  });

  it("chatStream 逐段产出增量文本", async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
      "data: [DONE]\n\n";
    const fetchImpl: typeof fetch = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sse));
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );

    const chunks: string[] = [];
    for await (const delta of chatStream(provider(), { messages: [{ role: "user", content: "hi" }], fetchImpl })) {
      chunks.push(delta);
    }
    expect(chunks.join("")).toBe("你好");
  });
});

describe("网关：错误类型", () => {
  it("LlmError 携带 code/status/detail", () => {
    const err = new LlmError("http", "boom", 500, "upstream");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("http");
    expect(err.status).toBe(500);
    expect(err.detail).toBe("upstream");
  });
});
