import { describe, expect, it } from "vitest";
import { COPILOT_FRAME_TYPES, isCopilotFrameType, parseCopilotFrame } from "../src/copilot-frame.ts";

describe("Copilot 帧类型白名单", () => {
  it("恰好三种且顺序稳定：新增帧必须同步两端", () => {
    expect([...COPILOT_FRAME_TYPES]).toEqual(["delta", "reasoning", "done"]);
  });

  it("isCopilotFrameType 只认白名单里的字符串", () => {
    expect(isCopilotFrameType("delta")).toBe(true);
    expect(isCopilotFrameType("done")).toBe(true);
    expect(isCopilotFrameType("status")).toBe(false);
    expect(isCopilotFrameType("")).toBe(false);
    expect(isCopilotFrameType(undefined)).toBe(false);
    expect(isCopilotFrameType(1)).toBe(false);
  });
});

describe("parseCopilotFrame：运行时解析", () => {
  it("delta / reasoning 保留原文", () => {
    expect(parseCopilotFrame(JSON.stringify({ type: "delta", text: "你好" }))).toEqual({ type: "delta", text: "你好" });
    expect(parseCopilotFrame(JSON.stringify({ type: "reasoning", text: "先想一下" }))).toEqual({
      type: "reasoning",
      text: "先想一下",
    });
  });

  it("done 保留全部扩展字段（引用 / 额度 / 建议 / 降级原因）", () => {
    const done = {
      type: "done",
      ok: true,
      reply: "终稿",
      model: "gpt-x",
      citations: [{ siteId: "s1", title: "站", url: "https://a.example" }],
      quota: { scope: "identity", metric: "calls", limit: 10, used: 3, retryAfterSeconds: 60 },
      suggestions: ["再问一个"],
      degraded: "error",
    };
    expect(parseCopilotFrame(JSON.stringify(done))).toMatchObject(done);
  });

  it("未知 type 一律丢弃：静默降级也好过把第四种帧当正文", () => {
    expect(parseCopilotFrame(JSON.stringify({ type: "status", text: "内部状态" }))).toBeNull();
    expect(parseCopilotFrame(JSON.stringify({ type: "tool_call", name: "x" }))).toBeNull();
  });

  it("坏 JSON / 非对象 / 数组 / 空输入都返回 null，不抛错", () => {
    expect(parseCopilotFrame("{broken")).toBeNull();
    expect(parseCopilotFrame("null")).toBeNull();
    expect(parseCopilotFrame("[]")).toBeNull();
    expect(parseCopilotFrame('"delta"')).toBeNull();
    expect(parseCopilotFrame("")).toBeNull();
    expect(parseCopilotFrame("   ")).toBeNull();
  });

  it("delta / reasoning 缺文本或文本为空：整帧丢弃（没有可渲染的内容）", () => {
    expect(parseCopilotFrame(JSON.stringify({ type: "delta" }))).toBeNull();
    expect(parseCopilotFrame(JSON.stringify({ type: "delta", text: 123 }))).toBeNull();
    expect(parseCopilotFrame(JSON.stringify({ type: "delta", text: "" }))).toBeNull();
    expect(parseCopilotFrame(JSON.stringify({ type: "reasoning", text: null }))).toBeNull();
  });

  it("done 的两个关键字段形状不对就丢弃，避免抽屉按错误类型渲染", () => {
    expect(parseCopilotFrame(JSON.stringify({ type: "done", reply: 123 }))).toBeNull();
    expect(parseCopilotFrame(JSON.stringify({ type: "done", ok: "true", reply: "好" }))).toBeNull();
  });

  it("done 允许省略 reply / ok（错误终稿走 ok=false + error 的形态由上层处理）", () => {
    expect(parseCopilotFrame(JSON.stringify({ type: "done" }))).toEqual({ type: "done" });
    expect(parseCopilotFrame(JSON.stringify({ type: "done", ok: false, code: "upstream_cancelled" }))).toEqual({
      type: "done",
      ok: false,
      code: "upstream_cancelled",
    });
  });
});
