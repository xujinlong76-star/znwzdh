/**
 * 授权策略表 × 真实路由清单的登记闸门。
 *
 * 为什么必须枚举真实路由：策略表（@navhub/core 的 route-policy.ts）本身的
 * 纯函数规则在 core 的单测里已经钉死；真正的风险是**路由新增了而没有人
 * 重新审视它的写域**——例如一条新的 POST 忘了写 `scope:"write"`（默认 public 即匿名可写），
 * 或一条 write 路由被误当成用户域放给个人令牌。本文件把注册期快照
 * `app.routeInventory`（与 openapi.json 同源）逐条过一遍策略表：
 *
 *   1. 默认拒绝方向：未登记的 write/admin 写路由 ⇒ 个人令牌不可触达；
 *   2. 唯一例外清单（PERSONAL_TOKEN_WRITE_ROUTES）必须命中且只命中一条真实写路由；
 *   3. 匿名写面账本（PUBLIC_INSTANCE_WRITE_ROUTES）必须与 public 级写路由逐一对应；
 *   4. 匿名写路由全集是**复核快照**：新增/删除都会红，逼一次显式决定；
 *   5. read 级写方法只允许已复核的计算型路由；
 *   6. 逐路由交叉验证：authz.ts 的 evaluateInstanceWrite 与策略表判定一致。
 *
 * 第 4 条是全文件最有价值的一条：scope 是手写的，漏写不会报错，只会静默变成
 * 匿名可写。快照红的时候不要删行——先回答「这条路由写的是谁的数据」。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PERSONAL_TOKEN_WRITE_ROUTES,
  PUBLIC_INSTANCE_WRITE_ROUTES,
  classifyRoute,
  evaluateInstanceWrite,
  matchesRoutePath,
  personalTokenMayWrite,
  routeKey,
} from "@navhub/core";
import type { RouteScope } from "../src/auth.ts";
import type { RouteEntry } from "../src/openapi.ts";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const isMutating = (method: string): boolean => !SAFE_METHODS.has(method.toUpperCase());

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-route-policy-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "policy.db"),
    embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "models"), enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubPolicyTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

const keyOf = (route: RouteEntry): string => routeKey(route.method, route.url);
const mutating = (): RouteEntry[] => app.routeInventory.filter((r) => isMutating(r.method));
const concretePath = (url: string): string => url.replace(/:([A-Za-z0-9_]+)/g, "probe-1");
const decisionFor = (route: RouteEntry) =>
  classifyRoute({ method: route.method, path: route.url, declaredScope: route.scope });

/**
 * 匿名写路由复核快照（public 级、非安全方法）。
 *
 * 变红时逐条确认三件事，再决定往哪边改：
 *   - 写的是调用者自己的数据？ → 处理器必须有 `userDomainWriteAllowed`/`identityAllowed`；
 *   - 写的是共享实例数据？     → 进 PUBLIC_INSTANCE_WRITE_ROUTES 并写清 why；
 *   - 根本不该匿名可写？       → 把 scope 提成 write/admin。
 */
