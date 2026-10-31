/**
 * `scripts/fix-mock-hygiene.mjs` 的自检。
 *
 * 它把「补 mock 卫生钩子」做成确定性操作：`apps/web/test/mock-hygiene.test.ts` 的规则
 * 拦得对，但每新加一个测试文件就可能踩一次——2026-10-29 一晚上追了三轮手工补。
 * 用纯函数做回归，保证补出来的钩子语法正确且幂等。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error —— .mjs 无类型声明
import { addResetModulesHook, findHygieneViolations, needsHook } from "./fix-mock-hygiene.mjs";

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

  it("写 process.env 但没 afterAll → 要补（mock 卫生的第二条规则）", () => {
    const src = [
      "import { describe, it, vi } from 'vitest'",
      "describe('x', () => {",
      "  it('a', () => { process.env.FOO = '1' })",
      "})",
    ].join("\n");
    expect(needsHook(src)).toBe(true);
    const out = addResetModulesHook(src);
    expect(out).toContain("afterAll");
    expect(out).toContain("process.env.FOO");
  });

  it("读 process.env 不算改写 → 不补", () => {
    const src = ["import { describe, it } from 'vitest'", "describe('x', () => { it('a', () => { const v = process.env.FOO }) })"].join("\n");
    expect(needsHook(src)).toBe(false);
  });

  it("显式豁免（mock-hygiene: exempt）→ 不补", () => {
    const src = ["// mock-hygiene: exempt", "import { describe, it, vi } from 'vitest'", "vi.mock('@/lib/x', () => ({}));", "describe('x', () => {});"].join("\n");
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

/**
 * pre-push 档（--head）：推送出去的只有 HEAD。
 *
 * 2026-10-31 实测：并行会话 19:06 新建的 video-shrink-confirm.test.ts 还缺兜底，
 * 按工作区扫的门禁把一笔只含 gate 脚本的推送挡了两次——那个文件根本不在推送内容里。
 * 这一组钉住「工作区未跟踪文件不参与、HEAD 缺口照样点名」，以及闸门确实传了 --head。
 */
describe("HEAD 口径（pre-push）只判已入库内容", () => {
  const violating = [
    "import { describe, it, vi } from 'vitest'",
    "vi.mock('@/lib/github', () => ({}));",
    "describe('x', () => {});",
  ].join("\n");
  const clean = [
    "import { afterAll, describe, it, vi } from 'vitest'",
    "vi.mock('@/lib/github', () => ({}));",
    "afterAll(() => vi.resetModules());",
    "describe('x', () => {});",
  ].join("\n");

  it("HEAD 里已入库的缺口要点名", () => {
    expect(findHygieneViolations([{ path: "apps/web/test/a.test.ts", src: violating }])).toEqual([
      "apps/web/test/a.test.ts",
    ]);
  });

  it("已带兜底的入库文件不报", () => {
    expect(findHygieneViolations([{ path: "apps/web/test/a.test.ts", src: clean }])).toEqual([]);
  });

  it("只认测试文件：源码里出现 vi.mock 不算", () => {
    expect(findHygieneViolations([{ path: "apps/web/src/lib/a.ts", src: violating }])).toEqual([]);
  });

  it("pre-push 闸门传的是 --head（不按工作区判）", () => {
    const src = readFileSync(new URL("./prepush-gates.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(src).toContain('runNode(["scripts/fix-mock-hygiene.mjs", "--head"])');
  });
});
