/**
 * 模块图影响面：选测的「谁引用了它」这一层。
 *
 * 为什么需要单独的测试：选测收窄是「少跑」的策略，**漏选不会报错**——它只会安静地
 * 少跑几条。precommit-select.test.ts 从生成物的 dry-run 观察结果，能证明「选中了什么」，
 * 但证明不了「为什么选中」与三类边的边界（尤其目录依赖只对起点生效、注释里的路径不算）。
 * 这里把图的语义逐条钉住：import 边、测试里的路径字面量（含 `.github/workflows/ci.yml`
 * 这类**非代码文件**，以及 resolve(ROOT, "scripts", "x.mjs") 这种分段拼接）、
 * core↔overlay 镜像边，以及真实仓库的验收口径。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildGraph, canonicalPath, graphFor, impactedTests, impactedWithPaths, pathLiteralDeps } from "./lib/test-impact.mjs";

const ROOT = process.cwd();
const tempRoots: string[] = [];

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "navhub-impact-"));
  tempRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return root;
}

afterAll(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

describe("canonicalPath", () => {
  it("apps/web/src 与 overlay 是同一节点（vendored 镜像，本地有没有 vendor 不改变选测）", () => {
    expect(canonicalPath("apps/web/src/lib/a.ts")).toBe("apps/web-overlay/src/lib/a.ts");
    expect(canonicalPath("apps/web-overlay/src/lib/a.ts")).toBe("apps/web-overlay/src/lib/a.ts");
    expect(canonicalPath("apps/api/src/a.ts")).toBe("apps/api/src/a.ts");
  });
});

describe("图的三类边", () => {
  it("import 边是传递的：改 core 模块，经入口再导出的测试也要收到", () => {
    const root = makeRepo({
      "packages/core/src/a.ts": "export const a = 1;\n",
      "packages/core/src/index.ts": 'export * from "./a.ts";\n',
      "apps/api/test/a.test.ts": 'import { a } from "@navhub/core";\n',
      "apps/api/test/unrelated.test.ts": "export const x = 1;\n",
    });
    const hit = impactedTests(buildGraph({ root }), ["packages/core/src/a.ts"]);
    expect(hit).toEqual(["apps/api/test/a.test.ts"]);
  });

  it("@/ 别名：overlay 源码的消费者", () => {
    const root = makeRepo({
      "apps/web-overlay/src/lib/b.ts": "export const b = 2;\n",
      "apps/web/test/b.test.ts": 'import { b } from "@/lib/b";\n',
    });
    const graph = buildGraph({ root });
    expect(impactedTests(graph, ["apps/web-overlay/src/lib/b.ts"])).toEqual(["apps/web/test/b.test.ts"]);
    // 镜像路径写法的答案必须一样
    expect(impactedTests(graph, ["apps/web/src/lib/b.ts"])).toEqual(["apps/web/test/b.test.ts"]);
  });

  it("路径字面量：守卫型测试不 import，而是 readFileSync / spawn 源码", () => {
    const root = makeRepo({
      "apps/web-overlay/src/app/guard/page.tsx": "export default 1;\n",
      "apps/web/test/guard.test.ts": 'const p = "src/app/guard/page.tsx";\n',
    });
    const hit = impactedTests(buildGraph({ root }), ["apps/web-overlay/src/app/guard/page.tsx"]);
    expect(hit).toEqual(["apps/web/test/guard.test.ts"]);
  });

  it("分段拼接的路径（resolve(ROOT, \"scripts\", \"x.mjs\")）也要认", () => {
    // 真实盲区：scripts/check-large-files.test.ts 就是这么写的。单看每个字符串都不带 /，
    // 只按「整段路径字面量」抽，改脚本时图命中 0 —— 只能靠词根回退兜，回退不报错，
    // 但也不保证覆盖到别的东西。
    expect(pathLiteralDeps('const p = resolve(ROOT, "scripts", "tool.mjs");').has("scripts/tool.mjs")).toBe(true);
    expect(pathLiteralDeps('const p = join(root, "apps", "api", "src", "a.ts");').has("apps/api/src/a.ts")).toBe(true);
    // 绝对路径 / .. 会让「拼起来是哪」依赖运行时，宁可不猜
    expect([...pathLiteralDeps('join("/abs", "scripts", "x.mjs")')]).toEqual([]);
    expect([...pathLiteralDeps('join("..", "scripts", "x.mjs")')]).toEqual([]);

    const root = makeRepo({
      "scripts/tool.mjs": "export const t = 1;\n",
      "scripts/tool.test.ts": 'const p = resolve(ROOT, "scripts", "tool.mjs");\n',
    });
    expect(impactedTests(buildGraph({ root }), ["scripts/tool.mjs"])).toEqual(["scripts/tool.test.ts"]);
  });

  it("注释里提到的路径不算依赖（弱证据会把无关文件拖进来）", () => {
    const root = makeRepo({
      "scripts/ghost.mjs": "export const g = 1;\n",
      "scripts/ghost.test.ts": '// 与 resolve(ROOT, "scripts", "ghost.mjs") 同一套环境变量\nimport fs from "node:fs";\n',
    });
    expect(impactedTests(buildGraph({ root }), ["scripts/ghost.mjs"])).toEqual([]);
  });

  it("镜像边：core 与 overlay 两侧互为依赖", () => {
    const root = makeRepo({
      "packages/core/src/rank.ts": "export const rank = 1;\n",
      "apps/web-overlay/src/lib/rank.ts": "export const rank = 1;\n",
      "apps/web/test/rank.test.ts": 'import { rank } from "@/lib/rank";\n',
      "scripts/core-mirrors.json": JSON.stringify({ verbatim: [{ name: "rank" }] }),
    });
    const graph = buildGraph({ root });
    // 改 core 侧：overlay 的消费者同样受影响（两侧是同一份实现的两个落点）
    expect(impactedTests(graph, ["packages/core/src/rank.ts"])).toEqual(["apps/web/test/rank.test.ts"]);
    expect(impactedTests(graph, ["apps/web-overlay/src/lib/rank.ts"])).toEqual(["apps/web/test/rank.test.ts"]);
  });

  /**
   * 盲区（2026-10-29）：测试**读的非代码文件**不在图里。
   * `.github/workflows/ci.yml`、`docker/Dockerfile.api` 既不在 BASE_SCAN_DIRS、`Dockerfile.*`
   * 连后缀都没有 ⇒ 改 CI 接线时选测等于没改动，而读它们的正是门禁自己的测试。
   * 两条判据分开钉：带后缀的按文件；无后缀但**真实存在**的也按文件
   * （落到 `dir:` 分支的话，那条边永远匹配不上「改这个文件本身」）。
   */
  it("非代码文件也是节点：.github / docker 的字面量按仓库根记账", () => {
    const root = makeRepo({
      ".github/workflows/ci.yml": "jobs:\n  test:\n",
      "docker/Dockerfile.api": "FROM node\n",
      "scripts/check-ci-gate.test.ts": 'const a = ".github/workflows/ci.yml";\n',
      "scripts/check-hooks-fresh.test.ts": 'const b = "docker/Dockerfile.api";\n',
    });
    const graph = buildGraph({ root });
    expect(impactedTests(graph, [".github/workflows/ci.yml"])).toEqual(["scripts/check-ci-gate.test.ts"]);
    expect(impactedTests(graph, ["docker/Dockerfile.api"])).toEqual(["scripts/check-hooks-fresh.test.ts"]);
    // 仓库根前缀不许被当成 overlay 相对写法（加了 apps/web-overlay/ 前缀就是死边）
    expect(pathLiteralDeps('const p = ".github/workflows/ci.yml";').has(".github/workflows/ci.yml")).toBe(true);
    expect(pathLiteralDeps('const p = "docker/Dockerfile.api";').has("apps/web-overlay/docker/Dockerfile.api")).toBe(false);
  });

  it("带斜杠的目录字面量仍按目录记账（改目录下任何文件都命中）", () => {
    const root = makeRepo({
      ".github/workflows/ci.yml": "jobs:\n",
      ".github/workflows/release.yml": "jobs:\n",
      "scripts/wf-scan.test.ts": 'const dir = ".github/workflows/";\n',
    });
    expect(impactedTests(buildGraph({ root }), [".github/workflows/release.yml"])).toEqual([
      "scripts/wf-scan.test.ts",
    ]);
  });
});