const ANON_WRITE_SNAPSHOT: readonly string[] = [
  "DELETE /api/crdt/sync",
  "DELETE /api/favorites",
  "DELETE /api/favorites/:siteId",
  "DELETE /api/favorites/folders/:id",
  "DELETE /api/me",
  "DELETE /api/me/sessions/:id",
  "DELETE /api/me/tokens/:id",
  "DELETE /api/plugins/:slug/install",
  "DELETE /api/plugins/:slug/star",
  "DELETE /api/profile",
  "DELETE /api/profile/signals/:kind",
  "DELETE /api/search-history",
  "DELETE /api/search-history/:id",
  "DELETE /api/user/ai/config",
  "DELETE /api/vault/sync",
  "DELETE /api/workspaces/:id/members/:userId",
  "PATCH /api/favorites/:siteId",
  "PATCH /api/favorites/folders/:id",
  "PATCH /api/me/profile",
  "PATCH /api/me/settings",
  "POST /api/copilot/chat",
  "POST /api/crdt/sync",
  "POST /api/design/harmony",
  "POST /api/errors",
  "POST /api/events",
  "POST /api/favorites",
  "POST /api/favorites/folders",
  "POST /api/mcp",
  "POST /api/me/diagnostics",
  "POST /api/me/favorites/sync",
  "POST /api/me/import",
  "POST /api/me/merge",
  "POST /api/me/notifications/:id/read",
  "POST /api/me/notifications/read-all",
  "POST /api/me/prune",
  "POST /api/me/sessions/check",
  "POST /api/me/tokens",
  "POST /api/p2p/signal",
  "POST /api/plugins",
  "POST /api/plugins/:slug/ai-audit",
  "POST /api/plugins/:slug/install",
  "POST /api/plugins/:slug/report",
  "POST /api/plugins/:slug/reviews",
  "POST /api/plugins/:slug/reviews/:id/reply",
  "POST /api/plugins/:slug/reviews/:id/report",
  "POST /api/plugins/:slug/star",
  "POST /api/plugins/:slug/uninstall",
  "POST /api/plugins/:slug/versions",
  "POST /api/plugins/auto-fix",
  "POST /api/plugins/check-urls",
  "POST /api/plugins/diff",
  "POST /api/plugins/pre-audit",
  "POST /api/plugins/validate",
  "POST /api/rank/federated",
  "POST /api/search",
  "POST /api/search-history/batch-delete",
  "POST /api/shortlinks",
  "POST /api/sites/:id/archive",
  "POST /api/sites/cluster",
  "POST /api/speculation/rules",
  "POST /api/submissions",
  "POST /api/tools/synthesize",
  "POST /api/user/ai/canvas/generate",
  "POST /api/user/ai/chat",
  "POST /api/user/ai/config/test",
  "POST /api/user/ai/plugin/generate",
  "POST /api/users/sync",
  "POST /api/vitals",
  "POST /api/workspaces",
  "POST /api/workspaces/:id/members",
  "PUT /api/user/ai/config",
  "PUT /api/vault/sync",
];

/** read 级写方法：全部是计算型（AI 生成 / 诊断 / 推荐），已逐条核对无业务写入 */
const READ_SCOPE_WRITE_ROUTES: readonly string[] = [
  "POST /api/plugins/:slug/ai-heal",
  "POST /api/plugins/:slug/url-deep-diagnose",
  "POST /api/sites/:id/recommend-alternative",
];

describe("路由清单本身足够支撑判定", () => {
  it("注册期快照非空，且三档写路由都有（防止空清单让下列循环变成空转）", () => {
    expect(app.routeInventory.length).toBeGreaterThan(300);
    expect(mutating().length).toBeGreaterThan(100);
    const scopes = new Set(mutating().map((r) => r.scope));
    for (const scope of ["public", "write", "admin"] as RouteScope[]) {
      expect(scopes.has(scope), "缺少 " + scope + " 级写路由").toBe(true);
    }
  });

  it("安全方法在策略表里一律是 read", () => {
    for (const route of app.routeInventory.filter((r) => !isMutating(r.method))) {
      expect(decisionFor(route).mutationClass, keyOf(route)).toBe("read");
    }
  });
});

describe("默认拒绝：未登记的 write/admin 写路由不接受个人令牌", () => {
  it("逐路由：只有登记在个人写清单里的 write 路由才放行", () => {
    for (const route of mutating().filter((r) => r.scope === "write" || r.scope === "admin")) {
      const registered = route.scope === "write" && PERSONAL_TOKEN_WRITE_ROUTES.includes(keyOf(route));
      expect(decisionFor(route).personalTokenAllowed, keyOf(route)).toBe(registered);
    }
  });

  it("个人写清单的每条登记都命中且只命中一条真实写路由（防陈旧 / 防 :param 泛化）", () => {
    expect(PERSONAL_TOKEN_WRITE_ROUTES.length).toBeGreaterThan(0);
    for (const key of PERSONAL_TOKEN_WRITE_ROUTES) {
      const [method, pattern] = key.split(" ") as [string, string];
      const matched = mutating().filter((r) => r.method === method && matchesRoutePath(pattern, r.url));
      expect(matched.length, key + " 命中 " + matched.map(keyOf).join(", ")).toBe(1);
      expect(matched[0]!.scope, key).toBe("write");
      // 登记的是「作者改自己的投稿」这一条语义，不是任何一个以 /api/submissions/ 开头的路径
      expect(matchesRoutePath(pattern, "/api/submissions"), key).toBe(false);
    }
  });
});

