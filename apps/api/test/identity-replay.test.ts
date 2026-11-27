/**
 * 身份签名的重放防护（v2）。
 *
 * v1 签名 = HMAC(secret, identity) 是恒定值：抓到一次请求头就能无限重放，
 * 冒充该身份读写收藏/历史/画像，且服务端看不出异常。v2 把时间戳与随机 nonce
 * 纳入 MAC，校验「窗口内 + 未用过 + MAC 匹配」。
 *
 * 本文件同时守住兼容窗口的边界：
 *   - 非严格模式（默认）仍接受仅 v1 的旧代理请求
 *   - 严格模式（NAVHUB_IDENTITY_SIGNATURE_STRICT=1）只认 v2
 *   - 只要带了 v2 头就绝不回退 v1（防止把 v2 改坏来降级）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import {
  IdentityReplayGuard,
  IDENTITY_SIGNATURE_WINDOW_SECONDS,
  signIdentity,
  signIdentityV2,
  verifyIdentityHeaders,
} from "../src/identity-signature.ts";

const SECRET = "replay-test-secret";
const USER = "anon-replay-guard-user";

interface Harness {
  ctx: AppContext;
  app: Awaited<ReturnType<typeof buildServer>>;
}

let dir: string;
let compat: Harness;
let strict: Harness;

function makeConfig(name: string, strictMode: boolean) {
  return loadConfig({
    mode: "lite",
    sqlitePath: join(dir, name + ".db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
    identitySecret: SECRET,
    identitySignatureStrict: strictMode,
  });
}

async function boot(name: string, strictMode: boolean): Promise<Harness> {
  const ctx = await createContext(makeConfig(name, strictMode));
  const app = await buildServer(ctx);
  await app.ready();
  return { ctx, app };
}

/** 与 BFF 相同的一套头：v1 + v2 三件套 */
function signedHeaders(identity: string, override: { ts?: number; nonce?: string } = {}): Record<string, string> {
  const ts = override.ts ?? Math.floor(Date.now() / 1000);
  const nonce = override.nonce ?? randomBytes(16).toString("hex");
  return {
    "x-navhub-anon-id": identity,
    "x-navhub-identity-signature": signIdentity(SECRET, identity),
    "x-navhub-identity-signature-v2": signIdentityV2(SECRET, identity, ts, nonce),
    "x-navhub-identity-ts": String(ts),
    "x-navhub-identity-nonce": nonce,
  };
}

function hit(app: Harness["app"], headers: Record<string, string>) {
  return app.inject({ method: "GET", url: "/api/profile", headers });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-identity-replay-"));
  compat = await boot("compat", false);
  strict = await boot("strict", true);
});

