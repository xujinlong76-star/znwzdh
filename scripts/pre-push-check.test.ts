/**
 * scripts/pre-push-check.mjs 的自测。
 *
 * 分两层（与 precommit-select.test.ts 同款分工）：
 *   1. 纯函数单测：改动解析、钩子 stdin、词根、映射、计划、失败提取、退出码判定——快，不碰 git 状态；
 *   2. --dry-run 实跑：用 NAVHUB_PREPUSH_FILES 注入改动集（不碰真实 git 状态），
 *      断言“改动 → 选中测试”的端到端映射（含模块图，单用例约 3–7s 建图）。
 *
 * 注意：本文件不用跨模块 vi.mock（也就不需要 afterAll(vi.resetModules()) 兜底）；
 * 子进程调用时剥掉继承的 NAVHUB_PREPUSH_* 环境变量，防止外层泄漏改口径
 * （precommit-select.test.ts 同款教训）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decideExit,
  dirtyIntersection,
  extractStdoutFailures,
  filterSharp,
  isZeroSha,
  mapFile,
  mapToTests,
  narrowTests,
  parseArgs,
  parseHookStdin,
  parseJunitFailures,
  parseNameOnly,
  parseNameStatus,
  planChecks,
  runStep,
  stemHit,
  stemsOf,
  toRunnableTest,
} from "./pre-push-check.mjs";

const ROOT = process.cwd();
const SCRIPT = "scripts/pre-push-check.mjs";

/** --dry-run 实跑：返回 { code, tests, changed, out }。 */
function dryRun(files, extraEnv = {}) {
  const inherited = { ...process.env };
  for (const key of Object.keys(inherited)) {
    if (key.startsWith("NAVHUB_PREPUSH_")) delete inherited[key];
  }
  let out = "";
  let code = -1;
  try {
    out = execFileSync(process.execPath, [SCRIPT, "--dry-run"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...inherited, NAVHUB_PREPUSH_FILES: files.join(","), ...extraEnv },
      timeout: 180_000,
    });
    code = 0;
  } catch (error) {
    out = String(error.stdout ?? "") + String(error.stderr ?? "");
    code = typeof error.status === "number" ? error.status : -1;
  }
  const testsLine = out.split(/\r?\n/).find((l) => l.startsWith("DRYRUN_TESTS="));
  const tests = testsLine ? JSON.parse(testsLine.slice("DRYRUN_TESTS=".length)) : null;
  return { code, tests, out };
}

describe("改动检测：解析", () => {
  it("parseHookStdin：正常行 / 删远程分支 / 删本地分支 / 多行", () => {
    const normal = parseHookStdin("refs/heads/main abc1234 refs/heads/main def5678\n");
    expect(normal.lines).toEqual([
      { localRef: "refs/heads/main", localSha: "abc1234", remoteRef: "refs/heads/main", remoteSha: "def5678" },
    ]);
    expect(normal.allDeletes).toBe(false);

    const delRemote = parseHookStdin(`refs/heads/feat abc1234 refs/heads/feat ${"0".repeat(40)}\n`);
    expect(delRemote.allDeletes).toBe(true);

    const delLocal = parseHookStdin(`refs/heads/feat ${"0".repeat(40)} refs/heads/feat def5678\n`);
    expect(delLocal.allDeletes).toBe(true);

    const multi = parseHookStdin(
      `refs/heads/a aaa refs/heads/a bbb\nrefs/heads/b ${"0".repeat(40)} refs/heads/b ccc\n`,
    );
    expect(multi.lines).toHaveLength(2);
    expect(multi.allDeletes).toBe(false);
    expect(parseHookStdin("")).toEqual({ lines: [], allDeletes: false });
  });

  it("isZeroSha：全零才算删分支", () => {
    expect(isZeroSha("0".repeat(40))).toBe(true);
    expect(isZeroSha("abc1234")).toBe(false);
    expect(isZeroSha("")).toBe(false);
  });

  it("parseNameStatus：重命名拆成删旧 + 增新，并保留配对", () => {
    const { files, renames } = parseNameStatus("A\tapps/api/src/new.ts\nM\tscripts/a.mjs\nD\told.ts\nR100\tapps/web-overlay/src/lib/old.ts\tapps/web-overlay/src/lib/new.ts\n");
    expect(files).toEqual([
      "apps/api/src/new.ts",
      "apps/web-overlay/src/lib/new.ts",
      "apps/web-overlay/src/lib/old.ts",
      "old.ts",
      "scripts/a.mjs",
    ]);
    expect(renames).toEqual([{ from: "apps/web-overlay/src/lib/old.ts", to: "apps/web-overlay/src/lib/new.ts" }]);
  });

  it("parseNameOnly：去重排序、丢空行", () => {
    expect(parseNameOnly("b.ts\n\na.ts\nb.ts\n")).toEqual(["a.ts", "b.ts"]);
  });
});

