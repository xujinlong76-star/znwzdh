/**
 * `scripts/ci-status.mjs` 的纯函数守卫。
 *
 * 本机没有 gh CLI，推送后只能靠这个脚本确认 CI 状态——它解析错仓库、
 * 或者把「进行中」误判成「成功」，都会让人对 CI 结果产生错误判断。
 * 这里只测纯函数（不发网络请求）：remote 解析、状态标记、字段裁剪。
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明；测试只消费其导出函数
import { parseRepoSlug, statusMark, summarizeRun } from "./ci-status.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("parseRepoSlug", () => {
  it("支持 https / ssh / 带 .git 后缀三种写法", () => {
    for (const remote of [
      "https://github.com/xujinlong76-star/znwzdh.git",
      "https://github.com/xujinlong76-star/znwzdh",
      "git@github.com:xujinlong76-star/znwzdh.git",
      "ssh://git@github.com/xujinlong76-star/znwzdh.git",
    ]) {
      expect(parseRepoSlug(remote), remote).toBe("xujinlong76-star/znwzdh");
    }
  });

  it("非 GitHub 地址与空值返回 null（而不是猜一个仓库出来）", () => {
    expect(parseRepoSlug("https://gitlab.com/a/b.git")).toBeNull();
    expect(parseRepoSlug("")).toBeNull();
    expect(parseRepoSlug(null)).toBeNull();
  });
});

describe("statusMark", () => {
  it("只有 completed 才给出结论标记，进行中不能被说成成功", () => {
    expect(statusMark({ status: "in_progress", conclusion: null })).toBe("…");
    expect(statusMark({ status: "queued", conclusion: null })).toBe("…");
    expect(statusMark({ status: "completed", conclusion: "success" })).toBe("✔");
    expect(statusMark({ status: "completed", conclusion: "failure" })).toBe("✘");
    expect(statusMark({ status: "completed", conclusion: "cancelled" })).toBe("⊘");
  });
});

describe("summarizeRun", () => {
  it("sha 截断到 7 位，字段缺失时不抛错", () => {
    const run = summarizeRun({
      id: 1,
      name: "CI",
      head_branch: "main",
      head_sha: "8bc4219deadbeef",
      status: "completed",
      conclusion: "success",
      html_url: "https://example.com/run/1",
    });
    expect(run.sha).toBe("8bc4219");
    expect(run.branch).toBe("main");
    expect(run.url).toBe("https://example.com/run/1");
    const empty = summarizeRun({ id: 2 });
    expect(empty.name).toBe("(未命名)");
    expect(empty.sha).toBe("");
  });
});

describe("CLI 参数校验", () => {
  it("remote 不是 GitHub 时以退出码 2 结束，并说明用法", () => {
    let status = 0;
    let output = "";
    try {
      output = execFileSync(process.execPath, ["scripts/ci-status.mjs", "--limit=3"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NAVHUB_GIT_REMOTE: "https://gitlab.com/a/b.git" },
      });
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      status = e.status ?? -1;
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(status).toBe(2);
    expect(output).toContain("无法从 git remote 解析 GitHub 仓库");
  });

  it("--limit 越界时拒绝执行（避免一次打几百行）", () => {
    let status = 0;
    try {
      execFileSync(process.execPath, ["scripts/ci-status.mjs", "--limit=999"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NAVHUB_GIT_REMOTE: "https://github.com/a/b.git" },
      });
    } catch (error) {
      status = (error as { status?: number }).status ?? -1;
    }
    expect(status).toBe(2);
  });
});
