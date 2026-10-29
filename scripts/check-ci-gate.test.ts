/**
 * `scripts/check-ci-gate.mjs` 的两项守卫（第 5 项 2026-10-25 run47，第 6 项 2026-10-29）。
 *
 * 第 5 项管的是「后端 lint 到底哪边说了算」：CI 的那一步带 continue-on-error，
 * 退出码会被吞掉，所以同一份断言必须在被 ci-passed 聚合的阻塞作业里也跑一遍。
 * 检查本身只有在**两种方向都会红**时才有意义，因此这里用真实 ci.yml 派生夹具：
 *   1. 现状（有 continue-on-error + 有阻塞断言文件）⇒ 绿；
 *   2. 阻塞断言文件消失 ⇒ 红，且话里说清缺的是哪条通道；
 *   3. 工作流自己收紧（去掉 continue-on-error）⇒ 绿 —— 证明它不是「无论如何都要第二通道」的死规则。
 *
 * 第 6 项管「一次根因只留一处红」，见下面 describe 的注释。
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

/**
 * 第 6 项：级联红收敛（2026-10-29，run 40835496871）。
 *
 * typecheck 一红 → 测试步骤被跳过 → junit 不存在 → 红灯光谱/台账/上传三步仍按
 * `!cancelled()` 跑，各自再判一次红。四处红淹没一个根因，所以「读产物的收尾步骤
 * 必须以生产者 outcome 为条件」必须是可执行断言，而不是 ci.yml 里一段会被顺手删掉的注释。
 *
 * 这一组还钉住一个**反向**坑：判定不能把生产者步骤自己当消费者。HEAD 上就是这么坏的
 * （步骤注释里写了「与 upload-artifact 的口径一致」，门禁对着干净的 ci.yml 报红），
 * 所以「现状绿」和「注释里出现 upload-artifact 依然绿」是两条独立断言。
 * 判定的三个分支（锚点自我排除 / 注释剥离 / ignore 豁免）在真实 ci.yml 上各只走一条路，
 * 因此它们本身的正反面在 scripts/lib/ci-workflow.test.ts 用合成片段逐个钉。
 */
