/**
 * GET /api/me/drama-check-states 测试（U-D3）。
 *
 * 只读当前登录用户的 drama_check_states：匿名返 []、无记录返 []、
 * 他人状态不可见；未带身份 401。
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
const USER = "github:u-drama-states";
const OTHER = "github:u-drama-states-other";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const signedHeaders = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-me-drama-states-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "me-drama-states.db"),
      embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
      llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
      fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
      corsOrigins: ["*"],
      identitySecret: SECRET,
    }),
  );
  app = await buildServer(ctx);
  await app.ready();
  const now = Date.now();
  await ctx.repo.upsertDramaCheckState(USER, "nav-557388e01d50::剧a", { latestEpisode: 86, lastCheckedAt: now, lastError: null }, now);
  await ctx.repo.upsertDramaCheckState(USER, "nav-557388e01d50::剧b", { latestEpisode: null, lastCheckedAt: now, lastError: "搜短剧详情页未解析出集数" }, now);
  await ctx.repo.upsertDramaCheckState(OTHER, "nav-557388e01d50::剧c", { latestEpisode: 100, lastCheckedAt: now, lastError: null }, now);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/me/drama-check-states", () => {
  it("只返回当前用户的状态，按 dramaKey 排序；他人状态不可见", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me/drama-check-states",
      headers: signedHeaders(USER),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      states: { dramaKey: string; latestEpisode: number | null; lastCheckedAt: number; lastError: string | null }[];
    };
    expect(body.ok).toBe(true);
    expect(body.states).toHaveLength(2);
    expect(body.states[0]?.dramaKey).toBe("nav-557388e01d50::剧a");
    expect(body.states[0]?.latestEpisode).toBe(86);
    expect(body.states[0]?.lastError).toBeNull();
    expect(body.states[1]?.dramaKey).toBe("nav-557388e01d50::剧b");
    expect(body.states[1]?.latestEpisode).toBeNull();
    expect(body.states[1]?.lastError).toBe("搜短剧详情页未解析出集数");
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("匿名身份返空数组", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me/drama-check-states",
      headers: signedHeaders("anon-test-123"),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { states: unknown[] }).states).toEqual([]);
  });

  it("无记录的用户返空数组", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/me/drama-check-states",
      headers: signedHeaders("github:u-drama-states-nobody"),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { states: unknown[] }).states).toEqual([]);
  });

  it("未带身份 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/drama-check-states" });
    expect(res.statusCode).toBe(401);
  });
});
