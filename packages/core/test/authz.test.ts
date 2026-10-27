import { describe, expect, it } from "vitest";
import { evaluateInstanceWrite, isPersonalWritePath, pathnameOf } from "../src/authz.ts";

/**
 * 个人令牌的写域边界（P0-3）。
 *
 * 背景：`scopeSatisfies` 是一维等级，个人令牌拿到 write 后会同时通过
 * `POST /api/sites`、`PATCH /api/categories/:id`、`POST /api/jobs` 的门槛。
 * 这组用例把「write 在用户域可用、在实例域不可用」钉成矩阵。
 */
describe("evaluateInstanceWrite：个人令牌不得触达实例写面", () => {
  it("个人 write 令牌访问站点/类目/任务写端点 → 拒绝", () => {
    for (const path of [
      "/api/sites",
      "/api/sites/site-1",
      "/api/categories",
      "/api/categories/cat-1/move",
      "/api/tags/merge",
      "/api/collections",
      "/api/jobs",
      "/api/jobs/job-1/cancel",
      "/api/plugins/demo/featured",
    ]) {
      const decision = evaluateInstanceWrite({ ownerScoped: true, required: "write", path });
      expect(decision.allowed, path).toBe(false);
      expect(decision.reason).toBe("personal_token_instance_write");
    }
  });

  it("个人 write 令牌访问投稿修改 → 放行（用户域例外）", () => {
    const decision = evaluateInstanceWrite({
      ownerScoped: true,
      required: "write",
      path: "/api/submissions/42",
    });
    expect(decision.allowed).toBe(true);
  });

  it("实例令牌（owner 为空）不受影响", () => {
    const decision = evaluateInstanceWrite({ ownerScoped: false, required: "write", path: "/api/sites" });
    expect(decision.allowed).toBe(true);
  });

  it("read / admin 等级不在这条规则里收窄", () => {
    expect(evaluateInstanceWrite({ ownerScoped: true, required: "read", path: "/api/sites" }).allowed).toBe(true);
    expect(evaluateInstanceWrite({ ownerScoped: true, required: "admin", path: "/api/sites" }).allowed).toBe(true);
  });

  it("带 query / hash 的路径按 pathname 判定，不能被绕过", () => {
    expect(evaluateInstanceWrite({ ownerScoped: true, required: "write", path: "/api/sites?x=1" }).allowed).toBe(false);
    expect(evaluateInstanceWrite({ ownerScoped: true, required: "write", path: "/api/sites#frag" }).allowed).toBe(false);
    // 绝对 URL 不是站内路径：按拒绝处理（pathnameOf 返回空串）
    expect(pathnameOf("https://evil.example/api/sites")).toBe("");
    expect(evaluateInstanceWrite({ ownerScoped: true, required: "write", path: "https://evil.example/api/sites" }).allowed).toBe(false);
  });

  it("按段匹配而不是前缀：只放行真正的投稿编号路径", () => {
    expect(isPersonalWritePath("/api/sites")).toBe(false);
    expect(isPersonalWritePath("/api/submissions")).toBe(false);
    expect(isPersonalWritePath("/api/submissions/9")).toBe(true);
    // 前缀匹配会连带放行未来新增的 /api/submissions/export；按段匹配不会
    expect(isPersonalWritePath("/api/submissions/export/deep")).toBe(false);
  });
});
