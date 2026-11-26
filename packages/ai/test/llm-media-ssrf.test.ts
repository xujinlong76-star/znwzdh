import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoTask, generateImage, pollVideoTask } from "../src/llm.ts";

async function withMediaServer(run: (baseUrl: string, hits: () => number) => Promise<void>): Promise<void> {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url?.startsWith("/v1/images/generations")) {
      res.end(JSON.stringify({ data: [{ url: "https://img.example/1.png" }] }));
      return;
    }
    if (req.url?.startsWith("/v1/videos")) {
      res.end(JSON.stringify({ task_id: "task-1" }));
      return;
    }
    if (req.url?.startsWith("/poll")) {
      res.end(JSON.stringify({ status: "completed", url: "https://video.example/1.mp4" }));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`, () => hits);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("媒体 LLM 请求使用统一 SSRF 出口", () => {
  it("生产默认路径不调用裸 fetch，显式私网放行后图像/视频/轮询均成功", async () => {
    const bareFetch = vi.fn(() => { throw new Error("production media path must not use bare fetch"); });
    vi.stubGlobal("fetch", bareFetch);

    await withMediaServer(async (baseUrl, hits) => {
      await expect(generateImage({
        prompt: "cat",
        apiKey: "k1",
        baseUrl: `${baseUrl}/v1`,
        model: "image-model",
        allowPrivateNetwork: true,
      })).resolves.toMatchObject({ url: "https://img.example/1.png" });

      await expect(createVideoTask({
        prompt: "cat",
        apiKey: "k1",
        baseUrl: `${baseUrl}/v1`,
        model: "video-model",
        allowPrivateNetwork: true,
      })).resolves.toMatchObject({ status: "processing", taskId: "task-1" });

      await expect(pollVideoTask({
        taskId: "task-1",
        apiKey: "k1",
        baseUrl: `${baseUrl}/poll`,
        model: "video-model",
        allowPrivateNetwork: true,
      })).resolves.toMatchObject({ status: "completed", url: "https://video.example/1.mp4" });

      expect(hits()).toBe(3);
      expect(bareFetch).not.toHaveBeenCalled();
    });
  });

  it("默认拒绝私网，轮询不会把 SSRF 错误吞成 processing", async () => {
    await withMediaServer(async (baseUrl, hits) => {
      await expect(generateImage({
        prompt: "cat",
        apiKey: "k1",
        baseUrl: `${baseUrl}/v1`,
        model: "image-model",
      })).rejects.toMatchObject({ code: "ssrf" });
      await expect(createVideoTask({
        prompt: "cat",
        apiKey: "k1",
        baseUrl: `${baseUrl}/v1`,
        model: "video-model",
      })).rejects.toMatchObject({ code: "ssrf" });
      await expect(pollVideoTask({
        taskId: "task-1",
        apiKey: "k1",
        baseUrl: `${baseUrl}/poll`,
        model: "video-model",
      })).rejects.toMatchObject({ code: "ssrf" });
      expect(hits()).toBe(0);
    });
  });

  it("即使显式放行私网，媒体端点仍永久拒绝云元数据地址", async () => {
    const baseUrl = "http://169.254.169.254";
    await expect(generateImage({
      prompt: "cat",
      apiKey: "k1",
      baseUrl,
      model: "image-model",
      allowPrivateNetwork: true,
    })).rejects.toMatchObject({ code: "ssrf" });
    await expect(createVideoTask({
      prompt: "cat",
      apiKey: "k1",
      baseUrl,
      model: "video-model",
      allowPrivateNetwork: true,
    })).rejects.toMatchObject({ code: "ssrf" });
    await expect(pollVideoTask({
      taskId: "task-1",
      apiKey: "k1",
      baseUrl,
      model: "video-model",
      allowPrivateNetwork: true,
    })).rejects.toMatchObject({ code: "ssrf" });
  });
});
