/**
 * 批次 J 回归（2026-11-06 深扫 P2-4）：enrich 必须接受端到端 deadline。
 *
 * 旧实现 enrichUrl 直连 chatCompletion，自维护 2 次 attempt，完全绕过
 * llm-usage.ts 的 deadlineAt / RetryBudget 治理 → 主模型 + 备用池 + 2 次重试
 * 叠加后最坏耗时远超用户等待，用户关页后上游仍在计费。
 *
 * 这里用源码级断言（不真调模型）钉住三件事：
 *  ① EnrichOptions 暴露 deadlineAt；② tryLlm 每次尝试前检查预算、耗尽即返回 null；
 *  ③ 每次 chatCompletion 的 timeoutMs 经 clampToDeadline 钳制。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clampToDeadline } from "../../../packages/ai/src/deadline.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENRICH = readFileSync(resolve(ROOT, "../../packages/ai/src/enrich.ts"), "utf8");
const ROUTE = readFileSync(resolve(ROOT, "src/routes/enrich.ts"), "utf8");

describe("enrich 端到端 deadline", () => {
  it("EnrichOptions 暴露 deadlineAt 字段", () => {
    expect(ENRICH).toMatch(/deadlineAt\?: number/);
  });

  it("预算耗尽时不再发起新尝试（返回 null 并记 warning）", () => {
    expect(ENRICH).toContain("llm_deadline_exhausted");
    expect(ENRICH).toMatch(/Date\.now\(\) >= deadlineAt[\s\S]{0,80}return null/);
  });

  it("每次尝试的 timeoutMs 经 clampToDeadline 钳制", () => {
    expect(ENRICH).toContain("clampToDeadline(llm.timeoutMs, deadlineAt)");
    expect(ENRICH).toContain('from "./deadline.ts"');
  });

  it("clampToDeadline 语义：钳到剩余预算、耗尽返回 0", () => {
    const now = 1_000_000;
    expect(clampToDeadline(20_000, now + 5_000, now)).toBe(5_000); // 钳到剩余
    expect(clampToDeadline(20_000, now + 60_000, now)).toBe(20_000); // 预算充足
    expect(clampToDeadline(20_000, now - 1, now)).toBe(0); // 已耗尽
    expect(clampToDeadline(20_000, undefined, now)).toBe(20_000); // 不传=历史行为
  });

  it("两个 enrich 路由都传入 INTERACTIVE_LLM_BUDGET_MS 预算", () => {
    expect(ROUTE).toContain("INTERACTIVE_LLM_BUDGET_MS");
    expect((ROUTE.match(/deadlineAt: Date\.now\(\) \+ INTERACTIVE_LLM_BUDGET_MS/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
