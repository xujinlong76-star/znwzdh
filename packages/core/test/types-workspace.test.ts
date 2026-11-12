/**
 * types.ts 补充覆盖：checkWorkspacePermission 权限真值表与
 * canonicalizeUrl 的剩余分支（非 http(s) 协议、非法 URL、根路径锚点）。
 */
import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  checkWorkspacePermission,
  type WorkspaceAction,
  type WorkspaceRole,
} from "../src/types.ts";

describe("checkWorkspacePermission", () => {
  const actions: WorkspaceAction[] = [
    "edit_sites",
    "manage_categories",
    "manage_members",
    "configure_ai",
    "view_audit",
    "delete_workspace",
  ];

  it("owner 全部允许", () => {
    for (const action of actions) {
      expect(checkWorkspacePermission("owner", action)).toBe(true);
    }
  });

  it("maintainer：除 configure_ai / delete_workspace 外全部允许", () => {
    const role: WorkspaceRole = "maintainer";
    expect(checkWorkspacePermission(role, "edit_sites")).toBe(true);
    expect(checkWorkspacePermission(role, "manage_categories")).toBe(true);
    expect(checkWorkspacePermission(role, "manage_members")).toBe(true);
    expect(checkWorkspacePermission(role, "view_audit")).toBe(true);
    expect(checkWorkspacePermission(role, "configure_ai")).toBe(false);
    expect(checkWorkspacePermission(role, "delete_workspace")).toBe(false);
  });

  it("member：仅 edit_sites / manage_categories", () => {
    const role: WorkspaceRole = "member";
    expect(checkWorkspacePermission(role, "edit_sites")).toBe(true);
    expect(checkWorkspacePermission(role, "manage_categories")).toBe(true);
    expect(checkWorkspacePermission(role, "manage_members")).toBe(false);
    expect(checkWorkspacePermission(role, "configure_ai")).toBe(false);
    expect(checkWorkspacePermission(role, "view_audit")).toBe(false);
    expect(checkWorkspacePermission(role, "delete_workspace")).toBe(false);
  });

  it("viewer：全部拒绝；未知 action 拒绝", () => {
    for (const action of actions) {
      expect(checkWorkspacePermission("viewer", action)).toBe(false);
    }
    expect(checkWorkspacePermission("owner", "nonsense" as never)).toBe(false);
  });
});

describe("canonicalizeUrl 剩余分支", () => {
  it("非 http(s) 协议与非法 URL 原样返回", () => {
    expect(canonicalizeUrl("ftp://example.com/a")).toBe("ftp://example.com/a");
    expect(canonicalizeUrl("not a url")).toBe("not a url");
    expect(canonicalizeUrl("")).toBe("");
    expect(canonicalizeUrl("   ")).toBe("");
  });

  it("默认端口被剥离，非默认端口保留", () => {
    expect(canonicalizeUrl("http://example.com:80/a")).toBe("http://example.com/a");
    expect(canonicalizeUrl("https://example.com:443/a")).toBe("https://example.com/a");
    expect(canonicalizeUrl("http://example.com:8080/a")).toBe("http://example.com:8080/a");
  });

  it("根路径：无查询串/锚点时去掉末尾斜杠；有锚点时保留", () => {
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(canonicalizeUrl("https://example.com/#frag")).toBe("https://example.com/#frag");
    expect(canonicalizeUrl("https://example.com/?a=1")).toBe("https://example.com/?a=1");
  });

  it("追踪参数被剥离、剩余参数按字母序排列；域名小写、路径大小写保留", () => {
    expect(canonicalizeUrl("https://EXAMPLE.com/Path/?utm_source=x&b=2&a=1&fbclid=zzz")).toBe(
      "https://example.com/Path?a=1&b=2",
    );
    expect(canonicalizeUrl("HTTPS://Example.COM/Docs/")).toBe("https://example.com/Docs");
  });
});
