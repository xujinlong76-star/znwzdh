/**
 * 门禁清单的双向对照（scripts/check-gates-registry.mjs）。
 *
 * 这一条的性质：登记与接线**任意一侧漂移都不报错**，只会让人以为被保护着（或让下一个人
 * 把没有登记的命令顺手删掉）。所以每个方向都要用真实文件派生坏夹具，证明它确实会红：
 *   1. 登记了、模板里没有 → 红（以为在拦，其实没跑）；
 *   2. 模板里有、没登记 → 红（下一次重构会把它无声删掉）；
 *   3. pre-push 内层 runner 缺一枚 → 红；
 *   4. 登记为阻塞的 CI 作业不在 needs 里 / 新作业没登记 → 红；
 *   5. 清单本身坏了（重名）→ rc 2，不把「读不了清单」当成「没有门禁」。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(REPO_ROOT, "scripts/check-gates-registry.mjs");
const REAL_REGISTRY = join(REPO_ROOT, "scripts/gates.json");
const REAL_HOOKS = join(REPO_ROOT, "scripts/install-git-hooks.mjs");
const REAL_CI = join(REPO_ROOT, ".github/workflows/ci.yml");
const REAL_PREPUSH = join(REPO_ROOT, "scripts/prepush-gates.mjs");

let dir: string;

function run(opts: { registry?: string; hooks?: string; ci?: string; prepush?: string } = {}) {
  const args = [SCRIPT];
  if (opts.registry) args.push("--registry", opts.registry);
  if (opts.hooks) args.push("--hooks", opts.hooks);
  if (opts.ci) args.push("--ci", opts.ci);
  if (opts.prepush) args.push("--prepush", opts.prepush);
  try {
    const out = execFileSync(process.execPath, args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function writeFixture(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

/** 读真实文件 → 必须真的替换成功 → 落成夹具（否则用例会对着未变更的原文假绿） */
function derive(name: string, sourcePath: string, from: string | RegExp, to: string): string {
  const original = readFileSync(sourcePath, "utf8");
  const changed = original.replace(from, to);
  expect(changed, `${name}：派生没有命中，夹具等于原文`).not.toBe(original);
  return writeFixture(name, changed);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "navhub-gates-registry-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("门禁清单：现状与双向对照", () => {
  it("仓库现状：三个方向都对得上 ⇒ rc 0", () => {
    const res = run();
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("门禁清单一致");
    expect(res.out).toContain("pre-commit 12 枚");
    expect(res.out).toContain("CI 9 个作业");
    expect(res.out).toContain("登记的测试文件全部存在");
    expect(res.out).toContain("2 枚无专属测试，已声明理由");
  });

  it("登记的测试文件不存在 ⇒ 红（写了 test 却没东西验证这枚门禁）", () => {
    const registry = JSON.parse(readFileSync(REAL_REGISTRY, "utf8"));
    const target = registry.gates.find((g: { name: string }) => g.name === "syntax");
    target.test = "scripts/does-not-exist.test.ts";
    const path = writeFixture("registry-missing-test.json", JSON.stringify(registry, null, 2));
    const res = run({ registry: path });
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("门禁「syntax」登记的测试文件不存在");
    expect(res.out).toContain("does-not-exist.test.ts");
  });

  it("既没有 test 也没有 whyNoTest ⇒ rc 2（裸门禁不许入库）", () => {
    const registry = JSON.parse(readFileSync(REAL_REGISTRY, "utf8"));
    const target = registry.gates.find((g: { name: string }) => g.name === "syntax");
    delete target.test;
    const path = writeFixture("registry-no-test.json", JSON.stringify(registry, null, 2));
    const res = run({ registry: path });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("缺 test");
  });

  it("test 与 whyNoTest 同时写 ⇒ rc 2（要么补测试，要么删掉 test）", () => {
    const registry = JSON.parse(readFileSync(REAL_REGISTRY, "utf8"));
    const target = registry.gates.find((g: { name: string }) => g.name === "extensions");
    target.test = "scripts/check-syntax.test.ts";
    const path = writeFixture("registry-test-and-why.json", JSON.stringify(registry, null, 2));
    const res = run({ registry: path });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("同时写了 test 与 whyNoTest");
  });

  it("登记了但 pre-commit 模板没接线 ⇒ 红（以为在拦，其实没跑）", () => {
    const hooks = derive("hooks-missing-syntax.mjs", REAL_HOOKS, /node scripts\/check-syntax\.mjs --staged \|\| exit 1\n/, "");
    const res = run({ hooks });
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("check-syntax.mjs --staged");
    expect(res.out).toContain("以为在拦，其实没跑");
  });

  it("模板里多了一条未登记的命令 ⇒ 红", () => {
    const hooks = derive(
      "hooks-extra-command.mjs",
      REAL_HOOKS,
      "node scripts/check-extensions.mjs || exit 1",
      "node scripts/check-extensions.mjs || exit 1\nnode scripts/check-qq.mjs || exit 1",
    );
    const res = run({ hooks });
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("未登记的命令「scripts/check-qq.mjs」");
  });

  it("pre-push 外层命令没接线 ⇒ 红（含参数区分：staged 与 unpushed 是两枚）", () => {
    const hooks = derive(
      "hooks-missing-unpushed.mjs",
      REAL_HOOKS,
      /node scripts\/check-large-files\.mjs --unpushed \|\| exit 1\n/,
      "",
    );
    const res = run({ hooks });
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("check-large-files.mjs --unpushed");
    // 同一脚本的 --staged 那枚仍在，不应被误报
    expect(res.out).not.toContain("check-large-files.mjs --staged");
  });

  it("pre-push 内层 runner 缺一枚 ⇒ 红（计划里没有 = 它不会跑）", () => {
    const prepush = writeFixture(
      "prepush-without-core-mirrors.mjs",
      'export function planGates() { return [{ id: "rest-contracts" }, { id: "scope-explicit" }, { id: "client-node-imports" }, { id: "test-mirror-pairs" }]; }\n',
    );
    const res = run({ prepush });
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("「core-mirrors」");
    expect(res.out).toContain("planGates() 里没有");
  });

  it("登记为阻塞的 CI 作业不在 ci-passed.needs 里 ⇒ 红", () => {
    const ci = derive("ci-needs-without-e2e.yml", REAL_CI, "test-e2e, docker-smoke", "docker-smoke");
    const res = run({ ci });
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("test-e2e");
    expect(res.out).toContain("不在 ci-passed.needs");
  });

  it("ci.yml 新增作业但清单没登记 ⇒ 红（新作业要先回答该不该拦合并）", () => {
    const original = readFileSync(REAL_CI, "utf8");
    const ci = writeFixture(
      "ci-extra-job.yml",
      original +
        "\n  test-qq:\n    name: 未登记作业\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n",
    );
    const res = run({ ci });
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("作业 test-qq 未在清单登记");
  });

  it("清单登记了不存在的 CI 作业 ⇒ 红", () => {
    const registry = JSON.parse(readFileSync(REAL_REGISTRY, "utf8"));
    registry.gates.push({ name: "ghost-job", when: "ci", job: "test-ghost", blocks: true, why: "夹具", test: "apps/web/test/ci-gate.test.ts" });
    const path = writeFixture("registry-ghost-job.json", JSON.stringify(registry, null, 2));
    const res = run({ registry: path });
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("test-ghost");
    expect(res.out).toContain("在 ci.yml 里不存在");
  });

  it("清单本身坏了（重名）⇒ rc 2，不把「读不了清单」当成「没有门禁」", () => {
    const registry = JSON.parse(readFileSync(REAL_REGISTRY, "utf8"));
    registry.gates.push({ ...registry.gates[0] });
    const path = writeFixture("registry-duplicate-name.json", JSON.stringify(registry, null, 2));
    const res = run({ registry: path });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("name 重复");
  });
});
