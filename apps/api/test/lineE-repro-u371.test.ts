/**
 * 临时复现（U-371，跑完即删，不入仓）：
 * R1：离线改备注 op at=createdAt=t0，遇云端 updated_at=t0+60000
 * → HTTP 200 + ok:true，但 applied=0，op 被 LWW 跳过；回包无 skipped 字段。
 * 与 round2 E 路方法一致（服务端一半）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

const SECRET = "test-secret-please-rotate";
const USER = "github:u-repro-u371";
const T0 = 1700000000000;

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

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

async function sync(identity: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/me/favorites/sync",
    headers: headersFor(identity),
    payload,
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-repro-u371-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "repro.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "复现测试" });
  siteA = (await ctx.repo.createSite({ url: "https://repro-a.example.com", title: "复现 A", categoryId: cat.id })).id;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("U-371 R1 复现（服务端）", () => {
  it("离线改备注 op at=createdAt=t0 遇云端 t0+60000 → 200 ok:true 但 applied=0，云端仍是 B 版", async () => {
    const first = await sync(USER, { ops: [{ op: "add", siteId: siteA, note: "A版备注", at: T0 }] });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { applied: number }).applied).toBe(1);

    const second = await sync(USER, { ops: [{ op: "add", siteId: siteA, note: "B版备注", at: T0 + 60000 }] });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { applied: number }).applied).toBe(1);

    // 设备 A 离线改备注：按 useFavorites.ts:1737，op.at 取 createdAt=t0
    const stale = await sync(USER, { ops: [{ op: "add", siteId: siteA, note: "A版备注改", at: T0 }] });
    expect(stale.statusCode).toBe(200);
    const body = stale.json() as { ok: boolean; applied: number; skipped?: number; items: Array<{ siteId: string; note?: string | null }> };
    console.log("R1 stale sync response:", JSON.stringify({ status: stale.statusCode, ok: body.ok, applied: body.applied, skipped: body.skipped, note: body.items.find((i) => i.siteId === siteA)?.note }));
    expect(body.ok).toBe(true);
    // BUG：LWW 跳过，但 HTTP 200 + ok:true
    expect(body.applied).toBe(0);
    expect(body.items.find((i) => i.siteId === siteA)?.note).toBe("B版备注");
    // BUG：回包没有跳过计数，客户端无从知道
    expect(body.skipped).toBeUndefined();
  });
});