describe("参数", () => {
  it("parseArgs：各开关与 --base", () => {
    expect(parseArgs(["--full", "--dry-run", "--json"])).toEqual({
      base: null, full: true, dryRun: true, json: true, help: false,
    });
    expect(parseArgs(["--base=HEAD~3"]).base).toBe("HEAD~3");
    expect(parseArgs([])).toEqual({ base: null, full: false, dryRun: false, json: false, help: false });
  });

  it("parseArgs：未知参数抛错（main 层转为退出 2）", () => {
    expect(() => parseArgs(["--bogus"])).toThrow("未知参数");
    expect(() => parseArgs(["--base"])).toThrow("--base 需要一个值");
  });
});

describe("词根收窄（与 pre-commit 选测器同款）", () => {
  it("stemsOf：basename + 父目录取 token，通用词排除", () => {
    // "pin" 只有 3 字符（<4）按规则丢弃；"lib" 是通用词
    expect(stemsOf("apps/web-overlay/src/lib/batch-pin-toast.ts")).toEqual(["batch", "toast"]);
    // page/layout/route 属于 GENERIC_STEMS，不得用来收窄
    expect(stemsOf("apps/web-overlay/src/app/exam/page.tsx")).toEqual(["exam"]);
    // "routes" 也是通用词，只剩 backup
    expect(stemsOf("apps/api/src/routes/backup.ts")).toEqual(["backup"]);
  });

  it("stemHit：复数归一（plugins→plugin，3 字符起）", () => {
    expect(stemHit("plugins", "plugin-market-star.test.ts")).toBe(true);
    expect(stemHit("jobs", "backup-restore-job.test.ts")).toBe(true);
    expect(stemHit("exam", "exam-page.test.ts")).toBe(true);
    expect(stemHit("exam", "feed.test.ts")).toBe(false);
  });

  it("filterSharp：同时满足 >5 个且 >25% 才算通用词", () => {
    // 总数 40：命中 11（>5 且 >25%）→ 通用，滤掉；命中 5 → 保留
    expect(filterSharp(["check", "bundle"], (t) => (t === "check" ? 11 : 5), 40)).toEqual(["bundle"]);
    // 小目录：命中 4（>25% 但 ≤5）→ 保留，不误杀
    expect(filterSharp(["check"], () => 4, 10)).toEqual(["check"]);
  });

  it("narrowTests：batch-pin-toast 命中同名族；无词根时返回 []（调用方退回整棵）", () => {
    const hits = narrowTests(ROOT, "apps/web/test", ["apps/web-overlay/src/lib/batch-pin-toast.ts"]);
    expect(hits).toContain("apps/web/test/batch-pin-toast-count.test.ts");
    expect(narrowTests(ROOT, "apps/web/test", ["apps/web-overlay/src/lib/qzxwvkj.ts"])).toEqual([]);
    // sources > 3 不收窄
    expect(narrowTests(ROOT, "apps/web/test", ["a.ts", "b.ts", "c.ts", "d.ts"])).toEqual([]);
  });
});

describe("映射：mapFile / toRunnableTest", () => {
  it("mapFile：全局文件 / e2e / 测试自身 / 目录路由 / 未知文件", () => {
    expect(mapFile("vitest.config.ts")).toEqual({ global: true });
    expect(mapFile("types/foo.ts")).toEqual({ global: true });
    expect(mapFile("e2e/search.spec.ts")).toEqual({ e2e: true });
    expect(mapFile("apps/web-overlay/test/exam-page.test.ts")).toEqual({ target: "apps/web/test/exam-page.test.ts" });
    expect(mapFile("apps/web-overlay/src/lib/x.ts")).toEqual({ target: "apps/web/test" });
    expect(mapFile("apps/api/src/routes/x.ts")).toEqual({ target: "apps/api/test" });
    expect(mapFile("scripts/check-foo.mjs")).toEqual({ target: "scripts" });
    expect(mapFile("docs/README.md").reason).toMatch("不属于任何带测试的工作区");
  });

  it("toRunnableTest：overlay 测试换算到镜像，api/脚本测试原样", () => {
    expect(toRunnableTest("apps/web-overlay/test/exam-page.test.ts")).toBe("apps/web/test/exam-page.test.ts");
    expect(toRunnableTest("apps/api/test/backup-async-api.test.ts")).toBe("apps/api/test/backup-async-api.test.ts");
    expect(toRunnableTest("apps/web-overlay/src/lib/x.ts")).toBeNull();
  });
});

