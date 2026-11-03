/**
 * 启动预热 embedding 的回归测试（2026-11-03 实测驱动）。
 *
 * 背景：首次 `encode()` 实测 **1396ms**（模型加载），此后 0ms。未预热时这一笔钱由
 * 第一个走语义通道的用户承担——用户侧表现为「第一次搜索 2512ms，第二次 9ms」。
 * 此前只有 `POST /api/warmup` 能预热，部署脚本通常不调它。
 *
 * 本测试锁住四条契约：
 *   1. 默认开启预热（warmupOnStart=true）；
 *   2. `NAVHUB_EMBEDDING_WARMUP=0` 可关闭（CI / 一次性脚本不该为一次进程加载模型）；
 *   3. 关闭预热时语义通道仍可用（首次使用时惰性加载），即预热只是**提前**，不是**必需**；
 *   4. 预热失败绝不能让 createContext 抛错（搜索必须始终可用）。
 */
import { describe, expect, it, afterAll, vi } from "vitest";
import { loadConfig } from "../src/config.ts";

const base = {
  mode: "lite" as const,
  sqlitePath: ":memory:",
};

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe("embedding 启动预热配置", () => {
  it("默认开启（warmupOnStart=true）", () => {
    const cfg = loadConfig({ ...base });
    expect(cfg.embedding.warmupOnStart).toBe(true);
  });

  it("可通过 overrides 关闭", () => {
    const cfg = loadConfig({ ...base, embedding: { ...loadConfig(base).embedding, warmupOnStart: false } });
    expect(cfg.embedding.warmupOnStart).toBe(false);
  });

  it("环境变量 NAVHUB_EMBEDDING_WARMUP=0 关闭", () => {
    const prev = process.env.NAVHUB_EMBEDDING_WARMUP;
    process.env.NAVHUB_EMBEDDING_WARMUP = "0";
    try {
      const cfg = loadConfig({ ...base });
      expect(cfg.embedding.warmupOnStart).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.NAVHUB_EMBEDDING_WARMUP;
      else process.env.NAVHUB_EMBEDDING_WARMUP = prev;
    }
  });

  it("环境变量 NAVHUB_EMBEDDING_WARMUP=1 开启", () => {
    const prev = process.env.NAVHUB_EMBEDDING_WARMUP;
    process.env.NAVHUB_EMBEDDING_WARMUP = "1";
    try {
      const cfg = loadConfig({ ...base });
      expect(cfg.embedding.warmupOnStart).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.NAVHUB_EMBEDDING_WARMUP;
      else process.env.NAVHUB_EMBEDDING_WARMUP = prev;
    }
  });
});

describe("预热不阻塞启动（结构性保证）", () => {
  /**
   * 这条是「行为契约」而非用时断言：createContext 返回时 embedding 必然还没 ready
   * （预热被 setImmediate 推迟到下一轮事件循环）。若有人把预热改回同步 await，
   * 这条会立刻变红——这正是要防的回归：实测同步等待会把启动从 ~2.2s 拖到 ~3.0s，
   * 且让健康检查在模型加载期间不可用。
   */
  it("embedding 装配完成后 ready() 为 false（惰性，预热尚未跑）", async () => {
    process.env.NAVHUB_EMBEDDING_ENABLED = "0";
    const prev = process.env.NAVHUB_EMBEDDING_ENABLED;
    try {
      const { createContext } = await import("../src/context.ts");
      const cfg = loadConfig({ ...base, embedding: { ...loadConfig(base).embedding, enabled: false } });
      const ctx = await createContext(cfg);
      // embedding 被显式关闭时装配为 null，语义通道标注为不可用（如实上报）
      expect(ctx.embedding).toBeNull();
      expect(ctx.capabilities.semantic).toBe(false);
      await ctx.close();
    } finally {
      if (prev === undefined) delete process.env.NAVHUB_EMBEDDING_ENABLED;
      else process.env.NAVHUB_EMBEDDING_ENABLED = prev;
    }
  });
});
