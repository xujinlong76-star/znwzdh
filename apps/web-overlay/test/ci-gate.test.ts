/**
 * CI 合并门禁守卫。
 *
 * `ci-passed` 是分支保护唯一必经项。只要 `needs` 里少了 `test-postgres`，
 * PG 红了也不会阻塞合并——2026-10-24 实测 PG 套件确实红过，说明
 * 「聚合了」不等于「聚合对了」。这里既验证正向通过，也用反向用例证明
 * 守卫不是空跑（删掉关键作业必须退出 1）。
 *
 * 2026-10-27：门禁改为解析全部作业（不再硬编码清单）。本文件新增两条反向用例：
 * 新增常驻作业未入 needs 必须红；显式声明为手动/定时则允许不聚合。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    try {
      readFileSync(resolve(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = resolve(dir, "..");
    }
  }
  throw new Error("无法定位仓库根目录");
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const tmpDirs: string[] = [];
const CI_FILE = resolve(ROOT, ".github/workflows/ci.yml");

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function runGate(ciPath?: string) {
  return spawnSync(process.execPath, ["scripts/check-ci-gate.mjs"], {
    cwd: ROOT,
    env: { ...process.env, ...(ciPath ? { NAVHUB_CI_PATH: ciPath } : {}) },
    encoding: "utf8",
  });
}

/** 在 ci-passed 之前插入一段作业定义，写到临时文件后跑门禁 */
function runWithInjectedJob(jobLines: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "navhub-ci-gate-inject-"));
  tmpDirs.push(dir);
  const src = readFileSync(CI_FILE, "utf8");
  const anchor = ["", "  ci-passed:"].join("\n");
  expect(src).toContain(anchor);
  const injected = src.replace(anchor, ["", ...jobLines, "", "  ci-passed:"].join("\n"));
  const target = join(dir, "ci.yml");
  writeFileSync(target, injected, "utf8");
  return runGate(target);
}

describe("CI 合并门禁", () => {
  it("当前 ci.yml 通过：10 个作业聚合（含 test-responsive-pr）、逐个读结果、PG 走 test:pg:suite", () => {
    const res = runGate();
    expect(res.status, res.stderr).toBe(0);
    // 2026-11-22：新增 test-responsive-pr 响应式门禁，聚合数 9 → 10
    expect(res.stdout).toContain("聚合 10 个作业");
    // 手动/定时作业必须被识别并显式列出，而不是静默忽略
    expect(res.stdout).toContain("seo-audit-prod");
  });

  it("删掉 test-postgres 后必须变红（守卫不是空跑）", () => {
    const dir = mkdtempSync(join(tmpdir(), "navhub-ci-gate-"));
    tmpDirs.push(dir);
    const src = readFileSync(CI_FILE, "utf8");
    const broken = src.replace(
      "needs: [test-sqlite, test-postgres, test-web, check-web-overlay, check-isr-live, test-e2e, test-responsive-pr, docker-smoke, audit, coverage]",
      "needs: [test-sqlite, test-web, check-web-overlay, check-isr-live, test-e2e, test-responsive-pr, docker-smoke, audit, coverage]",
    );
    expect(broken).not.toBe(src);
    const target = join(dir, "ci.yml");
    writeFileSync(target, broken, "utf8");
    const res = runGate(target);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("test-postgres");
  });

  it("作业仍在 needs 里但评估脚本漏读 result，必须判红", () => {
    // 模拟「聚合列表没动，但评估脚本里那一行 result 被误删/改错」：
    // 这种漏法不会让 needs 少项，只看清单的门禁发现不了。
    const src = readFileSync(CI_FILE, "utf8");
    const mutated = src.replaceAll("needs.audit.result", "needs.audit.conclusion");
    expect(mutated).not.toBe(src);
    const dir = mkdtempSync(join(tmpdir(), "navhub-ci-gate-missed-result-"));
    tmpDirs.push(dir);
    const target = join(dir, "ci.yml");
    writeFileSync(target, mutated, "utf8");
    const res = runGate(target);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("needs.audit.result");
    expect(res.stderr).toContain("静默忽略");
  });

  it("新增的常驻作业若未纳入 needs，必须判红（清单不再硬编码）", () => {
    const res = runWithInjectedJob([
      "  brand-new-gate:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo hi",
    ]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("brand-new-gate");
    expect(res.stderr).toContain("不会阻塞合并");
  });

  it("新增作业若显式声明为手动/定时，则允许不聚合", () => {
    const res = runWithInjectedJob([
      "  nightly-only:",
      "    if: github.event_name == 'workflow_dispatch'",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo hi",
    ]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain("nightly-only");
  });

  it("pre-commit 在 workflow 变更时会跑门禁（否则改坏 ci.yml 本地无感）", () => {
    const installer = readFileSync(resolve(ROOT, "scripts/install-git-hooks.mjs"), "utf8");
    expect(installer).toContain("check-ci-gate.mjs");
    // 条件必须锚定 .github/workflows/，不能每次提交都跑
    // 用字符串包含判断而不是正则：避免转义层级把条件写错
    expect(installer).toContain("--diff-filter=ACMRD");
    expect(installer).toContain(".github/workflows/");
    expect(installer).toContain("node scripts/check-ci-gate.mjs || exit 1");
  });

  it("pnpm verify 与 package.json 都已接入该门禁", () => {
    const verify = readFileSync(resolve(ROOT, "scripts/verify.mjs"), "utf8");
    expect(verify).toContain("check-ci-gate.mjs");
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:ci-gate"]).toContain("check-ci-gate.mjs");
  });

  it("本地 verify 登记的生成链条数与 check:generated 的 4 条一致", () => {
    // 2026-11-26：verify 原本只登记 3 条（core 镜像 / 路由策略 / overlay 镜像），
    // 漏了 REST 契约。本地一路绿、推上去才在 CI 的 check:generated 红——
    // 这里按「聚合入口声明了几条链」动态核对，防止以后再加链又漏登记。
    const aggregate = readFileSync(resolve(ROOT, "scripts/check-generated-all.mjs"), "utf8");
    const chainCount = (aggregate.match(/^\s*id: "/gm) ?? []).length;
    expect(chainCount).toBeGreaterThanOrEqual(4);
    const verify = readFileSync(resolve(ROOT, "scripts/verify.mjs"), "utf8");
    const gateLabels = ["core 镜像一致", "网关路由策略新鲜度", "REST 契约一致", "覆盖层同步"];
    for (const label of gateLabels) expect(verify).toContain(`gate("${label}"`);
    // 每个 gate 都要指向真实存在的脚本，防止只补了标签没补执行
    for (const script of [
      "scripts/sync-core-mirrors.mjs",
      "scripts/gen-hub-route-policy.mjs",
      "scripts/generate-rest-contract-types.mjs",
      "scripts/check-web-overlay.mjs",
    ]) {
      expect(verify).toContain(script);
      expect(existsSync(resolve(ROOT, script))).toBe(true);
    }
  });
});
