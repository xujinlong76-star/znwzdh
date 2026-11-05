/**
 * P0-4 公开写端点的输入预算。
 *
 * 三组端点都无鉴权（events / vitals / workspaces 创建 / federated 排序），
 * 修复前它们唯一的约束是 4MB 全局 bodyLimit：
 *   - events 的 siteId/query/categoryId 无长度上限 → 一条事件可写进 MB 级文本；
 *   - workspaces 无数量上限、名册无单包上限 → 反复创建可把 vault 行撑大；
 *   - federated 接受 200×1024 维数组 → 一次请求数百 KB 的纯计算。
 * 这里逐项锁住新的边界（超限必须是 4xx，不是静默截断）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-p04-public-"));
  const config = loadConfig({ sqlitePath: join(dir, "public.db"), embedding: { enabled: false } });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/events 字段上限", () => {
  it("query 超过 512 字符 → 400（不再接受 MB 级搜索词入库）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { kind: "click", siteId: "x", query: "q".repeat(513) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("siteId/categoryId 超过 128 字符 → 400", async () => {
    const longSite = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { kind: "click", siteId: "s".repeat(129) },
    });
    expect(longSite.statusCode).toBe(400);

    const longCategory = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { kind: "click", siteId: "site-ok", categoryId: "c".repeat(129) },
    });
    expect(longCategory.statusCode).toBe(400);
  });

  it("边界值本身仍然可用（512 / 128 不误伤）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { kind: "impression", query: "q".repeat(512), siteId: "s".repeat(128), categoryId: "c".repeat(128) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("body 超过 16KB → 413（字段全合法但体积过大也不收）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: { kind: "click", siteId: "x", query: "q".repeat(17 * 1024) },
    });
    expect(res.statusCode).toBe(413);
  });
});

describe("POST /api/vitals 体积上限", () => {
  it("body 超过 8KB → 413", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/vitals",
      payload: { name: "LCP", value: 1200, path: "p".repeat(9 * 1024) },
    });
    expect(res.statusCode).toBe(413);
  });

  it("正常上报仍然 204", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/vitals",
      payload: { name: "LCP", value: 1200, rating: "good", path: "/" },
    });
    expect(res.statusCode).toBe(204);
  });
});

describe("POST /api/workspaces 配额与单包上限", () => {
  const H = { "x-anon-id": "quota-user" };

  it("自定义空间达到 20 个后 → 409（预设空间不占额度）", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: H,
        payload: { name: `配额空间 ${i}` },
      });
      expect(res.statusCode).toBe(201);
    }
    const denied = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: H,
      payload: { name: "第 21 个空间" },
    });
    expect(denied.statusCode).toBe(409);
    expect(String(denied.json().error)).toContain("上限");

    // 预设空间仍然可见，且自定义空间没有多写一条
    const list = await app.inject({ method: "GET", url: "/api/workspaces", headers: H });
    expect(list.json().items).toHaveLength(22);
  });

  it("成员名册超过 512KB → 413（写前检查，不落库）", async () => {
    const identity = "blob-user";
    const huge = Array.from({ length: 6000 }, (_, i) => ({
      userId: `usr-${i}`,
      username: `member-${i}-${"x".repeat(40)}`,
      role: "member",
      joinedAt: 1,
    }));
    await ctx.repo.saveWorkspaceBlob(`ws_members:${identity}:ws-personal`, JSON.stringify(huge));
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces/ws-personal/members",
      headers: { "x-anon-id": identity },
      payload: { username: "new-member", role: "member" },
    });
    expect(res.statusCode).toBe(413);
    const stored = await ctx.repo.getWorkspaceBlob(`ws_members:${identity}:ws-personal`);
    // 未写入：存储里的名册仍是原来的 6000 条
    expect(JSON.parse(stored!.payload)).toHaveLength(6000);
  });
});

describe("POST /api/rank/federated 计算预算", () => {
  it("候选超过 50 个 → 400", async () => {
    const candidates = Array.from({ length: 51 }, (_, i) => ({
      id: `cand-${i}`,
      name: `候选 ${i}`,
      featureVector: [1, 0, 1],
    }));
    const res = await app.inject({
      method: "POST",
      url: "/api/rank/federated",
      payload: { localVector: [1, 0, 1], candidates },
    });
    expect(res.statusCode).toBe(400);
  });

  it("向量维度超过 256 → 400（本地/全局/候选三处同口径）", async () => {
    const dims = Array.from({ length: 257 }, () => 0.5);
    for (const payload of [
      { localVector: dims },
      { localVector: [0.5], globalVector: dims },
      { localVector: [0.5], candidates: [{ id: "c", name: "c", featureVector: dims }] },
    ]) {
      const res = await app.inject({ method: "POST", url: "/api/rank/federated", payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it("50 个候选 × 256 维仍在预算内 → 200", async () => {
    const vector = Array.from({ length: 256 }, (_, i) => Math.sin(i));
    const candidates = Array.from({ length: 50 }, (_, i) => ({
      id: `cand-${i}`,
      name: `候选 ${i}`,
      featureVector: vector,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/api/rank/federated",
      payload: { localVector: vector, candidates },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(50);
  });
});
