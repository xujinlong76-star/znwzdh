/**
 * CRDT 视频断点 op 的服务端接受性（Batch 3 第 9 项，方案 A）：
 * POST /api/crdt/sync 的 zod 枚举必须接受 UPSERT_VIDEO_PROGRESS /
 * DELETE_VIDEO_PROGRESS，并把断点写进返回的 state.videoProgress。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const ID = "anon-crdt-video-0001";
const H = { "x-navhub-anon-id": ID };

const base = {
  mode: "lite" as const,
  embedding: { model: "none", endpoint: "", dtype: "q8" as const, dim: 512, enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 1500, maxBytes: 65536, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubCrdtVideoTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-crdt-video-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "video.db") } as never));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await new Promise((r) => setTimeout(r, 30));
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // SQLite 句柄释放有延迟：临时目录交给系统回收
  }
});

const videoOp = {
  id: "op_1000_c1_video1",
  type: "UPSERT_VIDEO_PROGRESS",
  entityId: "v1",
  payload: {
    timestampSec: 754,
    durationSec: 1800,
    progressPercent: 42,
    title: "测试视频",
    platform: "bilibili",
    updatedAt: 1000,
    deviceId: "client_abc",
  },
  timestamp: 1000,
  clientId: "c1",
};

describe("POST /api/crdt/sync 视频断点 op", () => {
  it("接受 UPSERT_VIDEO_PROGRESS：200 且 state.videoProgress 含该断点", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/crdt/sync",
      headers: H,
      payload: { operations: [videoOp] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { state: { videoProgress: Record<string, { title: string }> } };
    expect(body.state.videoProgress["v1"]!.title).toBe("测试视频");

    const get = await app.inject({ method: "GET", url: "/api/crdt/sync", headers: H });
    expect(get.statusCode).toBe(200);
    const got = get.json() as { state: { videoProgress: Record<string, unknown> } };
    expect(got.state.videoProgress["v1"]).toBeDefined();
  });

  it("接受 DELETE_VIDEO_PROGRESS：删除后 state 里不再有该断点", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/crdt/sync",
      headers: H,
      payload: {
        operations: [
          {
            id: "op_2000_c1_video1",
            type: "DELETE_VIDEO_PROGRESS",
            entityId: "v1",
            payload: { updatedAt: 2000 },
            timestamp: 2000,
            clientId: "c1",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { state: { videoProgress: Record<string, unknown> } };
    expect(body.state.videoProgress["v1"]).toBeUndefined();
  });

  it("未知 op 类型仍被 zod 拒绝：400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/crdt/sync",
      headers: H,
      payload: { operations: [{ ...videoOp, id: "op_3000_c1_x", type: "UPSERT_VIDEO_SCENE" }] },
    });
    expect(res.statusCode).toBe(400);
  });
});
