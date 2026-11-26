/**
 * /api/events 的重放去重与副作用闸门（run100）。
 *
 * 端侧点击出箱回到线上后会**重放**同一条证据（同 eventId）。
 * 只保证「事件表里不多一行」是不够的——路由上还挂着三个副作用：
 *   `bumpVisit`（热度排序的原始信号）、`recordFeedback`（LinUCB 通道权重）、
 *   `refreshUserProfile`（个性化画像）。重放若再走一遍，
 *   等于用户点一次、模型学两次。
 * 这里把「插入返回 false ⇒ 一个副作用都不许再动」钉成可观察行为。
 *
 * 本机背景数据（查询日 2026-10-29）：sites 表 visit_count 99.8% 为 0，
 * 它是排序的次键——重复 +1 会被极小分母放大成错误排名，不是「多一条脏行」那么简单。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity, signIdentityV3 } from "../src/identity-signature.ts";
import { generateToken, hashToken } from "../src/auth.ts";

const IDENTITY_SECRET = "event-replay-test-secret";
const USER = "github:event-replay-user";
const TOKEN_USER = "github:event-replay-token-user";
const signed = (identity = USER) => {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = randomUUID().replace(/-/g, "");
  return {
    "x-navhub-user-id": identity,
    "x-navhub-identity-signature": signIdentity(IDENTITY_SECRET, identity),
    "x-navhub-identity-signature-v3": signIdentityV3(IDENTITY_SECRET, identity, ts, nonce, "user"),
    "x-navhub-identity-ts": String(ts),
    "x-navhub-identity-nonce": nonce,
  };
};

const base = {
  mode: "lite" as const,
  embedding: {
    model: "Xenova/bge-small-zh-v1.5",
    endpoint: "https://hf-mirror.com",
    dtype: "q8",
    dim: 512,
    enabled: false,
  },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let siteId = "";

async function clickRows(id: string): Promise<Array<{ created_at: number }>> {
  return (await ctx.repo.raw(
    "SELECT created_at FROM events WHERE kind = 'click' AND site_id = ? AND meta LIKE ?",
    [siteId, `%"eventId":"${id}"%`],
  )) as Array<{ created_at: number }>;
}

async function visitCount(): Promise<number> {
  const rows = (await ctx.repo.raw("SELECT visit_count FROM sites WHERE id = ?", [siteId])) as Array<{
    visit_count: number;
  }>;
  return Number(rows[0]?.visit_count ?? 0);
}

async function postEvent(payload: Record<string, unknown>, headers?: Record<string, string>) {
  return app.inject({ method: "POST", url: "/api/events", payload, headers });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-event-replay-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "replay.db"), identitySecret: IDENTITY_SECRET }));
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "重放测试" });
  siteId = (await ctx.repo.createSite({ url: "https://replay-a.example.com", title: "重放 A", categoryId: cat.id })).id;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("同一次点击的重放", () => {
  it("两次同键上报只落一行，visit_count 只 +1", async () => {
    const before = await visitCount();
    expect((await postEvent({ kind: "click", siteId, eventId: "replay-a" })).statusCode).toBe(200);
    expect((await postEvent({ kind: "click", siteId, eventId: "replay-a" })).statusCode).toBe(200);
    expect(await clickRows("replay-a")).toHaveLength(1);
    expect(await visitCount()).toBe(before + 1);
  });

  it("重放不再更新在线学习权重（点一次不该被学两次）", async () => {
    const spy = vi.spyOn(ctx.search, "recordFeedback");
    await postEvent({ kind: "click", siteId, eventId: "replay-b", query: "重放测试词", channel: "fts" }, signed());
    await postEvent({ kind: "click", siteId, eventId: "replay-b", query: "重放测试词", channel: "fts" }, signed());
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("不同 eventId 各算一次点击（同站连点三次是真热度，不是重复）", async () => {
    const before = await visitCount();
    await postEvent({ kind: "click", siteId, eventId: "multi-1" });
    await postEvent({ kind: "click", siteId, eventId: "multi-2" });
    await postEvent({ kind: "click", siteId, eventId: "multi-3" });
    expect(await visitCount()).toBe(before + 3);
  });

  it("不带 eventId 的旧客户端逐条都记（去重不能反过来把证据吃掉）", async () => {
    const spy = vi.spyOn(ctx.search, "recordFeedback");
    await postEvent({ kind: "click", siteId, query: "旧客户端词", channel: "fts" }, signed());
    await postEvent({ kind: "click", siteId, query: "旧客户端词", channel: "fts" }, signed());
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("匿名与 body 自称身份不更新全局 LinUCB", async () => {
    const spy = vi.spyOn(ctx.search, "recordFeedback");
    await postEvent({ kind: "click", siteId, query: "匿名词", channel: "fts" });
    await postEvent({ kind: "click", siteId, query: "冒充词", channel: "fts", userId: USER, anonId: USER });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("已签名的匿名 anonId 仍不更新全局 LinUCB", async () => {
    const anon = "anon-event-replay";
    const ts = Math.floor(Date.now() / 1000);
    const nonce = randomUUID().replace(/-/g, "");
    const spy = vi.spyOn(ctx.search, "recordFeedback");
    await postEvent(
      { kind: "click", siteId, query: "签名匿名词", channel: "fts" },
      {
        "x-navhub-anon-id": anon,
        "x-navhub-anon-signature-v3": signIdentityV3(IDENTITY_SECRET, anon, ts, nonce, "anon"),
        "x-navhub-anon-ts": String(ts),
        "x-navhub-anon-nonce": nonce,
      },
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("匿名 v3 签名改头成登录身份也会被拒绝，不能污染全局模型", async () => {
    const anon = "anon-event-replay-moved";
    const ts = Math.floor(Date.now() / 1000);
    const nonce = randomUUID().replace(/-/g, "");
    const spy = vi.spyOn(ctx.search, "recordFeedback");
    const res = await postEvent(
      { kind: "click", siteId, query: "改头匿名词", channel: "fts" },
      {
        "x-navhub-user-id": anon,
        "x-navhub-identity-signature-v3": signIdentityV3(IDENTITY_SECRET, anon, ts, nonce, "anon"),
        "x-navhub-identity-ts": String(ts),
        "x-navhub-identity-nonce": nonce,
      },
    );
    expect(res.statusCode).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("可信身份缺渠道时按未归因而跳过，不默认记为 exact", async () => {
    const spy = vi.spyOn(ctx.search, "recordFeedback");
    await postEvent({ kind: "click", siteId, query: "无渠道词" }, signed());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("用户令牌 owner 可学习，匿名身份头不能覆盖它", async () => {
    const token = generateToken();
    await ctx.repo.createApiToken({
      name: "event-replay-user-token",
      tokenHash: hashToken(token),
      scopes: "read,write",
      ownerIdentity: TOKEN_USER,
    });
    const anon = "event-replay-shadow-anon";
    const spy = vi.spyOn(ctx.search, "recordFeedback");
    await postEvent(
      { kind: "click", siteId, query: "令牌身份词", channel: "fts" },
      {
        authorization: `Bearer ${token}`,
        "x-navhub-anon-id": anon,
        "x-navhub-identity-signature": signIdentity(IDENTITY_SECRET, anon),
      },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("关闭遥测的可信身份也不更新全局 LinUCB", async () => {
    await ctx.repo.updateUserSettings(USER, { telemetryEnabled: false });
    try {
      const spy = vi.spyOn(ctx.search, "recordFeedback");
      await postEvent({ kind: "click", siteId, query: "关闭遥测词", channel: "fts" }, signed());
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    } finally {
      await ctx.repo.updateUserSettings(USER, { telemetryEnabled: true });
    }
  });

  it("离线攒了 6 天的证据补报后，事件时间是点击当天而不是送达当天", async () => {
    const clickedAt = Date.now() - 6 * 24 * 60 * 60 * 1000;
    await postEvent({ kind: "click", siteId, eventId: "stale-6d", clientCreatedAt: clickedAt });
    const rows = await clickRows("stale-6d");
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.created_at)).toBe(Math.floor(clickedAt));
  });

  it("非法幂等键直接 400（它会被拼进 LIKE 模式，不接受任意字符）", async () => {
    const res = await postEvent({ kind: "click", siteId, eventId: 'x" OR 1=1 --' });
    expect(res.statusCode).toBe(400);
  });
});

describe("投递漏斗信号（click_delivery）", () => {
  async function signalRows(): Promise<Array<{ meta: string }>> {
    return (await ctx.repo.raw("SELECT meta FROM events WHERE kind = 'click_delivery'")) as Array<{ meta: string }>;
  }

  it("接受 failed/enqueued 并在 meta 里保留 outcome 与 code", async () => {
    const res = await postEvent({ kind: "click_delivery", outcome: "failed", code: "enqueued" });
    expect(res.statusCode).toBe(200);
    const parsed = (await signalRows()).map((r) => JSON.parse(r.meta) as Record<string, unknown>);
    expect(parsed.some((m) => m.outcome === "failed" && m.code === "enqueued")).toBe(true);
  });

  it("不联动 visit_count，也不刷新画像（它不是一次点击）", async () => {
    const before = await visitCount();
    const spy = vi.spyOn(ctx.search, "recordFeedback");
    await postEvent({ kind: "click_delivery", outcome: "success", code: "drained", siteId });
    expect(await visitCount()).toBe(before);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("outcome 词表有界：没登记的结果码整条拒收", async () => {
    const res = await postEvent({ kind: "click_delivery", outcome: "delivered_maybe" });
    expect(res.statusCode).toBe(400);
  });
});
