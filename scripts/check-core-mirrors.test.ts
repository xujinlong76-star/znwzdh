/**
 * core 镜像闸门（读 HEAD）的单测。
 *
 * 这枚闸门存在的理由就是「工作区绿、提交红」，所以夹具一律喂内存 Map：
 * 判定只能由**传进去的内容**决定，不能取决于本机工作区脏不脏。
 * 唯一的真实 git 用例放在最后，用来钉住 plumbing（读不到 blob / ref 无效时不许装成通过）。
 * --baseline 那一组同样只用内存里的漂移记录：放行/拦下的决定必须由「基线上红的是什么」
 * 推出，不能取决于本机 main 此刻有没有别人的漂移。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  assess,
  explainFailure,
  renderExplain,
  run,
  runWorkingTree,
  splitDrift,
  trackedPathsOf,
  verdictWithBaseline,
} from "./check-core-mirrors.mjs";
import { composeMirror } from "./lib/core-mirror.mjs";

const SCRIPT = resolve("scripts/check-core-mirrors.mjs");

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

describe("splitDrift / verdictWithBaseline：只拦本次推送新引入的漂移", () => {
  const drift = (name: string, ...reasons: string[]) => ({
    name,
    reasons,
    source: `packages/core/src/${name}.ts`,
    overlay: `apps/web-overlay/src/lib/${name}.ts`,
  });

  it("基线上以同样根因红着 -> 放行并显式警告（rc 0，且不能悄悄藏起来）", () => {
    const now = [drift("webmcp-bridge", "overlay 与事实源不一致：apps/web-overlay/src/lib/webmcp-bridge.ts")];
    const base = [drift("webmcp-bridge", "overlay 与事实源不一致：apps/web-overlay/src/lib/webmcp-bridge.ts")];
    const v = verdictWithBaseline(now, base);
    expect(v.rc).toBe(0);
    expect(v.passWithWarning).toBe(true);
    expect(v.preexisting.map((f: { name: string }) => f.name)).toEqual(["webmcp-bridge"]);
    expect(v.introduced).toEqual([]);
  });

  it("基线全绿而当前红 = 本次新引入 -> 拦（rc 1）", () => {
    const v = verdictWithBaseline([drift("demo", "overlay 与事实源不一致：x")], []);
    expect(v.rc).toBe(1);
    expect(v.passWithWarning).toBe(false);
    expect(v.introduced.map((f: { name: string }) => f.name)).toEqual(["demo"]);
  });

  it("同名条目换了根因算新的破坏：不许因为「这条早就红过」就免检", () => {
    const v = verdictWithBaseline([drift("demo", "overlay 缺失")], [drift("demo", "overlay 与事实源不一致：x")]);
    expect(v.rc).toBe(1);
    expect(v.introduced.map((f: { name: string }) => f.name)).toEqual(["demo"]);
    // changed 是给打印用的第二层信息：它已经在 introduced 里了
    expect(v.changed.map((f: { name: string }) => f.name)).toEqual(["demo"]);
  });

  it("一部分早就红、一部分新引入 -> 仍然拦，但只有新引入的那部分该被点名", () => {
    const shared = drift("webmcp-bridge", "overlay 与事实源不一致：y");
    const v = verdictWithBaseline([shared, drift("cjk", "overlay 缺失")], [shared]);
    expect(v.rc).toBe(1);
    expect(v.preexisting.map((f: { name: string }) => f.name)).toEqual(["webmcp-bridge"]);
    expect(v.introduced.map((f: { name: string }) => f.name)).toEqual(["cjk"]);
  });

  it("当前不红时不报「早于基线」的假警（passWithWarning 前提是确有漂移）", () => {
    const v = verdictWithBaseline([], [drift("demo", "overlay 缺失")]);
    expect(v.rc).toBe(0);
    expect(v.passWithWarning).toBe(false);
  });

  it("根因顺序不影响身份：同一批原因换个排列仍算已存在", () => {
    const split = splitDrift([drift("demo", "r1", "r2")], [drift("demo", "r2", "r1")]);
    expect(split.preexisting).toHaveLength(1);
    expect(split.introduced).toEqual([]);
    expect(verdictWithBaseline([drift("demo", "r1", "r2")], [drift("demo", "r2", "r1")]).rc).toBe(0);
  });
});

describe("explainFailure：漂移归属与「修复是否已在暂存区」", () => {
  const FAILURE = {
    name: "demo",
    source: "packages/core/src/demo.ts",
    overlay: "apps/web-overlay/src/lib/demo.ts",
  };

  function ioOf({
    head = {},
    staged = {},
    commits = {},
  }: {
    head?: Record<string, string>;
    staged?: Record<string, string>;
    commits?: Record<string, { commit: string; author: string; date: string }>;
  }) {
    return {
      headFile: (p: string) => (p in head ? head[p] : null),
      stagedFile: (p: string) => (p in staged ? staged[p] : null),
      lastCommit: (p: string) => commits[p] ?? null,
    };
  }

  it("事实源已提交、镜像没重生成，但重生成的镜像躺在暂存区 → 「等提交」，不是「再去生成一遍」", () => {
    const v2 = "export const v = 2\n";
    const e = explainFailure(
      FAILURE,
      ioOf({
        head: {
          [FAILURE.source]: v2,
          [FAILURE.overlay]: mirrorOf(FAILURE.source, SOURCE),
        },
        staged: { [FAILURE.overlay]: mirrorOf(FAILURE.source, v2) },
      }),
    );
    expect(e.closedBy).toBe("mirror-regenerated");
    expect(e.hint).toContain("修复已在暂存区");
    expect(e.hint).toContain(FAILURE.overlay);
  });

  it("镜像先被更新（HEAD 镜像比事实源新），暂存的事实源与镜像正文一致 → 提交事实源即闭合", () => {
    const v2 = "export const v = 2\n";
    const e = explainFailure(
      FAILURE,
      ioOf({
        head: {
          [FAILURE.source]: SOURCE,
          [FAILURE.overlay]: mirrorOf(FAILURE.source, v2),
        },
        staged: { [FAILURE.source]: v2 },
      }),
    );
    expect(e.closedBy).toBe("source-synced");
    expect(e.hint).toContain(FAILURE.source);
  });

  it("暂存区里没有能闭合这次漂移的改动 → 明确说「需要真的重生成」", () => {
    const e = explainFailure(
      FAILURE,
      ioOf({
        head: {
          [FAILURE.source]: "export const v = 2\n",
          [FAILURE.overlay]: mirrorOf(FAILURE.source, SOURCE),
        },
        staged: {},
      }),
    );
    expect(e.closedBy).toBeNull();
    expect(e.hint).toContain("sync-core-mirrors.mjs");
  });

  it("CRLF 的暂存镜像与 LF 的 HEAD 事实源仍算闭合（换行不是漂移）", () => {
    const v2 = "export const v = 2\n";
    const e = explainFailure(
      FAILURE,
      ioOf({
        head: { [FAILURE.source]: v2, [FAILURE.overlay]: mirrorOf(FAILURE.source, SOURCE) },
        staged: { [FAILURE.overlay]: mirrorOf(FAILURE.source, v2).replace(/\n/g, "\r\n") },
      }),
    );
    expect(e.closedBy).toBe("mirror-regenerated");
  });

  it("overlay 在 HEAD 缺失时，只凭「暂存镜像 == HEAD 事实源」也能判定已在暂存区", () => {
    const e = explainFailure(
      FAILURE,
      ioOf({
        head: { [FAILURE.source]: SOURCE },
        staged: { [FAILURE.overlay]: mirrorOf(FAILURE.source, SOURCE) },
      }),
    );
    expect(e.closedBy).toBe("mirror-regenerated");
  });

  it("归属取两侧各自最后一次提交；渲染不出「undefined」", () => {
    const e = explainFailure(
      FAILURE,
      ioOf({
        head: { [FAILURE.source]: SOURCE, [FAILURE.overlay]: "// 手改\n" },
        commits: {
          [FAILURE.source]: { commit: "abc1234", author: "Alice", date: "2026-10-28" },
          [FAILURE.overlay]: { commit: "def5678", author: "Bob", date: "2026-10-27" },
        },
      }),
    );
    const lines = renderExplain(e).join("\n");
    expect(lines).toContain("abc1234 Alice 2026-10-28");
    expect(lines).toContain("def5678 Bob 2026-10-27");
    expect(lines).not.toContain("undefined");
    const noCommits = renderExplain(explainFailure(FAILURE, ioOf({ head: { [FAILURE.source]: SOURCE } }))).join("\n");
    expect(noCommits).toContain("（无提交记录）");
  });
});

describe("真实 CLI：--baseline 的失败关闭", () => {
  const cli = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

  it("给了 --baseline 却没值 -> rc 2，不退化成「按 HEAD 严格判」的静默放行", () => {
    const res = cli(["--baseline"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("需要一个 git ref 作值");
  });

  it("基线 ref 不存在 -> rc 2：拿不到比较对象时既不判绿也不放行", () => {
    const res = cli(["--baseline", "no-such-baseline-ref-9f3c21"]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("跑不起来");
  });

  it("--explain 只增字段不改判定：JSON 有 explain，退出码仍由 ok 决定", () => {
    const res = cli(["--explain", "--json"]);
    const body = JSON.parse(res.stdout);
    expect(body).toHaveProperty("explain");
    if (body.ok) expect(body.explain).toBeNull();
    else expect(Array.isArray(body.explain)).toBe(true);
    expect(res.status).toBe(body.ok ? 0 : 1);
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