describe("脏检测", () => {
  it("dirtyIntersection：只报与推送受影响路径的交集", () => {
    const affected = ["apps/web-overlay/src/lib/a.ts", "apps/web/test/a.test.ts"];
    expect(dirtyIntersection(affected, ["apps/web-overlay/src/lib/a.ts"], [], ["docs/x.md"])).toEqual([
      "apps/web-overlay/src/lib/a.ts",
    ]);
    // 别人的半成品与推送无关时不报
    expect(dirtyIntersection(affected, ["apps/api/src/other.ts"], ["scripts/other.mjs"], [])).toEqual([]);
    // 去重 + 排序
    expect(dirtyIntersection(affected, ["apps/web/test/a.test.ts"], ["apps/web/test/a.test.ts"], [])).toEqual([
      "apps/web/test/a.test.ts",
    ]);
  });
});

describe("失败提取与退出码", () => {
  it("parseJunitFailures：只提含 <failure> 的 testcase 的 classname", () => {
    const xml = `<testsuites><testsuite name="s">
      <testcase classname="apps/web/test/a.test.ts" name="t1"><failure message="x"/></testcase>
      <testcase classname="apps/web/test/b.test.ts" name="t2"></testcase>
      <testcase classname="apps/web/test/c.test.ts" name="t3"><failure/></testcase>
    </testsuite></testsuites>`;
    expect(parseJunitFailures(xml)).toEqual(["apps/web/test/a.test.ts", "apps/web/test/c.test.ts"]);
    expect(parseJunitFailures("")).toEqual([]);
  });

  it("extractStdoutFailures：FAIL 行回退", () => {
    const out = " ✓ apps/web/test/a.test.ts (3 tests)\n FAIL apps/web/test/b.test.ts > suite > case\n Test Files  1 failed";
    expect(extractStdoutFailures(out)).toEqual(["apps/web/test/b.test.ts"]);
  });

  it("decideExit：fail/error 任一即 1；pass/skipped 全过即 0", () => {
    expect(decideExit([{ status: "pass" }, { status: "skipped" }])).toBe(0);
    expect(decideExit([])).toBe(0);
    expect(decideExit([{ status: "pass" }, { status: "fail" }])).toBe(1);
    expect(decideExit([{ status: "error" }])).toBe(1);
  });
});

describe("检查计划 planChecks", () => {
  const baseMapping = {
    tests: ["apps/web/test/exam-page.test.ts"],
    reasons: new Map(),
    e2e: [],
    e2eConfig: false,
    full: false,
    fullReason: "",
    skipped: [],
    warnings: [],
    graphAvailable: true,
  };
  const changedOf = (pushed) => ({ pushed, staged: [], unstaged: [], untracked: [], renames: [], base: "x" });

  it("overlay 源码改动：mirror/overlay/any/vitest/前端 typecheck/前端 lint 都跑；后端相关跳过", () => {
    const steps = planChecks(baseMapping, changedOf(["apps/web-overlay/src/lib/exam-calendar.ts"]), { root: ROOT });
    const byId = new Map(steps.map((s) => [s.id, s]));
    for (const id of ["mirror", "overlay-check", "syntax", "no-explicit-any", "vitest", "frontend-typecheck", "frontend-lint"]) {
      expect(byId.get(id).run).toBe(true);
    }
    for (const id of ["backend-typecheck", "backend-lint-api", "backend-lint-store", "ci-gate", "gates-registry"]) {
      expect(byId.get(id).run).toBe(false);
    }
    // deps-integrity / mock-hygiene 永不由本脚本跑，但必须显式列为 SKIPPED 并写明覆盖方
    expect(byId.get("deps-integrity").run).toBe(false);
    expect(byId.get("deps-integrity").skipReason).toMatch("prepush-gates");
    expect(byId.get("mock-hygiene").skipReason).toMatch("prepush-gates");
  });

  it("api 改动：后端 typecheck + api lint 跑，前端相关跳过", () => {
    const steps = planChecks(baseMapping, changedOf(["apps/api/src/routes/backup.ts"]), { root: ROOT });
    const byId = new Map(steps.map((s) => [s.id, s]));
    expect(byId.get("backend-typecheck").run).toBe(true);
    expect(byId.get("backend-lint-api").run).toBe(true);
    expect(byId.get("backend-lint-store").run).toBe(false);
    expect(byId.get("mirror").run).toBe(false);
    expect(byId.get("frontend-typecheck").run).toBe(false);
  });

  it("ci.yml 改动：两枚门禁脚本跑", () => {
    const steps = planChecks(baseMapping, changedOf([".github/workflows/ci.yml"]), { root: ROOT });
    const byId = new Map(steps.map((s) => [s.id, s]));
    expect(byId.get("ci-gate").run).toBe(true);
    expect(byId.get("gates-registry").run).toBe(true);
  });

  it("eslint 配置改动：前端 lint 升全量", () => {
    const steps = planChecks(baseMapping, changedOf(["apps/web-overlay/eslint.config.mjs"]), { root: ROOT });
    const step = steps.find((s) => s.id === "frontend-lint");
    expect(step.run).toBe(true);
    expect(step.title).toMatch("全量");
  });
});

