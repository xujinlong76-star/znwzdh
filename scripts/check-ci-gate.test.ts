/**
 * `scripts/check-ci-gate.mjs` 第 5 项的守卫（2026-10-25 run47）。
 *
 * 这一项管的是「后端 lint 到底哪边说了算」：CI 的那一步带 continue-on-error，
 * 退出码会被吞掉，所以同一份断言必须在被 ci-passed 聚合的阻塞作业里也跑一遍。
 * 检查本身只有在**两种方向都会红**时才有意义，因此这里用真实 ci.yml 派生夹具：
 *   1. 现状（有 continue-on-error + 有阻塞断言文件）⇒ 绿；
 *   2. 阻塞断言文件消失 ⇒ 红，且话里说清缺的是哪条通道；
 *   3. 工作流自己收紧（去掉 continue-on-error）⇒ 绿 —— 证明它不是「无论如何都要第二通道」的死规则。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO_ROOT, "scripts/check-ci-gate.mjs");
const REAL_CI = join(REPO_ROOT, ".github/workflows/ci.yml");
const GATE_TEST = join(REPO_ROOT, "apps/api/test/backend-lint-gate.test.ts");

let dir: string;

/** 跑脚本并返回 { status, out }：非零退出码在这里是被断言的结果，不是异常 */
function runGate(ciPath: string, gatePath: string) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NAVHUB_CI_PATH: ciPath, NAVHUB_LINT_GATE_TEST: gatePath },
    });
    return { status: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function writeFixture(name: string, source: string): string {
  const path = join(dir, name);
  writeFileSync(path, source, "utf8");
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "navhub-ci-gate-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("check-ci-gate 第 5 项：后端 lint 的阻塞通道", () => {
  it("仓库现状：CI 步骤允许失败，但阻塞作业里有同口径断言 ⇒ 绿", () => {
    const source = readFileSync(REAL_CI, "utf8");
    expect(source).toMatch(/- run: pnpm run lint:backend\s*\n\s*continue-on-error: true/);
    const res = runGate(REAL_CI, GATE_TEST);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("后端 lint 由阻塞作业里的同口径断言把关");
  });

  it("阻塞断言消失 ⇒ 红（否则 continue-on-error 又把信号吞回去）", () => {
    const res = runGate(REAL_CI, join(dir, "does-not-exist.test.ts"));
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("continue-on-error");
    expect(res.out).toContain("backend-lint-gate.test.ts");
  });

  it("工作流自己收紧（去掉 continue-on-error）⇒ 绿，不逼着留第二通道", () => {
    const tightened = readFileSync(REAL_CI, "utf8").replace(
      /- run: pnpm run lint:backend(\s*\n\s*)continue-on-error: true/,
      "- run: pnpm run lint:backend",
    );
    expect(tightened).not.toContain("continue-on-error: true");
    const fixture = writeFixture("ci-tightened.yml", tightened);
    const res = runGate(fixture, join(dir, "does-not-exist.test.ts"));
    expect(res.status, res.out).toBe(0);
  });
});