describe("依赖链（--why 的数据来源）", () => {
  it("链从改动文件起、到测试止，每一跳都是真实的反向边", () => {
    const root = makeRepo({
      "apps/api/src/a.ts": "export const a = 1;\n",
      "apps/api/src/b.ts": 'import { a } from "./a.ts";\n',
      "apps/api/test/b.test.ts": 'import { b } from "../src/b.ts";\n',
      "apps/api/test/unrelated.test.ts": "export const x = 1;\n",
    });
    const graph = buildGraph({ root });
    const { tests, paths } = impactedWithPaths(graph, ["apps/api/src/a.ts"]);
    expect(tests).toEqual(["apps/api/test/b.test.ts"]);
    const chain = paths.get("apps/api/test/b.test.ts");
    expect(chain).toEqual(["apps/api/src/a.ts", "apps/api/src/b.ts", "apps/api/test/b.test.ts"]);
    for (let i = 0; i + 1 < chain.length; i += 1) {
      expect(graph.reverse.get(chain[i])?.has(chain[i + 1]), `${chain[i]} → ${chain[i + 1]} 不是图里的边`).toBe(true);
    }
  });

  it("目录依赖的链首是真实改动文件，不是 dir: 合成节点", () => {
    const root = makeRepo({
      "apps/api/test/a.test.ts": "export const a = 1;\n",
      "apps/api/test/sweeper.test.ts": 'const dir = "apps/api/test";\n',
    });
    const graph = buildGraph({ root });
    const chain = impactedWithPaths(graph, ["apps/api/test/a.test.ts"]).paths.get("apps/api/test/sweeper.test.ts");
    expect(chain).toEqual(["apps/api/test/a.test.ts", "apps/api/test/sweeper.test.ts"]);
    expect(chain.some((n) => n.startsWith("dir:"))).toBe(false);
  });

  it("真实仓库：backup.ts 到 plugins-api.test.ts 的链可逐跳核对", () => {
    const graph = graphFor(ROOT);
    const changed = "apps/api/src/routes/backup.ts";
    const test = "apps/api/test/plugins-api.test.ts";
    const chain = impactedWithPaths(graph, [changed]).paths.get(test);
    expect(chain, "链不存在").toBeTruthy();
    expect(chain[0]).toBe(changed);
    expect(chain[chain.length - 1]).toBe(test);
    for (let i = 0; i + 1 < chain.length; i += 1) {
      expect(graph.reverse.get(chain[i])?.has(chain[i + 1]), `断链：${chain[i]} → ${chain[i + 1]}`).toBe(true);
    }
  });
});

