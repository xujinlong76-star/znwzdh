/**
 * 模型配置的「存得进也要读得出」回归（AI-3 流式记账带出来的缺陷）。
 *
 * 现象：管理端把深度思考关掉之后，`llm_usage` 里仍然每条都记 `thinking=1`，
 * 且流式/非流式的超时都被抬到 60s。根因不在写入端——`saveSystemLlmConfig`
 * 老老实实把 `thinking: false` 落进了 system_states，但**读取端的 zod 对象
 * 没有声明这个键**，未声明的键会被剥掉，于是 `toProvider` 拿到 undefined，
 * 再按「旧配置没有该字段 ⇒ 产品默认开」兜底成 true。
 *
 * 这类缺陷的隐蔽之处在于：写侧、读侧、UI 三处都「看起来对」，只有真正下发
 * 请求时才露馅。所以这里锁的是消费点 `resolveLlm` 的返回值，而不是存储 JSON。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { resolveLlm, saveSystemLlmConfig } from "../src/llm-config.ts";

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-llm-config-thinking-"));
  ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 127.0.0.1 + 私网放行：过得了 SSRF 闸门，又不需要真出门 */
const baseUrl = "http://127.0.0.1:11434/v1";

async function saveSystem(thinking: boolean | undefined, fallbackThinking?: boolean) {
  await saveSystemLlmConfig(
    ctx,
    {
      enabled: true,
      baseUrl,
      model: "main-model",
      apiKey: "sk-fake",
      allowPrivateNetwork: true,
      thinking,
      // 备用池按 id 沿用旧值：没有 id 时「不填不改」的语义不成立
      fallbacks: [
        { id: "backup-1", baseUrl, model: "backup-model", apiKey: "sk-fake", allowPrivateNetwork: true, thinking: fallbackThinking },
      ],
    },
    "test",
  );
  return resolveLlm(ctx, null);
}

describe("系统级 thinking：关得掉、读得出、不填不改", () => {
  it("显式关掉 ⇒ 主模型与备用池的 provider.thinking 都是 false", async () => {
    const resolved = await saveSystem(false, false);
    expect(resolved.provider.thinking).toBe(false);
    // 备用池以前连这个字段都不存：主模型关了、轮换之后又悄悄开回去
    expect(resolved.fallbacks[0]?.thinking).toBe(false);
  });

  it("省略 thinking ⇒ 沿用既有的关（不是每次都回到产品默认开）", async () => {
    await saveSystem(false, false);
    const again = await saveSystem(undefined, undefined);
    expect(again.provider.thinking).toBe(false);
    expect(again.fallbacks[0]?.thinking).toBe(false);
  });

  it("显式打开 ⇒ 两处都回到 true", async () => {
    const resolved = await saveSystem(true, true);
    expect(resolved.provider.thinking).toBe(true);
    expect(resolved.fallbacks[0]?.thinking).toBe(true);
  });
});
