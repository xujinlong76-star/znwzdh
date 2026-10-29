/**
 * 语义相似度闸门的配置解析（AI-5）。
 *
 * 默认值 0.40 不是拍脑袋：来自 bge-small-zh-v1.5 的真实标定
 * （deliverables/ai5-vector-2026-10-30），保留 96.9% 相关命中、剔除 73% 噪声。
 * 这里锁住「默认值不能被悄悄改掉」以及越界值的钳制口径：
 * 负数会被当成「关闭」（意外的宽松），>1 会剔除一切（语义通道静默失效）。
 */
import { afterEach, describe, expect, it, afterAll, vi } from "vitest";
import { loadConfig } from "../src/config.ts";

function cfg(search?: { semanticMinSimilarity: number }) {
  return loadConfig({
    mode: "lite",
    sqlitePath: ":memory:",
    corsOrigins: ["*"],
    ...(search ? { search } : {}),
  });
}

afterEach(() => {
  delete process.env.NAVHUB_SEMANTIC_MIN_SIMILARITY;
});

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe("NAVHUB_SEMANTIC_MIN_SIMILARITY", () => {
  it("默认 0.40", () => {
    expect(cfg().search.semanticMinSimilarity).toBe(0.4);
  });

  it("环境变量覆盖", () => {
    process.env.NAVHUB_SEMANTIC_MIN_SIMILARITY = "0.55";
    expect(cfg().search.semanticMinSimilarity).toBe(0.55);
  });

  it("负值钳到 0（关闭），而不是被当成负阈值静默放宽", () => {
    process.env.NAVHUB_SEMANTIC_MIN_SIMILARITY = "-0.3";
    expect(cfg().search.semanticMinSimilarity).toBe(0);
  });

  it("大于 1 钳到 1，而不是让语义通道全体静默消失", () => {
    process.env.NAVHUB_SEMANTIC_MIN_SIMILARITY = "2.5";
    expect(cfg().search.semanticMinSimilarity).toBe(1);
  });

  it("非数字回退到默认值", () => {
    process.env.NAVHUB_SEMANTIC_MIN_SIMILARITY = "abc";
    expect(cfg().search.semanticMinSimilarity).toBe(0.4);
  });

  it("测试装配的 overrides 可显式关闭（部分覆盖不影响其它字段）", () => {
    const c = cfg({ semanticMinSimilarity: 0 });
    expect(c.search.semanticMinSimilarity).toBe(0);
    // 回归：新增 search 段不能挤掉既有顶层配置
    expect(c.mode).toBe("lite");
    expect(c.embedding.model).toBeTruthy();
  });
});