describe("packages/*/test 也是图里的测试根", () => {
  it("改 core 源码：core 自己的测试也在影响面里（CI 会跑它们）", () => {
    const root = makeRepo({
      "packages/core/src/a.ts": "export const a = 1;\n",
      "packages/core/src/index.ts": 'export * from "./a.ts";\n',
      "packages/core/test/a.test.ts": 'import { a } from "../src/a.ts";\n',
      "apps/web/test/a.test.ts": 'import { a } from "@navhub/core";\n',
    });
    const hit = impactedTests(buildGraph({ root }), ["packages/core/src/a.ts"]);
    expect(hit).toEqual(["apps/web/test/a.test.ts", "packages/core/test/a.test.ts"]);
  });

  it("真实仓库的图里确实包含 packages 测试", () => {
    const tests = [...graphFor(ROOT).testFiles];
    expect(tests.some((t) => t.startsWith("packages/core/test/"))).toBe(true);
  });
});

describe("目录依赖只对起点生效", () => {
  const files = {
    "apps/api/src/a.ts": "export const a = 1;\n",
    "apps/api/test/route.test.ts": 'import { a } from "../src/a.ts";\n',
    "apps/api/test/sweeper.test.ts": 'const dir = "apps/api/test";\n',
  };

  it("改源码不会把「扫描测试目录」的测试拖进来（否则 web/scripts 都会被串味）", () => {
    const hit = impactedTests(buildGraph({ root: makeRepo(files) }), ["apps/api/src/a.ts"]);
    expect(hit).toContain("apps/api/test/route.test.ts");
    expect(hit).not.toContain("apps/api/test/sweeper.test.ts");
  });

  it("直接改测试目录里的文件时，扫描该目录的测试要收到", () => {
    const hit = impactedTests(buildGraph({ root: makeRepo(files) }), ["apps/api/test/route.test.ts"]);
    expect(hit).toContain("apps/api/test/sweeper.test.ts");
  });
});

