import { describe, expect, it } from "vitest";
import {
  chatCompletion,
  extractApiKeys,
  maskApiKey,
  type LlmProvider,
} from "../src/llm.ts";

const BASE = "http://127.0.0.1:9/v1";

function testProvider(over: Partial<LlmProvider> = {}): LlmProvider {
  return {
    baseUrl: BASE,
    model: "test-model",
    apiKey: "sk-key1,sk-key2,sk-key3",
    allowPrivateNetwork: true,
    timeoutMs: 1000,
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
    id: "chat-1",
    model: "test-model",
    choices: [{ message: { role: "assistant", content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

describe("Llm Multi-Key Pool & Failover", () => {
  it("extractApiKeys 正确解析单 Key 与多 Key 格式", () => {
    expect(extractApiKeys("")).toEqual([]);
    expect(extractApiKeys(null)).toEqual([]);
    expect(extractApiKeys("sk-one")).toEqual(["sk-one"]);
    expect(extractApiKeys("sk-one, sk-two,sk-three")).toEqual(["sk-one", "sk-two", "sk-three"]);
    expect(extractApiKeys("sk-one\nsk-two\nsk-three")).toEqual(["sk-one", "sk-two", "sk-three"]);
  });

  it("maskApiKey 支持多 Key 池掩码", () => {
    expect(maskApiKey("sk-1234567890")).toBe("sk-****7890");
    expect(maskApiKey("sk-1234567890, sk-abcdefghij")).toBe("sk-****7890 (+1 备用 Key)");
    expect(maskApiKey("sk-1234567890,sk-2,sk-3,sk-4")).toBe("sk-****7890 (+3 备用 Key)");
  });

  it("chatCompletion 在主 Key 遭遇 429 限流时自动无缝切换到备用 Key", async () => {
    const attemptedKeys: string[] = [];

    const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const auth = headers.Authorization || "";
      const currentKey = auth.replace("Bearer ", "");
      attemptedKeys.push(currentKey);

      if (currentKey === "sk-key1") {
        return jsonResponse({ error: { message: "Rate limit exceeded" } }, 429);
      }
      return jsonResponse(okBody("从备用 Key 成功响应！"));
    };

    const res = await chatCompletion(
      testProvider({ apiKey: "sk-key1,sk-key2" }),
      {
        messages: [{ role: "user", content: "ping" }],
        fetchImpl: mockFetch as typeof fetch,
      }
    );

    expect(res.content).toBe("从备用 Key 成功响应！");
    expect(attemptedKeys.length).toBeGreaterThanOrEqual(1);
  });
});
