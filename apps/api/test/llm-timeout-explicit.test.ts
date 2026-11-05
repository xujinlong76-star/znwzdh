/**
 * 超时「显式性」的存储与解析链测试。
 *
 * 背景：llm.ts 在思考态把超时抬到 60s 下限，于是管理端填的 timeoutMs 对思考请求失效。
 * 修复靠的是一个独立布尔（timeoutMsExplicit），所以必须钉住三件事：
 *   ① 只有真提交过这个数字才算显式；
 *   ② 旧库记录（没有这个键）落回 false，不改变现网行为；
 *   ③ 视图回显的是执行期同一个数字（回显与执行不能分叉）。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import {
  SYSTEM_LLM_CONFIG_KEY,
  enrichLlmOf,
  getSystemLlmConfigView,
  resolveLlm,
  saveSystemLlmConfig,
} from "../src/llm-config.ts";

let dir: string;
let ctx: AppContext;

const PUBLIC_URL = "http://93.184.216.34/v1";
const ACTOR = "admin-test";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-llm-timeout-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "llm-timeout.db"),
    embedding: { enabled: false, cacheDir: join(dir, "models") },
    llm: {
      name: "Agnes 3.0 Flash",
      baseUrl: PUBLIC_URL,
      apiKey: "sk-env-placeholder-1234",
      model: "agnes-3.0-flash",
      timeoutMs: 2000,
      allowPrivateNetwork: true,
    },
    fetch: {
      timeoutMs: 2000,
      maxBytes: 262144,
      maxRedirects: 2,
      allowPrivateNetworks: false,
      userAgent: "NavHubTest/0.1",
    },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
});

afterEach(async () => {
  await ctx.repo.deleteSystemState(SYSTEM_LLM_CONFIG_KEY);
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function rawStored(): Promise<Record<string, unknown> | null> {
  return ctx.repo.getSystemState<Record<string, unknown>>(SYSTEM_LLM_CONFIG_KEY);
}

describe("系统级：超时是否「有人真填过」", () => {
  it("显式提交 25000 ⇒ 落库记为显式，视图回显 25000 而不是 60000", async () => {
    const view = await saveSystemLlmConfig(
      ctx,
      { baseUrl: PUBLIC_URL, model: "agnes-3.0-flash", timeoutMs: 25_000, thinking: true },
      ACTOR,
    );
    expect(await rawStored().then((r) => r?.timeoutMsExplicit)).toBe(true);
    expect(view.timeoutMs).toBe(25_000);
    expect(view.timeoutMsExplicit).toBe(true);
    expect(view.thinkingTimeoutMsEffective).toBe(25_000);
    const resolved = await resolveLlm(ctx);
    expect(resolved.provider.timeoutMs).toBe(25_000);
    expect(resolved.provider.timeoutMsExplicit).toBe(true);
  });

  it("没填超时（值是兜出来的）⇒ 不是显式，回显必须点名思考态被放宽到 60s", async () => {
    const view = await saveSystemLlmConfig(ctx, { baseUrl: PUBLIC_URL, model: "agnes-3.0-flash" }, ACTOR);
    expect(await rawStored().then((r) => r?.timeoutMsExplicit)).toBe(false);
    // 数字仍是兜底的 2000，但生效值不同 —— 这正是修复前「声明值与执行值不一致」的那处，必须可见
    expect(view.timeoutMs).toBe(2_000);
    expect(view.timeoutMsExplicit).toBe(false);
    expect(view.thinkingTimeoutMsEffective).toBe(60_000);
    expect((await resolveLlm(ctx)).provider.timeoutMsExplicit).toBe(false);
  });

  it("省略 timeoutMs 的二次保存不抹掉既有显式性（与 apiKey 同的「不填不改」语义）", async () => {
    await saveSystemLlmConfig(ctx, { baseUrl: PUBLIC_URL, model: "agnes-3.0-flash", timeoutMs: 45_000 }, ACTOR);
    const view = await saveSystemLlmConfig(
      ctx,
      { baseUrl: PUBLIC_URL, model: "agnes-2.5-flash", temperature: 0.5 },
      ACTOR,
    );
    expect(view.timeoutMs).toBe(45_000);
    expect(view.timeoutMsExplicit).toBe(true);
    expect(view.thinkingTimeoutMsEffective).toBe(45_000);
  });

  it("思考关掉时回显等于配置值：放宽只属于真的下发思维链的请求", async () => {
    const view = await saveSystemLlmConfig(
      ctx,
      { baseUrl: PUBLIC_URL, model: "agnes-3.0-flash", timeoutMs: 8_000, thinking: false },
      ACTOR,
    );
    expect(view.thinking).toBe(false);
    expect(view.timeoutMs).toBe(8_000);
    expect(view.thinkingTimeoutMsEffective).toBe(8_000);
  });
});

describe("解析链：旧记录与环境变量", () => {
  it("旧库记录没有该键 ⇒ 读回落 false（保持现网放宽行为，不会静默收紧）", async () => {
    await ctx.repo.setSystemState(SYSTEM_LLM_CONFIG_KEY, {
      enabled: true,
      name: "旧配置",
      baseUrl: PUBLIC_URL,
      model: "agnes-3.0-flash",
      apiKeyEnc: null,
      timeoutMs: 20_000,
      temperature: 0.2,
      maxTokens: 1024,
      jsonMode: "auto",
      allowPrivateNetwork: false,
      thinking: true,
      fallbacks: [],
      updatedAt: 1,
      updatedBy: ACTOR,
    });
    const view = await getSystemLlmConfigView(ctx);
    expect(view.timeoutMsExplicit).toBe(false);
    expect(view.thinkingTimeoutMsEffective).toBe(60_000);
    expect((await resolveLlm(ctx)).provider.timeoutMsExplicit).toBe(false);
  });

  it("读侧声明了该键：写进去的 true 必须活着回来（zod 会剥掉未声明的键）", async () => {
    await ctx.repo.setSystemState(SYSTEM_LLM_CONFIG_KEY, {
      enabled: true,
      name: "已显式",
      baseUrl: PUBLIC_URL,
      model: "agnes-3.0-flash",
      apiKeyEnc: null,
      timeoutMs: 30_000,
      timeoutMsExplicit: true,
      temperature: 0.2,
      maxTokens: 1024,
      jsonMode: "auto",
      allowPrivateNetwork: false,
      thinking: true,
      fallbacks: [{ id: "fb-1", baseUrl: PUBLIC_URL, model: "fb-model", timeoutMs: 15_000, timeoutMsExplicit: true }],
      updatedAt: 2,
      updatedBy: ACTOR,
    });
    const view = await getSystemLlmConfigView(ctx);
    expect(view.timeoutMsExplicit).toBe(true);
    expect(view.thinkingTimeoutMsEffective).toBe(30_000);
    expect(view.fallbacks[0]?.timeoutMsExplicit).toBe(true);
    expect(view.fallbacks[0]?.thinkingTimeoutMsEffective).toBe(15_000);
    // 备用池条目没有密钥，会被解析链整条跳过（这是既有语义），所以这里只验主模型的传递
    expect((await resolveLlm(ctx)).provider.timeoutMsExplicit).toBe(true);
  });

  it("NAVHUB_LLM_TIMEOUT_MS 是部署方的显式赋值：没落库记录时按它生效、不再放宽", async () => {
    const prev = process.env.NAVHUB_LLM_TIMEOUT_MS;
    process.env.NAVHUB_LLM_TIMEOUT_MS = "45000";
    try {
      // 必须重新 loadConfig 且不覆盖 timeoutMs：环境变量真的要落进 config.llm.timeoutMs 才算「部署方设的」
      const envConfig = loadConfig({
        mode: "lite",
        sqlitePath: join(dir, "llm-timeout.db"),
        llm: { baseUrl: PUBLIC_URL, apiKey: "sk-env-placeholder-1234" },
      });
      const envCtx = { ...ctx, config: envConfig } as AppContext;
      const resolved = await resolveLlm(envCtx);
      expect(resolved.source).toBe("env");
      expect(resolved.provider.timeoutMs).toBe(45_000);
      expect(resolved.provider.timeoutMsExplicit).toBe(true);
      expect((await getSystemLlmConfigView(envCtx)).thinkingTimeoutMsEffective).toBe(45_000);
    } finally {
      if (prev === undefined) delete process.env.NAVHUB_LLM_TIMEOUT_MS;
      else process.env.NAVHUB_LLM_TIMEOUT_MS = prev;
    }
  });

  it("环境变量与装配覆盖不一致 ⇒ 不算显式：生效的是覆盖值，放宽照旧", async () => {
    const prev = process.env.NAVHUB_LLM_TIMEOUT_MS;
    process.env.NAVHUB_LLM_TIMEOUT_MS = "45000";
    try {
      // ctx.config 的 timeoutMs 是被 loadConfig 覆盖出来的 2000 —— 那个 45000 从没生效过
      const resolved = await resolveLlm(ctx);
      expect(resolved.source).toBe("env");
      expect(resolved.provider.timeoutMs).toBe(2_000);
      expect(resolved.provider.timeoutMsExplicit).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.NAVHUB_LLM_TIMEOUT_MS;
      else process.env.NAVHUB_LLM_TIMEOUT_MS = prev;
    }
  });

  it("坏掉的环境变量赋值不算显式：它兜回默认值，就不该顺手关掉思考态放宽", async () => {
    const prev = process.env.NAVHUB_LLM_TIMEOUT_MS;
    process.env.NAVHUB_LLM_TIMEOUT_MS = "abc";
    try {
      const envConfig = loadConfig({
        mode: "lite",
        sqlitePath: join(dir, "llm-timeout.db"),
        llm: { baseUrl: PUBLIC_URL, apiKey: "sk-env-placeholder-1234" },
      });
      const envCtx = { ...ctx, config: envConfig } as AppContext;
      const resolved = await resolveLlm(envCtx);
      expect(resolved.provider.timeoutMs).toBe(20_000);
      expect(resolved.provider.timeoutMsExplicit).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.NAVHUB_LLM_TIMEOUT_MS;
      else process.env.NAVHUB_LLM_TIMEOUT_MS = prev;
    }
  });
});

describe("备用池：逐条独立判定显式性", () => {
  it("本次填了超时的条目才锁值，省略的沿用旧条目的显式性", async () => {
    const first = await saveSystemLlmConfig(
      ctx,
      {
        baseUrl: PUBLIC_URL,
        model: "agnes-3.0-flash",
        fallbacks: [
          { id: "fb-tight", baseUrl: PUBLIC_URL, model: "fb-tight", timeoutMs: 12_000, apiKey: "sk-fb-secret-12345678" },
          { baseUrl: PUBLIC_URL, model: "fb-loose" },
        ],
      },
      ACTOR,
    );
    expect(first.fallbacks.map((fb) => [fb.timeoutMs, fb.timeoutMsExplicit])).toEqual([
      [12_000, true],
      [20_000, false],
    ]);

    // 第二次只动模型名、都不带 timeoutMs：填过的条目保持显式，没填过的保持未显式
    const second = await saveSystemLlmConfig(
      ctx,
      {
        baseUrl: PUBLIC_URL,
        model: "agnes-3.0-flash",
        fallbacks: first.fallbacks.map((fb) => ({
          id: fb.id,
          baseUrl: PUBLIC_URL,
          model: fb.model + "-2",
        })),
      },
      ACTOR,
    );
    expect(second.fallbacks.map((fb) => [fb.timeoutMs, fb.timeoutMsExplicit])).toEqual([
      [12_000, true],
      [20_000, false],
    ]);

    // 解析链真的把显式性带到 provider 上（有密钥的条目才会被解出来）
    const resolved = await resolveLlm(ctx);
    expect(resolved.fallbacks).toHaveLength(1);
    expect(resolved.fallbacks[0]?.timeoutMs).toBe(12_000);
    expect(resolved.fallbacks[0]?.timeoutMsExplicit).toBe(true);
    expect(enrichLlmOf(resolved).fallbacks[0]?.timeoutMsExplicit).toBe(true);
  });
});
