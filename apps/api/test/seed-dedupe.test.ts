import { describe, expect, it } from "vitest";

import { shouldImproveDescription } from "../src/seed.ts";

/**
 * 种子去重择优（2026-10-22）。
 *
 * 背景：29 个 site-pack 共 5845 条条目，其中 1093 条是重复 URL（同一站点被
 * 多个垂类包收录）。原实现命中即跳过，等于「先到先得」——后到包里更完整的
 * 描述被永久丢弃。生产集描述长度中位数只有 23 字，丢掉更长的那个是净损失。
 */
describe("shouldImproveDescription：重复 URL 的描述择优", () => {
  it("新描述明显更长时覆盖", () => {
    expect(shouldImproveDescription("AI 代码补全工具。", "AI 代码补全与编程助手，支持 VS Code、JetBrains 等主流编辑器。")).toBe(true);
  });

  it("长度差不足门槛时不覆盖（避免标点级改动产生无意义写入）", () => {
    // 差值 3 字 < 10 字门槛
    expect(shouldImproveDescription("AI 代码补全工具。", "AI 代码补全的工具。")).toBe(false);
  });

  it("新描述更短或等长时不覆盖", () => {
    expect(shouldImproveDescription("很长很长的一段站点介绍文字。", "短介绍。")).toBe(false);
    expect(shouldImproveDescription("同样的描述。", "同样的描述。")).toBe(false);
  });

  it("旧描述为空时，任何非空新描述都覆盖", () => {
    expect(shouldImproveDescription("", "有内容了。")).toBe(true);
    expect(shouldImproveDescription(null, "有内容了。")).toBe(true);
    expect(shouldImproveDescription(undefined, "有内容了。")).toBe(true);
  });

  it("新描述为空时绝不覆盖（不能把已有内容清空）", () => {
    expect(shouldImproveDescription("已有描述。", "")).toBe(false);
    expect(shouldImproveDescription("已有描述。", "   ")).toBe(false);
    expect(shouldImproveDescription("已有描述。", null)).toBe(false);
  });

  it("两侧都空时不覆盖", () => {
    expect(shouldImproveDescription("", "")).toBe(false);
  });
});
