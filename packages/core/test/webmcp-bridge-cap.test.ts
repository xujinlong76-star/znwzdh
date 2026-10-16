import { describe, it, expect } from "vitest";
import { WebMcpBridge, type WebMcpToolDefinition } from "../src/webmcp-bridge.ts";

function def(name: string): WebMcpToolDefinition {
  return {
    name,
    description: "test tool " + name,
    inputSchema: { type: "object", properties: {} },
  };
}

describe("WebMcpBridge 容量上限", () => {
  it("默认上限 512：内置工具可注册，超限的新工具被拒绝", () => {
    const bridge = new WebMcpBridge();
    expect(bridge.maxToolCount).toBe(512);
    // 内置工具（navhub_echo / navhub_system_info）已占 2 席
    expect(bridge.toolCount).toBeGreaterThanOrEqual(2);
    expect(bridge.registerTool(def("t-extra"), () => ({}))).toBe(true);
  });

  it("达到 maxTools 后新工具返回 false，同名覆盖不受限", () => {
    const bridge = new WebMcpBridge({ maxTools: 16 });
    // 先填满（含内置 2 个）
    let i = 0;
    while (bridge.toolCount < bridge.maxToolCount) {
      expect(bridge.registerTool(def("fill-" + i), () => ({}))).toBe(true);
      i++;
      if (i > 100) throw new Error("fill loop did not converge");
    }
    expect(bridge.registerTool(def("one-too-many"), () => ({}))).toBe(false);
    // 同名覆盖（更新已有工具）不受上限影响
    expect(bridge.registerTool(def("fill-0"), () => ({ updated: true }))).toBe(true);
    expect(bridge.toolCount).toBe(bridge.maxToolCount);
  });

  it("maxTools 越界配置被钳制到 [16, 4096]", () => {
    expect(new WebMcpBridge({ maxTools: 1 }).maxToolCount).toBe(16);
    expect(new WebMcpBridge({ maxTools: 99999 }).maxToolCount).toBe(4096);
  });
});
