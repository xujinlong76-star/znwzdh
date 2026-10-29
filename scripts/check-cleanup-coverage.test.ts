/**
 * `scripts/check-cleanup-coverage.mjs` 的回归。
 *
 * 这条守卫是 2026-10-30 那个真 bug 的直接产物：`removeOfflineVideo` 在 `finally`
 * 里清缓存，却漏了前面 `if (!idb) { …; return }` 的提前分支——「删了还在」。
 * 通用控制流分析太重，所以用登记制 + 「每条 return 都要见清理调用」这条可判据。
 *
 * 钉住四件事：真缺口要报、finally 覆盖不许误报、`cleanup-noop` 豁免要生效、
 * 豁免必须显式（静默跳过就是把守卫变成摆设）。
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error —— .mjs 无类型声明
import { checkSource, returnsWithoutCleanup, splitFunctionBodies } from "./check-cleanup-coverage.mjs";

const RULE = { file: "x.ts", cleanupFn: "invalidate", why: "t" };

describe("清理动作覆盖：函数体切分", () => {
  it("按大括号配对切出函数体，嵌套大括号不提前收尾", () => {
    const src = "function a() { if (x) { return 1 } }\nfunction b() { return 2 }";
    const fns = splitFunctionBodies(src);
    expect(fns.map((f: { name: string }) => f.name)).toEqual(["a", "b"]);
    expect(fns[0].body).toContain("if (x)");
    expect(fns[1].body).toContain("return 2");
  });

  it("export async function 同样识别", () => {
    const fns = splitFunctionBodies("export async function go() { return 1 }");
    expect(fns.map((f: { name: string }) => f.name)).toEqual(["go"]);
  });
});

describe("清理动作覆盖：缺口判定", () => {
  it("提前 return 前没有清理调用 ⇒ 报（这正是 2026-10-30 的 bug 形态）", () => {
    const body = "{\n  if (!idb) { lsRemove(id); return }\n  try { doIt() } finally { invalidate() }\n}";
    const gaps = returnsWithoutCleanup(body, "invalidate");
    expect(gaps).toHaveLength(1);
  });

  it("提前 return 前紧邻清理调用 ⇒ 不报", () => {
    const body = "{\n  if (!idb) { lsRemove(id); invalidate(); return }\n  try { doIt() } finally { invalidate() }\n}";
    expect(returnsWithoutCleanup(body, "invalidate")).toHaveLength(0);
  });

  it("try 块里的 return 被 finally 兜住 ⇒ 不报（否则把合法写法误判成缺口）", () => {
    const body = "{\n  try {\n    return await new Promise((res) => res(1))\n  } catch {\n    return 0\n  } finally {\n    invalidate()\n  }\n}";
    expect(returnsWithoutCleanup(body, "invalidate")).toHaveLength(0);
  });

  it("注释里的 return 不算出口", () => {
    const body = "{\n  // 出错时 return null\n  invalidate()\n}";
    expect(returnsWithoutCleanup(body, "invalidate")).toHaveLength(0);
  });

  it("cleanup-noop 显式豁免 ⇒ 不报（且豁免文字在注释里也认）", () => {
    const body = "{\n  // cleanup-noop: 空集合什么都没写\n  if (!items.length) return 0\n  invalidate()\n}";
    expect(returnsWithoutCleanup(body, "invalidate")).toHaveLength(0);
  });
});

describe("清理动作覆盖：端到端", () => {
  it("只在有清理调用的函数里查，其它函数不牵连", () => {
    const src = [
      "function unrelated() { return 1 }",
      "function touched() { const a = invalidate(); if (!x) { return } try { f() } finally { invalidate() } }",
    ].join("\n");
    const gaps = checkSource(src, RULE);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].fn).toBe("touched");
  });
});
