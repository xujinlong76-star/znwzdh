import { describe, expect, it, vi } from "vitest";
import {
  MAX_LLM_ERROR_RESPONSE_BYTES,
  MAX_LLM_JSON_RESPONSE_BYTES,
  MAX_LLM_STREAM_RESPONSE_BYTES,
  LlmError,
  chatCompletion,
  chatStream,
  createVideoTask,
  generateImage,
  pollVideoTask,
  type LlmProvider,
  type LlmStreamEvent,
} from "../src/llm.ts";

const provider: LlmProvider = {
  baseUrl: "http://127.0.0.1:9/v1",
  model: "limit-test",
  apiKey: "test-key",
  allowPrivateNetwork: true,
  timeoutMs: 2000,
};

function responseFromChunks(chunks: Uint8Array[], status = 200, onCancel = vi.fn()): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      // 故意不自动 close：超限路径必须能观测到底层流被 cancel，而不是“恰好已读完”。
      if (index < chunks.length) controller.enqueue(chunks[index++]!);
    },
    cancel: onCancel,
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

describe("LLM 响应硬字节上限", () => {
  it("普通 JSON 超限时中止读取并返回 response_too_large", async () => {
    const cancel = vi.fn();
    const response = responseFromChunks([new Uint8Array(MAX_LLM_JSON_RESPONSE_BYTES + 1)], 200, cancel);
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;

    const err = await chatCompletion(provider, {
      messages: [{ role: "user", content: "hi" }],
      fetchImpl,
    }).catch((error: unknown) => error);

    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ code: "response_too_large", status: 200 });
    expect((err as Error).message).toContain(String(MAX_LLM_JSON_RESPONSE_BYTES));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("错误体超限时不吞成普通 HTTP 错误，也不触发能力去参重试", async () => {
    const cancel = vi.fn();
    const response = responseFromChunks(
      [new TextEncoder().encode("x".repeat(MAX_LLM_ERROR_RESPONSE_BYTES + 1))],
      400,
      cancel,
    );
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;

    const err = await chatCompletion(provider, {
      messages: [{ role: "user", content: "hi" }],
      json: true,
      fetchImpl,
    }).catch((error: unknown) => error);

    expect(err).toMatchObject({ code: "response_too_large", status: 400 });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("SSE 累计字节超限时取消流，不产出 end 事件", async () => {
    const cancel = vi.fn();
    const chunk = new TextEncoder().encode(`data: {"choices":[{"delta":{"content":"${"x".repeat(1024)}"}}]}\n\n`);
    const chunks = Array.from({ length: Math.ceil(MAX_LLM_STREAM_RESPONSE_BYTES / chunk.byteLength) + 1 }, () => chunk);
    const response = responseFromChunks(chunks, 200, cancel);
    const fetchImpl = vi.fn(async () => response) as unknown as typeof fetch;
    const events: LlmStreamEvent[] = [];

    const gen = chatStream(provider, {
      messages: [{ role: "user", content: "hi" }],
      fetchImpl,
    });
    const err = await (async () => {
      try {
        for await (const event of gen) events.push(event);
        return null;
      } catch (error: unknown) {
        return error;
      }
    })();

    expect(err).toMatchObject({ code: "response_too_large" });
    expect((err as Error).message).toContain(String(MAX_LLM_STREAM_RESPONSE_BYTES));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === "end")).toBe(false);
  });

  it("媒体 JSON 与视频 503 错误体同样受硬上限约束", async () => {
    const jsonFetch = vi.fn(async () =>
      new Response("x".repeat(MAX_LLM_JSON_RESPONSE_BYTES + 1), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(generateImage({
      prompt: "x",
      apiKey: "k",
      baseUrl: "https://api.example.com/v1",
      model: "image-model",
      fetchImpl: jsonFetch,
    })).rejects.toMatchObject({ code: "response_too_large" });

    const errorFetch = vi.fn(async () =>
      new Response("x".repeat(MAX_LLM_ERROR_RESPONSE_BYTES + 1), { status: 503 }),
    ) as unknown as typeof fetch;
    await expect(createVideoTask({
      prompt: "x",
      apiKey: "k",
      baseUrl: "https://api.example.com/v1",
      model: "video-model",
      fetchImpl: errorFetch,
    })).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("视频轮询超限不能降级成 processing 后无限轮询", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("x".repeat(MAX_LLM_JSON_RESPONSE_BYTES + 1), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(pollVideoTask({
      taskId: "task-1",
      apiKey: "k",
      baseUrl: "https://media.example.com/poll",
      model: "video-model",
      fetchImpl,
    })).rejects.toMatchObject({ code: "response_too_large" });
  });
});
