/**
 * `scripts/check-source-truth.mjs` 的回归。
 *
 * 钉的是 2026-10-30 那个真 bug 的形态：读路径里出现
 * `if (dbItemCount > kvCount) 用表` 的启发式——看着像「智能回落」，
 * 实际是把影子副本当正本，返回站点上根本不存在的幻影视频。
 *
 * 三个要点：真形态要抓得住、注释里的示例不许误报、显式开关的写法不许误伤。
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error —— .mjs 无类型声明
import { COUNT_COMPARISON, findCountComparisons } from "./check-source-truth.mjs";

describe("事实源判据：抓得住那条真 bug", () => {
  it("dbItemCount > kvCount ⇒ 报（正是 storage.ts 那条启发式）", () => {
    const src = [
      "export function read(doc) {",
      "  const kvCount = doc.items.length",
      "  const dbItemCount = countRows()",
      "  if (dbItemCount > kvCount) return readFromDb()",
      "  return doc",
      "}",
    ].join("\n");
    const hits = findCountComparisons(src);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain("dbItemCount > kvCount");
  });

  it("a.length < b.length ⇒ 同样报（长度比较也是同一类气味）", () => {
    const src = "if (a.length < b.length) use(b)";
    expect(findCountComparisons(src)).toHaveLength(1);
  });

  it("countVideos() > 0 ⇒ 不报（和常数比较不是「哪边多用哪边」）", () => {
    const src = "if (countVideos() > 0) return rows";
    // 0 不是计数/长度表达式，这条不该命中
    expect(findCountComparisons(src)).toHaveLength(0);
  });
});

describe("事实源判据：不许误报", () => {
  it("显式开关判据 ⇒ 不报", () => {
    const src = [
      "const preferDb = resolveVideoStoreMode() === 'db'",
      "if (preferDb) return readFromDb()",
    ].join("\n");
    expect(findCountComparisons(src)).toHaveLength(0);
  });

  it("注释里的示例不报（否则守卫自己写文档都会红）", () => {
    const src = [
      "// 反例：if (dbItemCount > kvCount) 用表 —— 这是明令禁止的",
      "const preferDb = mode === 'db'",
    ].join("\n");
    expect(findCountComparisons(src)).toHaveLength(0);
  });

  it("块注释里的示例也不报", () => {
    const src = "/* if (a.length > b.length) */\nconst x = 1";
    expect(findCountComparisons(src)).toHaveLength(0);
  });
});

describe("事实源判据：正则形状", () => {
  it("COUNT_COMPARISON 对 Count/length 两类都认", () => {
    expect(COUNT_COMPARISON.test("aCount > bCount")).toBe(true);
    expect(COUNT_COMPARISON.test("x.length >= y.length")).toBe(true);
    expect(COUNT_COMPARISON.test("mode === 'db'")).toBe(false);
    expect(COUNT_COMPARISON.test("n > 0")).toBe(false);
  });
});
