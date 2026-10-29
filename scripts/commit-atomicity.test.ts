/**
 * `scripts/check-commit-atomicity.mjs` 的夹具测试。
 *
 * 这个门禁来自一次真实事故（89a20b42）：测试先提交、源码还在暂存区，本地全绿、
 * CI 26 例红。测试必须同时覆盖「该报」与「不该报」两侧，否则门禁会退化成噪音源：
 *   · 提交的测试 → 脏源码（改过未提交）        ⇒ 必须红
 *   · 提交的测试 → 未入库新文件                ⇒ 必须红
 *   · 依赖随本次提交一起进                     ⇒ 必须绿
 *   · 非测试文件的提交                         ⇒ 必须绿（并行开发允许源码脏）
 *   · 被 gitignore 覆盖的生成物（apps/web/src） ⇒ 必须绿
 *   · 注释里的路径字面量                       ⇒ 必须绿
 *   · 镜像测试（apps/web/test）的 `@/x` 归一到 overlay 事实源 ⇒ 必须红
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/check-commit-atomicity.mjs");
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/**
 * 夹具的 git 必须拿干净的 git 环境。
 *
 * 事故（2026-10-29，就在本门禁自己的首轮提交里）：pre-commit 由 safe-commit 驱动时
 * 带着 GIT_INDEX_FILE（独立索引）跑测试；夹具照原样继承了它，于是 fixture 仓库里的
 * `git add` 写进了**本次提交的临时索引**，钩子随后以为「本次提交不含测试文件」。
 * 任何 spawn git 的夹具测试都有这个雷，所以入口只留这一处、统一剥掉。
 */
function gitEnv(extra: Record<string, string> = {}) {
  const env = { ...process.env, ...extra };
  delete env.GIT_INDEX_FILE;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
  });
}

function makeRepo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "navhub-atomicity-"));
  dirs.push(dir);
  git(dir, ["init", "-q"]);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content, "utf8");
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-qm", "init"]);
  return dir;
}

function write(cwd: string, name: string, content: string) {
  mkdirSync(dirname(join(cwd, name)), { recursive: true });
  writeFileSync(join(cwd, name), content, "utf8");
}

