/**
 * 写路由覆盖率门禁的负控。
 *
 * 门禁本身是纯函数（scripts/lib/rest-contract-coverage.mjs），这里用合成路由
 * 证明它真的会咬人：新增未绑定写路由、allowlist 陈旧、Top 20 公开读缺绑定
 * 都必须判红。只测「当前仓库是绿的」等于没有门禁。
 */
import { describe, expect, it } from "vitest";
import {
  PRIORITY_PUBLIC_READS,
  analyzeCoverage,
  parseAllowlist,
} from "./lib/rest-contract-coverage.mjs";

const ROUTES = [
  { method: "POST", url: "/api/things", scope: "write" },
  { method: "GET", url: "/api/things", scope: "public" },
  { method: "GET", url: "/api/admin/things", scope: "admin" },
];

const BINDINGS = {
  "POST /api/things": {},
  ...Object.fromEntries(PRIORITY_PUBLIC_READS.map((key) => [key, {}])),
};

/** Top 20 全部真实存在，避免「清单里写了不存在的路由」干扰其它断言 */
const ROUTES_WITH_PRIORITY = [
  ...ROUTES,
  ...PRIORITY_PUBLIC_READS.map((key) => {
    const [method, url] = key.split(" ");
    return { method: method!, url: url!, scope: "public" };
  }),
];

function analyze(overrides: Partial<Parameters<typeof analyzeCoverage>[0]> = {}) {
  return analyzeCoverage({
    routes: ROUTES_WITH_PRIORITY,
    bindings: BINDINGS,
    allowlist: parseAllowlist(""),
    ...overrides,
  });
}

describe("parseAllowlist", () => {
  it("忽略注释与空行，解析键与理由", () => {
    const parsed = parseAllowlist("# 注释\n\nPOST /api/x | 动态报告\n");
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toEqual([{ key: "POST /api/x", reason: "动态报告", line: 3 }]);
  });

  it("缺少分隔符或理由为空都判格式错误（豁免必须说清为什么）", () => {
    expect(parseAllowlist("POST /api/x").errors.length).toBe(1);
    expect(parseAllowlist("POST /api/x |   ").errors.length).toBe(1);
  });
});

describe("写路由覆盖率门禁", () => {
  it("全部绑定、Top 20 齐全时通过", () => {
    const report = analyze();
    expect(report.problems).toEqual([]);
    expect(report.stats.write).toMatchObject({ total: 1, bound: 1, allowlisted: 0 });
    expect(report.stats.priorityPublicRead).toMatchObject({ total: 20, bound: 20 });
  });

  it("新增未绑定写路由 → 判红（新增端点必须补绑定或登记理由）", () => {
    const report = analyze({
      routes: [...ROUTES_WITH_PRIORITY, { method: "DELETE", url: "/api/things/:id", scope: "write" }],
    });
    expect(report.problems.some((p: string) => p.includes("DELETE /api/things/{id}"))).toBe(true);
    expect(report.unboundWrites).toContain("DELETE /api/things/{id}");
  });

  it("未绑定写路由登记了理由 → 通过，并计入 allowlisted", () => {
    const routes = [...ROUTES_WITH_PRIORITY, { method: "DELETE", url: "/api/things/:id", scope: "write" }];
    const allowlist = parseAllowlist("DELETE /api/things/{id} | 动态报告：逐规则命中\n");
    const report = analyze({ routes, allowlist });
    expect(report.problems).toEqual([]);
    expect(report.stats.write.allowlisted).toBe(1);
  });

  it("allowlist 陈旧：键已绑定 → 判红（清单只许缩小）", () => {
    const allowlist = parseAllowlist("POST /api/things | 已绑定的写路由\n");
    const report = analyze({ allowlist });
    expect(report.problems.some((p: string) => p.includes("已绑定响应契约"))).toBe(true);
  });

  it("allowlist 陈旧：键已不是真实写路由（改名/删除）→ 判红", () => {
    const allowlist = parseAllowlist("POST /api/gone | 路由已删除\n");
    const report = analyze({ allowlist });
    expect(report.problems.some((p: string) => p.includes("已不是真实写路由"))).toBe(true);
  });

  it("Top 20 公开读缺绑定 → 判红", () => {
    const missing = PRIORITY_PUBLIC_READS[0]!;
    const bindings = { ...BINDINGS };
    delete (bindings as Record<string, unknown>)[missing];
    const report = analyze({ bindings });
    expect(report.missingPriority).toContain(missing);
    expect(report.problems.some((p: string) => p.includes(missing))).toBe(true);
  });

  it("Top 20 清单里的路由不存在 → 判红（改名后清单必须同步）", () => {
    const missing = PRIORITY_PUBLIC_READS[1]!;
    const routes = ROUTES_WITH_PRIORITY.filter((r) => r.method + " " + r.url !== missing);
    const report = analyze({ routes });
    expect(report.problems.some((p: string) => p.includes("不存在"))).toBe(true);
  });

  it("读路由不在写门禁里判红（由读路由棘轮兜底）", () => {
    const report = analyze({
      routes: [...ROUTES_WITH_PRIORITY, { method: "GET", url: "/api/unbound-read", scope: "public" }],
    });
    expect(report.problems).toEqual([]);
  });
});
