/**
 * `scripts/safe-commit.mjs` 的自检。
 *
 * 它存在的理由是多会话并行开发时反复踩的两次坑：
 *   1. 对方 `git add -A && git commit` 把我的工作区改动一并提交（3 次）；
 *   2. 我 `git add` 之后、`git commit` 之前对方提交过，索引被动过 → 我的提交落空（2 次）。
 *
 * 这两件事都不报错、也不留痕迹，只能靠流程约束。所以工具本身必须有测试：
 *
 *   · 纯函数：`git status --porcelain` 的解析（重命名、带空格路径）；
 *   · **集成**：在一个临时 git 仓库里真跑一次，验证「索引里有别人的暂存内容时，
 *     pathspec 提交不会把它带上」——这是这个工具唯一的核心保证，纯函数测不到。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, "scripts", "safe-commit.mjs");

/**
 * 脚本是 `.mjs`，没有类型声明。用动态 import 取两个纯函数。
 *
 * 放在 beforeAll 而不是顶层 await：本仓的 vitest 配置下，测试文件的顶层 await
 * 会以 `SyntaxError: Invalid or unexpected token` 的形式失败——
 * 报错里不带行号，排查成本远高于改成 beforeAll。
 */
type SafeCommitModule = {
  parseStatus: (s: string) => Array<{ status: string; path: string }>;
  diffSets: (a: string[], b: string[]) => { missing: string[]; extra: string[] };
};
let mod: SafeCommitModule;

beforeAll(async () => {
  // @ts-expect-error —— .mjs 无类型声明
  mod = (await import("./safe-commit.mjs")) as SafeCommitModule;
});

describe("parseStatus：porcelain 解析", () => {
  it("普通修改与新增", () => {
    expect(mod.parseStatus(" M apps/a.ts\nA  apps/b.ts\n")).toEqual([
      { status: " M", path: "apps/a.ts" },
      { status: "A ", path: "apps/b.ts" },
    ]);
  });

  it("重命名取新路径（old -> new）", () => {
    const got = mod.parseStatus("R  old/a.ts -> new/a.ts");
    expect(got).toHaveLength(1);
    expect(got[0]!.path).toBe("new/a.ts");
  });

  it("含空格的路径（被引号包着）", () => {
    expect(mod.parseStatus(' M "docs/a b.md"')[0]!.path).toBe("docs/a b.md");
  });

  it("空输出不产生条目", () => {
    expect(mod.parseStatus("")).toEqual([]);
    expect(mod.parseStatus("\n\n")).toEqual([]);
  });
});

describe("diffSets：提交内容与预期比对", () => {
  it("完全一致时两项都为空", () => {
    expect(mod.diffSets(["a", "b"], ["b", "a"])).toEqual({ missing: [], extra: [] });
  });

  it("漏提交与混入别人的改动都能分辨", () => {
    expect(mod.diffSets(["a", "b"], ["a", "c"])).toEqual({ missing: ["b"], extra: ["c"] });
  });
});

/**
 * 集成：临时仓库里真跑一次。
 *
 * 场景刻意做成「索引里有别人的暂存内容 + 我的工作区有改动」——
 * 这正是并行会话里最容易出事的状态。
 */
