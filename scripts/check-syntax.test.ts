/**
 * 语法门禁守卫（P3）：确保 check-syntax 不依赖 TS compiler API。
 *
 * 背景：Dependabot 的 TS 7 PR 中，check-syntax 因 `import ts from "typescript"`
 * 在 TS 7 native 下没有 createSourceFile 而直接失败。改用 esbuild 后，这里用
 * 真实 CLI 行为锁住：合法 TS/TSX 通过，坏语法退出码 1 且能定位到文件。
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/check-syntax.mjs");

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navhub-syntax-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      cwd: ROOT,
      stdio: "pipe",
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      status: err.status ?? -1,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
    };
  }
}

describe("语法快速门禁（scripts/check-syntax.mjs）", () => {
  it("默认扫描仓库 TS/TSX 通过", () => {
    const result = run([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[syntax] 通过");
  }, 90_000);

  it("合法 TS 与 TSX 返回 0", () => {
    const dir = tempDir();
    const ts = join(dir, "ok.ts");
    const tsx = join(dir, "ok.tsx");
    writeFileSync(ts, "export const n: number = 1;\n", "utf8");
    writeFileSync(tsx, "export const C = () => <div>{1}</div>;\n", "utf8");
    const result = run([ts, tsx]);
    expect(result.status).toBe(0);
  });

  it("缺失右括号返回 1，并输出文件与位置", () => {
    const dir = tempDir();
    const bad = join(dir, "bad.ts");
    writeFileSync(bad, "export const value = {\n  a: 1,\n", "utf8");
    const result = run([bad]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[syntax] 发现");
    expect(result.stderr).toContain("bad.ts");
    expect(result.stderr).toMatch(/bad\.ts:\d+:\d+/);
  });
});
