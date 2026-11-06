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

describe("ssrf-guard 跨源重定向剥离敏感头", () => {
  it("声明了敏感头集合（authorization / cookie / proxy-authorization）", () => {
    expect(GUARD).toContain("SENSITIVE_HEADERS");
    for (const h of ["authorization", "cookie", "proxy-authorization"]) {
      expect(GUARD.toLowerCase()).toContain(h);
    }
  });

  it("重定向时按 origin 变化剥离，而不是无条件复用 init.headers", () => {
    expect(GUARD).toContain("next.origin !== prevOrigin");
    expect(GUARD).toContain("carriedHeaders");
    // 旧写法 `...(init.headers as ...)` 直接展开进每跳 headers，必须已移除
    expect(GUARD).not.toMatch(/const headers: Record<string, string> = \{[\s\S]{0,120}\.\.\.\(init\.headers/);
  });

  it("与 packages/ai/src/ssrf.ts 的敏感头口径一致（parity）", () => {
    const aiSet = /SENSITIVE_REDIRECT_HEADERS = new Set\(\[([^\]]+)\]\)/.exec(AI_SSRF)?.[1] ?? "";
    const guardSet = /SENSITIVE_HEADERS = new Set\(\[([^\]]+)\]\)/.exec(GUARD)?.[1] ?? "";
    const norm = (s: string) => s.replace(/["'\s]/g, "").toLowerCase();
    expect(norm(guardSet)).toBe(norm(aiSet));
  });
});
