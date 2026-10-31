/**
 * 失败归因的判据自检（见 failure-scope.mjs 文件头 2026-10-31 的真实事故）。
 *
 * 这条判据决定「测试红了还让不让提交」，两个方向都要钉：
 *   - 放宽方向：依赖未提交改动的失败必须降级（否则种子提交被同事的在途重构挡死）；
 *   - 收紧方向：闭包干净的失败必须拦（否则门禁退化成只报不拦的摆设）。
 */
import { describe, expect, it } from "vitest";
import {
  attributeFailures,
  dependencyClosure,
  firstWorktreeHit,
  forwardAdjacency,
  parseFailingTestFiles,
  worktreeDirtyPaths,
} from "./failure-scope.mjs";

describe("parseFailingTestFiles", () => {
  it("从 vitest 的 FAIL 行取文件，去重、去 ANSI", () => {
    const output = [
      "⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯",
      "",
      " FAIL  apps/api/test/snapshot-version.test.ts > 快照版本号缓存 > 第一次读建缓存",
      "AssertionError: ...",
      " FAIL  apps/api/test/snapshot-version.test.ts > 快照版本号缓存 > 第二次读",
      "\u001b[31m FAIL  apps\\web\\test\\copilot-stream-guard.test.ts > 守卫\u001b[39m",
      " ❯ apps/api/test/snapshot-version.test.ts:135:67",
    ].join("\n");
    expect(parseFailingTestFiles(output)).toEqual([
      "apps/api/test/snapshot-version.test.ts",
      "apps/web/test/copilot-stream-guard.test.ts",
    ]);
  });

  it("没有 FAIL 行就返回空——调用方必须据此判红，不许当成「全部可降级」", () => {
    expect(parseFailingTestFiles("Unhandled error: worker crashed")).toEqual([]);
  });
});

describe("worktreeDirtyPaths", () => {
  it("只认工作区侧（Y 位）与未跟踪；只动索引的不算脏", () => {
    const { files, dirs } = worktreeDirtyPaths([
      " M apps/api/src/routes/copilot.ts",
      "M  apps/api/src/seed.ts",
      "MM apps/api/src/llm-quota.ts",
      " D apps/api/src/gone.ts",
      "A  apps/api/src/added.ts",
      "R  old/name.ts -> new/name.ts",
      "?? apps/api/test/snapshot-version.test.ts",
      "?? new-package/",
    ]);
    expect([...files].sort()).toEqual([
      "apps/api/src/gone.ts",
      "apps/api/src/llm-quota.ts",
      "apps/api/src/routes/copilot.ts",
      "apps/api/test/snapshot-version.test.ts",
    ]);
    expect(dirs).toEqual(["new-package/"]);
    expect(files.has("apps/api/src/seed.ts")).toBe(false);
    expect(files.has("apps/api/src/added.ts")).toBe(false);
    expect(files.has("new/name.ts")).toBe(false);
  });
});

describe("依赖闭包", () => {
  const reverse = new Map([
    ["a.ts", new Set(["b.ts"])],
    ["b.ts", new Set(["c.ts"])],
  ]);

  it("reverse 边表折成正向后，闭包从测试走到最底层依赖", () => {
    const forward = forwardAdjacency(reverse);
    expect([...dependencyClosure(forward, "c.ts")].sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("闭包含起点自身（测试文件自己脏也要认出来）", () => {
    const forward = forwardAdjacency(reverse);
    expect(dependencyClosure(forward, "a.ts").has("a.ts")).toBe(true);
  });

  it("未跟踪折叠目录按前缀命中", () => {
    const hit = firstWorktreeHit(new Set(["new-package/src/x.ts"]), {
      files: new Set(),
      dirs: ["new-package/"],
    });
    expect(hit).toBe("new-package/");
  });
});

describe("attributeFailures", () => {
  const worktree = {
    files: new Set(["apps/api/src/routes/copilot.ts"]),
    dirs: [],
  };
  const forward = new Map([
    ["apps/web/test/copilot-stream-guard.test.ts", new Set(["apps/api/src/routes/copilot.ts"])],
    ["apps/api/test/clean.test.ts", new Set(["apps/api/src/seed.ts"])],
    ["apps/api/test/snapshot-version.test.ts", new Set(["apps/api/src/db.ts"])],
  ]);

  it("失败文件依赖未提交改动 → 降级并点名那个文件", () => {
    const { blocked, downgraded } = attributeFailures(
      ["apps/web/test/copilot-stream-guard.test.ts"],
      { inIndex: new Set(["apps/web/test/copilot-stream-guard.test.ts"]), worktree, forward },
    );
    expect(blocked).toEqual([]);
    expect(downgraded).toEqual([
      {
        file: "apps/web/test/copilot-stream-guard.test.ts",
        reason: "依赖未提交改动 apps/api/src/routes/copilot.ts",
      },
    ]);
  });

  it("失败文件不在本次提交里（未入库未暂存）→ 降级", () => {
    const { blocked, downgraded } = attributeFailures(
      ["apps/api/test/snapshot-version.test.ts"],
      { inIndex: new Set(["apps/api/test/clean.test.ts"]), worktree, forward },
    );
    expect(blocked).toEqual([]);
    expect(downgraded[0].reason).toContain("不在本次提交");
  });

  it("闭包干净 → 照样拦（这条是收紧方向，去掉它门禁就退化成只报不拦）", () => {
    const { blocked, downgraded } = attributeFailures(
      ["apps/api/test/clean.test.ts"],
      { inIndex: new Set(["apps/api/test/clean.test.ts"]), worktree, forward },
    );
    expect(downgraded).toEqual([]);
    expect(blocked.map((b) => b.file)).toEqual(["apps/api/test/clean.test.ts"]);
  });

  it("同一个提交里的失败各算各的：一个降级、一个照拦", () => {
    const { blocked, downgraded } = attributeFailures(
      ["apps/web/test/copilot-stream-guard.test.ts", "apps/api/test/clean.test.ts"],
      {
        inIndex: new Set([
          "apps/web/test/copilot-stream-guard.test.ts",
          "apps/api/test/clean.test.ts",
        ]),
        worktree,
        forward,
      },
    );
    expect(downgraded.map((d) => d.file)).toEqual(["apps/web/test/copilot-stream-guard.test.ts"]);
    expect(blocked.map((b) => b.file)).toEqual(["apps/api/test/clean.test.ts"]);
  });
});
