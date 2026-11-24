import { describe, expect, it } from "vitest";
import { examNodeLinkCopy } from "../src/lib/exam-node-link-copy.ts";

describe("exam node link copy", () => {
  it.each([
    ["报名", "去官网报名", "官方报名"],
    ["公共科目笔试", "查看官方公告", "官方公告"],
    ["江西成绩复核", "去报名系统申请复核", "报名系统申请复核"],
    ["成绩查询", "去系统查成绩", "系统查询成绩"],
    ["缴费", "去官网缴费", "官方缴费"],
    ["新生预报名", "去官网报名", "官方报名"],
    ["正式报名", "去官网报名", "官方报名"],
    ["考生报考", "去官网报考", "官方报考"],
    ["网上缴费", "去官网缴费", "官方缴费"],
    ["考试", "去官网查看", "官方查看"],
  ])("maps %s to its specific action copy", (label, text, ariaAction) => {
    expect(examNodeLinkCopy(label)).toEqual({ text, ariaAction });
  });

  it("keeps the print-ticket copy as the default for other linked nodes", () => {
    expect(examNodeLinkCopy("打印入口")).toEqual({
      text: "去官网打印准考证",
      ariaAction: "官方打印",
    });
  });
});
