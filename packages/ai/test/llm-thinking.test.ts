import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletion, resetLlmCapabilityCache, type LlmProvider } from "../src/llm.ts";
import { enrichUrl } from "../src/enrich.ts";

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

function okBody(content: string) {
  return {
    model: "test-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetLlmCapabilityCache();
});

describe("富化：深度思考必须真的下发（不是只记在用量里）", () => {
  /** 捕获 LLM 请求体；页面抓取一律回一段最小 HTML */
  function stubNetwork() {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/chat/completions")) {
          bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
          return jsonResponse(
            okBody('{"title":"示例站点","description":"一个用于回归测试的站点描述。","tags":["测试"],"keywords":["test"],"category":"工具"}'),
          );
        }
        return new Response("<html><head><title>示例站点</title></head><body>hi</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      },
    );
    return bodies;
  }

  it("llm.thinking=true 时请求体带 thinking 与 chat_template_kwargs", async () => {
    const bodies = stubNetwork();
    await enrichUrl("http://127.0.0.1:9/", {
      llm: { baseUrl: BASE, apiKey: "sk-test-1234567890", model: "test-model", timeoutMs: 800, allowPrivateNetwork: true, thinking: true },
    });
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies[0]!.thinking).toMatchObject({ type: "enabled" });
    expect(bodies[0]!.chat_template_kwargs).toEqual({ enable_thinking: true });
  });

  it("llm.thinking=false 时这两个字段都不出现（开关不是摆设）", async () => {
    const bodies = stubNetwork();
    await enrichUrl("http://127.0.0.1:9/", {
      llm: { baseUrl: BASE, apiKey: "sk-test-1234567890", model: "test-model", timeoutMs: 800, allowPrivateNetwork: true, thinking: false },
    });
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies[0]!.thinking).toBeUndefined();
    expect(bodies[0]!.chat_template_kwargs).toBeUndefined();
  });
});

describe("网关：不支持 response_format 的判定不能误伤别的字段", () => {
  it("400 只点名 thinking 时必须照实抛错，且不许把端点记成「不支持 JSON 模式」", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      if (calls === 1) {
        return jsonResponse({ error: { message: "Unrecognized field: thinking" } }, 400);
      }
      return jsonResponse(okBody("你好"));
    };

    await expect(
      chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], json: true, fetchImpl }),
    ).rejects.toMatchObject({ code: "http", status: 400 });

    // 关键：误判会让 jsonModeUnsupported 在**整个进程**里记住这个 baseUrl|model，
    // 之后所有调用静默丢掉 response_format（只有测试专用的 reset 能清）。
    const second: Record<string, unknown>[] = [];
    const secondFetch: typeof fetch = async (_input, init) => {
      second.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return jsonResponse(okBody("你好"));
    };
    await chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], json: true, fetchImpl: secondFetch });
    expect(second[0]!.response_format).toEqual({ type: "json_object" });
  });

  it("400 点名 response_format 时才降级去参重试", async () => {
    const bodies: Record<string, unknown>[] = [];
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls++;
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      if (calls === 1) {
        return jsonResponse({ error: { message: 'Invalid request: extra field "response_format" not permitted' } }, 400);
      }
      return jsonResponse(okBody("你好"));
    };
    const res = await chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], json: true, fetchImpl });
    expect(res.content).toBe("你好");
    expect(bodies[0]!.response_format).toBeDefined();
    expect(bodies[1]!.response_format).toBeUndefined();
  });
});

