import { describe, expect, it } from "vitest";
import {
  PERSONAL_TOKEN_WRITE_ROUTES,
  PUBLIC_INSTANCE_WRITE_ROUTES,
  classifyRoute,
  classifyRoute as classify,
  isPersonalUserWritePath,
  matchesRoutePath,
  personalTokenMayWrite,
  routeKey,
  type RouteScopeName,
} from "../src/route-policy.ts";

/**
 * 策略表的纯函数层单测。
 *
 * 真实路由表（388 条）与策略表的一致性由 apps/api/test/route-policy.test.ts
 * 枚举 `app.routeInventory` 核对；这里只钉判定规则本身：优先级、路径匹配边界、
 * 账本形状。两层分开是刻意的——规则错了这里红，登记漏了那边红。
 */
describe("matchesRoutePath：按段匹配，不做前缀放行", () => {
  it("字面量路径必须逐段相等", () => {
    expect(matchesRoutePath("/api/sites", "/api/sites")).toBe(true);
    expect(matchesRoutePath("/api/sites", "/api/sites/bulk")).toBe(false);
    expect(matchesRoutePath("/api/sites", "/api/site")).toBe(false);
  });

  it(":param 只吃一个非空段", () => {
    expect(matchesRoutePath("/api/submissions/:number", "/api/submissions/42")).toBe(true);
    expect(matchesRoutePath("/api/submissions/:number", "/api/submissions/site-abc")).toBe(true);
    expect(matchesRoutePath("/api/submissions/:number", "/api/submissions")).toBe(false);
    expect(matchesRoutePath("/api/submissions/:number", "/api/submissions/42/extra")).toBe(false);
    // 空段不是合法参数值
    expect(matchesRoutePath("/api/submissions/:number", "/api/submissions/")).toBe(false);
  });

  it("多个参数按位置各自匹配", () => {
    expect(matchesRoutePath("/api/plugins/:slug/reviews/:id/reply", "/api/plugins/demo/reviews/r1/reply")).toBe(true);
    expect(matchesRoutePath("/api/plugins/:slug/reviews/:id/reply", "/api/plugins/demo/reviews/r1/report")).toBe(false);
    expect(matchesRoutePath("/api/plugins/:slug/reviews/:id/reply", "/api/plugins/demo/reviews/reply/x")).toBe(false);
  });
});