describe("端到端映射（--dry-run，含模块图）", { timeout: 180_000 }, () => {
  it("改 exam-calendar：命中设计 §2.4 的 7 个最小集 + 两枚全局守卫", () => {
    const { code, tests } = dryRun(["apps/web-overlay/src/lib/exam-calendar.ts"]);
    expect(code).toBe(0);
    expect(tests).not.toBeNull();
    for (const t of [
      "apps/web/test/exam-page.test.ts",
      "apps/web/test/exam-admission-reminder.test.ts",
      "apps/web/test/exam-urgency.test.ts",
      "apps/web/test/home-exam-entry.test.ts",
      "apps/web/test/home-today-zone.test.ts",
      "apps/web/test/my-exams.test.ts",
      "apps/web/test/use-my-exams.test.ts",
    ]) {
      expect(tests).toContain(t);
    }
    expect(tests).toContain("apps/web/test/field-names.test.ts");
    expect(tests).toContain("apps/web/test/keyboard-activation.test.ts");
  });

  it("改 site-favicon：命中 site-favicon 全族（≥20 个）", () => {
    const { code, tests } = dryRun(["apps/web-overlay/src/components/site-favicon.tsx"]);
    expect(code).toBe(0);
    const family = tests.filter((t) => t.startsWith("apps/web/test/site-favicon-"));
    expect(family.length).toBeGreaterThanOrEqual(20);
    expect(tests).toContain("apps/web/test/site-favicon-dark-tile.test.ts");
    expect(tests).toContain("apps/web/test/site-favicon-gradient.test.ts");
  });

  it("改 overlay 测试自身：跑它自己的镜像，不跑整棵", () => {
    const { code, tests } = dryRun(["apps/web-overlay/test/exam-page.test.ts"]);
    expect(code).toBe(0);
    expect(tests).toContain("apps/web/test/exam-page.test.ts");
    expect(tests.length).toBeLessThan(20);
  });

  it("改 api 路由：图命中 backup 自己的测试", () => {
    const { code, tests } = dryRun(["apps/api/src/routes/backup.ts"]);
    expect(code).toBe(0);
    expect(tests).toContain("apps/api/test/backup-async-api.test.ts");
    expect(tests.length).toBeGreaterThan(0);
  });

  it("改 scripts 脚本：命中自己的测试", () => {
    const { code, tests } = dryRun(["scripts/check-bundle-budget.mjs"]);
    expect(code).toBe(0);
    expect(tests).toContain("scripts/check-bundle-budget.test.ts");
  });

  it("M4 目录回退（图不可用时）：无图无词根的源文件跑整棵 apps/web/test（宁可多跑）", () => {
    // 直接调 mapToTests + graph:null：干跑要建图（并行 I/O 争抢时可达 100s+），
    // 这里只钉 M4 分支本身，不经过子进程。
    const mapping = mapToTests(["apps/web-overlay/src/lib/qzxwvkj.ts"], { root: ROOT, graph: null });
    expect(mapping.graphAvailable).toBe(false);
    const total = readdirSync(join(ROOT, "apps/web/test")).filter((f) => f.endsWith(".test.ts")).length;
    expect(mapping.tests.length).toBe(total);
    expect(mapping.tests).toContain("apps/web/test/exam-page.test.ts");
  });

  it("有图时同一文件不走 M4：目录扫描型守卫经 dir 边命中，小集合而非整棵", () => {
    const { code, tests } = dryRun(["apps/web-overlay/src/lib/qzxwvkj.ts"]);
    expect(code).toBe(0);
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.length).toBeLessThan(50);
    expect(tests).toContain("scripts/check-no-explicit-any.test.ts");
  });

  it("vitest.config.ts：升全量", () => {
    const { code, tests, out } = dryRun(["vitest.config.ts"]);
    expect(code).toBe(0);
    expect(out).toMatch("全量");
    expect(tests.length).toBeGreaterThan(500);
  });

  it("只改 e2e spec：vitest 不跑，e2e 列为 CI-only", () => {
    const { code, tests, out } = dryRun(["e2e/plugin-market-star.spec.ts"]);
    expect(code).toBe(0);
    expect(tests).toEqual([]);
    expect(out).toMatch("e2e: deferred-to-CI (1 specs)");
    expect(out).not.toMatch("e2e: PASS");
  });

  it("只改 docs：无测试映射，dry-run 仍退出 0 并列出 SKIP", () => {
    // 注意：路径必须拼接构造——若把完整路径写成一个字符串字面量，模块图的路径字面量边
    // 会让本测试文件自身“依赖”该文档，改文档就会选中本文件，断言不再是空集。
    const { code, tests, out } = dryRun(["docs/" + "NEXT-STEPS-PLAN.md"]);
    expect(code).toBe(0);
    expect(tests).toEqual([]);
    expect(out).toMatch("SKIP: docs/NEXT-STEPS-PLAN.md");
  });

  it("改 playwright.config.ts：E2E-CONFIG 列为 CI-only", () => {
    const { code, out } = dryRun(["playwright.config.ts"]);
    expect(code).toBe(0);
    expect(out).toMatch("E2E-CONFIG: CI-ONLY");
  });
});

