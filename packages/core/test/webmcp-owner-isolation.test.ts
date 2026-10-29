import { describe, expect, it } from "vitest";
import { WebMcpBridge, type WebMcpToolDefinition } from "../src/webmcp-bridge.ts";

/**
 * 工具供应链安全（P1-1）。
 *
 * 旧行为：`registerTool` 对同名工具直接覆盖，且 `tools/call` 不做归属校验——
 * 任意持 read 令牌（或开放模式匿名）的调用方都能注册一个与内置同名的工具，
 * 等别人来调用（tool poisoning），并把任意 URL/方法带进 SSRF 面。
 */
const def = (name: string): WebMcpToolDefinition => ({
  name,
  description: name,
  inputSchema: { type: "object", properties: {} },
});

const callTool = (bridge: WebMcpBridge, name: string, caller: string | null) =>
  bridge.handleRpc(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } },
    caller,
  );

describe("WebMcpBridge：按 owner 隔离的工具注册表", () => {
  it("私有工具只对注册者可见、可调用", async () => {
    const bridge = new WebMcpBridge();
    const reg = bridge.registerOwnedTool(def("alice_tool"), () => ({ ok: true }), "alice");
    expect(reg.ok).toBe(true);

    expect(bridge.listTools("alice").some((t) => t.name === "alice_tool")).toBe(true);
    expect(bridge.listTools("bob").some((t) => t.name === "alice_tool")).toBe(false);
    expect(bridge.listTools(null).some((t) => t.name === "alice_tool")).toBe(false);

    const ok = await callTool(bridge, "alice_tool", "alice");
    expect(ok.error).toBeUndefined();

    // 不可见与不存在返回同一个错误：不泄露私有工具的存在
    const denied = await callTool(bridge, "alice_tool", "bob");
    expect(denied.error?.code).toBe(-32601);
  });

  it("跨 owner 同名注册被拒绝（conflict），同 owner 可覆盖", () => {
    const bridge = new WebMcpBridge();
    expect(bridge.registerOwnedTool(def("shared_name"), () => "alice", "alice").ok).toBe(true);

    const conflict = bridge.registerOwnedTool(def("shared_name"), () => "bob", "bob");
    expect(conflict).toEqual({ ok: false, reason: "conflict" });
    expect(bridge.ownerOf("shared_name")).toBe("alice");

    // 同 owner 覆盖：升级自己注册的工具是合法操作
    expect(bridge.registerOwnedTool(def("shared_name"), () => "alice-v2", "alice").ok).toBe(true);
  });

  it("内置工具（owner=null）对所有调用方可见", async () => {
    const bridge = new WebMcpBridge();
    expect(bridge.listTools("alice").some((t) => t.name === "navhub_echo")).toBe(true);
    expect(bridge.listTools(null).some((t) => t.name === "navhub_echo")).toBe(true);
    const res = await callTool(bridge, "navhub_echo", null);
    expect(res.error).toBeUndefined();
  });

  it("表满只影响新工具，不影响同 owner 覆盖", () => {
    const bridge = new WebMcpBridge({ maxTools: 16 });
    // 构造 16 个（含 2 个内置）→ 直接塞满
    for (let i = 0; i < 14; i++) {
      expect(bridge.registerOwnedTool(def("t" + i), () => i, "alice").ok).toBe(true);
    }
    expect(bridge.registerOwnedTool(def("overflow"), () => 0, "alice")).toEqual({ ok: false, reason: "full" });
    // 覆盖已有工具仍允许
    expect(bridge.registerOwnedTool(def("t0"), () => "v2", "alice").ok).toBe(true);
  });
});
