/**
 * 失败归因的判据自检（见 failure-scope.mjs 文件头 2026-10-31 的真实事故）。
 *
 * 这条判据决定「测试红了还让不让提交」，两个方向都要钉：
 *   - 放宽方向：依赖未提交改动的失败必须降级（否则种子提交被同事的在途重构挡死）；
 *   - 收紧方向：闭包与消息都干净的失败必须拦（否则门禁退化成只报不拦的摆设）。
 *
 * 夹具路径一律用不存在的 `__fixtures__/` 命名空间：写真实路径会被「提交原子性」
 * 当成依赖边（路径字面量）——测试根本没读过那些文件，却会把别人未提交的改动
 * 算到自己头上（2026-10-31 实测被拦 5 条）。
 */
import { describe, expect, it } from "vitest";
import {
  attributeFailures,
  dependencyClosure,
  firstWorktreeHit,
  forwardAdjacency,
  namedWorktreeHits,
  parseFailBlocks,
  parseFailingTestFiles,
  worktreeDirtyPaths,
} from "./failure-scope.mjs";

describe("parseFailingTestFiles", () => {
  it("从 vitest 的 FAIL 行取文件，去重、去 ANSI", () => {
    const output = [
      "⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯",
      "",
      " FAIL  __fixtures__/api/test/snapshot-version.test.ts > 快照版本号缓存 > 第一次读建缓存",
      "AssertionError: ...",
      " FAIL  __fixtures__/api/test/snapshot-version.test.ts > 快照版本号缓存 > 第二次读",
      "\u001b[31m FAIL  __fixtures__\\web\\test\\copilot-stream-guard.test.ts > 守卫\u001b[39m",
      " ❯ __fixtures__/api/test/snapshot-version.test.ts:135:67",
    ].join("\n");
    expect(parseFailingTestFiles(output)).toEqual([
      "__fixtures__/api/test/snapshot-version.test.ts",
      "__fixtures__/web/test/copilot-stream-guard.test.ts",
    ]);
  });

  it("没有 FAIL 行就返回空——调用方必须据此判红，不许当成「全部可降级」", () => {
    expect(parseFailingTestFiles("Unhandled error: worker crashed")).toEqual([]);
  });
});