describe("匿名写面：账本与快照逐条对应", () => {
  it("账本每条都命中一条 public 级写路由（不陈旧、不带错等级）", () => {
    for (const entry of PUBLIC_INSTANCE_WRITE_ROUTES) {
      const [method, pattern] = entry.route.split(" ") as [string, string];
      const matched = mutating().filter((r) => r.method === method && r.url === pattern);
      expect(matched.length, entry.route + " 在真实路由里不存在").toBe(1);
      expect(matched[0]!.scope, entry.route).toBe("public");
      expect(decisionFor(matched[0]!).mutationClass, entry.route).toBe("instance-write");
    }
  });

  it("账本每一项都写了 why（审计时能直接读懂为什么匿名可写共享数据）", () => {
    for (const entry of PUBLIC_INSTANCE_WRITE_ROUTES) {
      expect(entry.why.trim().length, entry.route).toBeGreaterThan(8);
    }
  });

  it("public 级写路由与复核快照完全一致（新增/删除都会红，逼一次显式决定）", () => {
    const actual = mutating()
      .filter((r) => r.scope === "public")
      .map(keyOf)
      .sort();
    expect(actual).toEqual([...ANON_WRITE_SNAPSHOT].sort());
  });

  it("快照里的每条要么在实例写账本里，要么是用户域（由处理器自行鉴权）", () => {
    const ledger = new Set(PUBLIC_INSTANCE_WRITE_ROUTES.map((e) => e.route));
    for (const route of mutating().filter((r) => r.scope === "public")) {
      const expected = ledger.has(keyOf(route)) ? "instance-write" : "user-write";
      expect(decisionFor(route).mutationClass, keyOf(route)).toBe(expected);
    }
  });
});

describe("read 级写方法只允许计算型", () => {
  it("清单与真实路由一致（新增 read 级 POST 必须先回答「它写不写库」）", () => {
    const actual = mutating()
      .filter((r) => r.scope === "read")
      .map(keyOf)
      .sort();
    expect(actual).toEqual([...READ_SCOPE_WRITE_ROUTES].sort());
  });
});

describe("策略表与 authz.ts 运行时判定一致", () => {
  it("每条 write 级写路由：evaluateInstanceWrite(owner 个人令牌) === 策略表", () => {
    for (const route of mutating().filter((r) => r.scope === "write")) {
      const viaAuthz = evaluateInstanceWrite({
        ownerScoped: true,
        required: "write",
        path: concretePath(route.url),
      });
      expect(viaAuthz.allowed, keyOf(route) + " → " + concretePath(route.url)).toBe(
        personalTokenMayWrite({ method: route.method, path: route.url, declaredScope: "write" }),
      );
    }
  });

  it("实例令牌（owner 为空）不受写域收窄影响", () => {
    for (const route of mutating()) {
      const decision = evaluateInstanceWrite({
        ownerScoped: false,
        required: "write",
        path: concretePath(route.url),
      });
      expect(decision.allowed, keyOf(route)).toBe(true);
    }
  });

  it("具名矩阵：真实路由 × 令牌类型", () => {
    const tables: Array<{ route: string; scope: RouteScope; personal: boolean; why: string }> = [
      { route: "PATCH /api/submissions/:number", scope: "write", personal: true, why: "作者改自己的投稿（唯一登记例外）" },
      { route: "POST /api/sites", scope: "write", personal: false, why: "实例写面：建站" },
      { route: "PATCH /api/categories/:id", scope: "write", personal: false, why: "实例写面：类目" },
      { route: "POST /api/jobs", scope: "write", personal: false, why: "实例写面：任务入队" },
      { route: "DELETE /api/tokens/:id", scope: "admin", personal: false, why: "高危：凭据管理" },
      { route: "POST /api/events", scope: "public", personal: true, why: "匿名同权：遥测" },
      { route: "POST /api/plugins/:slug/ai-heal", scope: "read", personal: true, why: "计算型：诊断不落库" },
    ];
    for (const row of tables) {
      const [method, path] = row.route.split(" ") as [string, string];
      const route = app.routeInventory.find((r) => r.method === method && r.url === path);
      expect(route, row.route + " 在真实路由里不存在").toBeTruthy();
      expect(route!.scope, row.route).toBe(row.scope);
      expect(personalTokenMayWrite({ method, path, declaredScope: row.scope }), row.why).toBe(row.personal);
      if (row.scope === "write") {
        expect(evaluateInstanceWrite({ ownerScoped: true, required: "write", path: concretePath(path) }).allowed, row.why).toBe(
          row.personal,
        );
      }
    }
  });
});
