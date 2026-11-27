/**
 * LLM 多媒体端点覆盖：generateImage / createVideoTask / pollVideoTask。
 *
 * llm.ts 的图像/视频生成函数此前没有任何测试（970-1275 行全部未覆盖）：
 * 多密钥轮询、503 队列满、taskId 多形态解析、超时/网络失败分支
 * 都没有回归保护。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createVideoTask as createVideoTaskImpl,
  generateImage as generateImageImpl,
  LlmError,
  pollVideoTask as pollVideoTaskImpl,
} from "../src/llm.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(status: number, text: string): Response {
  return new Response(text, { status });
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

/** 构造按调用顺序返回固定响应的 fetchImpl，并记录每次调用 */
function sequencedFetch(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next as Response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

/** 媒体调用的显式端点/模型：2026-11-18 起不再有任何内置厂商默认，调用方必须显式传 */
const MEDIA_BASE = "http://127.0.0.1:9/v1";
const IMG_MODEL = "img-model";
const VID_MODEL = "vid-model";
const POLL_BASE = "http://127.0.0.1:9/poll";

function generateImage(options: Parameters<typeof generateImageImpl>[0]) {
  return generateImageImpl({ ...options, allowPrivateNetwork: true });
}

function createVideoTask(options: Parameters<typeof createVideoTaskImpl>[0]) {
  return createVideoTaskImpl({ ...options, allowPrivateNetwork: true });
}

function pollVideoTask(options: Parameters<typeof pollVideoTaskImpl>[0]) {
  return pollVideoTaskImpl({ ...options, allowPrivateNetwork: true });
}

describe("generateImage", () => {
  it("未配置密钥时报 config 错，不发起请求", async () => {
    const { fetchImpl } = sequencedFetch([]);
    await expect(generateImage({ prompt: "a cat", apiKey: "" })).rejects.toMatchObject({
      code: "config",
    });
    await expect(generateImage({ prompt: "a cat", fetchImpl })).rejects.toMatchObject({
      code: "config",
    });
  });

  it("未配置地址/模型时报 config 错，不发起请求", async () => {
    // 2026-11-18 起 Agnes 已彻底移除：缺 baseUrl 或 model 必须明说，不许静默指向某个厂商
    const { fetchImpl } = sequencedFetch([]);
    await expect(generateImage({ prompt: "a cat", apiKey: "k1", fetchImpl })).rejects.toMatchObject({
      code: "config",
    });
    await expect(
      generateImage({ prompt: "a cat", apiKey: "k1", baseUrl: MEDIA_BASE, fetchImpl }),
    ).rejects.toMatchObject({ code: "config" });
    await expect(
      generateImage({ prompt: "a cat", apiKey: "k1", model: IMG_MODEL, fetchImpl }),
    ).rejects.toMatchObject({ code: "config" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("成功：POST 到 /images/generations，透传模型/尺寸/数量，解析 url/revised_prompt/task_id", async () => {
    const { fetchImpl, calls } = sequencedFetch([
      jsonResponse(200, {
        data: [{ url: "https://img.example.com/1.png", revised_prompt: "a cute cat" }],
        task_id: "task-1",
      }),
    ]);
    const res = await generateImage({
      prompt: "a cat",
      apiKey: "k1",
      baseUrl: "http://127.0.0.1:9/v1/",
      model: "img-model",
      size: "512x512",
      n: 2,
      fetchImpl,
    });
    expect(res).toEqual({
      url: "https://img.example.com/1.png",
      revisedPrompt: "a cute cat",
      model: "img-model",
      taskId: "task-1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:9/v1/images/generations");
    expect(calls[0]!.init?.method).toBe("POST");
    expect((calls[0]!.init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer k1");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      model: "img-model",
      prompt: "a cat",
      size: "512x512",
      n: 2,
    });
  });

  it("baseUrl 已是 /images/generations 时不重复拼接；默认尺寸/数量", async () => {
    const { fetchImpl, calls } = sequencedFetch([
      jsonResponse(200, { data: [{ url: "https://img.example.com/2.png" }] }),
    ]);
    const res = await generateImage({
      prompt: "x",
      apiKey: "k1",
      baseUrl: "http://127.0.0.1:9/v1/images/generations",
      model: IMG_MODEL,
      fetchImpl,
    });
    expect(res.model).toBe(IMG_MODEL);
    expect(res.revisedPrompt).toBeUndefined();
    expect(res.taskId).toBeUndefined();
    expect(calls[0]!.url).toBe("http://127.0.0.1:9/v1/images/generations");
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({
      size: "1024x1024",
      n: 1,
    });
  });

  it("未返回有效图片地址时报 invalid_response", async () => {
    const { fetchImpl } = sequencedFetch([jsonResponse(200, { data: [] })]);
    await expect(
      generateImage({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, model: IMG_MODEL, fetchImpl }),
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
    const { fetchImpl: f2 } = sequencedFetch([jsonResponse(200, { data: [{ url: 123 }] })]);
    await expect(
      generateImage({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, model: IMG_MODEL, fetchImpl: f2 }),
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("HTTP 状态映射：401→auth、429→rate_limit、500→http、400→invalid_response", async () => {
    const cases: Array<[number, string]> = [
      [401, "auth"],
      [403, "auth"],
      [429, "rate_limit"],
      [500, "http"],
      [400, "invalid_response"],
    ];
    for (const [status, code] of cases) {
      const { fetchImpl } = sequencedFetch([jsonResponse(status, { error: { message: "boom" } })]);
      const err = await generateImage({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, model: IMG_MODEL, fetchImpl }).catch((e) => e);
      expect(err).toBeInstanceOf(LlmError);
      expect(err.code).toBe(code);
      expect(err.status).toBe(status);
    }
  });

  it("网络异常→network；AbortError→timeout", async () => {
    const { fetchImpl } = sequencedFetch([new Error("ECONNRESET")]);
    await expect(
      generateImage({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, model: IMG_MODEL, fetchImpl }),
    ).rejects.toMatchObject({
      code: "network",
    });
    const { fetchImpl: f2 } = sequencedFetch([abortError()]);
    await expect(
      generateImage({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, model: IMG_MODEL, fetchImpl: f2, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("可恢复错误自动换下一个 Key 重试；不可恢复错误立即抛出不再试", async () => {
    const { fetchImpl, calls } = sequencedFetch([
      jsonResponse(429, { error: { message: "slow down" } }),
      jsonResponse(200, { data: [{ url: "https://img.example.com/3.png" }] }),
    ]);
    const res = await generateImage({ prompt: "x", apiKey: "bad-key,good-key", baseUrl: MEDIA_BASE, model: IMG_MODEL, fetchImpl });
    expect(res.url).toBe("https://img.example.com/3.png");
    expect(calls).toHaveLength(2);
    const auths = calls.map((c) => (c.init?.headers as Record<string, string>)["Authorization"]);
    expect(new Set(auths)).toEqual(new Set(["Bearer bad-key", "Bearer good-key"]));

    const { fetchImpl: f2, calls: calls2 } = sequencedFetch([
      jsonResponse(400, { error: { message: "bad prompt" } }),
      jsonResponse(200, { data: [{ url: "https://img.example.com/4.png" }] }),
    ]);
    await expect(
      generateImage({ prompt: "x", apiKey: "k1,k2", baseUrl: MEDIA_BASE, model: IMG_MODEL, fetchImpl: f2 }),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(calls2).toHaveLength(1);
  });

  it("全部 Key 都限流时抛出最后一个错误", async () => {
    const { fetchImpl } = sequencedFetch([
      jsonResponse(429, { error: { message: "slow" } }),
      jsonResponse(429, { error: { message: "slow" } }),
    ]);
    await expect(
      generateImage({ prompt: "x", apiKey: "k1,k2", baseUrl: MEDIA_BASE, model: IMG_MODEL, fetchImpl }),
    ).rejects.toMatchObject({ code: "rate_limit" });
  });
});

describe("createVideoTask", () => {
  it("未配置密钥时报 config 错", async () => {
    await expect(createVideoTask({ prompt: "a video" })).rejects.toMatchObject({ code: "config" });
  });

  it("未配置地址/模型时报 config 错，不发起请求", async () => {
    // 2026-11-18 起 Agnes 已彻底移除：缺 baseUrl 或 model 必须明说，不许静默指向某个厂商
    const { fetchImpl } = sequencedFetch([]);
    await expect(createVideoTask({ prompt: "x", apiKey: "k1", fetchImpl })).rejects.toMatchObject({
      code: "config",
    });
    await expect(
      createVideoTask({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, fetchImpl }),
    ).rejects.toMatchObject({ code: "config" });
    await expect(
      createVideoTask({ prompt: "x", apiKey: "k1", model: VID_MODEL, fetchImpl }),
    ).rejects.toMatchObject({ code: "config" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("直接返回 url 时判定 completed，taskId 取 data.task_id", async () => {
    const { fetchImpl, calls } = sequencedFetch([
      jsonResponse(200, { task_id: "t-1", url: "https://vid.example.com/1.mp4" }),
    ]);
    const res = await createVideoTask({
      prompt: "cat video",
      apiKey: "k1",
      baseUrl: "http://127.0.0.1:9/v1/",
      model: "vid-model",
      seconds: "10",
      mode: "keyframe",
      size: "720P",
      aspectRatio: "9:16",
      fetchImpl,
    });
    expect(res).toEqual({ ok: true, taskId: "t-1", status: "completed", url: "https://vid.example.com/1.mp4", model: "vid-model" });
    expect(calls[0]!.url).toBe("http://127.0.0.1:9/v1/videos");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      model: "vid-model",
      prompt: "cat video",
      seconds: "10",
      mode: "keyframe",
      size: "720P",
      aspect_ratio: "9:16",
    });
  });

  it("taskId 多形态解析：data.id / data.taskId / 嵌套 data.task_id / 嵌套 data.id", async () => {
    const variants: Array<[unknown, string]> = [
      [{ id: "a" }, "a"],
      [{ taskId: "b" }, "b"],
      [{ data: { task_id: "c" } }, "c"],
      [{ data: { id: "d" } }, "d"],
    ];
    for (const [body, want] of variants) {
      const { fetchImpl } = sequencedFetch([jsonResponse(200, body)]);
      const res = await createVideoTask({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, model: VID_MODEL, fetchImpl });
      expect(res).toEqual({ ok: true, taskId: want, status: "processing", model: VID_MODEL });
    }
  });

  it("嵌套 url 同样判定 completed；既无 url 又无 taskId 时报 invalid_response", async () => {
    const { fetchImpl } = sequencedFetch([jsonResponse(200, { data: { url: "https://v/1.mp4", id: "n1" } })]);
    await expect(
      createVideoTask({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, model: VID_MODEL, fetchImpl }),
    ).resolves.toMatchObject({
      ok: true,
      status: "completed",
      url: "https://v/1.mp4",
    });
    const { fetchImpl: f2 } = sequencedFetch([jsonResponse(200, { data: {} })]);
    await expect(
      createVideoTask({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, model: VID_MODEL, fetchImpl: f2 }),
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("503 队列满：JSON 体里的 message 被采用；非 JSON 体用默认文案", async () => {
    const { fetchImpl } = sequencedFetch([jsonResponse(503, { message: "排队人太多" })]);
    await expect(
      createVideoTask({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, model: VID_MODEL, fetchImpl }),
    ).resolves.toEqual({
      ok: false,
      status: "queue_full",
      message: "排队人太多",
      model: VID_MODEL,
    });
    const { fetchImpl: f2 } = sequencedFetch([textResponse(503, "Service Unavailable")]);
    await expect(
      createVideoTask({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, model: VID_MODEL, fetchImpl: f2 }),
    ).resolves.toMatchObject({
      status: "queue_full",
      message: "视频队列已满，请稍后重试",
    });
  });

  it("队列满时换下一个 Key；全部 Key 都满时返回兜底 queue_full", async () => {
    const { fetchImpl } = sequencedFetch([
      jsonResponse(503, { message: "满" }),
      jsonResponse(200, { task_id: "t-9" }),
    ]);
    await expect(
      createVideoTask({ prompt: "x", apiKey: "k1,k2", baseUrl: MEDIA_BASE, model: VID_MODEL, fetchImpl }),
    ).resolves.toMatchObject({
      ok: true,
      status: "processing",
      taskId: "t-9",
    });

    const { fetchImpl: f2 } = sequencedFetch([
      jsonResponse(503, {}),
      jsonResponse(503, {}),
    ]);
    await expect(
      createVideoTask({ prompt: "x", apiKey: "k1,k2", baseUrl: MEDIA_BASE, model: VID_MODEL, fetchImpl: f2 }),
    ).resolves.toEqual({
      ok: false,
      status: "queue_full",
      message: "视频队列已满，请稍后重试",
      model: VID_MODEL,
    });
  });

  it("HTTP 状态映射与网络/超时失败", async () => {
    const { fetchImpl } = sequencedFetch([jsonResponse(401, { error: { message: "no" } })]);
    await expect(
      createVideoTask({ prompt: "x", apiKey: "only-key", baseUrl: MEDIA_BASE, model: VID_MODEL, fetchImpl }),
    ).rejects.toMatchObject({
      code: "auth",
      status: 401,
    });
    const { fetchImpl: f2 } = sequencedFetch([new Error("dns fail")]);
    await expect(
      createVideoTask({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, model: VID_MODEL, fetchImpl: f2 }),
    ).rejects.toMatchObject({
      code: "network",
    });
    const { fetchImpl: f3 } = sequencedFetch([abortError()]);
    await expect(
      createVideoTask({ prompt: "x", apiKey: "k1", baseUrl: MEDIA_BASE, model: VID_MODEL, fetchImpl: f3, timeoutMs: 1000 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("baseUrl 已是 /videos 时不重复拼接", async () => {
    const { fetchImpl, calls } = sequencedFetch([jsonResponse(200, { task_id: "t" })]);
    await createVideoTask({ prompt: "x", apiKey: "k1", baseUrl: "http://127.0.0.1:9/v1/videos", model: VID_MODEL, fetchImpl });
    expect(calls[0]!.url).toBe("http://127.0.0.1:9/v1/videos");
  });
});

describe("pollVideoTask", () => {
  it("未配置轮询地址/模型时报 config 错，不发起请求", async () => {
    // 2026-11-18 起 Agnes 已彻底移除：此前硬编码的厂商轮询端点已删除，缺地址或模型必须明说
    const { fetchImpl } = sequencedFetch([]);
    await expect(pollVideoTask({ taskId: "t", apiKey: "k1", fetchImpl })).rejects.toMatchObject({
      code: "config",
    });
    await expect(
      pollVideoTask({ taskId: "t", apiKey: "k1", baseUrl: POLL_BASE, fetchImpl }),
    ).rejects.toMatchObject({ code: "config" });
    await expect(
      pollVideoTask({ taskId: "t", apiKey: "k1", model: VID_MODEL, fetchImpl }),
    ).rejects.toMatchObject({ code: "config" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("completed：status 字段或 url 任一命中即完成", async () => {
    const { fetchImpl, calls } = sequencedFetch([
      jsonResponse(200, { status: "completed", url: "https://v/9.mp4" }),
    ]);
    await expect(
      pollVideoTask({ taskId: "t-1", apiKey: "k1", baseUrl: POLL_BASE, model: VID_MODEL, fetchImpl }),
    ).resolves.toEqual({
      ok: true,
      status: "completed",
      url: "https://v/9.mp4",
    });
    expect(calls[0]!.url).toContain("video_id=t-1");
    expect(calls[0]!.url).toContain(`model_name=${VID_MODEL}`);
    expect(calls[0]!.url.startsWith(POLL_BASE)).toBe(true);
    expect(calls[0]!.init?.method).toBe("GET");

    // 只有 url、没有 status 时同样算完成（嵌套 data.url）
    const { fetchImpl: f2 } = sequencedFetch([jsonResponse(200, { data: { url: "https://v/10.mp4" } })]);
    await expect(
      pollVideoTask({ taskId: "t-2", baseUrl: POLL_BASE, model: VID_MODEL, fetchImpl: f2 }),
    ).resolves.toEqual({
      ok: true,
      status: "completed",
      url: "https://v/10.mp4",
    });
  });

  it("failed / error 状态返回失败与服务端 message；无 message 时用默认文案", async () => {
    const { fetchImpl } = sequencedFetch([jsonResponse(200, { status: "failed", message: "炸了" })]);
    await expect(
      pollVideoTask({ taskId: "t", baseUrl: POLL_BASE, model: VID_MODEL, fetchImpl }),
    ).resolves.toEqual({
      ok: false,
      status: "failed",
      message: "炸了",
    });
    const { fetchImpl: f2 } = sequencedFetch([jsonResponse(200, { status: "error" })]);
    await expect(
      pollVideoTask({ taskId: "t", baseUrl: POLL_BASE, model: VID_MODEL, fetchImpl: f2 }),
    ).resolves.toEqual({
      ok: false,
      status: "failed",
      message: "生成失败",
    });
  });

  it("其它状态返回 processing；非 2xx 返回 failed；网络异常降级为 processing", async () => {
    const { fetchImpl } = sequencedFetch([jsonResponse(200, { status: "processing" })]);
    await expect(
      pollVideoTask({ taskId: "t", baseUrl: POLL_BASE, model: VID_MODEL, fetchImpl }),
    ).resolves.toEqual({
      ok: true,
      status: "processing",
    });
    const { fetchImpl: f2 } = sequencedFetch([jsonResponse(500, {})]);
    await expect(
      pollVideoTask({ taskId: "t", baseUrl: POLL_BASE, model: VID_MODEL, fetchImpl: f2 }),
    ).resolves.toEqual({
      ok: false,
      status: "failed",
      message: "HTTP 500",
    });
    const { fetchImpl: f3 } = sequencedFetch([new Error("flaky")]);
    await expect(
      pollVideoTask({ taskId: "t", baseUrl: POLL_BASE, model: VID_MODEL, fetchImpl: f3 }),
    ).resolves.toMatchObject({
      ok: true,
      status: "processing",
      message: "flaky",
    });
  });
});
