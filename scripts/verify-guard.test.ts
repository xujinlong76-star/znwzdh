/**
 * `scripts/verify-guard.mjs` 的自检。
 *
 * 这个工具本身最容易「看起来在工作」：它跑一次测试、看到红灯就宣布「守卫有效」——
 * 而红灯可能来自编译错误或别的用例。所以它的每一条判定路径都必须被测试固定：
 *
 *   · 真守卫（测试失败 + 命中期望诊断）→ exit 0
 *   · 空守卫（改坏了仍通过）→ exit 2
 *   · 无法归因（失败了但不是那条断言）→ exit 2
 *   · 参数错误 / 脏文件 → exit 1
 *
 * 而且**每条路径都要验证文件已还原**——一个会损坏源码的诊断工具比没有更糟。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, "scripts", "verify-guard.mjs");

let dir: string;
let source: string;

/** 跑工具，返回 { code, out }；code 是工具自己的退出码 */
function run(args: string[], cwd = dir): { code: number; out: string } {
  const env = { ...process.env };
  delete env.GIT_INDEX_FILE;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
      env,
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: typeof e.status === "number" ? e.status : 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "navhub-verify-guard-"));
  source = join(dir, "subject.ts");
  writeFileSync(source, "export const value = 1;\nexport const other = 2;\n", "utf8");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 每个用例前后都要求源码完好——这是工具的核心承诺 */
function expectIntact(): void {
  expect(readFileSync(source, "utf8")).toBe("export const value = 1;\nexport const other = 2;\n");
}

describe("判定：守卫有效 vs 无效", () => {
  it("改坏后测试失败且命中诊断 → exit 0，且文件已还原", () => {
    const { code, out } = run([
      "--file", "subject.ts",
      "--from", "value = 1",
      "--to", "value = 999",
      "--cmd", `node -e "console.log('守卫命中：value 不该是 999'); process.exit(1)"`,
      "--expect-output", "守卫命中",
      "--allow-dirty",
    ]);
    expect(out).toContain("守卫有效");
    expect(code).toBe(0);
    expectIntact();
  });

  it("改坏后测试仍然通过 → exit 2（空守卫）", () => {
    const { code, out } = run([
      "--file", "subject.ts",
      "--from", "value = 1",
      "--to", "value = 999",
      "--cmd", `node -e "console.log('ok'); process.exit(0)"`,
      "--allow-dirty",
    ]);
    expect(out).toContain("守卫无效");
    expect(code).toBe(2);
    expectIntact();
  });

  it("测试失败了但诊断串对不上 → exit 2（无法归因）", () => {
    const { code, out } = run([
      "--file", "subject.ts",
      "--from", "value = 1",
      "--to", "value = 999",
      "--cmd", `node -e "console.log('编译错误：完全无关的红'); process.exit(1)"`,
      "--expect-output", "不该是 999",
      "--allow-dirty",
    ]);
    expect(out).toContain("无法归因");
    expect(code).toBe(2);
    expectIntact();
  });

  it("没给 --expect-output 时通过，但明确警告「未验证归因」", () => {
    const { code, out } = run([
      "--file", "subject.ts",
      "--from", "value = 1",
      "--to", "value = 999",
      "--cmd", `node -e "process.exit(1)"`,
      "--allow-dirty",
    ]);
    expect(code).toBe(0);
    expect(out).toContain("未验证归因");
    expectIntact();
  });
});

describe("拒绝执行的情况（都要 exit 1 且不动文件）", () => {
  it("--from 片段不存在", () => {
    const { code, out } = run([
      "--file", "subject.ts",
      "--from", "does-not-exist",
      "--to", "x",
      "--cmd", "node -e \"process.exit(1)\"",
      "--allow-dirty",
    ]);
    expect(code).toBe(1);
    expect(out).toContain("找不到 --from 片段");
    expectIntact();
  });

  it("--from 出现多次（无法确定替换哪一处）", () => {
    writeFileSync(source, "const a = 1;\nconst a = 1;\n", "utf8");
    const { code, out } = run([
      "--file", "subject.ts",
      "--from", "const a = 1;",
      "--to", "const a = 9;",
      "--cmd", "node -e \"process.exit(1)\"",
      "--allow-dirty",
    ]);
    expect(code).toBe(1);
    expect(out).toContain("出现 2 次");
    // 该用例自己改过文件，单独还原
    writeFileSync(source, "export const value = 1;\nexport const other = 2;\n", "utf8");
  });

  it("缺 --to 直接报错（避免「不小心删掉一段」）", () => {
    const { code, out } = run([
      "--file", "subject.ts",
      "--from", "value = 1",
      "--cmd", "node -e \"process.exit(1)\"",
      "--allow-dirty",
    ]);
    expect(code).toBe(1);
    expect(out).toContain("缺少 --to");
  });
});

describe("脏文件保护（并行会话的核心约束）", () => {
  it("工作区有未提交改动时拒绝执行，除非 --allow-dirty", () => {
    const repo = mkdtempSync(join(tmpdir(), "navhub-verify-guard-git-"));
    const clean = () => {
      const env = { ...process.env };
      delete env.GIT_INDEX_FILE;
      delete env.GIT_DIR;
      delete env.GIT_WORK_TREE;
      return env;
    };
    const git = (args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8", env: clean() }).replace(/\s+$/, "");

    git(["init", "-q"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "T"]);
    git(["config", "commit.gpgsign", "false"]);
    writeFileSync(join(repo, "a.ts"), "export const x = 1;\n");
    git(["add", "."]);
    git(["commit", "-q", "-m", "init"]);
    // 造一个「别人正在改」的状态
    writeFileSync(join(repo, "a.ts"), "export const x = 1; // 并行会话的改动\n");

    const { code, out } = run(
      [
        "--file", "a.ts",
        "--from", "x = 1",
        "--to", "x = 2",
        "--cmd", "node -e \"process.exit(1)\"",
      ],
      repo,
    );
    expect(code).toBe(1);
    expect(out).toContain("拒绝在其上做反向验证");
    // 关键：别人的改动必须原样还在
    expect(readFileSync(join(repo, "a.ts"), "utf8")).toContain("并行会话的改动");

    rmSync(repo, { recursive: true, force: true });
  });
});
