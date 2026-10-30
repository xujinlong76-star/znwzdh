/**
 * `scripts/check-source-truth.mjs` 的回归。
 *
 * 钉的是 2026-10-30 那个真 bug 的形态：读路径里出现
 * `if (dbItemCount > kvCount) 用表` 的启发式——看着像「智能回落」，
 * 实际是把影子副本当正本，返回站点上根本不存在的幻影视频。
 *
 * 五个要点：真形态要抓得住、注释里的示例不许误报、显式开关的写法不许误伤、
 * 目录级登记必须配上下文收窄（否则 12 处里 11 处误报）、豁免要显式。
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error —— .mjs 无类型声明
import { COUNT_COMPARISON, findCountComparisons, SOURCE_CONTEXT } from "./check-source-truth.mjs";

const NL = "\n";

describe("事实源判据：抓得住那条真 bug", () => {
  it("dbItemCount > kvCount ⇒ 报（正是 storage.ts 那条启发式）", () => {
    const src = [
      "// 事实源选择：表里有数据也不能改成用表",
      "const kvCount = doc.items.length",
      "const dbItemCount = countRows()",
      "if (dbItemCount > kvCount) return readFromDb()",
    ].join(NL);
    const hits = findCountComparisons(src);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain("dbItemCount > kvCount");
  });

  it("countVideos() > 0 ⇒ 不报（和常数比较不是「哪边多用哪边」）", () => {
    const src = "if (countVideos() > 0) return rows";
    expect(findCountComparisons(src)).toHaveLength(0);
  });
});

describe("事实源判据：不许误报", () => {
  it("显式开关判据 ⇒ 不报", () => {
    const src = [
      "const preferDb = resolveVideoStoreMode() === 'db'",
      "if (preferDb) return readFromDb()",
    ].join(NL);
    expect(findCountComparisons(src)).toHaveLength(0);
  });

  it("注释里的示例不报（否则守卫自己写文档都会红）", () => {
    const src = [
      "// 反例：if (dbItemCount > kvCount) 用表 —— 这是明令禁止的",
      "const preferDb = mode === 'db'",
    ].join(NL);
    expect(findCountComparisons(src)).toHaveLength(0);
  });

  it("块注释里的示例也不报", () => {
    const src = "/* if (a.length > b.length) */" + NL + "const x = 1";
    expect(findCountComparisons(src)).toHaveLength(0);
  });
});

describe("事实源判据：目录级登记必须配上下文收窄", () => {
  it("没有选源信号的计数比较 ⇒ 不报（压缩体积/校验上限都是合法的）", () => {
    const src = [
      "export function pick(smaller, bigger) {",
      "  const a = read(smaller)",
      "  const b = read(bigger)",
      "  if (a.length > b.length) return a",
      "  return b",
      "}",
    ].join(NL);
    expect(findCountComparisons(src)).toHaveLength(0);
  });

  it("落在选源上下文里的计数比较 ⇒ 报", () => {
    const src = [
      "// 事实源选择：影子副本不能当正本",
      "const kvCount = doc.items.length",
      "const dbItemCount = countRows()",
      "if (dbItemCount > kvCount) return readFromDb()",
    ].join(NL);
    expect(findCountComparisons(src)).toHaveLength(1);
  });

  it("source-truth-ok 显式豁免 ⇒ 不报（同源完整性检查不是选源）", () => {
    const src = [
      "// source-truth-ok: 同源完整性检查，防截断不是选源",
      "if (items.length < itemCount) return null",
    ].join(NL);
    expect(findCountComparisons(src)).toHaveLength(0);
  });

  it("SOURCE_CONTEXT 对选源词认、对无关词不认", () => {
    expect(SOURCE_CONTEXT.test("preferDb / 事实源 / 回落 / fromKv")).toBe(true);
    expect(SOURCE_CONTEXT.test("pluginList / maxCount / fileSize")).toBe(false);
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
