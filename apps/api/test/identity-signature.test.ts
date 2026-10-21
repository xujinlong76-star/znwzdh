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

  /**
   * 请求体入口的签名守卫（2026-10-20 修复的 P1）。
   *
   * 旧实现把校验放在 onRequest —— 那一阶段 Fastify 还没解析 body，
   * 于是「只在 body 里带 userId」的请求取到的 identity 恒为 null，
   * 校验被整段跳过；而路由随后用同一个 identityOf 从 body 读出身份。
   * 结果：配置了密钥也完全不设防。现在校验移到 preValidation。
   */
  it("身份只在请求体里（不带签名）→ 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/favorites",
      payload: { userId: "github:alice", siteId: "whatever" },
    });
    // 修复前是 404（绕过签名后走到「站点不存在」），修复后必须是 401
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("身份签名缺失或无效");
  });

  it("请求体身份签名正确 → 通过签名关卡（后续业务校验照常）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/favorites",
      headers: { "x-navhub-identity-signature": signIdentity(SECRET, "github:alice") },
      payload: { userId: "github:alice", siteId: "no-such-site" },
    });
    // 签名过了才会到达业务层：站点不存在 → 404（而非 401）
    expect(res.statusCode).toBe(404);
  });

  it("请求体身份与签名不匹配 → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/favorites",
      headers: { "x-navhub-identity-signature": signIdentity(SECRET, "github:alice") },
      payload: { userId: "github:bob", siteId: "no-such-site" },
    });
    expect(res.statusCode).toBe(401);
  });

  /**
   * 插件域的 `identity` 字段（安装/评价/上架/我的插件）此前不在 identityOf 的
   * 解析范围内：只带 identity 的请求被签名 hook 视为「无身份」直接放行，
   * 插件路由随后却拿 body.identity 当真实用户 → 配置了密钥也能冒充任意用户。
   */
  it("插件域 identity（query）不带签名 → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins/mine?identity=github:alice" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("身份签名缺失或无效");
  });

  it("插件域 identity（body）不带签名 → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/no-such-plugin/install",
      payload: { identity: "github:alice" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("插件域 identity 签名正确 → 越过签名关卡（业务照常校验）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/no-such-plugin/install",
      headers: { "x-navhub-identity-signature": signIdentity(SECRET, "github:alice") },
      payload: { identity: "github:alice" },
    });
    // 签名通过后才到达业务层：插件不存在 → 404，而不是 401
    expect(res.statusCode).toBe(404);
  });
});
