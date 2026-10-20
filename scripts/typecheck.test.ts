/**
 * TS 7 分离门禁守卫（P3）：
 *   - 门禁只跑 @navhub/*，不应把前端 navsphere 或 overlay 误算进来；
 *   - 门禁用 typescript7 别名，lint/工具仍必须是 typescript 5.9.3；
 *   - verify 与 pre-commit 必须复用同一脚本，避免只改 package.json 的假接线。
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

  it("verify 与 pre-commit 复用同一门禁脚本", () => {
    const verify = readFileSync(join(ROOT, "scripts/verify.mjs"), "utf8");
    const hooks = readFileSync(join(ROOT, "scripts/install-git-hooks.mjs"), "utf8");
    expect(verify).toContain('run("node", ["scripts/typecheck.mjs"])');
    expect(hooks).toContain("node scripts/typecheck.mjs || exit 1");
  });
});
