/**
 * `check-large-files.mjs` 的用例。
 *
 * 这套守卫的来历是一次真实事故：2026-10-26 一个并行会话 `git add -A` 把
 * `.playwright-mcp/` 下的 Playwright 安装包（141.42 MiB）提交进了本地历史，
 * GitHub 的单文件硬限制（100 MiB）让三次推送全部被服务端拒绝，最后只能重写
 * 三个未推送提交。这里用**真实 git 仓库**逐条钉住守卫的行为，包括它最容易
 * 退化成空转的两个地方：
 *   1) 只看本次提交集（不能因为历史里躺着一个大文件，就把无关提交全拦死）；
 *   2) 只在「尚未推送到远程」的对象上拦（已推送的大文件重写也救不回来，
 *      每次 push 都报一遍只会把钩子变成噪音）。
 * 另外钉住钩子接线本身：脚本存在但没接进 pre-commit / pre-push 等于没做。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, "scripts", "check-large-files.mjs");
const INSTALLER = resolve(ROOT, "scripts", "install-git-hooks.mjs");
const MIB = 1024 * 1024;

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Windows 上偶发 EBUSY（git 句柄未释放）：临时目录留给系统清理，不影响断言
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "navhub-large-files-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function makeRepo(): string {
  const dir = tempDir();
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "guard@test.local"]);
  git(dir, ["config", "user.name", "guard-test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "README.md"), "seed\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

function writeSized(cwd: string, name: string, mib: number): void {
  writeFileSync(join(cwd, name), Buffer.alloc(Math.round(mib * MIB)));
}

function run(cwd: string, args: string[] = []): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("check-large-files.mjs", () => {
  it("暂存区为空时直接通过（不误伤空提交）", () => {
    const repo = makeRepo();
    const { code, out } = run(repo, ["--staged"]);
    expect(code, out).toBe(0);
    expect(out).toContain("暂存区为空");
  });

  it("暂存 51 MiB 触发默认硬阈值（阈值压在一半，给已进历史的文件留处理余量）", () => {
    const repo = makeRepo();
    writeSized(repo, "big package.bin", 51);
    git(repo, ["add", "big package.bin"]);
    const { code, out } = run(repo, ["--staged"]);
    expect(code, out).toBe(1);
    expect(out).toContain("硬阈值 50 MiB");
    // 路径里的空格不能被解析吃掉：报错必须指向能直接拿去处理的文件名
    expect(out).toContain("big package.bin");
    expect(out).toContain("51.0 MiB");
  });

  it("暂存 12 MiB 只告警不拦（有该入库的大文件，但不该在 12 MiB 就挡住人）", () => {
    const repo = makeRepo();
    writeSized(repo, "fixture.bin", 12);
    git(repo, ["add", "fixture.bin"]);
    const { code, out } = run(repo, ["--staged"]);
    expect(code, out).toBe(0);
    expect(out).toContain("⚠");
    expect(out).toContain("fixture.bin");
  });

  it("历史里已有大文件时，无关文件的暂存照样通过（只判本次提交集）", () => {
    const repo = makeRepo();
    writeSized(repo, "legacy.bin", 2);
    git(repo, ["add", "legacy.bin"]);
    git(repo, ["commit", "-q", "-m", "legacy large blob"]);
    writeFileSync(join(repo, "README.md"), "seed\nmore\n");
    git(repo, ["add", "README.md"]);
    const { code, out } = run(repo, ["--staged", "--block-mb=1", "--warn-mb=0.5"]);
    expect(code, out).toBe(0);
    expect(out).toContain("1 个 blob");
  });

  it("--unpushed 能发现未推送历史里的大文件（pre-push 的取证面）", () => {
    const repo = makeRepo();
    writeSized(repo, "unpushed.bin", 2);
    git(repo, ["add", "unpushed.bin"]);
    git(repo, ["commit", "-q", "-m", "unpushed large blob"]);
    const { code, out } = run(repo, ["--unpushed", "--block-mb=1", "--warn-mb=0.5"]);
    expect(code, out).toBe(1);
    expect(out).toContain("未推送历史");
    expect(out).toContain("unpushed.bin");
  });

  it("已经推送过的大文件不再重复报（否则每次 push 都是噪音）", () => {
    const repo = makeRepo();
    const remote = tempDir();
    git(remote, ["init", "-q", "--bare"]);
    git(repo, ["remote", "add", "origin", remote]);

    writeSized(repo, "already-pushed.bin", 2);
    git(repo, ["add", "already-pushed.bin"]);
    git(repo, ["commit", "-q", "-m", "push large blob first"]);
    git(repo, ["push", "-q", "origin", "HEAD:main"]);

    // 远程历史里已有这个大文件；新的提交只有一个小改动 -> 不该再被拦
    writeFileSync(join(repo, "README.md"), "seed\nsmall change\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-q", "-m", "small change"]);
    const { code, out } = run(repo, ["--unpushed", "--block-mb=1", "--warn-mb=0.5"]);
    expect(code, out).toBe(0);
    expect(out).toContain("无 >= 1 MiB 的文件");
  });

  it("取证失败（不在 git 仓库）以 2 退出，不伪装成通过", () => {
    const dir = tempDir();
    const { code, out } = run(dir, ["--staged"]);
    expect(code, out).toBe(2);
    expect(out).toContain("无法取证");
    expect(out).toContain("不等同于通过");
  });

  it("参数自相矛盾时以 2 退出（warn 不得高于 block）", () => {
    const repo = makeRepo();
    const { code, out } = run(repo, ["--block-mb=2", "--warn-mb=3"]);
    expect(code, out).toBe(2);
    expect(out).toContain("不能大于");
  });
});

describe("钩子接线（源码级钉子）", () => {
  const installer = readFileSync(INSTALLER, "utf8");

  it("pre-commit 在其它门禁之前先跑大文件守卫", () => {
    const large = installer.indexOf("node scripts/check-large-files.mjs --staged");
    const overlay = installer.indexOf("node scripts/check-web-overlay.mjs --staged");
    expect(large, "安装器里找不到 pre-commit 的大文件守卫").toBeGreaterThan(-1);
    expect(large, "大文件守卫应排在覆盖层校验之前（它最便宜且最不可逆）").toBeLessThan(overlay);
  });

  it("pre-push 钩子被生成，并且查的是未推送对象", () => {
    expect(installer).toContain("const prePushPath = join(gitHooksDir, 'pre-push')");
    expect(installer).toContain("node scripts/check-large-files.mjs --unpushed");
    expect(installer).toContain("writeFileSync(prePushPath, prePush");
  });

  it("两个钩子共用 node 定位脚本（环境坑只修一处）", () => {
    expect(installer).toContain("navhub-hook-node.sh");
    const lib = installer.indexOf("const nodeLib");
    const pre = installer.indexOf("const script = `#!/bin/sh");
    expect(lib, "缺少共用的 node 定位生成源").toBeGreaterThan(-1);
    expect(lib).toBeLessThan(pre);
  });

  it("安装到临时仓库时真的落盘三个产物", () => {
    const repo = makeRepo();
    execFileSync(process.execPath, [INSTALLER], { cwd: repo, stdio: "ignore" });
    const hooks = join(repo, ".git", "hooks");
    for (const name of ["pre-commit", "pre-push", "navhub-hook-node.sh"]) {
      expect(() => readFileSync(join(hooks, name), "utf8"), `${name} 未生成`).not.toThrow();
    }
    expect(readFileSync(join(hooks, "pre-push"), "utf8")).toContain("check-large-files.mjs --unpushed");
  });
});
