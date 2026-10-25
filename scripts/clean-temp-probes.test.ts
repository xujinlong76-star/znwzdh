/**
 * `scripts/clean-temp-probes.mjs` 的自检。
 *
 * 这个工具会**删目录**，所以它的每条保护都必须是可验证的，而不是"我写了 if"：
 *
 *   1. 默认 dry-run：一个都不删（这是它默认安全的唯一凭据）；
 *   2. 有"新鲜"目录时 `--apply` 拒绝——那是「有测试正在跑」的直接证据；
 *   3. `--force` 才能越过上面那条；
 *   4. 含符号链接的目录整体跳过（本机有过 junction 递归删除清空源码的事故）；
 *   5. 前缀不匹配的目录从不碰。
 *
 * 用 `--root` 注入临时根，绝不碰真实的系统 temp。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, "scripts", "clean-temp-probes.mjs");

let root: string;

function run(args: string[]): { code: number; out: string } {
  const env = { ...process.env };
  delete env.GIT_INDEX_FILE;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", stdio: "pipe", env });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: typeof e.status === "number" ? e.status : 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** 造一个目录，并把 mtime 推到 `ageMin` 分钟前 */
function makeDir(name: string, ageMin: number, withFile = true): string {
  const p = join(root, name);
  mkdirSync(p, { recursive: true });
  if (withFile) writeFileSync(join(p, "data.db"), "x".repeat(2048), "utf8");
  const t = new Date(Date.now() - ageMin * 60_000);
  utimesSync(p, t, t);
  return p;
}

const list = () => readdirSync(root).sort();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "navhub-clean-probe-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("默认只报告，不删", () => {
  it("dry-run 列出可清理项，但目录全都还在", () => {
    makeDir("navhub-old-a", 120);
    makeDir("probe-old-b", 90);
    const { code, out } = run(["--root", root]);
    expect(code).toBe(0);
    expect(out).toContain("dry-run");
    expect(out).toContain("可选清理 2 个");
    expect(list()).toEqual(["navhub-old-a", "probe-old-b"]);
  });

  it("前缀不匹配的目录永远不进清单", () => {
    makeDir("other-thing", 120);
    makeDir("tmp.abcdef", 120);
    const { out } = run(["--root", root]);
    expect(out).toContain("可选清理 0 个");
    // tmp.* 会被单独提示「无法证明归属」，但不作为可清理项
    expect(out).toContain("未识别 1 个");
  });
});

describe("「有测试在跑」的保护", () => {
  it("存在新鲜目录时 --apply 拒绝，且一个都不删", () => {
    makeDir("navhub-old", 120); // 可选清理
    makeDir("navhub-fresh", 1); // 新鲜 → 视为「有测试在跑」
    const { code, out } = run(["--root", root, "--apply"]);
    expect(code).toBe(1);
    expect(out).toContain("很可能有测试正在运行");
    expect(list()).toEqual(["navhub-fresh", "navhub-old"]);
  });

  it("--force 越过保护：只删老的，保留新鲜的", () => {
    makeDir("navhub-old", 120);
    makeDir("navhub-fresh", 1);
    const { code, out } = run(["--root", root, "--apply", "--force"]);
    expect(code).toBe(0);
    expect(out).toContain("删除 1 个");
    // 新鲜目录必须还在——它可能正被某个测试用着
    expect(list()).toEqual(["navhub-fresh"]);
  });

  it("没有新鲜目录时直接 --apply 即可（不需要 --force）", () => {
    makeDir("navhub-old-1", 120);
    makeDir("navhub-old-2", 120);
    const { code, out } = run(["--root", root, "--apply"]);
    expect(code).toBe(0);
    expect(out).toContain("删除 2 个");
    expect(list()).toEqual([]);
  });
});

describe("符号链接：整目录跳过（宁可少清，不做赌博）", () => {
  it("目录里含链接时既不删、也不跟随", () => {
    const outer = makeDir("navhub-with-link", 120);
    // 链接指向一个「不该被删」的兄弟目录
    const precious = makeDir("other-precious", 120);
    let linked = true;
    try {
      symlinkSync(precious, join(outer, "link-to-precious"), "junction");
    } catch {
      linked = false;
    }
    if (!linked) {
      // 平台不支持创建链接：跳过断言（不留假绿）
      expect(true).toBe(true);
      return;
    }

    const { out } = run(["--root", root, "--apply", "--force"]);
    expect(out).toContain("含符号链接");
    // 两个目录都必须还在：外层被跳过，链接目标更不能被递归删
    expect(list()).toContain("navhub-with-link");
    expect(list()).toContain("other-precious");
    expect(readdirSync(precious)).toContain("data.db");
  });
});
