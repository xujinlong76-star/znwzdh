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
 *   2. 个人写例外清单（PERSONAL_TOKEN_WRITE_ROUTES）当前必须是空的；非空时每条
 *      必须命中且只命中一条 write 级真实路由；
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

/**
 * 仍未显式声明 scope 的写路由（注册期默认 public）。
 *
 * 它们全部是**用户域写面**：身份与写权限由处理器里的 `userDomainWriteAllowed`
 * 把关，scope 在这里只是一档等级，漏写不会导致匿名可改共享数据（快照测试
 * 另有逐条判定）。这份基线存在的意义是把「漏写」这一事实留存下来：
 * 新路由漏写会立刻红，而不是混进匿名写快照的差异里被当成正常新增。
 */
const IMPLICIT_SCOPE_BASELINE: readonly string[] = [
  "POST /api/search",
  "POST /api/favorites",
  "DELETE /api/favorites/:siteId",
  "PATCH /api/favorites/:siteId",
  "DELETE /api/favorites",
  "POST /api/favorites/folders",
  "DELETE /api/favorites/folders/:id",
  "PATCH /api/favorites/folders/:id",
  "DELETE /api/search-history/:id",
  "DELETE /api/search-history",
  "POST /api/search-history/batch-delete",
  "DELETE /api/profile",
  "DELETE /api/profile/signals/:kind",
  "PATCH /api/me/settings",
  "PATCH /api/me/profile",
  "POST /api/me/diagnostics",
  "POST /api/me/import",
  "POST /api/me/prune",
  "POST /api/me/sessions/check",
  "POST /api/me/tokens",
  "DELETE /api/me/tokens/:id",
  "POST /api/me/notifications/:id/read",
  "POST /api/me/notifications/read-all",
  "DELETE /api/me/sessions/:id",
  "POST /api/me/favorites/sync",
  "DELETE /api/me",
  "POST /api/me/merge",
  "PUT /api/vault/sync",
  "DELETE /api/vault/sync",
  "POST /api/users/sync",
  "POST /api/submissions",
  "POST /api/events",
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

  /**
   * 「忘了写 scope」与「明确声明 public」在快照里长得一样（都是 public 写路由），
   * 前者却是一类静默的安全缺陷：新写路由默认对匿名开放。这里按注册期记录的
   * scopeExplicit 把它们分开。
   *
   * 基线只减不增：表内 32 条都是用户域写面（真正的闸门是处理器里的
   * `userDomainWriteAllowed` / `identityAllowed`，scope 只是等级），
   * 漏写属于历史遗留而不是当前缺陷；新路由漏写直接红，且不会被快照
   * 「顺手补一行」掩盖成正常新增。
   */
  it("新写路由必须显式声明 scope（漏写只允许基线内的历史遗留）", () => {
    const implicit = mutating()
      .filter((route) => !route.scopeExplicit)
      .map(keyOf)
      .sort();
    expect(
      implicit,
      "新增写路由没有在 config 里声明 scope，注册期默认成 public（匿名可写）：补 scope 后再评估写域",
    ).toEqual([...IMPLICIT_SCOPE_BASELINE].sort());
  });

  it("scope 基线不陈旧：每条都仍是漏写状态（补了 scope 就从基线删除）", () => {
    const stillImplicit = new Set(
      mutating()
        .filter((route) => !route.scopeExplicit)
        .map(keyOf),
    );
    for (const key of IMPLICIT_SCOPE_BASELINE) {
      expect(stillImplicit.has(key), key + " 已显式声明 scope，请从 IMPLICIT_SCOPE_BASELINE 删除").toBe(true);
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

  it("个人写例外清单为空：write 等级里不再有任何个人令牌可越过的门槛", () => {
    // 唯一一条曾登记的例外是 `PATCH /api/submissions/:number`，理由写「作者改自己的投稿」。
    // 这个能力从未存在：处理体只接受 action: approve|reject，且没有归属校验。于是例外不是
    // 放行用户域写面，而是把实例域的审核动作交给个人令牌 ⇒ 自审自批、自发布（P0）。
    // 路由现在声明 admin，例外随之清空。
    // 断言「为空」不是图省事：新增一条例外必须同时改掉这一行，等于强制一次显式决定，
    // 让「写理由」变成「写证据」（见 route-policy.ts 的同类教训）。
    expect([...PERSONAL_TOKEN_WRITE_ROUTES]).toEqual([]);
  });

  it("非空时逐条验证：每条登记命中且只命中一条 write 级真实路由（防陈旧 / 防 :param 泛化）", () => {
    for (const key of PERSONAL_TOKEN_WRITE_ROUTES) {
      const [method, pattern] = key.split(" ") as [string, string];
      const matched = mutating().filter((r) => r.method === method && matchesRoutePath(pattern, r.url));
      expect(matched.length, key + " 命中 " + matched.map(keyOf).join(", ")).toBe(1);
      // 等级仍必须是 write：若路由被提成 admin 却留着登记，说明例外已陈旧
      expect(matched[0]!.scope, key).toBe("write");
      // 按段匹配不许退化成前缀放行：去掉末尾参数段的那个更短路径必须不命中
      const withoutParam = pattern.replace(/\/:[A-Za-z0-9_]+$/, "");
      if (withoutParam !== pattern) {
        expect(matchesRoutePath(pattern, withoutParam), key + " 不许前缀泛化").toBe(false);
      }
    }
  });

  it("回归锁：投稿审批不再对个人令牌开放（P0 自审自批）", () => {
    const key = "PATCH /api/submissions/:number";
    const route = mutating().find((r) => keyOf(r) === key);
    // 路由消失时这条锁该红着提醒人，而不是悄悄变成空跑
    expect(route, key + " 已不在真实路由表里：请确认是删除了路由，还是改了路径").toBeTruthy();
    expect(route!.scope, key).toBe("admin");
    expect(classifyRoute({ method: "PATCH", path: route!.url, declaredScope: route!.scope }).personalTokenAllowed, key).toBe(false);
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
      { route: "PATCH /api/submissions/:number", scope: "admin", personal: false, why: "审核动作属实例域：曾登记为 write 例外（理由「作者改自己的投稿」）导致自审自批" },
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