describe("worktreeDirtyPaths", () => {
  it("只认工作区侧（Y 位）与未跟踪；只动索引的不算脏", () => {
    const { files, dirs } = worktreeDirtyPaths([
      " M __fixtures__/api/src/routes/copilot.ts",
      "M  __fixtures__/api/src/seed.ts",
      "MM __fixtures__/api/src/llm-quota.ts",
      " D __fixtures__/api/src/gone.ts",
      "A  __fixtures__/api/src/added.ts",
      "R  __fixtures__/old/name.ts -> __fixtures__/new/name.ts",
      "?? __fixtures__/api/test/snapshot-version.test.ts",
      "?? __fixtures__/new-package/",
    ]);
    expect([...files].sort()).toEqual([
      "__fixtures__/api/src/gone.ts",
      "__fixtures__/api/src/llm-quota.ts",
      "__fixtures__/api/src/routes/copilot.ts",
      "__fixtures__/api/test/snapshot-version.test.ts",
    ]);
    expect(dirs).toEqual(["__fixtures__/new-package/"]);
    expect(files.has("__fixtures__/api/src/seed.ts")).toBe(false);
    expect(files.has("__fixtures__/api/src/added.ts")).toBe(false);
    expect(files.has("__fixtures__/new/name.ts")).toBe(false);
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

describe("parseFailBlocks", () => {
  const fieldNames = "__fixtures__/web/test/field-names.test.ts";
  const keyboard = "__fixtures__/web/test/keyboard-activation.test.ts";
  const output = [
    " FAIL  " + fieldNames + " > 表单 > 0 处没有可访问名的控件",
    "AssertionError: 这些控件没有可访问名：",
    "src/fixture-scanner/favorites/page.tsx:1254  <select>",
    ": expected [ …(1) ] to have a length of +0 but got 1",
    " ❯ " + fieldNames + ":250:7",
    " FAIL  " + keyboard + " > 扫描 > 白名单",
    "src/fixture-scanner/bookmark-modal.tsx:178 <div>",
    "⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯",
    " FAIL  " + fieldNames + " > 表单 > 第二例",
    "src/fixture-scanner/hot-view.tsx:326  <input>",
  ].join("\n");

  it("按 FAIL 行切块：别的失败块点名的路径不许串到本文件", () => {
    const blocks = parseFailBlocks(output);
    const fieldLines = (blocks.get(fieldNames) ?? []).join("\n");
    const keyboardLines = (blocks.get(keyboard) ?? []).join("\n");
    expect(fieldLines).toContain("favorites/page.tsx:1254");
    expect(fieldLines).toContain("hot-view.tsx:326");
    expect(fieldLines).not.toContain("bookmark-modal");
    expect(keyboardLines).toContain("bookmark-modal.tsx:178");
    expect(keyboardLines).not.toContain("favorites/page.tsx:1254");
  });

  it("同文件的多个失败块合并", () => {
    const blocks = parseFailBlocks(output);
    expect(blocks.get(fieldNames)?.length).toBeGreaterThan(1);
  });

  it("没有 FAIL 行就是空表", () => {
    expect(parseFailBlocks("Unhandled error: worker crashed").size).toBe(0);
  });
});

describe("namedWorktreeHits", () => {
  it("src/ 相对路径映射到 overlay 源码根；带行号才算「此处违规」", () => {
    const hits = namedWorktreeHits(
      [
        "src/fixture-scanner/favorites/page.tsx:1254  <select>",
        "说明里提到 src/fixture-scanner/clean.ts:1 但这处是干净的",
        "只写路径不带行号 src/fixture-scanner/favorites/page.tsx 不算申报",
      ],
      {
        files: new Set(["apps/web-overlay/src/fixture-scanner/favorites/page.tsx"]),
        dirs: [],
      },
    );
    expect(hits).toEqual(["apps/web-overlay/src/fixture-scanner/favorites/page.tsx"]);
  });

  it("apps/web 生成镜像与 overlay 互为候选", () => {
    const hits = namedWorktreeHits(
      ["apps/web/src/components/fixture-widget.tsx:550 <input>"],
      {
        files: new Set(["apps/web-overlay/src/components/fixture-widget.tsx"]),
        dirs: [],
      },
    );
    expect(hits).toEqual(["apps/web-overlay/src/components/fixture-widget.tsx"]);
  });

  it("未跟踪折叠目录按前缀命中", () => {
    const hits = namedWorktreeHits(["src/fixture-widgets/new/thing.tsx:3"], {
      files: new Set(),
      dirs: ["apps/web-overlay/src/fixture-widgets/new/"],
    });
    expect(hits).toEqual(["apps/web-overlay/src/fixture-widgets/new/"]);
  });
});

describe("attributeFailures", () => {
  const worktree = {
    files: new Set(["__fixtures__/api/src/routes/copilot.ts"]),
    dirs: [],
  };
  const forward = new Map([
    [
      "__fixtures__/web/test/copilot-stream-guard.test.ts",
      new Set(["__fixtures__/api/src/routes/copilot.ts"]),
    ],
    ["__fixtures__/api/test/clean.test.ts", new Set(["__fixtures__/api/src/seed.ts"])],
    [
      "__fixtures__/api/test/snapshot-version.test.ts",
      new Set(["__fixtures__/api/src/db.ts"]),
    ],
  ]);

  it("失败文件依赖未提交改动 → 降级并点名那个文件", () => {
    const { blocked, downgraded } = attributeFailures(
      ["__fixtures__/web/test/copilot-stream-guard.test.ts"],
      {
        inIndex: new Set(["__fixtures__/web/test/copilot-stream-guard.test.ts"]),
        worktree,
        forward,
      },
    );
    expect(blocked).toEqual([]);
    expect(downgraded).toEqual([
      {
        file: "__fixtures__/web/test/copilot-stream-guard.test.ts",
        reason: "依赖未提交改动 __fixtures__/api/src/routes/copilot.ts",
      },
    ]);
  });

  it("失败文件不在本次提交里（未入库未暂存）→ 降级", () => {
    const { blocked, downgraded } = attributeFailures(
      ["__fixtures__/api/test/snapshot-version.test.ts"],
      { inIndex: new Set(["__fixtures__/api/test/clean.test.ts"]), worktree, forward },
    );
    expect(blocked).toEqual([]);
    expect(downgraded[0].reason).toContain("不在本次提交");
  });

  it("闭包干净、消息也没点名脏路径 → 照样拦（这条是收紧方向，去掉它门禁就退化成只报不拦）", () => {
    const { blocked, downgraded } = attributeFailures(
      ["__fixtures__/api/test/clean.test.ts"],
      { inIndex: new Set(["__fixtures__/api/test/clean.test.ts"]), worktree, forward },
    );
    expect(downgraded).toEqual([]);
    expect(blocked.map((b) => b.file)).toEqual(["__fixtures__/api/test/clean.test.ts"]);
  });

  it("同一提交里的失败各算各的：一个降级、一个照拦", () => {
    const { blocked, downgraded } = attributeFailures(
      [
        "__fixtures__/web/test/copilot-stream-guard.test.ts",
        "__fixtures__/api/test/clean.test.ts",
      ],
      {
        inIndex: new Set([
          "__fixtures__/web/test/copilot-stream-guard.test.ts",
          "__fixtures__/api/test/clean.test.ts",
        ]),
        worktree,
        forward,
      },
    );
    expect(downgraded.map((d) => d.file)).toEqual([
      "__fixtures__/web/test/copilot-stream-guard.test.ts",
    ]);
    expect(blocked.map((b) => b.file)).toEqual(["__fixtures__/api/test/clean.test.ts"]);
  });

  it("目录扫描型失败：图里没有边，但消息点名的源码是未提交改动 → 降级", () => {
    const scanner = "__fixtures__/web/test/field-names.test.ts";
    const dirty = "apps/web-overlay/src/fixture-scanner/favorites/page.tsx";
    const { blocked, downgraded } = attributeFailures([scanner], {
      inIndex: new Set([scanner]),
      worktree: { files: new Set([dirty]), dirs: [] },
      forward: new Map(),
      named: new Map([
        [
          scanner,
          [
            "AssertionError: 这些控件没有可访问名：",
            "src/fixture-scanner/favorites/page.tsx:1254  <select>",
          ],
        ],
      ]),
    });
    expect(blocked).toEqual([]);
    expect(downgraded).toEqual([
      { file: scanner, reason: "失败消息点名了未提交改动 " + dirty },
    ]);
  });

  it("别的失败块点名的脏路径不许把本文件降级（块作用域是收紧方向）", () => {
    const target = "__fixtures__/api/test/clean.test.ts";
    const { blocked, downgraded } = attributeFailures([target], {
      inIndex: new Set([target]),
      worktree: {
        files: new Set(["apps/web-overlay/src/fixture-scanner/favorites/page.tsx"]),
        dirs: [],
      },
      forward: new Map(),
      named: new Map([[target, ["src/fixture-scanner/seed.ts:1 干净"]]]),
    });
    expect(downgraded).toEqual([]);
    expect(blocked.map((b) => b.file)).toEqual([target]);
  });

  it("消息点名的路径都干净 → 照样拦（旁证只认未提交改动，不认「扫了源码」本身）", () => {
    const scanner = "__fixtures__/web/test/field-names.test.ts";
    const { blocked, downgraded } = attributeFailures([scanner], {
      inIndex: new Set([scanner]),
      worktree: { files: new Set(), dirs: [] },
      forward: new Map(),
      named: new Map([[scanner, ["src/fixture-scanner/favorites/page.tsx:1254  <select>"]]]),
    });
    expect(downgraded).toEqual([]);
    expect(blocked.map((b) => b.file)).toEqual([scanner]);
  });
});
