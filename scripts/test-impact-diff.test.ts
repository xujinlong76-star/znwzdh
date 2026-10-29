/**
 * `--diff` 回放的两件事：改 CI 接线的提交看得见，读不到 base 时说的是真话。
 *
 * 为什么单独成文件（而不是并进 scripts/test-impact.test.ts）：这一组的价值全在
 * 「不依赖真实仓库的历史」——它要在一次性 git 仓库里造出「只改 .github/workflows/ci.yml
 * 的一笔提交」和「浅克隆」两种形状，而真实仓库的 HEAD 由多个会话共同推进，
 * 拿它当夹具必然假红（2026-10-29 实测：一笔 ci.yml-only 提交就把
 * 「--diff HEAD~1 应给出图命中数」打红了）。夹具与真实仓库分开，两边各自可核对。
 *
 * 覆盖的三条：
 *   1. 回放的可见集 = 图前缀表，不是代码后缀（只改 CI/Dockerfile 的提交也要能回放）；
 *   2. 浅克隆下 `HEAD~1` 真的不存在 ⇒ 报「浅克隆」并指向 fetch-depth，而不是 ref 笔误；
 *   3. ref 写错 ⇒ 报「不是真实存在的 ref」。
 * 2 与 3 的下一步命令完全不同，混成一句就等于让人去查一个没写错的参数。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { isShallow } from "./lib/git-blobs.mjs";
import { graphVisibleFiles } from "./lib/test-impact.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "test-impact.mjs");
const tempRoots: string[] = [];

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function tmpDir(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `navhub-diff-${name}-`));
  tempRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function commitAll(root: string, message: string): string {
  git(["add", "-A"], root);
  git(["-c", "user.name=t", "-c", "user.email=t@navhub.local", "commit", "-q", "-m", message], root);
  return git(["rev-parse", "HEAD"], root).trim();
}

/**
 * 一次性仓库：一笔改源码（测试引用它），一笔**只改 CI 接线**。
 * 后者是 2026-10-29 打红真实仓库断言的那种形状，历史上没有夹具能造它。
 */
function makeGitRepo(): string {
  const root = tmpDir("repo");
  git(["init", "-q", "--initial-branch=main"], root);
  write(root, "apps/api/src/a.ts", "export const a = 1;\n");
  write(root, "apps/api/test/a.test.ts", 'import { a } from "../src/a.ts";\n');
  write(root, ".github/workflows/ci.yml", "jobs:\n  test-sqlite:\n    steps: []\n");
  commitAll(root, "chore: 初始三文件");
  write(root, ".github/workflows/ci.yml", "jobs:\n  test-sqlite:\n    steps:\n      - run: pnpm test\n");
  commitAll(root, "ci: 只改 CI 接线");
  write(root, "apps/api/src/a.ts", "export const a = 2;\nexport const b = 1;\n");
  commitAll(root, "feat: 改源码");
  return root;
}

function cli(cwd: string, args: string[]): { status: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("回放的可见集：图前缀表，不是代码后缀", () => {
  it("非代码文件（CI / Dockerfile / docs）算图可见，锁文件与 data/ 不算", () => {
    expect(
      graphVisibleFiles([
        ".github/workflows/ci.yml",
        "docker/Dockerfile.api",
        "docs/GATES-OPERATIONS.md",
        "pnpm-lock.yaml",
        "data/navhub.db",
        "README.md",
      ]),
    ).toEqual([".github/workflows/ci.yml", "docker/Dockerfile.api", "docs/GATES-OPERATIONS.md"]);
  });

  it("只改 CI 接线的提交在回放里不再等于没改", () => {
    const root = makeGitRepo();
    // HEAD = 「feat: 改源码」，HEAD~1 = 「ci: 只改 CI 接线」：回放最近 2 笔
    const res = cli(root, ["--diff", "HEAD~2", "--limit", "2", "--no-selector"]);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("只改 CI 接线");
    expect(res.out).toContain("改源码");
    // 源码那笔必须给出图命中数（a.test.ts 经 import 依赖 a.ts）
    expect(res.out).toMatch(/改源码[^\n]*→ 图 [1-9]/);
  });
});

describe("读不到 base：浅克隆与 ref 笔误必须分开说", () => {
  it("浅克隆（CI 的 fetch-depth: 1）⇒ rc2 且点名浅克隆与 fetch-depth", () => {
    const src = makeGitRepo();
    const shallow = tmpDir("shallow");
    /**
     * `--no-local` 是必须的：本地路径克隆走 hardlink 优化，git 会**静默忽略 `--depth`**，
     * 造出来的「浅克隆」其实是全量的（2026-10-29 实测 `isShallow()` 为 false），
     * 于是这条断言在测一个不存在的形状。`--no-local` 强制走普通传输，`--depth` 才生效。
     */
    git(["clone", "--quiet", "--no-local", "--depth", "1", src, shallow], tmpdir());
    expect(isShallow({ cwd: shallow }), "夹具没造出浅克隆").toBe(true);
    expect(isShallow({ cwd: src }), "全量克隆不该被认成浅克隆").toBe(false);
    const res = cli(shallow, ["--diff", "HEAD~1", "--no-selector"]);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("浅克隆");
    expect(res.out).toContain("fetch-depth");
    // 关键：不许把人往「ref 写错了」上带
    expect(res.out).not.toContain("不是本仓库里真实存在的 ref");
  });

  it("ref 不存在（仓库是全量的）⇒ rc2 且说的是 ref", () => {
    const root = makeGitRepo();
    const res = cli(root, ["--diff", "definitely-not-a-ref", "--no-selector"]);
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain("不是本仓库里真实存在的 ref");
    expect(res.out).not.toContain("浅克隆");
  });

  it("夹具本身没有 .git/shallow 之外的钩子：选择器不参与时不该报错", () => {
    const root = makeGitRepo();
    expect(existsSync(join(root, ".git", "hooks", "navhub-precommit-tests.mjs"))).toBe(false);
    const res = cli(root, ["--diff", "HEAD~1", "--no-selector"]);
    expect(res.status, res.out).toBe(0);
  });
});
