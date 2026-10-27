/**
 * `scripts/check-committed-refs.mjs` 的夹具测试。
 *
 * 这个门禁存在的理由是一次真实事故：`vitest.config.ts` 引用了从未 `git add` 的
 * `scripts/worker-budget.ts`，本地全绿、CI 两个作业同时崩。所以测试必须覆盖
 * 「什么该报」与「什么不该报」两侧——只测报错会让门禁逐渐变成噪音源：
 *   · 已跟踪 → 未入库（未忽略）  ⇒ 必须红
 *   · 已跟踪 → 被 gitignore 覆盖 ⇒ 必须绿（构建期生成，如 apps/web/src）
 *   · 目标只存在于工作区、内容取自 HEAD 时不参与判定 ⇒ 绿
 *   · package.json 的 node 脚本引用同样纳入
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/check-committed-refs.mjs");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, args: string[]) {
  return execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
  });
}

/** 建一个最小仓库：main.ts 已入库，later.ts 故意不入库 */
function makeRepo(files: Record<string, string>, { commit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "navhub-committed-refs-"));
  dirs.push(dir);
  git(dir, ["init", "-q"]);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content, "utf8");
  }
  git(dir, ["add", "-A"]);
  if (commit) git(dir, ["commit", "-qm", "init"]);
  return dir;
}

function run(cwd: string, args: string[] = []) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe("提交完整性门禁", () => {
  it("已跟踪文件引用未入库文件：必须红，并指出该 git add 哪个路径", () => {
    const dir = makeRepo({
      "src/main.ts": 'import { x } from "./later";\nexport const y = x;\n',
    });
    writeFileSync(join(dir, "src/later.ts"), "export const x = 1;\n", "utf8"); // 存在但未入库
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.out).toContain("src/later.ts");
    expect(res.out).toContain("git add");
  });

  it("把文件 git add 之后必须转绿（证明报的是「未入库」而不是「不存在」）", () => {
    const dir = makeRepo({
      "src/main.ts": 'import { x } from "./later";\nexport const y = x;\n',
    });
    writeFileSync(join(dir, "src/later.ts"), "export const x = 1;\n", "utf8");
    expect(run(dir).status).toBe(1);
    git(dir, ["add", "src/later.ts"]);
    // HEAD 模式按「已提交」判定，所以这里要真的提交（--staged 模式才是看暂存区）
    git(dir, ["commit", "-qm", "add later"]);
    const res = run(dir);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("无「引用未入库文件」");
  });

  it("目标被 .gitignore 覆盖时放行（构建期生成物不算漏提交）", () => {
    const dir = makeRepo({
      ".gitignore": "generated/\n",
      "src/main.ts": 'import { g } from "../generated/thing";\n',
    });
    mkdirSync(join(dir, "generated"), { recursive: true });
    writeFileSync(join(dir, "generated/thing.ts"), "export const g = 1;\n", "utf8");
    const res = run(dir);
    expect(res.status, res.out).toBe(0);
  });

  it("package.json 的 node 脚本引用未入库文件：必须红", () => {
    const dir = makeRepo({
      "package.json": JSON.stringify({ name: "fixture", scripts: { check: "node scripts/missing.mjs" } }, null, 2),
    });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts/missing.mjs"), "console.log(1);\n", "utf8");
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.out).toContain("scripts/missing.mjs");
  });

  it("注释里的路径不算引用（避免注释示例制造假红）", () => {
    const dir = makeRepo({
      "src/main.ts": '// import { x } from "./nope"\n/* require("./also-nope") */\nexport const ok = 1;\n',
    });
    const res = run(dir);
    expect(res.status, res.out).toBe(0);
  });

  it("--staged 只看本次暂存集：未暂存的改动不参与判定", () => {
    const dir = makeRepo({ "src/main.ts": "export const a = 1;\n" });
    writeFileSync(join(dir, "src/other.ts"), 'import { a } from "./main";\nexport const b = a;\n', "utf8");
    // 未暂存 → staged 模式应绿
    expect(run(dir, ["--staged"]).status).toBe(0);
    // 暂存后：other.ts 引用的 main.ts 已入库，仍应绿
    git(dir, ["add", "src/other.ts"]);
    expect(run(dir, ["--staged"]).status).toBe(0);
  });
});
