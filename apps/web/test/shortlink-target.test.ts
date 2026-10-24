/**
 * 短链目标校验（前端这一份）。
 *
 * `/s/<code>` 是全站唯一的 302 出口：中枢返回的 `target` 可能是历史脏数据、
 * 也可能是别的写入面塞进来的，所以「字面前缀是 /marketplace/」不能当作安全。
 * `packages/core/src/mcp-schemas.ts` 的 `isInternalShortLinkTarget` 是入库/读回侧的
 * 同名实现（apps/web 不依赖 @navhub/core，只能同构复制）——两张用例表在这里和
 * `packages/core/test/shortlink-target.test.ts` 各钉一次，改口径必须同时改两处。
 */
import { describe, expect, it } from "vitest";
import { isInternalShortLinkTarget, MAX_SHORTLINK_TARGET_LENGTH } from "@/lib/shortlink-target";

/** 必须拒掉的目标：每一行都是一个真实的逃逸口 */
const REJECTED_TARGETS: Array<[string, string]> = [
  ["/marketplace/../../admin", "点段规范化后落在 /admin，前缀字面量却过关"],
  ["/marketplace/x/../../../api/users", "同上：多层点段"],
  ["/marketplace/..\\..\\evil.example", "反斜杠被当成路径分隔符"],
  ["/marketplace/..\\./admin", "点段 + 反斜杠混写"],
  ["\\marketplace/x", "不以 /marketplace/ 开头"],
  ["//evil.example/marketplace/x", "协议相对地址：浏览器直接换域"],
  [" /\tmarketplace/x", "空格 + 制表符伪装前缀"],
  ["/marketplace/..\t./admin", "浏览器会先删掉 Tab 再解析，于是变成 ../ 遍历"],
  ["https://evil.example/marketplace/x", "绝对外链"],
  ["javascript:alert(1)", "伪协议"],
];

describe("短链目标：只有站内 /marketplace/ 路径能过", () => {
  it.each(REJECTED_TARGETS)("%s 必须被拒绝（%s）", (target, why) => {
    expect(isInternalShortLinkTarget(target), why).toBe(false);
  });

  it("真实的分享链接形态不得误伤", () => {
    for (const target of [
      "/marketplace/github-copilot-guide",
      "/marketplace/github-copilot-guide?install=1",
      "/marketplace/slug#a-section",
      "/marketplace/%E4%B8%AD%E6%96%87-slug",
      `/marketplace/${"a".repeat(200)}`,
    ]) {
      expect(isInternalShortLinkTarget(target)).toBe(true);
    }
  });

  it("长度上限与中枢入库一致，且不会截断成可过的前缀", () => {
    expect(MAX_SHORTLINK_TARGET_LENGTH).toBe(500);
    const boundary = `/marketplace/${"b".repeat(MAX_SHORTLINK_TARGET_LENGTH - 13)}`;
    expect(boundary.length).toBe(MAX_SHORTLINK_TARGET_LENGTH);
    expect(isInternalShortLinkTarget(boundary)).toBe(true);
    expect(isInternalShortLinkTarget(`${boundary}x`)).toBe(false);
  });

  it("空值 / 非站内前缀一律拒绝", () => {
    expect(isInternalShortLinkTarget("")).toBe(false);
    expect(isInternalShortLinkTarget("/marketplace")).toBe(false);
    expect(isInternalShortLinkTarget("/sites")).toBe(false);
    expect(isInternalShortLinkTarget("marketplace/x")).toBe(false);
  });
});
