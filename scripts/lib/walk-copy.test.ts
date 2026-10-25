import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { walkAndCopy } from "./walk-copy.mjs";

/**
 * vendor-web.mjs 的搬运逻辑单测。
 *
 * 这些用例锁的都是"曾经真的把 CI 打红过"的行为：
 *   - apps/web-overlay 下出现 node_modules（workspace 安装产物，含目录符号链接）
 *     时，整条 vendor 步骤会抛 "Recursive option not enabled"；
 *   - 目标同名路径已是文件时，目录拷贝会 EISDIR；
 *   - 写入失败（Windows 安全软件干扰）需要 rm+cp 兜底与有限重试。
 */
const roots = [];

function makeRoot() {
  const dir = mkdtempSync(join(tmpdir(), "navhub-walk-copy-"));
  roots.push(dir);
  return dir;
}

/** 建一棵目录树：{ "a/b.txt": "content" } */
function makeTree(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, ...rel.split("/"));
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content, "utf8");
  }
  return dir;
}

const read = (dir, rel) => readFileSync(join(dir, ...rel.split("/")), "utf8");
const exists = (dir, rel) => existsSync(join(dir, ...rel.split("/")));

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("walkAndCopy", () => {
  it("copies nested files and counts them", () => {
    const src = makeTree(makeRoot(), { "a.txt": "A", "sub/b.txt": "B", "sub/deep/c.txt": "C" });
    const dst = makeRoot();
    const counter = { count: 0 };

    walkAndCopy(src, dst, { targetRoot: dst, counter });

    expect(counter.count).toBe(3);
    expect(read(dst, "a.txt")).toBe("A");
    expect(read(dst, "sub/b.txt")).toBe("B");
    expect(read(dst, "sub/deep/c.txt")).toBe("C");
  });

  it("never copies install artifacts (node_modules / .next) at any depth", () => {
    const src = makeTree(makeRoot(), {
      "keep.txt": "K",
      "node_modules/pkg/index.js": "top",
      ".next/build/manifest.json": "{}",
      "sub/node_modules/pkg/index.js": "nested",
      "sub/.next/types/page.ts": "// t",
    });
    const dst = makeRoot();
    const counter = { count: 0 };

    walkAndCopy(src, dst, { targetRoot: dst, counter });

    expect(counter.count).toBe(1);
    expect(exists(dst, "keep.txt")).toBe(true);
    expect(exists(dst, "node_modules")).toBe(false);
    expect(exists(dst, ".next")).toBe(false);
    expect(exists(dst, "sub/node_modules")).toBe(false);
    expect(exists(dst, "sub/.next")).toBe(false);
  });

  it("keeps the repo version of NavHub-owned files (skipRel) but still copies them when absent", () => {
    const src = makeTree(makeRoot(), { "package.json": '{"name":"upstream"}', "other.txt": "O" });
    const dst = makeTree(makeRoot(), { "package.json": '{"name":"navhub"}' });
    const counter = { count: 0 };

    walkAndCopy(src, dst, { targetRoot: dst, skipRel: new Set(["package.json"]), counter });

    // 目标已存在 -> 保留仓库版本，且不算作已拷贝
    expect(read(dst, "package.json")).toBe('{"name":"navhub"}');
    expect(read(dst, "other.txt")).toBe("O");
    expect(counter.count).toBe(1);

    // 目标不存在（全新目录 / Docker 构建）-> 正常拷贝
    const fresh = makeRoot();
    const freshCounter = { count: 0 };
    walkAndCopy(src, fresh, { targetRoot: fresh, skipRel: new Set(["package.json"]), counter: freshCounter });
    expect(read(fresh, "package.json")).toBe('{"name":"upstream"}');
    expect(freshCounter.count).toBe(2);
  });

  it("replaces a file with a directory instead of failing with EISDIR", () => {
    const src = makeTree(makeRoot(), { "sub/inside.txt": "I" });
    const dst = makeTree(makeRoot(), { "sub": "i-am-a-file" });

    walkAndCopy(src, dst, { targetRoot: dst });

    expect(statSync(join(dst, "sub")).isDirectory()).toBe(true);
    expect(read(dst, "sub/inside.txt")).toBe("I");
  });

  it("falls back to rm+cp when the plain copy fails", () => {
    const src = makeTree(makeRoot(), { "a.txt": "A" });
    const dst = makeRoot();
    const boom = () => {
      throw new Error("EBUSY: simulated lock");
    };

    walkAndCopy(src, dst, { targetRoot: dst, copyFile: boom });

    expect(read(dst, "a.txt")).toBe("A");
  });

  it("retries with backoff when both copy paths fail, then succeeds", () => {
    const src = makeTree(makeRoot(), { "a.txt": "A" });
    const dst = makeRoot();
    const sleep = vi.fn();
    let attempts = 0;
    const flaky = () => {
      attempts++;
      if (attempts === 1) throw new Error("first attempt fails");
      writeFileSync(join(dst, "a.txt"), "A", "utf8");
    };
    const cpAlwaysFails = () => {
      throw new Error("no symlink fallback here");
    };

    walkAndCopy(src, dst, { targetRoot: dst, copyFile: flaky, cp: cpAlwaysFails, sleep });

    expect(attempts).toBe(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(200);
    expect(read(dst, "a.txt")).toBe("A");
  });

  it("gives up (and surfaces the error) once the retry deadline passes", () => {
    const src = makeTree(makeRoot(), { "a.txt": "A" });
    const dst = makeRoot();
    const fail = () => {
      throw new Error("permanently locked");
    };

    expect(() =>
      walkAndCopy(src, dst, { targetRoot: dst, copyFile: fail, cp: fail, deadlineMs: 0, sleep: vi.fn() }),
    ).toThrow(/permanently locked/);
  });

  it("honours skipRel for nested paths (posix separators even on Windows)", () => {
    // relOf() 把 path.relative 的 "\" 归一化成 "/"，否则 Windows 上嵌套的自有文件
    // 会被上游同名文件覆盖（历史上 React 19 的 package.json 就是这样被打回 React 18）。
    const src = makeTree(makeRoot(), {
      "src/lib/github.ts": "upstream",
      "src/lib/new.ts": "upstream-new",
    });
    const dst = makeTree(makeRoot(), { "src/lib/github.ts": "navhub" });

    walkAndCopy(src, dst, { targetRoot: dst, skipRel: new Set(["src/lib/github.ts"]) });

    expect(read(dst, "src/lib/github.ts")).toBe("navhub");
    expect(read(dst, "src/lib/new.ts")).toBe("upstream-new");
  });
});
