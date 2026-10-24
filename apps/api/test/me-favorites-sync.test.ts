import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 收藏同步端点（M1）：批量 ops + 版本游标 + 墓碑删除。
 *
 * 断言的都是「客户端可观察行为」：发什么 ops、拿到什么 items/version，
 * 再拿 version 当 since 是否只回增量。
 */
const SECRET = "test-secret-please-rotate";
const USER = "github:u-sync-api";
const OTHER = "github:u-sync-api-other";
const ANON = "anon-33333333-3333-3333-3333-333333333333";

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
let siteA = "";
let siteB = "";

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

type SyncBody = {
  ok: boolean;
  applied: number;
  version: number;
  items: Array<{
    siteId: string;
    deletedAt?: number | null;
    note?: string | null;
    site: { id: string; url: string; title: string } | null;
  }>;
  folders: Array<{ id: string; name: string }>;
};

async function sync(identity: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/me/favorites/sync",
    headers: headersFor(identity),
    payload,
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-sync-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "sync.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
  // 真实站点：增量条目要带 site join（换设备首拉时本地没有缓存可回退）
  const cat = await ctx.repo.createCategory({ title: "同步测试" });
  siteA = (await ctx.repo.createSite({ url: "https://sync-a.example.com", title: "同步 A", categoryId: cat.id })).id;
  siteB = (await ctx.repo.createSite({ url: "https://sync-b.example.com", title: "同步 B", categoryId: cat.id })).id;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/me/favorites/sync", () => {
  let version = 0;

  it("无签名身份 -> 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/me/favorites/sync",
      payload: { ops: [{ op: "add", siteId: "site-x" }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("批量 2 条 add -> applied=2，items 全量返回且带 site join", async () => {
    const now = Date.now();
    const res = await sync(USER, {
      ops: [
        { op: "add", siteId: siteA, note: "第一条", at: now },
        { op: "add", siteId: siteB, at: now + 1 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.ok).toBe(true);
    expect(body.applied).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.items.every((i) => (i.deletedAt ?? null) === null)).toBe(true);
    // 新设备首拉的唯一渲染依据：站点元信息必须随增量下发
    const first = body.items.find((i) => i.siteId === siteA);
    expect(first?.site?.url).toBe("https://sync-a.example.com");
    expect(first?.site?.title).toBe("同步 A");
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

  it("remove -> 墓碑随增量下发（deletedAt 非空）", async () => {
    const res = await sync(USER, {
      ops: [{ op: "remove", siteId: siteA, at: version + 10 }],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.applied).toBe(1);
    expect(body.version).toBe(version + 10);

    const delta = await sync(USER, { ops: [], since: version });
    expect(delta.statusCode).toBe(200);
    const items = (delta.json() as SyncBody).items;
    const tomb = items.find((i) => i.siteId === siteA);
    expect(tomb).toBeTruthy();
    expect(tomb!.deletedAt).toBeGreaterThan(0);
    // 未改动的另一条不应出现
    expect(items.some((i) => i.siteId === siteB)).toBe(false);

    version = (delta.json() as SyncBody).version;
  });

  it("匿名身份能同步自己的数据，且与登录身份隔离", async () => {
    const res = await sync(ANON, {
      ops: [{ op: "add", siteId: "anon-site", at: Date.now() }],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody;
    expect(body.applied).toBe(1);
    expect(body.items.map((i) => i.siteId)).toEqual(["anon-site"]);

    // 另一个身份从 0 拉取，看不到匿名身份的收藏
    const other = await sync(OTHER, { ops: [], since: 0 });
    expect(other.statusCode).toBe(200);
    expect((other.json() as SyncBody).items).toHaveLength(0);
  });

  it("参数非法（未知 op / ops 超限）-> 400", async () => {
    const bad = await sync(USER, { ops: [{ op: "nope", siteId: "site-1" }] });
    expect(bad.statusCode).toBe(400);

    const tooMany = await sync(USER, {
      ops: Array.from({ length: 501 }, (_, i) => ({ op: "add", siteId: `s-${i}` })),
    });
    expect(tooMany.statusCode).toBe(400);
  });

  it("超长备注（>200 字）逐条截断同步，不阻断整批（T15）", async () => {
    const now = Date.now();
    const longNote = "长".repeat(250);
    const res = await sync(USER, {
      ops: [
        { op: "add", siteId: siteB, note: longNote, at: now + 100 },
        { op: "add", siteId: siteA, note: "正常备注", at: now + 101 },
      ],
    });
    // 一条脏数据不允许让整批 400——那会卡死客户端的重试链路
    expect(res.statusCode).toBe(200);
    const body = res.json() as SyncBody & { truncatedNotes: number };
    expect(body.ok).toBe(true);
    expect(body.applied).toBe(2);
    expect(body.truncatedNotes).toBe(1);
    const long = body.items.find((i) => i.siteId === siteB);
    expect(long?.note).toBe("长".repeat(200));
  });

  it("备注超过结构上限（>2000 字）仍整批 400：那是客户端 bug，不是用户内容", async () => {
    const res = await sync(USER, {
      ops: [{ op: "add", siteId: siteA, note: "x".repeat(2001), at: Date.now() }],
    });
    expect(res.statusCode).toBe(400);
  });
});
