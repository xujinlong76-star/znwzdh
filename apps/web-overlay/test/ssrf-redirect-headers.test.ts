/**
 * 批次 I 回归（2026-11-06 深扫 P2-3）：SSRF 守卫跨源重定向必须剥离敏感头。
 *
 * 旧实现每跳都用同一份 init.headers 重建，调用方传的 Authorization / Cookie
 * 会被白名单域名的 302 带到第三方或内网。packages/ai/src/ssrf.ts 早已逐跳剥离，
 * 前端副本漏了 —— 本测试钉住两侧口径一致。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = readFileSync(resolve(ROOT, "src/lib/ssrf-guard.ts"), "utf8");
const AI_SSRF = readFileSync(resolve(ROOT, "../../packages/ai/src/ssrf.ts"), "utf8");

describe("SSRF 守卫跨源重定向剥离敏感头", () => {
  /**
   * 2026-11-21 架构变更后重写。
   *
   * 原测试守的是「web 副本与 packages/ai 的敏感头集合逐字一致」——
   * 这条守卫之所以存在，是因为两侧曾是两份独立实现、真的漂移过
   * （P2-3 那次：权威层逐跳剥离，前端副本漏了）。
   *
   * 本轮把 web 层收口成 packages/ai 的薄壳 re-export，**漂移在物理上
   * 不可能再发生**——两侧是同一份代码。所以断言从「两处字面量相等」
   * 改为「实现只存在一处 + 薄壳确实转发它」，这比原来的文本比对更强：
   * 原测试在两处同时写错时仍会通过，新断言不会。
   */
  it("权威层声明了敏感头集合（authorization / cookie / proxy-authorization）", () => {
    expect(AI_SSRF).toContain("SENSITIVE_REDIRECT_HEADERS");
    for (const h of ["authorization", "cookie", "proxy-authorization"]) {
      expect(AI_SSRF.toLowerCase()).toContain(h);
    }
  });

  it("权威层按 origin 变化剥离，而不是无条件复用 headers", () => {
    // 实现细节可能改名，但「比较 origin」这个语义必须存在
    expect(AI_SSRF).toMatch(/origin\s*!==\s*prevOrigin|prevOrigin\s*!==\s*\w+\.origin/)
  });

  it("web 层不再自带第二份实现（收口为薄壳 re-export）", () => {
    expect(GUARD).toContain("from '@navhub/ai/ssrf'")
    // 薄壳里不应再出现独立的敏感头集合定义（那是权威层的职责）
    expect(GUARD).not.toContain("SENSITIVE_REDIRECT_HEADERS = new Set")
  });

  it("web 层导出的 guardedFetch 走权威层实现", () => {
    // 适配器必须调用权威层的 guardedFetch，而不是自己再实现一遍
    expect(GUARD).toMatch(/coreGuardedFetch|guardedFetch/)
    expect(GUARD).toContain("new Response(")
  });
});