function run(cwd: string, env: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, "--staged"], {
    cwd,
    encoding: "utf8",
    env: gitEnv(env),
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

describe("提交原子性门禁", () => {
  it("事故形状：测试提交了、它读的源码只是工作区改动 → 必须红", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/app/admin/x.ts": "export const a = 1\n",
    });
    // 源码改过但没 add（并行会话的半成品）
    write(dir, "apps/web-overlay/src/app/admin/x.ts", "export const a = 2\n");
    write(
      dir,
      "apps/web-overlay/test/x-guard.test.ts",
      'import { readFileSync } from "node:fs"\nconst src = readFileSync("src/app/admin/x.ts", "utf8")\n',
    );
    git(dir, ["add", "apps/web-overlay/test/x-guard.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("apps/web-overlay/test/x-guard.test.ts");
    expect(res.out).toContain("apps/web-overlay/src/app/admin/x.ts");
    expect(res.out).toContain("NAVHUB_ALLOW_DIRTY_TEST_DEPS");
  });

  it("源码一起进本次提交 → 必须绿（证明拦的是「不在提交集」而不是「改过」）", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/app/admin/x.ts": "export const a = 1\n",
    });
    write(dir, "apps/web-overlay/src/app/admin/x.ts", "export const a = 2\n");
    write(
      dir,
      "apps/web-overlay/test/x-guard.test.ts",
      'import { readFileSync } from "node:fs"\nreadFileSync("src/app/admin/x.ts", "utf8")\n',
    );
    git(dir, ["add", "apps/web-overlay/test/x-guard.test.ts", "apps/web-overlay/src/app/admin/x.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("提交原子性");
  });

  it("模块说明符形态：@/ 别名指向的源码脏了、未随提交 → 必须红", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/lib/fmt.ts": "export const fmt = (x: number) => String(x)\n",
    });
    write(dir, "apps/web-overlay/src/lib/fmt.ts", "export const fmt = (x: number) => `#${x}`\n");
    write(
      dir,
      "apps/web-overlay/test/fmt.test.ts",
      'import { fmt } from "@/lib/fmt"\nimport { expect, it } from "vitest"\nit("x", () => expect(fmt(1)).toBe("#1"))\n',
    );
    git(dir, ["add", "apps/web-overlay/test/fmt.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("apps/web-overlay/src/lib/fmt.ts");
  });

  it("从未入库的新源码（untracked）→ 必须红", () => {
    const dir = makeRepo({ "README.md": "# fixture\n" });
    write(dir, "apps/web-overlay/src/lib/brand-new.ts", "export const n = 1\n");
    write(
      dir,
      "apps/web-overlay/test/brand-new.test.ts",
      'import { n } from "@/lib/brand-new"\nvoid n\n',
    );
    git(dir, ["add", "apps/web-overlay/test/brand-new.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("apps/web-overlay/src/lib/brand-new.ts");
  });

  it("依赖与 HEAD 一致（源码没脏）→ 必须绿", () => {
    const dir = makeRepo({
      "apps/web-overlay/src/lib/stable.ts": "export const s = 1\n",
    });
    write(
      dir,
      "apps/web-overlay/test/stable.test.ts",
      'import { s } from "@/lib/stable"\nvoid s\n',
    );
    git(dir, ["add", "apps/web-overlay/test/stable.test.ts"]);

    expect(run(dir).status).toBe(0);
  });

  it("提交里没有测试文件 → 必须绿（并行开发允许源码脏）", () => {
    const dir = makeRepo({ "apps/web-overlay/src/lib/fmt.ts": "export const fmt = 1\n" });
    write(dir, "apps/web-overlay/src/lib/fmt.ts", "export const fmt = 2\n");
    write(dir, "apps/web-overlay/src/lib/other.ts", "export const other = 1\n");
    git(dir, ["add", "apps/web-overlay/src/lib/other.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("不含测试文件");
  });

  it("被 gitignore 覆盖的生成物不算「未提交」（apps/web/src 是构建产物）", () => {
    // 只存在于生成树、没有 overlay 对应物：判据必须落在「被忽略 = 不算未提交」
    const dir = makeRepo({ ".gitignore": "apps/web/src/\n" });
    write(dir, "apps/web/src/lib/generated-only.ts", "export const g = 100\n");
    write(
      dir,
      "apps/web/test/generated-only.test.ts",
      'import { g } from "@/lib/generated-only"\nvoid g\n',
    );
    git(dir, ["add", "apps/web/test/generated-only.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(0);
  });

  it("镜像测试的 @/x 归一到 overlay 事实源：overlay 脏了 → 必须红", () => {
    const dir = makeRepo({
      ".gitignore": "apps/web/src/\n",
      "apps/web-overlay/src/lib/x.ts": "export const x = 1\n",
    });
    write(dir, "apps/web/src/lib/x.ts", "export const x = 2\n");
    write(dir, "apps/web-overlay/src/lib/x.ts", "export const x = 2\n");
    write(dir, "apps/web/test/x.test.ts", 'import { x } from "@/lib/x"\nvoid x\n');
    git(dir, ["add", "apps/web/test/x.test.ts"]);

    const res = run(dir);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("apps/web-overlay/src/lib/x.ts");
  });

  it("注释里的路径字面量不算依赖", () => {
    const dir = makeRepo({ "apps/web-overlay/src/lib/x.ts": "export const x = 1\n" });
    write(dir, "apps/web-overlay/src/lib/x.ts", "export const x = 2\n");
    write(
      dir,
      "apps/web-overlay/test/comment-only.test.ts",
      '// readFileSync("src/lib/x.ts")\n/* import { x } from "@/lib/x" */\nexport const ok = 1\n',
    );
    git(dir, ["add", "apps/web-overlay/test/comment-only.test.ts"]);

    expect(run(dir).status).toBe(0);
  });

  it("钩子接线：install-git-hooks.mjs 生成在 check-committed-refs 之后（源码级钉子）", () => {
    const installer = readFileSync(join(ROOT, "scripts/install-git-hooks.mjs"), "utf8");
    const refs = installer.indexOf("node scripts/check-committed-refs.mjs --staged || exit 1");
    const atomic = installer.indexOf("node scripts/check-commit-atomicity.mjs --staged || exit 1");
    expect(refs, "安装器里找不到 check-committed-refs").toBeGreaterThan(-1);
    expect(atomic, "安装器里找不到提交原子性门禁").toBeGreaterThan(refs);
  });

  it("NAVHUB_ALLOW_DIRTY_TEST_DEPS=1 时放行并逐条列出（逃生口要看得见）", () => {
    const dir = makeRepo({ "apps/web-overlay/src/lib/x.ts": "export const x = 1\n" });
    write(dir, "apps/web-overlay/src/lib/x.ts", "export const x = 2\n");
    write(dir, "apps/web-overlay/test/x.test.ts", 'import { x } from "@/lib/x"\nvoid x\n');
    git(dir, ["add", "apps/web-overlay/test/x.test.ts"]);

    const res = run(dir, { NAVHUB_ALLOW_DIRTY_TEST_DEPS: "1" });
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("NAVHUB_ALLOW_DIRTY_TEST_DEPS");
    expect(res.out).toContain("apps/web-overlay/src/lib/x.ts");
  });
});
