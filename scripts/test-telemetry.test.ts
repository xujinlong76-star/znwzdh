/**
 * `scripts/test-telemetry.mjs` 的纯函数与 CLI 测试。
 *
 * 关键断言是「flaky 不等于 failed」：Playwright 重试后通过会写 `<flakyFailure>`，
 * 整轮是绿的，但用例在抖。如果解析把它当通过，这个脚本就完全失去意义。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明
import { expiredQuarantine, flakeRate, parseJUnit, updateHistory } from "./test-telemetry.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/test-telemetry.mjs");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), "navhub-telemetry-"));
  dirs.push(dir);
  return dir;
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="suite" tests="4" failures="1" skipped="1">
    <testcase classname="a.test.ts" name="通过" time="0.01"/>
    <testcase classname="a.test.ts" name="失败 &amp; 转义" time="0.02">
      <failure message="boom">stack</failure>
    </testcase>
    <testcase classname="a.test.ts" name="跳过" time="0">
      <skipped/>
    </testcase>
    <testcase classname="b.test.ts" name="抖了一次" time="0.03">
      <flakyFailure message="first attempt failed">stack</flakyFailure>
    </testcase>
  </testsuite>
</testsuites>`;

describe("parseJUnit", () => {
  it("区分 passed / failed / skipped / flaky，并解码实体", () => {
    const parsed = parseJUnit(XML);
    expect(parsed.total).toBe(4);
    expect(parsed.failed).toBe(1);
    expect(parsed.flaky).toEqual(["b.test.ts › 抖了一次"]);
    const failed = parsed.cases.find((c: { status: string }) => c.status === "failed");
    expect(failed.id).toBe("a.test.ts › 失败 & 转义");
  });

  it("自闭合 testcase 也能解析（vitest 的通过用例就是这种）", () => {
    const parsed = parseJUnit('<testsuite><testcase classname="x" name="y" time="0.5"/></testsuite>');
    expect(parsed.total).toBe(1);
    expect(parsed.cases[0]).toMatchObject({ id: "x › y", status: "passed", timeMs: 500 });
  });
});

describe("updateHistory / flakeRate", () => {
  it("按用例累计 runs / fails / flakes，并按上限裁剪", () => {
    let history = { version: 1, runs: [], tests: {} };
    const run = (status: string) => ({ at: new Date().toISOString(), cases: [{ id: "t", status, timeMs: 1 }] });
    history = updateHistory(history, run("passed"), 2);
    history = updateHistory(history, run("flaky"), 2);
    history = updateHistory(history, run("failed"), 2);
    expect(history.runs).toHaveLength(2); // 上限 2
    expect(history.tests.t).toEqual({ runs: 3, fails: 1, flakes: 1, last: "failed" });
    expect(flakeRate(history, "t")).toBeCloseTo(1 / 3, 5);
    expect(flakeRate(history, "unknown")).toBe(0);
  });
});

describe("expiredQuarantine", () => {
  it("到期日当天仍有效，次日起失效", () => {
    const entries = [
      { test: "old", expiresAt: "2026-10-01" },
      { test: "today", expiresAt: "2026-10-27" },
      { test: "future", expiresAt: "2026-12-31" },
    ];
    expect(expiredQuarantine(entries, "2026-10-27T10:00:00Z").map((e: { test: string }) => e.test)).toEqual(["old"]);
  });
});

describe("CLI", () => {
  it("隔离过期时退出 1，并说明是哪个用例", () => {
    const dir = tmp();
    const q = join(dir, "quarantine.json");
    writeFileSync(q, JSON.stringify({ entries: [{ test: "flaky.case", expiresAt: "2020-01-01", owner: "me" }] }), "utf8");
    const res = spawnSync(process.execPath, [SCRIPT, "--quarantine-only", `--quarantine=${q}`], { encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(`${res.stdout}${res.stderr}`).toContain("隔离条目已过期");
  });

  it("没有 JUnit 文件时以退出码 2 结束（而不是假装通过）", () => {
    const res = spawnSync(process.execPath, [SCRIPT, "--junit=/nonexistent/*.xml"], { encoding: "utf8" });
    expect(res.status).toBe(2);
  });

  it("正常跑一轮：写入历史并打印统计", () => {
    const dir = tmp();
    const junit = join(dir, "junit-1.xml");
    writeFileSync(junit, XML, "utf8");
    const history = join(dir, "history.json");
    const q = join(dir, "q.json");
    writeFileSync(q, JSON.stringify({ entries: [] }), "utf8");
    execFileSync(process.execPath, [SCRIPT, `--junit=${junit}`, `--history=${history}`, `--quarantine=${q}`], {
      encoding: "utf8",
    });
    const saved = JSON.parse(readFileSync(history, "utf8"));
    expect(saved.runs).toHaveLength(1);
    expect(saved.tests["b.test.ts › 抖了一次"].flakes).toBe(1);
  });
});