describe("classifyRoute：优先级与默认方向", () => {
  it("安全方法一律 read，与 scope 无关", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      for (const scope of ["public", "read", "write", "admin"] as RouteScopeName[]) {
        const d = classifyRoute({ method, path: "/api/sites", declaredScope: scope });
        expect(d.mutationClass, method + " " + scope).toBe("read");
        expect(d.basis).toBe("safe-method");
        expect(d.personalTokenAllowed).toBe(true);
      }
    }
  });

  it("个人写例外清单为空 ⇒ 投稿审批落回 write 默认规则（拒绝）", () => {
    // 这里钉的是 2026-10-28 的越权修复：`PATCH /api/submissions/:number` 曾被登记成
    // 「作者改自己的投稿」例外，但该能力从未实现（处理体只有 approve/reject 且无归属校验），
    // 效果是把实例域的审核动作放行给个人令牌。路由改为 admin，例外清空。
    // 「登记优先于默认」这条规则本身因此暂时无例可验；一旦清单非空，
    // apps/api/test/route-policy.test.ts 会要求每条登记都命中真实的 write 级路由。
    expect([...PERSONAL_TOKEN_WRITE_ROUTES]).toEqual([]);
    const d = classifyRoute({ method: "PATCH", path: "/api/submissions/:number", declaredScope: "write" });
    expect(d.mutationClass).toBe("instance-write");
    expect(d.basis).toBe("instance-default");
    expect(d.personalTokenAllowed).toBe(false);
  });

  it("public 级写路由默认按用户域放行", () => {
    const d = classifyRoute({ method: "POST", path: "/api/favorites", declaredScope: "public" });
    expect(d.mutationClass).toBe("user-write");
    expect(d.basis).toBe("public-scope");
    expect(d.personalTokenAllowed).toBe(true);
  });

  it("read 级的非安全方法按计算型放行（无业务写入）", () => {
    const d = classifyRoute({ method: "POST", path: "/api/plugins/:slug/ai-heal", declaredScope: "read" });
    expect(d.mutationClass).toBe("compute");
    expect(d.basis).toBe("read-scope-compute");
    expect(d.personalTokenAllowed).toBe(true);
  });

  it("未登记的 write / admin 级写路由默认进实例域，个人令牌拒绝", () => {
    for (const [method, path, scope] of [
      ["POST", "/api/sites", "write"],
      ["PATCH", "/api/categories/:id", "write"],
      ["POST", "/api/jobs", "write"],
      ["DELETE", "/api/tokens/:id", "admin"],
      ["POST", "/api/backup/restore", "admin"],
    ] as const) {
      const d = classifyRoute({ method, path, declaredScope: scope });
      expect(d.mutationClass, method + " " + path).toBe("instance-write");
      expect(d.basis).toBe("instance-default");
      expect(d.personalTokenAllowed).toBe(false);
    }
  });

  it("账本里的公开实例写路由仍对个人令牌放行（匿名同权），但分类记为实例域", () => {
    for (const entry of PUBLIC_INSTANCE_WRITE_ROUTES) {
      const [method, path] = entry.route.split(" ") as [string, string];
      const d = classifyRoute({ method, path, declaredScope: "public" });
      expect(d.mutationClass, entry.route).toBe("instance-write");
      expect(d.basis).toBe("public-instance-registered");
      expect(d.personalTokenAllowed).toBe(true);
    }
  });
});

describe("策略表形状", () => {
  it("每条登记都是 METHOD /path 形式且带非空理由", () => {
    for (const entry of PUBLIC_INSTANCE_WRITE_ROUTES) {
      expect(entry.route).toMatch(/^[A-Z]+ \/api\//);
      expect(entry.why.trim().length, entry.route).toBeGreaterThan(8);
    }
    for (const key of PERSONAL_TOKEN_WRITE_ROUTES) {
      expect(key).toMatch(/^[A-Z]+ \/api\//);
    }
  });

  it("两张清单不重叠（公开实例写 ≠ 个人写例外）", () => {
    const ledger = new Set(PUBLIC_INSTANCE_WRITE_ROUTES.map((e) => e.route));
    for (const key of PERSONAL_TOKEN_WRITE_ROUTES) expect(ledger.has(key), key).toBe(false);
  });

  it("routeKey 统一大写方法名", () => {
    expect(routeKey("patch", "/api/submissions/:number")).toBe("PATCH /api/submissions/:number");
  });
});

describe("isPersonalUserWritePath 与 personalTokenMayWrite 同源", () => {
  it("清单为空时不放行任何路径（含投稿修改路径）", () => {
    expect(isPersonalUserWritePath("/api/submissions/42")).toBe(false);
    expect(isPersonalUserWritePath("/api/submissions")).toBe(false);
    expect(isPersonalUserWritePath("/api/submissions/42/extra")).toBe(false);
    expect(isPersonalUserWritePath("/api/sites")).toBe(false);
    expect(isPersonalUserWritePath("https://evil.example/api/submissions/42")).toBe(false);
  });

  it("personalTokenMayWrite 只看 write/admin 这一格", () => {
    expect(personalTokenMayWrite({ method: "PATCH", path: "/api/submissions/42", declaredScope: "write" })).toBe(false);
    expect(personalTokenMayWrite({ method: "PATCH", path: "/api/submissions/42", declaredScope: "admin" })).toBe(false);
    expect(classify({ method: "PATCH", path: "/api/submissions/42", declaredScope: "admin" }).mutationClass).toBe("instance-write");
  });
});
