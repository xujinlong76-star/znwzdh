/**
 * TS 7 分离门禁守卫（P3）：
 *   - 门禁只跑 @navhub/*，不应把前端 navsphere 或 overlay 误算进来；
 *   - 门禁用 typescript7 别名，lint/工具仍必须是 typescript 5.9.3；
 *   - verify 与 CI（test-sqlite 的 pnpm run typecheck）复用同一脚本。
 * U-385（2026-11-21 钩子瘦身）：全量 typecheck 已移出本地 pre-commit，
 * 全量只在 CI 跑——pre-commit 模板里不再有 `node scripts/typecheck.mjs`
 * 这一行是预期行为，不是接线丢失；改回钩子前须同步恢复 gates.json 的
 * staged 登记，否则 check-gates-registry 即红。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/typecheck.mjs");

describe("TS 7 类型检查门禁（scripts/typecheck.mjs）", () => {
  it("只发现 @navhub/* 包，不包含前端 navsphere", () => {
    const out = execFileSync(process.execPath, [SCRIPT, "--list"], { encoding: "utf8", cwd: ROOT });
    const names = out
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[0]);
    expect(names).toEqual(["@navhub/ai", "@navhub/api", "@navhub/core", "@navhub/mcp", "@navhub/store"]);
    expect(names).not.toContain("navsphere");
  });

  it("门禁用 TS 7，lint/工具仍锁 TS 5.9.3", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.typecheck).toBe("node scripts/typecheck.mjs");
    expect(pkg.devDependencies.typescript7).toBe("npm:typescript@7.0.2");
    expect(pkg.devDependencies.typescript).toBe("5.9.3");
  });

  it("verify 与 CI 复用同一门禁脚本；pre-commit 不再跑全量 typecheck（U-385）", () => {
    const verify = readFileSync(join(ROOT, "scripts/verify.mjs"), "utf8");
    const hooks = readFileSync(join(ROOT, "scripts/install-git-hooks.mjs"), "utf8");
    // 断言的是「这一步存在且命令是它」，不是包它的那个函数名——
    // verify 后来把部分步骤包进 gate(...)（--changed 档要带跳过条件），名字会变。
    expect(verify).toMatch(/(?:run|gate)\("类型检查", "node", \["scripts\/typecheck\.mjs"\]/);
    // U-385 钩子瘦身：全量 typecheck（70–77 秒）已移出本地 pre-commit，全量
    // 只在 CI 跑（test-sqlite 的 pnpm run typecheck）；模板里不再有这一行是
    // 预期行为。注意：断言只钉模板里的接线行（`|| exit 1`），不钉注释里
    // 的按需跑法说明——注释不是接线（stripShellComments 会剥掉它们）。
    expect(hooks).not.toContain("node scripts/typecheck.mjs || exit 1");
    // CI 侧仍在跑：test-sqlite 作业有 pnpm run typecheck 步骤。
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("pnpm run typecheck");
  });

  it("后端 lint 必须在 verify 链里，且门禁不许把跳过说成通过", () => {
    const verify = readFileSync(join(ROOT, "scripts/verify.mjs"), "utf8");
    // 只在 CI 单独跑的规则等于没有规则：本地一路绿灯，推上去才红。
    // 断言的是「链里有后端 lint 这一步」，不是它的调用形态——曾经是
    // `gate("后端 lint", "pnpm", ["lint:backend"])`，后来 pnpm 的运行前依赖自检
    // 在本机会 EPERM，改成直接调 eslint 并按 api/store 拆成两步。
    expect(verify).toMatch(/gate\("后端 lint[^"]*", "(?:pnpm|node)", \[/);
    // 「全部验证项 100% 通过」是旧口径：首屏预算依赖构建产物，本地经常根本没执行这一步
    expect(verify).not.toContain("全部验证项 100% 通过");
    expect(verify).toContain("不代表通过");
  });
});
