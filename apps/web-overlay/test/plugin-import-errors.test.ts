/**
 * Phase 2 批 B：插件导入失败文案（设计线 K7）。
 * 三类指导语模板：请先登录 / 同名已存在 / 请稍后重试，
 * 服务端原话（err.message）只做补充，401/403 绝不透传「Unauthorized」。
 */
import { describe, expect, it } from "vitest";
import { formatImportError } from "@/lib/plugin-import-errors";

function errWithStatus(status: number, message: string): Error {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

describe("formatImportError", () => {
  it("401（带 status）：主文案是请先登录，不含 Unauthorized，去登录入口开", () => {
    const view = formatImportError(errWithStatus(401, "Unauthorized"));
    expect(view.needsLogin).toBe(true);
    expect(view.message).toContain("请先登录");
    expect(view.message).not.toContain("Unauthorized");
    expect(view.detail ?? "").not.toContain("Unauthorized");
  });

  it("401（只有原串、无 status）：同样识别为需要登录", () => {
    const view = formatImportError(new Error("Unauthorized"));
    expect(view.needsLogin).toBe(true);
    expect(view.message).toContain("请先登录");
  });

  it("403：同样识别为需要登录", () => {
    const view = formatImportError(errWithStatus(403, "Forbidden"));
    expect(view.needsLogin).toBe(true);
    expect(view.message).toContain("请先登录");
    expect(view.detail ?? "").not.toContain("Forbidden");
  });

  it("409：同名已存在，服务端原话只做补充", () => {
    const view = formatImportError(errWithStatus(409, "插件已存在：my-pack"));
    expect(view.needsLogin).toBe(false);
    expect(view.message).toContain("同名插件已存在");
    expect(view.detail).toBe("插件已存在：my-pack");
  });

  it("其他错误：请稍后重试，服务端原话只做补充", () => {
    const view = formatImportError(new Error("插件清单校验失败：缺少 name"));
    expect(view.needsLogin).toBe(false);
    expect(view.message).toBe("请稍后重试");
    expect(view.detail).toBe("插件清单校验失败：缺少 name");
  });

  it("网络失败：映射为中文网络提示，不透传 Failed to fetch", () => {
    const view = formatImportError(new Error("Failed to fetch"));
    expect(view.message).toBe("请稍后重试");
    expect(view.detail).toContain("网络请求失败");
  });

  it("空错误：仍有请稍后重试主文案，无补充", () => {
    const view = formatImportError(new Error(""));
    expect(view.message).toBe("请稍后重试");
    expect(view.detail).toBeUndefined();
    expect(view.needsLogin).toBe(false);
  });
});
