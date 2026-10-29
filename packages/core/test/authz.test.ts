import { describe, expect, it } from "vitest";
import { evaluateInstanceWrite, isPersonalWritePath, pathnameOf } from "../src/authz.ts";

/**
 * 个人令牌的写域边界（P0-3）。
 *
 * 背景：`scopeSatisfies` 是一维等级，个人令牌拿到 write 后会同时通过
 * `POST /api/sites`、`PATCH /api/categories/:id`、`POST /api/jobs` 的门槛。
 * 这组用例把「write 不等于实例域通行证」钉成矩阵：唯一的例外入口是
 * route-policy 的登记清单，而该清单在 2026-10-28 之后是空的
 * （原先唯一一条「作者改自己的投稿」与实现不符，见 route-policy.ts）。
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

  it("个人 write 令牌访问投稿审批 → 拒绝（曾经的唯一例外已清空）", () => {
    // P0 回归锁：这条登记的理由是「作者改自己的投稿」，但该能力从未实现
    // （处理体只有 approve/reject 且无归属校验），例外实际把实例域的审批动作
    // 交给了个人令牌 ⇒ 自审自批。路由已提为 admin，清单清空。
    // 保留 required:"write" 这一格：即使有人把路由重新降成 write，没登记就没放行。
    const decision = evaluateInstanceWrite({
      ownerScoped: true,
      required: "write",
      path: "/api/submissions/42",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("personal_token_instance_write");
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

  it("清单为空时 isPersonalWritePath 不认任何路径（含投稿编号路径）", () => {
    // 按段匹配 vs 按前缀匹配这条性质本身由 test/route-policy.test.ts 的
    // matchesRoutePath 用例钉住；这里只钉「没有登记就没有放行」。
    // 新登记一条例外时，apps/api/test/route-policy.test.ts 会要求它命中且只命中
    // 一条 write 级真实路由，并且不许退化成前缀放行。
    expect(isPersonalWritePath("/api/sites")).toBe(false);
    expect(isPersonalWritePath("/api/submissions")).toBe(false);
    expect(isPersonalWritePath("/api/submissions/9")).toBe(false);
    expect(isPersonalWritePath("/api/submissions/9/extra")).toBe(false);
    // 绝对 URL 不是站内路径：pathnameOf 返回空串，按拒绝处理
    expect(isPersonalWritePath("https://evil.example/api/submissions/9")).toBe(false);
  });
});
