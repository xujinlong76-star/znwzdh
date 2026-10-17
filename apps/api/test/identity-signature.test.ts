/**
 * 身份签名（P0-2）的回归。
 *
 * 修的是什么：身份标识（`userId` / `anonId`）是纯字符串，任何持票人——开放模式下
 * 甚至匿名——都能自称任何身份读写他人数据。配置 `NAVHUB_IDENTITY_SECRET` 后，
 * 带身份的请求必须携带 `x-navhub-identity-signature = HMAC-SHA256(secret, identity)`。
 *
 * 这里覆盖两半：
 *  1. 纯函数（向量锁 + 恒定时间比较的接受/拒绝矩阵）
 *  2. 真实路由行为：不带签名 → 401；签名正确 → 200；无身份的公开路由不受影响
 *
 * 非空性：把校验去掉后，「不带签名 → 401」会变成 200，本文件立刻失败。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity, verifyIdentitySignature } from "../src/identity-signature.ts";

const SECRET = "test-secret-please-rotate";
/** 与 apps/web-overlay/test/hub-identity-signature.test.ts 共用同一向量：两侧实现必须一致 */
const VECTOR_ALICE = "8091d0f3cb74f22698ca395cb5d7e16896a2a6d1a18dbd102e1148c18836b7a1";

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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-identity-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "identity.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("identity-signature：纯函数", () => {
  it("向量锁：HMAC-SHA256(secret, github:alice)", () => {
    expect(signIdentity(SECRET, "github:alice")).toBe(VECTOR_ALICE);
  });

  it("接受：精确值 / 大小写不敏感 / 前后空白", () => {
    expect(verifyIdentitySignature(SECRET, "github:alice", VECTOR_ALICE)).toBe(true);
    expect(verifyIdentitySignature(SECRET, "github:alice", VECTOR_ALICE.toUpperCase())).toBe(true);
    expect(verifyIdentitySignature(SECRET, "github:alice", "  " + VECTOR_ALICE + " ")).toBe(true);
  });

  it("拒绝：换密钥 / 换身份 / 空值 / 截断值", () => {
    expect(verifyIdentitySignature("another-secret", "github:alice", VECTOR_ALICE)).toBe(false);
    expect(verifyIdentitySignature(SECRET, "github:bob", VECTOR_ALICE)).toBe(false);
    expect(verifyIdentitySignature(SECRET, "github:alice", "")).toBe(false);
    expect(verifyIdentitySignature(SECRET, "github:alice", undefined)).toBe(false);
    expect(verifyIdentitySignature(SECRET, "github:alice", VECTOR_ALICE.slice(0, -2))).toBe(false);
  });
});

describe("identity-signature：路由行为", () => {
  it("带身份但不带签名 → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/favorites?userId=github:alice" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("身份签名缺失或无效");
  });

  it("签名错误 → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/favorites?userId=github:alice",
      headers: { "x-navhub-identity-signature": "a".repeat(64) },
    });
    expect(res.statusCode).toBe(401);
  });

  it("签名正确 → 200（证明守卫不会把正常调用一起挡掉）", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/favorites?userId=github:alice",
      headers: { "x-navhub-identity-signature": signIdentity(SECRET, "github:alice") },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("items");
  });

  it("签名必须绑定到具体身份：拿 alice 的签名冒充 bob → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/favorites?userId=github:bob",
      headers: { "x-navhub-identity-signature": signIdentity(SECRET, "github:alice") },
    });
    expect(res.statusCode).toBe(401);
  });

  it("无身份的公开路由不受影响", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites?limit=1" });
    expect(res.statusCode).toBe(200);
  });

  it("匿名身份（anonId）同样受保护", async () => {
    const noSig = await app.inject({ method: "GET", url: "/api/favorites?anonId=anon-42" });
    expect(noSig.statusCode).toBe(401);

    const signed = await app.inject({
      method: "GET",
      url: "/api/favorites?anonId=anon-42",
      headers: { "x-navhub-identity-signature": signIdentity(SECRET, "anon-42") },
    });
    expect(signed.statusCode).toBe(200);
  });
});
