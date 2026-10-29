/**
 * `scripts/junit-summary.mjs` 的测试。
 *
 * 背景：CI 红灯时无 token 读不到 job 日志、本机也拉不到 artifact 内容，
 * 「哪一例红了」实际不可读。这份账的唯一职责是把这个信息搬进 Step Summary，
 * 所以测试覆盖三件事：
 *   · 解析要认真实产物形态（vitest：根 testsuites + 每文件 testsuite + 实体转义）；
 *   · 渲染要能放进 markdown 表格（竖线/反引号/换行不能把表打散）；
 *   · 产物缺失必须显式失败——「静默零输出」正是这类账最坏的失效方式。
 * CI 接线用源码级断言（读 ci.yml）：脚本存在但没被跑，等于没有账。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseJunit, renderSummary } from "./junit-summary.mjs";

const SCRIPT = "scripts/junit-summary.mjs";
const DIRS: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "navhub-junit-summary-"));
  DIRS.push(d);
  return d;
}

afterAll(() => {
  for (const d of DIRS) rmSync(d, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}`, stdout: res.stdout };
}

/** 与真实产物同构：根 testsuites + 每文件 testsuite + 实体转义 */
const REAL_SHAPE = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="1" errors="0" time="1.2">
    <testsuite name="apps/api/test/a.test.ts" tests="2" failures="0" errors="0" skipped="0">
        <testcase classname="apps/api/test/a.test.ts" name="ok &gt; passes" time="0.001"></testcase>
        <testcase classname="apps/api/test/a.test.ts" name="ok &gt; skips" time="0.001">
            <skipped />
        </testcase>
    </testsuite>
    <testsuite name="apps/api/test/b.test.ts" tests="1" failures="1" errors="0" skipped="1">
        <testcase classname="apps/api/test/b.test.ts" name="bad &gt; fails">
            <failure message="expected &apos;x&apos; to be &apos;y&apos; | with pipe" type="AssertionError"><![CDATA[AssertionError: expected 'x' to be 'y'
    at file.ts:1:1]]></failure>
        </testcase>
    </testsuite>