describe("check-ci-gate 第 6 项：级联红收敛", () => {
  it("仓库现状：读产物的收尾步骤都带 outcome 守卫 ⇒ 绿", () => {
    const source = readFileSync(REAL_CI, "utf8");
    expect(source).toContain("!cancelled() && steps.vitest.outcome != 'skipped'");
    expect(source).toContain("!cancelled() && steps.e2e.outcome != 'skipped'");
    // test-web 的账读的是 next build 产物（2026-10-29 泛化）：锚点是 web-build
    expect(source).toContain("id: web-build");
    expect(source).toContain("!cancelled() && steps.web-build.outcome != 'skipped'");
    // ISR 门禁挂在同一个锚点上，但用更严的 == 'success'（2026-10-30）
    expect(source).toContain("!cancelled() && steps.web-build.outcome == 'success'");
    const res = runGate(REAL_CI, GATE_TEST);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("级联红已按产物生产者 outcome 收敛");
  });

  it("ISR 那一步的条件被删 ⇒ 红：预算常驻红会把整步 skipped，撤防不报错", () => {
    // 2026-10-29 起首屏预算红是常驻的（视频线在途），默认条件 ⇒ 下一步 `check-isr-routes`
    // 每轮 skipped，而 skipped 不判红：作业结论里只看见预算那一步，看不出 ISR 门禁
    // 已经连续几天没判过任何东西。登记表把它的锚点补上之后，删条件必须当场红。
    const source = readFileSync(REAL_CI, "utf8");
    const guardLine = /[ \t]*if: \$\{\{ !cancelled\(\) && steps\.web-build\.outcome == 'success' \}\}\r?\n/;
    expect(source).toMatch(guardLine);
    const weakened = source.replace(guardLine, "");
    expect(weakened).not.toMatch(guardLine);
    const res = runGate(writeFixture("ci-web-isr-unguarded.yml", weakened), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("test-web");
    expect(res.out).toContain("node scripts/check-isr-routes.mjs");
  });

  it("test-web 的守卫退回 if: always() ⇒ 红，账步骤与它的上传各点名一次", () => {
    const source = readFileSync(REAL_CI, "utf8");
    const guard = `!cancelled() && steps.web-build.outcome != 'skipped'`;
    expect(source.split(guard).length - 1).toBe(2);
    const weakened = source.replaceAll(guard, "always()");
    const res = runGate(writeFixture("ci-web-unguarded.yml", weakened), GATE_TEST);
    expect(res.status).not.toBe(0);
    // lint 一红 → build 被跳过 → `.next` 不存在：这两步各自再判一次红就是三处红，
    // 所以两处都得点名，不能只报第一条。
    expect(res.out).toContain("首屏预算账");
    expect(res.out).toContain("bundle-budget-report");
  });

  it("web-build 这个锚点被改名 ⇒ 红：test-web 的守卫静默失效必须看得见", () => {
    const orphaned = readFileSync(REAL_CI, "utf8").replace(/^(\s*)id: web-build\s*\r?\n/m, "");
    expect(orphaned).not.toContain("id: web-build");
    const res = runGate(writeFixture("ci-web-no-build-id.yml", orphaned), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("test-web");
    expect(res.out).toContain("级联判据挂在它上面");
  });

  it("SQLite 的守卫被删回 !cancelled() ⇒ 红，并点名「红灯光谱」", () => {
    const source = readFileSync(REAL_CI, "utf8");
    // ci.yml 的注释正文里也写了 steps.vitest.outcome（解释判据），所以只能比对完整守卫串
    const guard = `!cancelled() && steps.vitest.outcome != 'skipped'`;
    expect(source.split(guard).length - 1).toBeGreaterThan(0);
    const weakened = source.replaceAll(guard, "!cancelled()");
    expect(weakened).not.toContain(guard);
    const res = runGate(writeFixture("ci-sqlite-unguarded.yml", weakened), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("test-sqlite");
    expect(res.out).toContain("红灯光谱");
    expect(res.out).toContain("一次根因多处红");
  });

  it("E2E 的守卫被删 ⇒ 红（分片作业同样不许把缺产物当第二次红）", () => {
    const weakened = readFileSync(REAL_CI, "utf8").replaceAll(
      "!cancelled() && steps.e2e.outcome != 'skipped'",
      "!cancelled()",
    );
    const res = runGate(writeFixture("ci-e2e-unguarded.yml", weakened), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("test-e2e");
  });

  it("测试步骤 id 消失 ⇒ 红：守卫挂在一个不存在的步骤上等于没有守卫", () => {
    const orphaned = readFileSync(REAL_CI, "utf8").replace(
      /^(\s*)id: vitest\s*\n/m,
      "",
    );
    expect(orphaned).not.toContain("id: vitest");
    const res = runGate(writeFixture("ci-no-vitest-id.yml", orphaned), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("级联判据挂在它上面");
  });

  it("步骤注释里出现 upload-artifact / junit-summary ⇒ 不误判成遥测步骤", () => {
    const source = readFileSync(REAL_CI, "utf8");
    // 注释跟在产出 junit 的步骤正文之后 ⇒ 它属于那个步骤的切片，判定必须先看代码行
    const annotated = source.replace(
      /(        run: pnpm test --shard=[^\n]*\n)/,
      "$1        # 口径同 upload-artifact 与 scripts/junit-summary.mjs：缺 junit 就是遥测链路断了\n",
    );
    expect(annotated).not.toBe(source);
    const res = runGate(writeFixture("ci-comment.yml", annotated), GATE_TEST);
    expect(res.status, res.out).toBe(0);
  });

  it("给一个没登记的作业加上 error 上传 ⇒ 红：覆盖面漏了不该等事故才发现", () => {
    // 现状里三个带 error 上传的作业（test-sqlite / test-web / test-e2e）全在登记表里，
    // 所以「登记表齐全」这件事从来没被证明过。把同一个形状搬到 check-web-overlay
    // （它没有规则）——此前门禁一路绿灯，现在必须点名。
    const withReader = readFileSync(REAL_CI, "utf8").replace(
      /(      - run: node scripts\/check-extensions\.mjs(\r?\n))/,
      (_match, line: string, eol: string) =>
        line +
        [
          "      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7",
          "        with:",
          "          name: overlay-drift-report",
          "          path: overlay-drift.json",
          "          if-no-files-found: error",
        ].join(eol) +
        eol,
    );
    expect(withReader).toContain("overlay-drift-report");
    const res = runGate(writeFixture("ci-unregistered-reader.yml", withReader), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("check-web-overlay");
    expect(res.out).toContain("没在级联登记表里登记");
  });
});
