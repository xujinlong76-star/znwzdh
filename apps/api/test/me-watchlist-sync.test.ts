import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 追剧清单同步端点：与收藏同步同一套协议（批量 ops + 版本游标 + 墓碑）。
 * 断言的都是客户端可观察行为：ops 的应用、LWW 跳过、增量与墓碑下发、用户隔离。
 * 条目自带平台快照，不依赖 sites 表，所以这里不建站点数据。
 */
const SECRET = "test-secret-please-rotate";
const USER = "github:u-watch-api";
const OTHER = "github:u-watch-api-other";

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

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

type WatchItem = {
  key: string;
  title: string;
  platformSiteId: string;
  platformTitle: string;
  playUrl: string;
  episode: number;
  priority: string;
  cadence: { kind: string; weekdays?: number[] };
  remind: boolean;
  lastProgressAt: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
};

type SyncBody = {
  ok: boolean;
  applied: number;
  version: number;
  items: WatchItem[];
  truncatedTitles: number;
};

const KEY_A = "nav-hongguo::甲剧";
const KEY_B = "nav-hongguo::乙剧";

function addOp(key: string, title: string, at: number, extra: Record<string, unknown> = {}) {
  return {
    op: "add",
    key,
    title,
    platformSiteId: "nav-hongguo",
    platformTitle: "红果短剧",
    playUrl: "https://www.hongguo.com",
    episode: 3,
    priority: "normal",
    cadence: { kind: "weekly", weekdays: [2, 4] },
    remind: true,
    lastProgressAt: at,
    createdAt: at,
    at,
    ...extra,
  };
}

async function sync(identity: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/me/watchlist/sync",
    headers: headersFor(identity),
    payload,
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-watch-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "watch.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/me/watchlist/sync", () => {
  let version = 0;

  it("无签名身份 -> 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/watchlist/sync",
      payload: { ops: [addOp(KEY_A, "甲剧", Date.now())] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("批量 2 条 add -> applied=2，全量返回且字段完整（含节奏与进度）", async () => {
    const now = Date.now();
    const res = await sync(USER, { ops: [addOp(KEY_A, "甲剧", now), addOp(KEY_B, "乙剧", now + 1)] });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.ok).toBe(true);
    expect(body.applied).toBe(2);
    expect(body.items).toHaveLength(2);
    const a = body.items.find((i) => i.key === KEY_A);
    expect(a?.title).toBe("甲剧");
    expect(a?.platformTitle).toBe("红果短剧");
    expect(a?.playUrl).toBe("https://www.hongguo.com");
    expect(a?.episode).toBe(3);
    expect(a?.cadence).toEqual({ kind: "weekly", weekdays: [2, 4] });
    expect(a?.remind).toBe(true);
    expect(a?.deletedAt ?? null).toBeNull();
    expect(body.version).toBeGreaterThan(0);
    version = body.version;
  });

  it("用 version 当 since -> 只拿增量（此刻为空）", async () => {
    const res = await sync(USER, { ops: [], since: version });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.applied).toBe(0);
    expect(body.items).toHaveLength(0);
    expect(body.version).toBe(version);
  });

  it("update 改进度 -> 增量只回这一条，episode 与 lastProgressAt 已更新", async () => {
    const at = Date.now() + 1000;
    const res = await sync(USER, {
      ops: [{ op: "update", key: KEY_A, episode: 7, lastProgressAt: at, at }],
      since: version,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.key).toBe(KEY_A);
    expect(body.items[0]?.episode).toBe(7);
    expect(body.items[0]?.lastProgressAt).toBe(at);
    // update 是补丁语义：没传的字段保持原值
    expect(body.items[0]?.title).toBe("甲剧");
    version = body.version;
  });

  it("LWW：at 早于存量 updated_at 的 add 被跳过，旧进度不能盖新进度", async () => {
    const stale = Date.now() - 60_000;
    const res = await sync(USER, {
      ops: [addOp(KEY_A, "甲剧", stale, { episode: 1, lastProgressAt: stale, createdAt: stale })],
      since: 0,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.applied).toBe(0);
    const a = body.items.find((i) => i.key === KEY_A);
    expect(a?.episode).toBe(7);
  });

  it("remove -> 墓碑随增量下发；全量拉取不再包含该条", async () => {
    const at = Date.now() + 2000;
    const res = await sync(USER, { ops: [{ op: "remove", key: KEY_B, at }], since: version });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.applied).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.key).toBe(KEY_B);
    expect(body.items[0]?.deletedAt).toBe(at);
    version = body.version;

    const full = await sync(USER, { ops: [], since: 0 });
    const fullBody = full.json() as SyncBody;
    const alive = fullBody.items.filter((i) => (i.deletedAt ?? null) === null);
    expect(alive.map((i) => i.key)).toEqual([KEY_A]);
  });

  it("remove 后再 add 同一 key -> 复活且清墓碑", async () => {
    const at = Date.now() + 3000;
    const res = await sync(USER, {
      ops: [addOp(KEY_B, "乙剧", at, { episode: 1, lastProgressAt: at, createdAt: at })],
      since: 0,
    });
    const body = res.json() as SyncBody;
    const b = body.items.find((i) => i.key === KEY_B);
    expect(b?.deletedAt ?? null).toBeNull();
    expect(b?.episode).toBe(1);
  });

  it("用户隔离：另一个用户全量拉取看不到 USER 的条目", async () => {
    const res = await sync(OTHER, { ops: [], since: 0 });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.items).toHaveLength(0);
  });

  it("参数无效 -> 400（节奏形状非法 / episode 越界）", async () => {
    const badCadence = await sync(USER, {
      ops: [addOp(KEY_A, "甲剧", Date.now(), { cadence: { kind: "weekly", weekdays: [9] } })],
    });
    expect(badCadence.statusCode).toBe(400);
    const badEpisode = await sync(USER, {
      ops: [addOp(KEY_A, "甲剧", Date.now(), { episode: -1 })],
    });
    expect(badEpisode.statusCode).toBe(400);
  });

  it("超长剧名被截断并计数，不整批 400", async () => {
    const at = Date.now() + 4000;
    const res = await sync(USER, {
      ops: [addOp("nav-hongguo::长剧名", "剧".repeat(120), at, { lastProgressAt: at, createdAt: at })],
      since: 0,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.truncatedTitles).toBeGreaterThanOrEqual(1);
    const item = body.items.find((i) => i.key === "nav-hongguo::长剧名");
    expect(item?.title.length).toBe(80);
  });
});
