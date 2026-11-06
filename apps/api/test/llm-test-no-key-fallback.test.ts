/**
 * LLM 连通性测试「凭据外带」回归守卫（2026-11-06 深扫 P0）。
 *
 * 攻击面：/api/user/ai/config/test 是 public 路由，旧实现在省略 apiKey 时会
 * 解密回退到「用户级已存 → 系统级已存 → 环境变量」密钥，并以 Bearer 发往
 * 请求体里任意公网 baseUrl —— 一次请求即可外带全站 LLM Key。
 *
 * 这里做两层零网络守卫：
 *   1) 源码级：testLlmProvider 函数体内不得再出现 openKey / readStoredUser /
 *      readStoredSystem / config.llm.apiKey 任一回退形态；
 *   2) 行为级：省略 apiKey 且非 allowPrivate 时返回 code="config"，且错误文案
 *      明确说明「不会使用已保存的配置」（防止有人把回退改回去但换个文案）。
 *
 * 真实出站请求的 Authorization 头断言放在 llm-gateway-guard 同款注入式用例，
 * 本守卫只钉「服务端不代劳取密钥」这条不变量。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(resolve(ROOT, "src/llm-config.ts"), "utf8");

/** 截取 testLlmProvider 的函数体（到下一个 export 为止），避免扫到别处的合法 openKey */
function testLlmProviderBody(): string {
  const start = SRC.indexOf("export async function testLlmProvider(");
  if (start < 0) throw new Error("找不到 testLlmProvider");
  const rest = SRC.slice(start);
  const next = rest.indexOf("\nexport ", 10);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("LLM 连通性测试不得回退已存密钥", () => {
  it("函数体内不含任何「从存储/配置取密钥」的回退形态", () => {
    const body = testLlmProviderBody();
    const forbidden = [
      "openKey(",
      "readStoredUser(",
      "readStoredSystem(",
      "ctx.config.llm.apiKey",
    ];
    for (const token of forbidden) {
      expect(body, `testLlmProvider 不应出现 ${token}（会把已存密钥发往调用方指定的 baseUrl）`).not.toContain(token);
    }
  });

  it("省略 apiKey 时返回 config 拒绝，且文案明确不使用已保存配置", () => {
    const body = testLlmProviderBody();
    expect(body).toContain("连通性测试必须显式提供待测试的 API 密钥");
    expect(body).toContain("不会使用已保存的配置");
    expect(body).toContain('code: "config"');
  });

  it("apiKey 只来自 input.apiKey，不再有 let + 多次赋值回退", () => {
    const body = testLlmProviderBody();
    // 修复前的形态是 `let apiKey = ...` 后跟 3 段 `if (!apiKey) ...`。
    expect(body).not.toMatch(/let apiKey\s*=/);
    expect(body).toContain("const apiKey = typeof input.apiKey");
  });
});
