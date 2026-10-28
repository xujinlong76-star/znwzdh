/**
 * core 镜像闸门（读 HEAD）的单测。
 *
 * 这枚闸门存在的理由就是「工作区绿、提交红」，所以夹具一律喂内存 Map：
 * 判定只能由**传进去的内容**决定，不能取决于本机工作区脏不脏。
 * 唯一的真实 git 用例放在最后，用来钉住 plumbing（读不到 blob / ref 无效时不许装成通过）。
 */
import { describe, expect, it } from "vitest";
import { assess, run, runWorkingTree, trackedPathsOf } from "./check-core-mirrors.mjs";
import { composeMirror } from "./lib/core-mirror.mjs";

const ENTRIES = [
  { name: "demo", why: "x" },
  { name: "other", source: "packages/core/src/nested/thing.ts", target: "apps/web-overlay/src/lib/thing.ts", why: "y" },
];

const SOURCE = "export const v = 1\n";

function mirrorOf(rel: string, text: string = SOURCE) {
  return composeMirror(text, rel);
}

/** 三份都写全（含 apps/web 这条腿）——HEAD 模式必须看不见它 */
function completeFiles(): Record<string, string> {
  return {
    "packages/core/src/demo.ts": SOURCE,
    "apps/web-overlay/src/lib/demo.ts": mirrorOf("packages/core/src/demo.ts"),
    "apps/web/src/lib/demo.ts": mirrorOf("packages/core/src/demo.ts"),
    "packages/core/src/nested/thing.ts": SOURCE,
    "apps/web-overlay/src/lib/thing.ts": mirrorOf("packages/core/src/nested/thing.ts"),
    "apps/web/src/lib/thing.ts": mirrorOf("packages/core/src/nested/thing.ts"),
  };
}

function asMap(files: Record<string, string>) {
  return new Map(Object.entries(files));
}

describe("trackedPathsOf：只登记已入库的两条腿", () => {
  it("每条 verbatim 给出事实源 + overlay，且不包含 apps/web", () => {
    expect(trackedPathsOf(ENTRIES)).toEqual([
      "packages/core/src/demo.ts",
      "apps/web-overlay/src/lib/demo.ts",
      "packages/core/src/nested/thing.ts",
      "apps/web-overlay/src/lib/thing.ts",
    ]);
  });

  it("重复路径只保留一次（同一条腿被多个条目引用时不重复读）", () => {
    const dup = [{ name: "demo" }, { name: "demo2", target: "apps/web-overlay/src/lib/demo.ts" }];
    const paths = trackedPathsOf(dup);
    expect(paths.filter((p: string) => p === "apps/web-overlay/src/lib/demo.ts")).toHaveLength(1);
  });
});

describe("assess：判定只看传进去的内容", () => {
  it("core 与 overlay 逐字节一致时通过", () => {
    const res = assess(ENTRIES, asMap(completeFiles()));
    expect(res.ok).toBe(true);
    expect(res.failures).toHaveLength(0);
  });

  it("overlay 被手改 -> 报出具体条目和文件（不能只说「有问题」）", () => {
    const files = completeFiles();
    files["apps/web-overlay/src/lib/demo.ts"] = "export const v = 2 // 手改\n";
    const res = assess(ENTRIES, asMap(files));
    expect(res.ok).toBe(false);
    expect(res.failures.map((p: { name: string }) => p.name)).toEqual(["demo"]);
    expect(res.failures[0].reasons.join(" ")).toContain("apps/web-overlay/src/lib/demo.ts");
  });

  it("只改 core 不重生成 overlay -> 红（这正是 CI 那条红的形态）", () => {
    const files = completeFiles();
    files["packages/core/src/demo.ts"] = "export const v = 9\n";
    const res = assess(ENTRIES, asMap(files));
    expect(res.failures.map((p: { name: string }) => p.name)).toEqual(["demo"]);
  });

  it("overlay 在提交里不存在 -> 判缺失，不得静默算通过", () => {
    const files = completeFiles();
    delete files["apps/web-overlay/src/lib/demo.ts"];
    const res = assess(ENTRIES, asMap(files));
    expect(res.ok).toBe(false);
    expect(res.failures[0].reasons.join(" ")).toContain("overlay 缺失");
  });

  it("事实源在提交里不存在 -> missing-source（清单过期也是问题）", () => {
    const files = completeFiles();
    delete files["packages/core/src/demo.ts"];
    const res = assess(ENTRIES, asMap(files));
    expect(res.failures[0].status).toBe("missing-source");
  });

  it("CRLF 与 LF 不算漂移（提交里是 LF，检出可能是 CRLF）", () => {
    const files = completeFiles();
    files["apps/web-overlay/src/lib/demo.ts"] = mirrorOf("packages/core/src/demo.ts").replace(/\n/g, "\r\n");
    expect(assess(ENTRIES, asMap(files)).ok).toBe(true);
  });

  it("缺横幅但正文相同 -> 仍算一致（和同步器同口径，闸门不许比修复工具更严）", () => {
    const files = completeFiles();
    files["apps/web-overlay/src/lib/demo.ts"] = SOURCE;
    expect(assess(ENTRIES, asMap(files)).ok).toBe(true);
  });

  it("apps/web 这条腿整个缺席也不报——提交里本来就没有它（.gitignore:45）", () => {
    const files = completeFiles();
    for (const p of Object.keys(files)) if (p.startsWith("apps/web/")) delete files[p];
    expect(assess(ENTRIES, asMap(files)).ok).toBe(true);
  });

  it("空文件按异常上报，不当成「一致地都是空」", () => {
    const files = completeFiles();
    files["packages/core/src/demo.ts"] = "  \n";
    const res = assess(ENTRIES, asMap(files));
    expect(res.failures[0].status).toBe("empty-source");
  });
});

describe("真实仓库 plumbing", () => {
  it("HEAD 模式把 13 条腿的 blob 全读到，且一条「web 缺失」都不许有", () => {
    const { contents, result } = run();
    expect(contents.size).toBe(26);
    expect(result.plans).toHaveLength(13);
    const text = JSON.stringify(result.plans.map((p: { reasons: string[] }) => p.reasons));
    expect(text).not.toContain("web 缺失");
  });

  it("判定确实来自读到的内容：改掉一条 blob 立刻变红", () => {
    const head = run();
    const tree = runWorkingTree();
    expect(head.result.plans).toHaveLength(tree.result.plans.length);
    // 自证：把 HEAD 的某个 overlay blob 换成别的，判定立刻变红——说明判定真的来自读到的内容
    const first = [...head.contents.keys()].find((p: string) => p.startsWith("apps/web-overlay/"))!;
    const mutated = new Map(head.contents);
    mutated.set(first, "// 不是镜像\n");
    expect(assess(head.entries, mutated).ok).toBe(false);
    expect(tree.contents.size).toBe(26);
  });

  it("ref 不存在时拒绝给结论（不把「读不到」说成「有漂移」，也不说成「通过」）", () => {
    expect(() => run({ ref: "no-such-ref-abc123" })).toThrow(/不存在/);
  });
});