describe("真实仓库的验收口径", () => {
  // 整棵建一次图（约 3 秒），所有用例共用 graphFor 的进程内缓存
  const graph = graphFor(ROOT);

  it("改 packages/core 的模块：依赖它的测试全在，而不是名字里带它的", () => {
    const hit = impactedTests(graph, ["packages/core/src/job-payloads.ts"]);
    // 这个名字里没有 job-payloads 的测试经 `@navhub/core` 入口依赖它
    expect(hit).toContain("apps/api/test/job-payload-schema.test.ts");
    expect(hit.length).toBeGreaterThan(20);
  });

  it("改 scripts/check-*.mjs：选中自己的测试，不拖同前缀族", () => {
    const hit = impactedTests(graph, ["scripts/check-large-files.mjs"]);
    expect(hit).toContain("scripts/check-large-files.test.ts");
    expect(hit.some((f) => /typecheck|check-syntax|check-core-mirrors|check-committed-refs/.test(f))).toBe(false);
    expect(hit.length).toBeLessThanOrEqual(3);
  });

  it("改 overlay 页面：页面守卫在（全仓门禁由选测器的 uiTouched 规则补，不在图里）", () => {
    const page = "apps/web-overlay/src/app/admin/data/restore/page.tsx";
    const hit = impactedTests(graph, [page]);
    expect(hit).toContain("apps/web/test/restore-page-guard.test.ts");
    // field-names / keyboard-activation 是「任何 UI 改动都要跑」的全仓扫描门禁，
    // 由生成物里的 GLOBAL_GATE_TESTS 无条件补进来，不依赖图（见 precommit-select.test.ts）。
    // 写 apps/web/src/... 与写 overlay 路径必须是同一个答案
    expect(impactedTests(graph, ["apps/web/src/app/admin/data/restore/page.tsx"])).toEqual(hit);
  });

  it("图解释不了的改动：不抛错，也不按名字乱选", () => {
    const hit = impactedTests(graph, ["apps/api/src/definitely-not-a-real-file.ts"]);
    expect(Array.isArray(hit)).toBe(true);
    expect(hit).not.toContain("apps/api/test/backup-async-api.test.ts");
    expect(impactedTests(graph, [])).toEqual([]);
  });

  it("改 CI 接线 / Dockerfile：读它们的门禁测试必须被选中（2026-10-29 前恒为 0）", () => {
    const ci = impactedTests(graph, [".github/workflows/ci.yml"]);
    expect(ci).toContain("scripts/check-ci-gate.test.ts");
    expect(ci).toContain("scripts/check-gates-registry.test.ts");
    expect(ci.some((t) => t.startsWith("apps/web/test/"))).toBe(true);
    expect(impactedTests(graph, ["docker/Dockerfile.api"])).toContain("scripts/check-hooks-fresh.test.ts");
  });

  it("同根重复调用返回同一张图（选测器一次提交只建一次）", () => {
    expect(graphFor(ROOT)).toBe(graphFor(ROOT));
  });
});

describe("CLI：--why / --diff", () => {
  function cli(args: string[]): { status: number; out: string } {
    try {
      const out = execFileSync(process.execPath, ["scripts/test-impact.mjs", ...args], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, out };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { status: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  }

  it("--why：打印改动 → 测试的最短链（链上每一跳都能在图里核对）", () => {
    const res = cli(["--why", "apps/api/test/plugins-api.test.ts", "--changed", "apps/api/src/routes/backup.ts"]);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("apps/api/src/routes/backup.ts");
    expect(res.out).toContain("→ apps/api/src/server.ts");
    expect(res.out).toContain("→ apps/api/test/plugins-api.test.ts");
  });

  it("--why：不可达的测试 rc1，而不是静默给个空结果", () => {
    const res = cli(["--why", "apps/api/test/plugins-api.test.ts", "--changed", "scripts/check-large-files.mjs"]);
    expect(res.status, res.out).toBe(1);
    expect(res.out).toContain("不在影响面内");
  });

  it("--diff：回放 HEAD~1，rc0 且输出形态合法", () => {
    /**
     * 刻意**不钉「→ 图 」**：`--diff HEAD~1` 回放的是真实仓库的上一笔提交，
     * 而上一笔可能只改 ci.yml / 文档（没有源码改动）——2026-10-29 实测
     * 「只改 ci.yml 的提交」就把这条断言打红了。钉死历史内容的测试在多会话
     * 并行下必然反复假红。
     *
     * 契约本身是：rc 0 + 说清回放了什么（有源码改动就给图命中数，
     * 没有就明说「没有改源码的提交可回放」）。
     */
    const res = cli(["--diff", "HEAD~1", "--limit", "1", "--no-selector"]);
    expect(res.status, res.out).toBe(0);
    expect(res.out).toContain("回放");
    const wellFormed = res.out.includes("→ 图 ") || res.out.includes("没有改源码的提交可回放");
    expect(wellFormed, `输出既没有图命中数、也没有「无可回放」说明：\n${res.out}`).toBe(true);
  });
});