describe("网关：端点拒收思维链参数时去参重试", () => {
  /** 深度思考是产品默认开的：严格的兼容网关把未知字段判 400，
   *  不去参就等于全站 AI 一起挂，而且报错只写「模型返回 HTTP 400」。 */
  function stubThinkingRejection(message: string) {
    const bodies: Record<string, unknown>[] = [];
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls++;
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      if (calls === 1) return jsonResponse({ error: { message } }, 400);
      return jsonResponse(okBody("你好"));
    };
    return { bodies, fetchImpl };
  }

  it("400 点名 chat_template_kwargs 时去掉两个字段重试并成功", async () => {
    const { bodies, fetchImpl } = stubThinkingRejection("Unexpected key: chat_template_kwargs");
    const res = await chatCompletion(provider(), {
      messages: [{ role: "user", content: "hi" }],
      thinking: true,
      fetchImpl,
    });
    expect(res.content).toBe("你好");
    expect(bodies[0]!.thinking).toMatchObject({ type: "enabled" });
    expect(bodies[0]!.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(bodies[1]!.thinking).toBeUndefined();
    expect(bodies[1]!.chat_template_kwargs).toBeUndefined();
    // 用量记账要按「实际下发」而不是「请求了」
    expect(res.thinkingApplied).toBe(false);
  });

  it("400 用「Unrecognized field: thinking」这类措辞时同样能判定", async () => {
    const { bodies, fetchImpl } = stubThinkingRejection("Unrecognized field: thinking");
    const res = await chatCompletion(provider(), {
      messages: [{ role: "user", content: "hi" }],
      thinking: true,
      fetchImpl,
    });
    expect(res.content).toBe("你好");
    expect(bodies.length).toBe(2);
    expect(bodies[1]!.thinking).toBeUndefined();
  });

  it("记住该端点不支持后，后续调用直接不带思维链（不再白撞一次 400）", async () => {
    const first = stubThinkingRejection('Extra fields not allowed: "thinking"');
    await chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], thinking: true, fetchImpl: first.fetchImpl });
    expect(first.bodies.length).toBe(2);

    const later: Record<string, unknown>[] = [];
    const secondFetch: typeof fetch = async (_input, init) => {
      later.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return jsonResponse(okBody("你好"));
    };
    const res = await chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], thinking: true, fetchImpl: secondFetch });
    expect(later.length).toBe(1);
    expect(later[0]!.thinking).toBeUndefined();
    expect(res.thinkingApplied).toBe(false);
  });

  it("去参重试仍然失败时抛原始错误，不把端点记成「不支持思维链」", async () => {
    // 这条守住的是误判代价：400 提到 thinking 但真正原因是别的（这里连去参后也 400），
    // 一旦写脏记忆，进程内后续所有调用都再也拿不到推理过程。
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      return jsonResponse({ error: { message: 'Extra fields not allowed: "thinking"' } }, 400);
    };
    await expect(
      chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], thinking: true, fetchImpl }),
    ).rejects.toMatchObject({ code: "http", status: 400 });
    expect(calls).toBe(2);

    const after: Record<string, unknown>[] = [];
    const secondFetch: typeof fetch = async (_input, init) => {
      after.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return jsonResponse(okBody("你好"));
    };
    const res = await chatCompletion(provider(), {
      messages: [{ role: "user", content: "hi" }],
      thinking: true,
      fetchImpl: secondFetch,
    });
    expect(after[0]!.thinking).toMatchObject({ type: "enabled" });
    expect(res.thinkingApplied).toBe(true);
  });

  it("400 与思维链字段无关时照实抛错，且不污染能力记忆", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return jsonResponse({ error: { message: "temperature must be a number between 0 and 2" } }, 400);
    };
    await expect(
      chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], thinking: true, fetchImpl }),
    ).rejects.toMatchObject({ code: "http", status: 400 });
    expect(bodies.length).toBe(1);

    // 误判后果是进程级的：一旦记成「不支持」，全站再也拿不到推理过程
    const after: Record<string, unknown>[] = [];
    const secondFetch: typeof fetch = async (_input, init) => {
      after.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return jsonResponse(okBody("你好"));
    };
    const res = await chatCompletion(provider(), { messages: [{ role: "user", content: "hi" }], thinking: true, fetchImpl: secondFetch });
    expect(after[0]!.thinking).toMatchObject({ type: "enabled" });
    expect(res.thinkingApplied).toBe(true);
  });

  it("去参重试不许顺手把 JSON 模式也丢掉（两个能力位互相独立）", async () => {
    const bodies: Record<string, unknown>[] = [];
    let calls = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      calls++;
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      if (calls === 1) return jsonResponse({ error: { message: "Unknown parameter: thinking" } }, 400);
      return jsonResponse(okBody("你好"));
    };
    const res = await chatCompletion(provider(), {
      messages: [{ role: "user", content: "hi" }],
      json: true,
      thinking: true,
      fetchImpl,
    });
    expect(res.content).toBe("你好");
    expect(bodies[0]!.response_format).toEqual({ type: "json_object" });
    // 第二次只是摘掉思维链字段，response_format 必须还在
    expect(bodies[1]!.response_format).toEqual({ type: "json_object" });
    expect(bodies[1]!.thinking).toBeUndefined();
    expect(res.jsonModeUsed).toBe("response_format");
  });
});
