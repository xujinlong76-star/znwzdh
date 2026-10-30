/**
 * `scripts/check-ci-gate.mjs` 的三项守卫（第 5 项 2026-10-25 run47，第 6 项 2026-10-29，
 * 第 7 项 2026-10-30）。
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

/**
 * 第 7 项：撤防账的接线（2026-10-30）。
 *
 * 默认条件是「上一步红 ⇒ 后面每一步 skipped」，而 skipped 不判红 ⇒ 作业结论只说明
 * 「没新增红」，不说明「门禁判过没有」。实战吃过的一次：10-29 起首屏预算常驻红，
 * test-web 的 ISR 路由门禁被整步跳过连着几天，结论一直写成「前端只有预算问题」。
 * `11108bf2` 补的是那一步的守卫；本项钉的是「其余没跑成的步骤必须点名」这件事
 * **还接在线上**——读数步骤在不在、条件是不是 always()、登记表里的 id 真不真存在、
 * 门禁形状的步骤有没有 id。
 *
 * 只钉接线、不判运行结果：把「有门禁没跑成」变成第二处红，等于把第 6 项刚压下去的
 * 级联红请回来。所以这里没有「撤防发生 ⇒ 脚本红」的用例，那类账是运行期的 ::warning。
 */
describe("check-ci-gate 第 7 项：撤防账接线", () => {
  /** 夹具一律用 LF 派生（CI 检出的那份文件就是 LF）；CRLF 由上面第 5/6 项读真实文件覆盖 */
  function source(): string {
    return readFileSync(REAL_CI, "utf8").replace(/\r\n/g, "\n");
  }

  /**
   * 按 run 里的字样定位它所属的整步（步骤起始行固定 6 空格 + "- "，到下一步或下一作业为止），
   * 交给 fn 改写。在**单步**范围内增删行，才不会牵动别的作业——撤防账是逐作业判定的。
   * 步骤尾部要一起取：ci.yml 里 `id:` 常常写在 `run:` 之后（YAML 键序不固定）。
   */
  function editStep(runNeedle: string, fn: (step: string[]) => string[], src = source()): string {
    const lines = src.split("\n");
    const at = lines.findIndex((l) => l.includes(runNeedle));
    expect(at, `夹具里找不到步骤：${runNeedle}`).toBeGreaterThan(-1);
    let start = at;
    while (start > 0 && !/^ {6}- /.test(lines[start])) start -= 1;
    let end = lines.length;
    for (let i = at + 1; i < lines.length; i += 1) {
      if (/^ {6}- /.test(lines[i]) || /^ {2}\S/.test(lines[i])) {
        end = i;
        break;
      }
    }
    return [...lines.slice(0, start), ...fn(lines.slice(start, end)), ...lines.slice(end)].join("\n");
  }

  it("仓库现状：8 个接入作业各有读数步骤 ⇒ 绿，✅ 行把记账范围说出来", () => {
    const res = runGate(REAL_CI, GATE_TEST);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("撤防账已接线（8 个作业 / 25 道门禁");
    expect(source().split("run: node scripts/ci-defused-gates.mjs").length - 1).toBe(8);
  });

  it("删掉 test-web 的读数步骤 ⇒ 红：登记表只是愿望", () => {
    const weakened = editStep("ci-defused-gates.mjs --job test-web", () => []);
    expect(weakened).not.toContain("--job test-web");
    const res = runGate(writeFixture("ci-web-no-reporter.yml", weakened), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("test-web");
    expect(res.out).toContain("撤防账没接线");
  });

  it("读数步骤的条件退回默认 ⇒ 红：它自己就是最大的那条撤防", () => {
    const weakened = editStep("ci-defused-gates.mjs --job test-e2e", (step) =>
      step.filter((l) => !/^ {8}if: \$\{\{ always\(\) \}\}$/.test(l)),
    );
    expect(weakened).not.toBe(source());
    const res = runGate(writeFixture("ci-e2e-reporter-not-always.yml", weakened), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("test-e2e");
    expect(res.out).toContain("条件不是 always()");
  });

  it("steps 上下文没传进来 ⇒ 红：账每次只会报「读不到」，却没人看", () => {
    const weakened = editStep("ci-defused-gates.mjs --job test-sqlite", (step) =>
      step.filter((l) => !/NAVHUB_STEP_CONCLUSIONS| {8}env:/.test(l)),
    );
    expect(weakened).not.toContain(
      "NAVHUB_STEP_CONCLUSIONS: ${{ toJSON(steps) }}\n        run: node scripts/ci-defused-gates.mjs --job test-sqlite",
    );
    const res = runGate(writeFixture("ci-sqlite-no-steps-context.yml", weakened), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("test-sqlite");
    expect(res.out).toContain("toJSON(steps)");
  });

  it("登记表里的 id 被改名 ⇒ 红：账还在等它，YAML 里已经没有这一步", () => {
    const renamed = editStep("node scripts/check-bundle-budget.mjs", (step) =>
      step.map((l) => (l === "        id: web-budget" ? "        id: web-budget-v2" : l)),
    );
    expect(renamed).not.toContain("id: web-budget\n");
    const res = runGate(writeFixture("ci-web-budget-renamed.yml", renamed), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("id: web-budget 在作业里找不到");
  });

  it("新加一道门禁不给 id ⇒ 红：它被上游跳过时报不出名字", () => {
    const injected = source().replace(
      "      - run: node scripts/check-extensions.mjs\n",
      "      - run: node scripts/check-brand-newgate.mjs\n      - run: node scripts/check-extensions.mjs\n",
    );
    expect(injected).toContain("check-brand-newgate.mjs");
    const res = runGate(writeFixture("ci-overlay-gate-no-id.yml", injected), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("check-brand-newgate.mjs");
    expect(res.out).toContain("没有 id");
  });

  it("新接入作业的准备步骤 id 被删 ⇒ 红：登记表失去对象，账会把「没跑成」记成「读不到」", () => {
    // 上一轮只有 test-web 的 web-budget 被点名过；这轮把同样口径套到新接的 4 个作业上，
    // 挑 check-isr-live 的 isr-hub（中枢启动）——它是 env 准备步骤，不是门禁：
    // 删掉 id 后 `toJSON(steps)` 里没这个键，撤防账就再也说不出「预览站没起来」这句话。
    const weakened = editStep("nohup node apps/api/src/main.ts > /tmp/hub.log", (step) =>
      step.filter((l) => !/^ {8}id: isr-hub$/.test(l)),
    );
    expect(weakened).not.toContain("id: isr-hub");
    const res = runGate(writeFixture("ci-isr-hub-id-gone.yml", weakened), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("check-isr-live");
    expect(res.out).toContain("id: isr-hub 在作业里找不到");
  });

  it("未登记的作业跑读数脚本 ⇒ 红：接线跑在账前面，那一步每轮都白跑", () => {
    // 2ca11031 那轮用 test-postgres 当「暂未登记的作业」；它现已接线，改用今天唯一
    // 刻意不登记的 seo-audit-prod（手动/定时作业，多一处红不阻塞合并）。
    // 把 test-web 那一步的形状搬过去 ⇒ 必须点名，而不是让「脚本自己发的 ::warning」
    // 成为唯一线索（注解这轮 REST 实测读不到，能机器读的是作业日志）。
    const withRogue = editStep("node scripts/seo-audit.mjs", (step) => [
      ...step,
      "      - name: 撤防账（没跑成的门禁要点名）",
      "        id: defused-gates",
      "        if: ${{ always() }}",
      "        env:",
      "          NAVHUB_STEP_CONCLUSIONS: ${{ toJSON(steps) }}",
      "        run: node scripts/ci-defused-gates.mjs --job seo-audit-prod",
    ]);
    expect(withRogue).toContain("--job seo-audit-prod");
    const res = runGate(writeFixture("ci-seo-rogue-reporter.yml", withRogue), GATE_TEST);
    expect(res.status).not.toBe(0);
    expect(res.out).toContain("seo-audit-prod");
    expect(res.out).toContain("DEFUSED_GATES 里没有它");
  });

  it("注释里出现 ci-defused-gates.mjs ⇒ 不误判成「已接线」（判定只看代码行）", () => {
    // 与第 6 项「遥测判定先剥 YAML 注释」同一条铁律：解释口径的注释常提到脚本名。
    // 反向也要成立——否则「给某作业写一行注释」就能骗过门禁。
    // 钉在未登记的作业上：登记表里有它的话，这条断言就成了空断言。
    const annotated = editStep("node scripts/seo-audit.mjs", (step) => [
      "      # 撤防账见 scripts/ci-defused-gates.mjs（本作业刻意不登记）",
      ...step,
    ]);
    expect(annotated).toContain("# 撤防账见 scripts/ci-defused-gates.mjs");
    const res = runGate(writeFixture("ci-seo-comment-only.yml", annotated), GATE_TEST);
    expect(res.status, res.out).toBe(0);
  });
});