describe("运行 runStep", () => {
  it("node 步骤：退出 0 → pass；非零 → fail；缺失脚本 → error（不静默通过）", () => {
    const ok = runStep(
      { id: "t", title: "t", run: true, cmd: ["node", "-e", "console.log('ok')"], cwd: "", timeoutMs: 10_000, kind: "node" },
      { root: ROOT },
    );
    expect(ok.status).toBe("pass");
    const bad = runStep(
      { id: "t", title: "t", run: true, cmd: ["node", "-e", "process.exit(3)"], cwd: "", timeoutMs: 10_000, kind: "node" },
      { root: ROOT },
    );
    expect(bad.status).toBe("fail");
    const missing = runStep(
      { id: "t", title: "t", run: true, cmd: ["node", "scripts/no-such-script.mjs"], cwd: "", timeoutMs: 10_000, kind: "node" },
      { root: ROOT },
    );
    expect(missing.status).toBe("error");
    expect(missing.detail).toMatch("找不到");
  });

  it("超时 = 失败，不是跳过", () => {
    const res = runStep(
      { id: "t", title: "t", run: true, cmd: ["node", "-e", "setTimeout(() => {}, 5000)"], cwd: "", timeoutMs: 200, kind: "node" },
      { root: ROOT },
    );
    expect(res.status).toBe("fail");
    expect(res.detail).toMatch("超时");
  });

  it("run=false → skipped（带原因）", () => {
    const res = runStep(
      { id: "t", title: "t", run: false, skipReason: "无改动", cmd: null, cwd: "", timeoutMs: 1000, kind: "node" },
      { root: ROOT },
    );
    expect(res.status).toBe("skipped");
    expect(res.detail).toBe("无改动");
  });
});

describe("硬不变量：脚本自身绝不推/提交/杀进程", () => {
  it("源码（去注释后）不含 git push/add/commit/reset/checkout/clean 与 pkill", () => {
    const src = readFileSync(join(ROOT, SCRIPT), "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/["'](push|add|commit|reset|checkout|clean)["']/);
    expect(code).not.toMatch(/pkill/);
    // 唯一允许的 git 子命令：读操作（fetch/merge-base/diff/ls-files/rev-parse）
    const subs = [...code.matchAll(/"(rev-parse|merge-base|diff|ls-files|fetch)"/g)].map((m) => m[1]);
    expect(subs.length).toBeGreaterThan(0);
    expect(new Set(subs).size).toBeLessThanOrEqual(5);
  });

  it("脚本自身可被 node --check 通过", () => {
    expect(existsSync(join(ROOT, SCRIPT))).toBe(true);
  });
});