describe("集成：pathspec 隔离", () => {
  let repo: string;

  /**
   * 所有 git 调用都必须在**干净环境**里跑。
   *
   * `safe-commit.mjs` 给提交用的子进程注入 `GIT_INDEX_FILE`，而钩子跑测试时会
   * 继承这个变量 —— 于是测试里的 git 会去操作**主仓库的独立索引**而不是临时仓库。
   * 这会让本测试在钩子里失败、在手动执行时通过（本轮就是这样：手动 8/8 绿，
   * 钩子里 2 例红）。凡是并发/隔离类的测试，都要显式清掉这类环境变量。
   */
  const cleanEnv = () => {
    const env = { ...process.env };
    delete env.GIT_INDEX_FILE;
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    return env;
  };

  const git = (args: string[], cwd = repo) =>
    execFileSync("git", args, { cwd, encoding: "utf8", env: cleanEnv() }).replace(/\s+$/, "");

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "navhub-safe-commit-"));
    git(["init", "-q"], repo);
    git(["config", "user.email", "test@example.com"], repo);
    git(["config", "user.name", "Test"], repo);
    git(["config", "commit.gpgsign", "false"], repo);
    writeFileSync(join(repo, "mine.ts"), "export const a = 1;\n");
    writeFileSync(join(repo, "theirs.ts"), "export const b = 1;\n");
    git(["add", "."], repo);
    git(["commit", "-q", "-m", "init"], repo);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("只提交我指定的路径，别人的暂存内容留在索引里", () => {
    // 我改 mine.ts；「别人」改 theirs.ts 并已暂存
    writeFileSync(join(repo, "mine.ts"), "export const a = 2;\n");
    writeFileSync(join(repo, "theirs.ts"), "export const b = 2;\n");
    git(["add", "theirs.ts"], repo);

    writeFileSync(join(repo, ".msg"), "feat: 只提交 mine\n");
    const out = execFileSync(
      process.execPath,
      [SCRIPT, "--msg-file", ".msg", "--", "mine.ts"],
      { cwd: repo, encoding: "utf8", env: cleanEnv() },
    );

    expect(out).toContain("提交内容与预期完全一致");

    // 提交里只有 mine.ts
    const committed = git(["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean);
    expect(committed).toEqual(["mine.ts"]);

    /**
     * 别人的改动仍在共享索引里、工作区没被动过。
     *
     * 同时锁住一件容易漏的事：提交后 mine.ts 在**共享索引**里必须已同步到新 HEAD
     * （`git status` 干净）。否则它会以「已暂存的旧内容」留着，
     * 下一次不带 paths 的 `git commit` 会把旧内容提交回去 —— 等于回退这次提交。
     */
    expect(git(["diff", "--cached", "--name-only"])).toBe("theirs.ts");
    expect(git(["status", "--porcelain", "--", "theirs.ts"])).toBe("M  theirs.ts");
    expect(git(["status", "--porcelain", "--", "mine.ts"])).toBe("");
  });

  it("路径没有任何变更时快速失败，而不是造出空提交", () => {
    const before = git(["rev-parse", "HEAD"]);
    writeFileSync(join(repo, ".msg2"), "chore: 空\n");
    let failed = false;
    try {
      execFileSync(process.execPath, [SCRIPT, "--msg-file", ".msg2", "--", "mine.ts"], {
        cwd: repo,
        encoding: "utf8",
        stdio: "pipe",
        env: cleanEnv(),
      });
    } catch (err) {
      failed = true;
      expect(String((err as { stderr?: string }).stderr)).toContain("没有任何变更");
    }
    expect(failed).toBe(true);
    expect(git(["rev-parse", "HEAD"])).toBe(before);
  });

  it("失败路径不留 .git/index.safe-commit（否则下次把自己当并发会话）", () => {
    /**
     * 回归 2026-10-29：fail() 原先用 process.exit(1)，Node 不执行 finally，
     * 独立索引留在 .git/ 下。下次运行的 clearOwnLeftovers 只有在文件**超过 2 分钟**
     * 时才当残留清掉，于是几分钟内连续两次失败会互相挡住——本轮实测被坑 3 次。
     */
    writeFileSync(join(repo, ".msg3"), "chore: 空\n");
    expect(() =>
      execFileSync(process.execPath, [SCRIPT, "--msg-file", ".msg3", "--", "mine.ts"], {
        cwd: repo,
        encoding: "utf8",
        stdio: "pipe",
        env: cleanEnv(),
      }),
    ).toThrow();

    for (const name of ["index.safe-commit", "index.safe-commit.lock", "SAFE_COMMIT_MSG"]) {
      expect(
        existsSync(join(repo, ".git", name)),
        `失败后 .git/${name} 不该留在原地`,
      ).toBe(false);
    }

    // 紧接着再跑一次必须能立刻开始，而不是被「另一次 safe-commit 正在运行」挡住
    writeFileSync(join(repo, "mine.ts"), "export const a = 3;\n");
    writeFileSync(join(repo, ".msg4"), "fix: 接着跑\n");
    const out = execFileSync(
      process.execPath,
      [SCRIPT, "--msg-file", ".msg4", "--", "mine.ts"],
      { cwd: repo, encoding: "utf8", env: cleanEnv() },
    );
    expect(out).toContain("提交内容与预期完全一致");
  });

  it("主题域守卫拦下时也不留独立索引（升级成阻断时它用的是 process.exit）", () => {
    /**
     * 上面那条测的是「空提交」这条失败路径。4-0 的主题域守卫 2026-10-30 从告警升级成
     * 阻断时写成了 `process.exit(1)` ⇒ finally 跑不到 ⇒ `.git/index.safe-commit` 留在原地，
     * 下一次运行（包括并行会话的）在 120s 内会被「另一次 safe-commit 正在运行」挡住。
     * 本轮我按提示改对 subject 再提交，就是被这个残留挡住的——守卫自己把重跑路径堵了。
     */
    const head = git(["rev-parse", "HEAD"]);
    writeFileSync(join(repo, "mine.ts"), "export const a = 5;\n");
    writeFileSync(join(repo, ".msg6"), "feat(tooling): 主题域写 tooling，但文件在仓库根\n");
    const blocked = spawnSync(process.execPath, [SCRIPT, "--msg-file", ".msg6", "--", "mine.ts"], {
      cwd: repo,
      encoding: "utf8",
      env: cleanEnv(),
    });
    expect(blocked.status, "域外文件必须拦下提交").not.toBe(0);
    expect(blocked.stderr).toContain("主题域与文件域不一致");
    expect(git(["rev-parse", "HEAD"])).toBe(head);
    for (const name of ["index.safe-commit", "index.safe-commit.lock"]) {
      expect(existsSync(join(repo, ".git", name)), `守卫拦下后 .git/${name} 不该留在原地`).toBe(false);
    }

    // 改对 subject 立刻重跑：必须真的走到提交，而不是被自己的残留挡住两分钟
    writeFileSync(join(repo, ".msg7"), "fix: 主题域改对之后重跑\n");
    const retry = spawnSync(process.execPath, [SCRIPT, "--msg-file", ".msg7", "--", "mine.ts"], {
      cwd: repo,
      encoding: "utf8",
      env: cleanEnv(),
    });
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.stdout).toContain("提交内容与预期完全一致");
    expect(`${retry.stdout}${retry.stderr}`).not.toContain("另一次 safe-commit 正在运行");
  });

  it("跨域放行但理由没写进 message ⇒ 同样拦下，同样不留残留", () => {
    // 第二条 exit 路径（needInMessage）也必须走 fail()，否则守卫自己制造并发假象
    writeFileSync(join(repo, "mine.ts"), "export const a = 6;\n");
    writeFileSync(join(repo, ".msg8"), "feat(tooling): 跨域了但正文没写放行理由\n");
    const res = spawnSync(process.execPath, [SCRIPT, "--msg-file", ".msg8", "--", "mine.ts"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...cleanEnv(), NAVHUB_ALLOW_CROSS_SCOPE: "同一轮工具加固必须连 docs 一起提交" },
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("理由出现在提交说明正文里");
    expect(existsSync(join(repo, ".git", "index.safe-commit"))).toBe(false);
  });

  it("钩子拦下提交后不留独立索引（Windows 上 git 退出后句柄滞留，unlink 会失败）", () => {
    /**
     * 回归 2026-10-29（Windows 实测）：钩子拦下提交时，git 进程虽然退出了，
     * 却仍持有 .git/index.safe-commit 的句柄，此刻 unlinkSync 抛 EPERM。
     * 原实现把异常吞掉，残留文件被下一次运行当成「另一次 safe-commit 正在运行」，
     * 白等 STALE_LOCK_MS（120s）——本轮连续两次提交各多付了两分钟。
     * 现在 finally 里做短时重试，句柄一释放就删掉，不必等年龄阈值。
     */
    const hook = join(repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'hook 拒绝' >&2\nexit 1\n");
    try {
      chmodSync(hook, 0o755);
    } catch {
      // Windows 上 git 用自己的 shell 跑钩子，不看执行位
    }

    writeFileSync(join(repo, "mine.ts"), "export const a = 4;\n");
    writeFileSync(join(repo, ".msg5"), "chore: 被钩子拦下\n");
    const res = spawnSync(
      process.execPath,
      [SCRIPT, "--msg-file", ".msg5", "--", "mine.ts"],
      { cwd: repo, encoding: "utf8", env: cleanEnv() },
    );
    expect(res.status, "钩子拦下时提交应当失败").not.toBe(0);
    expect(
      existsSync(join(repo, ".git", "index.safe-commit")),
      "钩子拦下后 .git/index.safe-commit 不该留在原地",
    ).toBe(false);
  });
});
