/**
 * 模块实例净化测试（vitest 风格）。
 *
 * 锁定"僵尸卡片"回归：含失效模块类型的 JSON 必须在加载/导入时被净化，
 * 否则 UI 上会出现没有删除入口、永远移不掉的占位卡片。
 */
import { describe, expect, it } from "vitest";
import { sanitizeWidgetInstances } from "../src/lib/modular/sanitize";

// 模拟注册表谓词（真实场景由 use-modular-layout 传 WIDGET_REGISTRY 查询）
const isKnownType = (type: string) => ["clock-pomodoro", "quick-tools", "weather"].includes(type);

const valid = { id: "w-1", type: "clock-pomodoro", colSpan: 3, rowSpan: 1, config: {}, createdAt: 1 };

describe("sanitizeWidgetInstances", () => {
  it("有效实例原样保留", () => {
    expect(sanitizeWidgetInstances([valid] as never, isKnownType).length).toBe(1);
  });

  it("失效类型被剔除（旧版导出 / 注册表改名）", () => {
    expect(
      sanitizeWidgetInstances([{ ...valid, id: "w-2", type: "ghost-widget" }] as never, isKnownType).length,
    ).toBe(0);
  });

  it("非对象条目被剔除", () => {
    expect(sanitizeWidgetInstances([null, undefined, 42, "x"] as never, isKnownType).length).toBe(0);
  });

  it("缺 type 字段 / type 非字符串被剔除", () => {
    expect(sanitizeWidgetInstances([{ id: "w-3" }] as never, isKnownType).length).toBe(0);
    expect(sanitizeWidgetInstances([{ id: "w-4", type: 7 }] as never, isKnownType).length).toBe(0);
  });

  it("非数组输入安全返回空数组（localStorage 损坏 / JSON 形状意外）", () => {
    expect(sanitizeWidgetInstances(null as never, isKnownType)).toEqual([]);
    expect(sanitizeWidgetInstances("not-array" as never, isKnownType)).toEqual([]);
    expect(sanitizeWidgetInstances({} as never, isKnownType)).toEqual([]);
  });

  it("混合数组只留有效的，且保持原有顺序；不修改原数组", () => {
    const mixed = [
      { ...valid, id: "a", type: "ghost" },
      { ...valid, id: "b", type: "quick-tools" },
      null,
      { ...valid, id: "c", type: "weather" },
    ];
    const kept = sanitizeWidgetInstances(mixed as never, isKnownType);
    expect(kept.length).toBe(2);
    expect(kept[0].id).toBe("b");
    expect(kept[1].id).toBe("c");
    expect(mixed.length).toBe(4);
  });
});
