/**
 * `NAVHUB_TRUST_PROXY` 的解析与真实生效行为（2026-10-21 深扫 P2）。
 *
 * 隐患：按 IP 分桶的限流（全局 300/min、投稿 5/hour）用 `req.ip`。
 * Fastify 的 `trustProxy: true` 取的是 `X-Forwarded-For` 的**最左**条目，
 * 而最左条目完全由客户端自己写 —— 于是「每个请求换一个伪造 IP」就能
 * 每个请求换一个限流桶，限流直接归零。仓库此前只有布尔开关，
 * 而 docs/security-notes.md 与 hub-proxy.ts 的注释都在教运维「按跳数配置」，
 * 可 config 根本表达不出更细的配法 —— 这个缺口在这里补上。
 *
 * 实测（Fastify 5.12）关键事实，测试就按这些事实锁：
 *  - `trustProxy: true` + `XFF: 伪造, 真实` → ip = **伪造**（左值，可绕过）
 *  - `trustProxy: "loopback"` + 同样请求 → ip = **真实**（右值，伪造被忽略）
 *  - `trustProxy: 2`（数字）→ XFF 整段忽略，恒为 socket 对端 = 全站共享一桶
 *    ⇒ 数字不是跳数，所以除 1 以外的纯数字必须报错，不能静默接受。
 *
 * 非空性：把 `trustProxyMode` 回退成旧的两行布尔判断，
 * 「loopback 网段列表」用例会拿到伪造 IP、「纯数字必须抛错」用例也会失败。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const ENV_KEY = "NAVHUB_TRUST_PROXY";
const FORGED = "203.0.113.9";
const SEEN_BY_PROXY = "198.51.100.7";

const saved = process.env[ENV_KEY];

function withEnv(raw: string | undefined, fn: () => void) {
  if (raw === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = raw;
  try {
    fn();
  } finally {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  }
}

function parse(raw: string | undefined): unknown {
  let out: unknown;
  withEnv(raw, () => {
    out = loadConfig({ sqlitePath: join(tmpdir(), "navhub-trust-parse.db") }).trustProxy;
  });
  return out;
}

describe("trustProxyMode：解析", () => {
  it("0 / 未设 / false / off → 完全不读 XFF", () => {
    for (const v of [undefined, "", "0", "false", "FALSE", "no", "off"]) {
      expect(parse(v)).toBe(false);
    }
  });

  it("1 / true / yes → 兼容旧语义：信任整条链", () => {
    for (const v of ["1", "true", "TRUE", "yes"]) {
      expect(parse(v)).toBe(true);
    }
  });

  it("proxy-addr 网段列表原样透传（这才是不被伪造的配法）", () => {
    expect(parse("loopback")).toBe("loopback");
    expect(parse(" loopback, 172.16.0.0/12 ")).toBe("loopback, 172.16.0.0/12");
    expect(parse("::1/128")).toBe("::1/128");
  });

  it("除 1 以外的纯数字：明确报错，不静默退化成共享桶", () => {
    expect(() => parse("2")).toThrow(/跳数/);
    expect(() => parse("8")).toThrow(/NAVHUB_TRUST_PROXY/);
  });

  it("拼错的条目：报错信息里点名具体条目（proxy-addr 原生报错看不出是谁配的）", () => {
    expect(() => parse("loopback, boguss")).toThrow(/boguss/);
  });
});

describe("trustProxyMode：真实 req.ip（限流分桶依据）", () => {
  const dirs: string[] = [];
  const contexts: AppContext[] = [];

  async function serverFor(trustProxy: boolean | string) {
    const dir = mkdtempSync(join(tmpdir(), "navhub-trust-"));
    dirs.push(dir);
    const ctx = await createContext(
      loadConfig({ sqlitePath: join(dir, "t.db"), embedding: { enabled: false }, trustProxy } as never),
    );
    contexts.push(ctx);
    const app = await buildServer(ctx);
    // 探针路由：直接把 req.ip 回显，避免依赖具体业务路由的实现细节
    app.get("/__ip_probe", { config: { scope: "public" } }, async (req, reply) => {
      reply.header("content-type", "application/json");
      return { ip: req.ip, ips: req.ips };
    });
    await app.ready();
    return app;
  }

  afterAll(async () => {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it('网段列表配法：伪造的最左条目被忽略，拿到的是代理看到的真实一跳', async () => {
    const app = await serverFor("loopback");
    const res = await app.inject({
      method: "GET",
      url: "/__ip_probe",
      headers: { "x-forwarded-for": `${FORGED}, ${SEEN_BY_PROXY}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ip).toBe(SEEN_BY_PROXY);
    await app.close();
  });

  it("旧 `1` 语义：拿到的是客户端自报的最左值（= 换 IP 就换桶的绕过口）", async () => {
    const app = await serverFor(true);
    const res = await app.inject({
      method: "GET",
      url: "/__ip_probe",
      headers: { "x-forwarded-for": `${FORGED}, ${SEEN_BY_PROXY}` },
    });
    expect(res.json().ip).toBe(FORGED);
    await app.close();
  });

  it("关闭（默认）：XFF 不参与，req.ip 恒为对端地址", async () => {
    const app = await serverFor(false);
    const a = await app.inject({ method: "GET", url: "/__ip_probe", headers: { "x-forwarded-for": FORGED } });
    const b = await app.inject({ method: "GET", url: "/__ip_probe", headers: { "x-forwarded-for": SEEN_BY_PROXY } });
    expect(a.json().ip).toBe(b.json().ip);
    expect(a.json().ip).not.toBe(FORGED);
    await app.close();
  });
});
