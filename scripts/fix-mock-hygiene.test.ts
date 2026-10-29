/**
 * `scripts/fix-mock-hygiene.mjs` 的自检。
 *
 * 它把「补 mock 卫生钩子」做成确定性操作：`apps/web/test/mock-hygiene.test.ts` 的规则
 * 拦得对，但每新加一个测试文件就可能踩一次——2026-10-29 一晚上追了三轮手工补。
 * 用纯函数做回归，保证补出来的钩子语法正确且幂等。
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error —— .mjs 无类型声明
import { addResetModulesHook, needsHook } from "./fix-mock-hygiene.mjs";

describe("mock 卫生自动补齐：判定", () => {
  it("跨模块 vi.mock 且缺清理 → 要补", () => {
    const src = ["import { describe, it, vi } from 'vitest'", "vi.mock('@/lib/github', () => ({}));", "describe('x', () => {});"].join("\n");
    expect(needsHook(src)).toBe(true);
  });

  it("相对路径的 mock 不算跨模块 → 不补", () => {
    const src = ["import { describe, it, vi } from 'vitest'", "vi.mock('./helper', () => ({}));", "describe('x', () => {});"].join("\n");
    expect(needsHook(src)).toBe(false);
  });

  it("已有 vi.resetModules() → 幂等，不补", () => {
    const src = ["import { afterAll, describe, it, vi } from 'vitest'", "vi.mock('@/lib/github', () => ({}));", "afterAll(() => vi.resetModules());", "describe('x', () => {});"].join("\n");
    expect(needsHook(src)).toBe(false);
    expect(addResetModulesHook(src)).toBe(src);
  });

  it("完全没有 vi.mock → 不补", () => {
    const src = ["import { describe, it } from 'vitest'", "describe('x', () => {});"].join("\n");
    expect(needsHook(src)).toBe(false);
  });
});

describe("mock 卫生自动补齐：改写", () => {
  it("在第一条 describe 前插入钩子，并把 afterAll 加进 import", () => {
    const src = [
      "import { describe, it, vi } from 'vitest'",
      "vi.mock('@/lib/github', () => ({}));",
      "",
      "describe('外层', () => {",
      "  it('a', () => {});",
      "});",
    ].join("\n");
    const out = addResetModulesHook(src);

    // import 里补了 afterAll，且没重复
    expect(out).toContain("import { describe, it, vi, afterAll } from 'vitest'");
    expect(out.match(/afterAll/g)?.length).toBeGreaterThanOrEqual(2);

    // 钩子在第一条 describe 之前
    const hookAt = out.indexOf("vi.resetModules()");
    const describeAt = out.indexOf("describe(");
    expect(hookAt).toBeGreaterThan(-1);
    expect(hookAt).toBeLessThan(describeAt);

    // 原有内容没被破坏
    expect(out).toContain("describe('外层', () => {");
    expect(out).toContain("vi.mock('@/lib/github', () => ({}));");
  });

  it("多行 import 同样能补，且不动已有 afterAll", () => {
    const src = [
      "import {",
      "  describe,",
      "  it,",
      "  afterAll,",
      "  vi,",
      "} from 'vitest'",
      "vi.mock('@/lib/github', () => ({}));",
      "describe('x', () => {});",
    ].join("\n");
    const out = addResetModulesHook(src);
    // 已有 afterAll 就不再加
    expect(out.match(/afterAll/g)?.length).toBeGreaterThanOrEqual(2);
    expect(out).toContain("vi.resetModules()");
  });

  it("补两次是幂等的（第二次原样返回）", () => {
    const src = ["import { describe, it, vi } from 'vitest'", "vi.mock('@/lib/x', () => ({}));", "describe('x', () => {});"].join("\n");
    const once = addResetModulesHook(src);
    const twice = addResetModulesHook(once);
    expect(twice).toBe(once);
  });
});
