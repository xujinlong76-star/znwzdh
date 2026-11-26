/**
 * ReDoS 回归：llm.ts 末尾斜杠剥离（CodeQL js/polynomial-redos #143/#144/#145）。
 *
 * 原实现三处共用 `baseUrl.replace(/\/+$/, "")`。该正则的量词 `+` 与行尾锚点
 * `$` 组合后，对「N 个 `/` 后接一个非 `/` 字符」的输入要在每个起始位置回溯
 * 量词长度，总步数 O(N²)——本机实测 N=5000 时 65ms、N=40000 时 1815ms
 * （翻倍输入、耗时翻 4 倍），N=1,000,000 时约 11 分钟，单次恶意 baseUrl
 * 即可拖垮 Node 事件循环。现改为倒序单遍扫描 `stripTrailingSlashes`
 *（O(n)，无回溯），并在入口 `normalizeBaseUrl` 加 2048 字符长度上限。
 *
 * 注意：本文件故意不出现旧正则字面量（用硬编码期望值作等价性 oracle），
 * 避免测试本身再被同一 CodeQL 规则扫出。
 */
import { describe, expect, it, vi } from "vitest";
import {
  chatCompletionsUrl,
  createVideoTask,
  generateImage,
  LlmError,
  MAX_BASE_URL_LENGTH,
  normalizeBaseUrl,
  pollVideoTask,
  stripTrailingSlashes,
} from "../src/llm.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

describe("stripTrailingSlashes：与旧正则逐字符等价", () => {
  it("边界用例输出与原 /\\/+$/ 一致", () => {
    const cases: Array<[input: string, expected: string]> = [
      ["https://api.example.com/v1", "https://api.example.com/v1"],
      ["https://api.example.com/v1/", "https://api.example.com/v1"],
      ["https://api.example.com/v1///", "https://api.example.com/v1"],
      ["///", ""],
      ["", ""],
      ["/", ""],
      ["a/b/c", "a/b/c"],
      ["a//b", "a//b"],
      ["a/", "a"],
      ["https://api.example.com/v1/chat/completions", "https://api.example.com/v1/chat/completions"],
    ];
    for (const [input, expected] of cases) {
      expect(stripTrailingSlashes(input)).toBe(expected);
    }
  });
});

describe("ReDoS 对抗：恶意串现快速完成", () => {
  it("3 万个 / 后接非 /：线性扫描瞬时完成（旧正则 N=20000 时已 891ms）", () => {
    const adversarial = "https://api.example.com/" + "/".repeat(30000) + "a";
    const start = Date.now();
    const out = stripTrailingSlashes(adversarial);
    const elapsed = Date.now() - start;
    // 末尾不是 /，原样返回；旧正则会在此处做 O(N²) 回溯，vitest 默认 5s 超时会直接失败
    expect(out).toBe(adversarial);
    expect(elapsed).toBeLessThan(1000);
  });

  it("3 万个纯 /：瞬时剥离为空串", () => {
    const start = Date.now();
    expect(stripTrailingSlashes("/".repeat(30000))).toBe("");
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("normalizeBaseUrl 对超长恶意串直接抛 config 错，不进入后续流程", () => {
    const adversarial = "https://api.example.com/" + "/".repeat(30000) + "a";
    let caught: unknown;
    try {
      normalizeBaseUrl(adversarial);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LlmError);
    expect((caught as LlmError).code).toBe("config");
  });
});

describe("normalizeBaseUrl 长度上限", () => {
  it(`恰好 ${MAX_BASE_URL_LENGTH} 字符通过，超出 1 字符抛 config`, () => {
    const prefix = "https://api.example.com/";
    const atLimit = prefix + "a".repeat(MAX_BASE_URL_LENGTH - prefix.length);
    expect(atLimit.length).toBe(MAX_BASE_URL_LENGTH);
    expect(normalizeBaseUrl(atLimit)).toBe(atLimit);
    const overLimit = prefix + "a".repeat(MAX_BASE_URL_LENGTH - prefix.length + 1);
    expect(() => normalizeBaseUrl(overLimit)).toThrowError(LlmError);
    try {
      normalizeBaseUrl(overLimit);
      expect.unreachable();
    } catch (err) {
      expect((err as LlmError).code).toBe("config");
    }
  });
});

describe("行为不变：三处被告函数的 endpoint 拼接", () => {
  it("generateImage：多尾斜杠 baseUrl 仍拼出同一终点", async () => {
    const { fetchImpl, calls } = sequencedFetch([
      jsonResponse(200, { data: [{ url: "https://img.example.com/1.png" }] }),
    ]);
    await generateImage({
      prompt: "a cat",
      apiKey: "k1",
      baseUrl: "https://api.example.com/v1///",
      model: "img-model",
      fetchImpl,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.example.com/v1/images/generations");
  });

  it("createVideoTask：多尾斜杠 baseUrl 仍拼出同一终点", async () => {
    const { fetchImpl, calls } = sequencedFetch([
      jsonResponse(200, { task_id: "t-1", url: "https://vid.example.com/1.mp4" }),
    ]);
    await createVideoTask({
      prompt: "cat video",
      apiKey: "k1",
      baseUrl: "https://api.example.com/v1//",
      model: "vid-model",
      fetchImpl,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.example.com/v1/videos");
  });

  it("pollVideoTask：尾斜杠 baseUrl 仍拼出同一轮询地址", async () => {
    const { fetchImpl, calls } = sequencedFetch([
      jsonResponse(200, { status: "completed", url: "https://v/9.mp4" }),
    ]);
    await pollVideoTask({
      taskId: "t-1",
      apiKey: "k1",
      baseUrl: "https://media.example.com/poll/",
      model: "vid-model",
      fetchImpl,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://media.example.com/poll?video_id=t-1&model_name=vid-model",
    );
  });

  it("chatCompletionsUrl：既有归一化行为不变", () => {
    expect(chatCompletionsUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
    expect(chatCompletionsUrl("https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
    expect(chatCompletionsUrl("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1/chat/completions",
    );
  });

  it("超长 baseUrl 的媒体调用直接报 config，不发起请求", async () => {
    const { fetchImpl } = sequencedFetch([]);
    const evil = "https://api.example.com/" + "/".repeat(3000);
    await expect(
      generateImage({ prompt: "x", apiKey: "k1", baseUrl: evil, model: "m", fetchImpl }),
    ).rejects.toMatchObject({ code: "config" });
    await expect(
      createVideoTask({ prompt: "x", apiKey: "k1", baseUrl: evil, model: "m", fetchImpl }),
    ).rejects.toMatchObject({ code: "config" });
    await expect(
      pollVideoTask({ taskId: "t", apiKey: "k1", baseUrl: evil, model: "m", fetchImpl }),
    ).rejects.toMatchObject({ code: "config" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