</testsuites>
`;

describe("junit 解析", () => {
  it("计数来自 testsuite 属性之和（分片真实形态：1834 例 / 12 失败）", () => {
    const report = parseJunit(REAL_SHAPE);
    expect(report.totals).toEqual({ tests: 3, failures: 1, errors: 0, skipped: 1 });
    expect(report.cases).toBe(3);
  });

  it("失败详情取 message 并解码实体；同文件其余用例不误报", () => {
    const report = parseJunit(REAL_SHAPE);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0].classname).toBe("apps/api/test/b.test.ts");
    expect(report.failures[0].name).toBe("bad > fails");
    expect(report.failures[0].message).toBe("expected 'x' to be 'y' | with pipe");
  });

  it("<error> 也算未通过；没有 message 时退到正文首行", () => {
    const xml = `<testsuites><testsuite tests="1" failures="0" errors="1">
      <testcase classname="c.test.ts" name="boom"><error>TypeError: undefined is not a function
    at x.ts:2</error></testcase>
    </testsuite></testsuites>`;
    const report = parseJunit(xml);
    expect(report.totals.errors).toBe(1);
    expect(report.failures[0].kind).toBe("error");
    expect(report.failures[0].message).toContain("TypeError: undefined is not a function");
  });

  it("CRLF 输入与 LF 等价（Windows 工作区产物不能改变判定）", () => {
    const lf = parseJunit(REAL_SHAPE);
    const crlf = parseJunit(REAL_SHAPE.replace(/\n/g, "\r\n"));
    expect(crlf.totals).toEqual(lf.totals);
    expect(crlf.failures).toEqual(lf.failures);
  });

  it("只有根属性、没有 testsuite 的产物也能计数", () => {
    const report = parseJunit(`<testsuites tests="7" failures="2" errors="1" skipped="0"></testsuites>`);
    expect(report.totals).toEqual({ tests: 7, failures: 2, errors: 1, skipped: 0 });
  });
});

describe("markdown 渲染", () => {
  it("表里不出现裸竖线/反引号/换行（否则后面的列会错位）", () => {
    const md = renderSummary(parseJunit(REAL_SHAPE), { label: "junit-sqlite-1.xml" });
    const row = md.split("\n").find((line) => line.includes("bad > fails")) ?? "";
    expect(row).toContain("\\|");
    expect(row).not.toContain("| with pipe |");
    expect(md).toContain("### ❌ junit-sqlite-1.xml — 3 例，1 失败，0 错误，1 跳过");
  });

  it("全绿时只报计数，不铺空表", () => {
    const xml = `<testsuites><testsuite tests="5" failures="0" errors="0"></testsuite></testsuites>`;
    const md = renderSummary(parseJunit(xml), { label: "junit-e2e-1.xml" });
    expect(md).toContain("✅");
    expect(md).toContain("5 例");
    expect(md).not.toContain("| 用例 |");
  });

  it("--max 生效并如实说明「还有几例没列出」", () => {
    const report = parseJunit(REAL_SHAPE);
    const md = renderSummary(report, { label: "x.xml", max: 0 });
    // max=0 不是合法用法（CLI 会回退默认 50），这里只验证截断口径本身
    expect(md).toContain("另有 1 例未列出");
  });
});

describe("CLI", () => {
  it("产物缺失：退出码 1，并点名缺的是哪个文件", () => {
    const res = run([join(tempDir(), "nope.xml")]);
    expect(res.status).toBe(1);
    expect(res.out).toContain("找不到 junit 产物");
    expect(res.out).toContain("遥测链路断了");
  });

  it("GITHUB_STEP_SUMMARY 存在时追加进去（不是覆盖：同一 job 多份产物要累积）", () => {
    const dir = tempDir();
    const xml = join(dir, "junit.xml");
    const summary = join(dir, "summary.md");
    writeFileSync(xml, REAL_SHAPE, "utf8");
    writeFileSync(summary, "既有内容\n", "utf8");

    const res = run([xml], { GITHUB_STEP_SUMMARY: summary });
    expect(res.status, res.out).toBe(0);
    const written = readFileSync(summary, "utf8");
    expect(written).toContain("既有内容");
    expect(written).toContain("1 失败");
  });

  it("没有 GITHUB_STEP_SUMMARY 时打印到 stdout（本地复跑等价）", () => {
    const dir = tempDir();
    const xml = join(dir, "junit.xml");
    writeFileSync(xml, REAL_SHAPE, "utf8");
    const res = run([xml], { GITHUB_STEP_SUMMARY: "" });
    expect(res.status, res.out).toBe(0);
    expect(res.stdout).toContain("### ❌");
  });

  it("多个产物各自成节（一个分片一份 junit）", () => {
    const dir = tempDir();
    const a = join(dir, "a.xml");
    const b = join(dir, "b.xml");
    writeFileSync(a, REAL_SHAPE, "utf8");
    writeFileSync(b, REAL_SHAPE, "utf8");
    const res = run([a, b], { GITHUB_STEP_SUMMARY: "" });
    expect(res.status, res.out).toBe(0);
    expect(res.stdout.match(/### ❌/g)).toHaveLength(2);
  });
});

describe("CI 接线（源码级钉子）", () => {
  const wf = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8").replace(/\r\n/g, "\n");

  /**
   * 红灯也要跑，所以条件至少含 `!cancelled()`。
   *
   * 2026-10-29 起又加了一段：只有**测试步骤真的跑过**（成功或失败）才执行，
   * 即 `steps.vitest.outcome != 'skipped'`。typecheck 一红时测试步骤会被跳过、
   * junit 根本不存在，这三步照样跑就会把「一次根因」变成「四处级联红」，
   * 还会把「遥测链路断了」这条告警变成狼来了。
   */
  const RED_RUNS = "!cancelled()";

  it("单元测试分片：junit-summary 在测试步骤之后、artifact 上传之前，且红灯也跑", () => {
    const testStep = wf.indexOf("单元/接口测试（分片 ${{ matrix.shard }}/3）");
    const summary = wf.indexOf("node scripts/junit-summary.mjs junit-sqlite-${{ matrix.shard }}.xml");
    const upload = wf.indexOf("name: junit-sqlite-${{ matrix.shard }}");
    expect(testStep).toBeGreaterThan(-1);
    expect(summary).toBeGreaterThan(testStep);
    expect(upload).toBeGreaterThan(summary);
    const block = wf.slice(summary - 220, summary);
    expect(block).toContain("if: ${{ " + RED_RUNS);
    // 测试步骤被跳过时不掺和（上游才是根因所在）
    expect(block).toContain("steps.vitest.outcome != 'skipped'");
  });

  it("E2E 分片：同样接上，且传的是本分片的 junit 文件名", () => {
    const summary = wf.indexOf("node scripts/junit-summary.mjs junit-e2e-${{ matrix.shard }}.xml");
    expect(summary).toBeGreaterThan(-1);
    const block = wf.slice(summary - 220, summary);
    expect(block).toContain("if: ${{ " + RED_RUNS);
    expect(block).toContain("steps.e2e.outcome != 'skipped'");
    // 文件名必须与 PLAYWRIGHT_JUNIT_OUTPUT_NAME 一致，否则账永远是「产物缺失」
    expect(wf).toContain("PLAYWRIGHT_JUNIT_OUTPUT_NAME=junit-e2e-${{ matrix.shard }}.xml");
  });
});