afterAll(async () => {
  await compat.app.close();
  await compat.ctx.close();
  await strict.app.close();
  await strict.ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("v2 请求头校验", () => {
  it("新签名（窗口内、nonce 未用过）放行", async () => {
    const res = await hit(compat.app, signedHeaders(USER));
    expect(res.statusCode).toBe(200);
  });

  it("同一份签名第二次出现 → 判定重放并拒绝", async () => {
    const headers = signedHeaders(USER);
    expect((await hit(compat.app, headers)).statusCode).toBe(200);
    const replay = await hit(compat.app, headers);
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error).toContain("签名");
  });

  it("时间戳超出 ±300s → 拒绝（过去与未来都算过期）", async () => {
    const now = Math.floor(Date.now() / 1000);
    const past = await hit(compat.app, signedHeaders(USER, { ts: now - IDENTITY_SIGNATURE_WINDOW_SECONDS - 60 }));
    expect(past.statusCode).toBe(401);
    const future = await hit(compat.app, signedHeaders(USER, { ts: now + IDENTITY_SIGNATURE_WINDOW_SECONDS + 60 }));
    expect(future.statusCode).toBe(401);
  });

  it("nonce 形态非法 → 拒绝", async () => {
    const res = await hit(compat.app, signedHeaders(USER, { nonce: "short" }));
    expect(res.statusCode).toBe(401);
  });

  it("v2 签名与身份不匹配 → 拒绝（不能借别人的签名）", async () => {
    const headers = signedHeaders(USER);
    const res = await hit(compat.app, {
      ...headers,
      "x-navhub-anon-id": "anon-someone-else",
    });
    expect(res.statusCode).toBe(401);
  });

  it("v2 头存在但被改坏 → 拒绝，且不回退 v1（防降级）", async () => {
    const headers = signedHeaders(USER);
    const res = await hit(compat.app, {
      ...headers,
      "x-navhub-identity-signature-v2": "0".repeat(64),
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("兼容窗口", () => {
  it("非严格模式：只有 v1 的旧代理请求仍可用", async () => {
    const res = await hit(compat.app, {
      "x-navhub-anon-id": USER,
      "x-navhub-identity-signature": signIdentity(SECRET, USER),
    });
    expect(res.statusCode).toBe(200);
  });

  it("非严格模式：v1 签名错误仍拒绝", async () => {
    const res = await hit(compat.app, {
      "x-navhub-anon-id": USER,
      "x-navhub-identity-signature": signIdentity(SECRET, "anon-other"),
    });
    expect(res.statusCode).toBe(401);
  });

  it("严格模式：只有 v1 的请求被拒", async () => {
    const res = await hit(strict.app, {
      "x-navhub-anon-id": USER,
      "x-navhub-identity-signature": signIdentity(SECRET, USER),
    });
    expect(res.statusCode).toBe(401);
  });

  it("严格模式：v2 请求照常放行", async () => {
    const res = await hit(strict.app, signedHeaders(USER));
    expect(res.statusCode).toBe(200);
  });
});

describe("校验函数单元口径", () => {
  const base = { secret: SECRET, identity: USER };

  it("anon 前缀只读 anon 头，不会误用 identity 头", () => {
    const now = Date.now();
    const ts = Math.floor(now / 1000);
    const nonce = randomBytes(16).toString("hex");
    const identityOnly = {
      "x-navhub-identity-signature-v2": signIdentityV2(SECRET, USER, ts, nonce),
      "x-navhub-identity-ts": String(ts),
      "x-navhub-identity-nonce": nonce,
    };
    const withPrefix = verifyIdentityHeaders({
      ...base,
      headers: identityOnly,
      prefix: "x-navhub-anon",
      guard: new IdentityReplayGuard(),
      nowMs: now,
    });
    const withoutPrefix = verifyIdentityHeaders({
      ...base,
      headers: identityOnly,
      guard: new IdentityReplayGuard(),
      nowMs: now,
    });
    expect(withPrefix.ok).toBe(false);
    expect(withoutPrefix.ok).toBe(true);
    expect(withoutPrefix.mode).toBe("v2");
  });

  it("窗口边界：恰好 ±300s 仍可接受，301s 拒绝", () => {
    const now = Date.now();
    const ts = Math.floor(now / 1000);
    const nonce = randomBytes(16).toString("hex");
    const headers = {
      "x-navhub-identity-signature-v2": signIdentityV2(SECRET, USER, ts, nonce),
      "x-navhub-identity-ts": String(ts),
      "x-navhub-identity-nonce": nonce,
    };
    const atEdge = verifyIdentityHeaders({ ...base, headers, guard: new IdentityReplayGuard(), nowMs: now + 300_000 });
    const beyond = verifyIdentityHeaders({ ...base, headers, guard: new IdentityReplayGuard(), nowMs: now + 301_000 });
    expect(atEdge.ok).toBe(true);
    expect(beyond).toMatchObject({ ok: false, reason: "stale" });
  });

  it("重放缓存有界：超过上限按插入顺序淘汰", () => {
    const guard = new IdentityReplayGuard(2);
    expect(guard.accept("a", 0, 60_000)).toBe(true);
    expect(guard.accept("b", 0, 60_000)).toBe(true);
    expect(guard.accept("c", 0, 60_000)).toBe(true);
    expect(guard.size).toBe(2);
    // a 已被挤出：再出现被当作首次（并挤掉当时的队首 b）
    expect(guard.accept("a", 0, 60_000)).toBe(true);
    expect(guard.size).toBe(2);
    // c 仍在缓存里
    expect(guard.accept("c", 0, 60_000)).toBe(false);
  });

  it("条目过期后可再次放行（窗口外的签名本来就会被 stale 拦住，这里只验缓存自身）", () => {
    const guard = new IdentityReplayGuard();
    expect(guard.accept("sig", 1_000, 5_000)).toBe(true);
    expect(guard.accept("sig", 3_000, 5_000)).toBe(false);
    expect(guard.accept("sig", 10_000, 5_000)).toBe(true);
    expect(guard.size).toBe(1);
  });
});
