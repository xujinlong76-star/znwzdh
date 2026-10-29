/**
 * 本轮新增工具脚本的纯函数测试。
 *
 * 这些脚本都是「给人和 CI 看结论」的，一旦解析错了会给出**看似合理**的错误结论
 * （比如把 97 处误报当成真问题）。所以每个解析器都要有正例 + 反例。
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error 纯 JS 脚本，无类型声明
import { isHeadRace, shouldRetry } from "./commit-safe.mjs";
// @ts-expect-error 同上
import { parseBlame, parseTscOutput, resolveTrackedPath } from "./typecheck-attribution.mjs";
// @ts-expect-error 同上
import { extractFailureLines } from "./ci-status.mjs";
// @ts-expect-error 同上
import { applyMatrix, parseWorkflow } from "./repro-ci.mjs";
// @ts-expect-error 同上
import { parseJsxProps, parsePropsInterface, scanJsxAttributes } from "./check-component-contracts.mjs";

describe("commit-safe：HEAD 竞态判定", () => {
  it("识别 git 的锁冲突文案（多版本变体）", () => {
    expect(isHeadRace("fatal: cannot lock ref 'HEAD': is at abc but expected def")).toBe(true);
    expect(isHeadRace("error: cannot lock ref 'HEAD'")).toBe(true);
    expect(isHeadRace("fatal: Unable to create '/repo/.git/HEAD.lock': File exists.")).toBe(true);
  });

  it("钩子真失败不得被当成竞态（否则会 --no-verify 绕过）", () => {
    expect(shouldRetry("pre-commit tests failed: 3 failed")).toBe(false);
    expect(shouldRetry("error: pathspec 'x' did not match")).toBe(false);
    expect(shouldRetry("")).toBe(false);
    expect(shouldRetry(null)).toBe(false);
  });
});

describe("typecheck-attribution：tsc / blame 解析", () => {
  it("解析 tsc 错误行（含 Windows 路径）", () => {
    const out = [
      "src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "apps\\web\\src\\b.tsx(3,1): error TS2304: Cannot find name 'x'.",
      "some unrelated log line",
    ].join("\n");
    const errors = parseTscOutput(out);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ file: "src/a.ts", line: 12, code: "TS2322" });
    expect(errors[1].file).toBe("apps/web/src/b.tsx");
  });

  it("解析 blame porcelain：行号 → 提交/作者", () => {
    const blame = [
      "aaaa1111 1 1 1",
      "author Alice",
      "summary fix: something",
      "\tconst x = 1;",
      "bbbb2222 2 2 1",
      "author Bob",
      "summary feat: other",
      "\tconst y = 2;",
    ].join("\n");
    const map = parseBlame(blame);
    expect(map.get(1)).toMatchObject({ sha: "aaaa1111", author: "Alice" });
    expect(map.get(2)).toMatchObject({ sha: "bbbb2222", author: "Bob" });
  });

  it("路径映射优先 overlay（镜像目录的 blame 无意义）", () => {
    const exists = (p: string) => p === "apps/web-overlay/src/a.tsx";
    expect(resolveTrackedPath("src/a.tsx", exists)).toBe("apps/web-overlay/src/a.tsx");
    expect(resolveTrackedPath("docs/x.md", () => false)).toBe("docs/x.md");
  });
});

describe("ci-status：失败日志抽取", () => {
  it("只取失败行 ±2 行，并保留上下文", () => {
    const log = ["l1", "l2", "FAIL  a.test.ts > 用例", "l4", "l5", "l6", "l7"].join("\n");
    const picked = extractFailureLines(log, 1, 10);
    expect(picked).toEqual(["l2", "FAIL  a.test.ts > 用例", "l4"]);
  });

  it("匹配多种失败标记（✘ / error TS / AssertionError）", () => {
    const log = ["✘ 构建失败", "error TS2304: Cannot find name", "AssertionError: nope"].join("\n");
    const picked = extractFailureLines(log, 0, 10);
    expect(picked).toHaveLength(3);
  });

  it("没有失败行时返回空数组（而不是整段日志）", () => {
    expect(extractFailureLines("all good\nnothing here", 2, 10)).toEqual([]);
  });
});

describe("repro-ci：工作流解析", () => {
  const yml = [
    "jobs:",
    "  test-x:",
    "    name: 测试 X",
    "    strategy:",
    "      matrix:",
    "        shard: [1, 2, 3]",
    "    steps:",
    "      - run: pnpm install",
    "      - name: 跑测试",
    "        run: pnpm test -- --shard=${{ matrix.shard }}/3",
  ].join("\n");

  it("解析 job 名称、矩阵与 run 序列", () => {
    const jobs = parseWorkflow(yml);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("test-x");
    expect(jobs[0].name).toBe("测试 X");
    expect(jobs[0].matrix[0]).toEqual({ key: "shard", values: ["1", "2", "3"] });
    expect(jobs[0].runs).toEqual(["pnpm install", "pnpm test -- --shard=${{ matrix.shard }}/3"]);
  });

  it("矩阵占位符替换：未指定时取第一项", () => {
    const run = "pnpm test --shard=${{ matrix.shard }}/3";
    expect(applyMatrix(run, [{ key: "shard", values: ["1", "2"] }], null)).toBe("pnpm test --shard=1/3");
    expect(applyMatrix(run, [{ key: "shard", values: ["1", "2"] }], "2")).toBe("pnpm test --shard=2/3");
    expect(applyMatrix("pnpm build", [], null)).toBe("pnpm build");
  });
});

describe("组件契约：props 解析", () => {
  it("解析 interface：区分必填与可选", () => {
    const src = ["export interface FooProps {", "  a: string;", "  b?: number;", "  // 注释", "}"].join("\n");
    const props = parsePropsInterface(src, "Foo");
    expect(props?.get("a")).toBe(true);
    expect(props?.get("b")).toBe(false);
  });

  it("嵌套对象的字段不是顶层 props（2026-10-29 一次跑出 20 条误报的根因）", () => {
    const src = [
      "export interface FooProps {",
      "  statusCodes?: {",
      "    s2xx: number",
      "    s3xx: number",
      "  }",
      "  total?: number",
      "}",
    ].join("\n");
    const props = parsePropsInterface(src, "Foo");
    // s2xx / s3xx 是 statusCodes 的字段，调用方本来就不该传
    expect(props?.has("s2xx")).toBe(false);
    expect(props?.has("s3xx")).toBe(false);
    // statusCodes 本身是顶层 props，且是可选的
    expect(props?.get("statusCodes")).toBe(false);
    expect(props?.get("total")).toBe(false);
  });

  it("多行函数签名的形参不是顶层 props", () => {
    const src = [
      "export interface FooProps {",
      "  sync: (",
      "    passphrase: string,",
      "  ) => Promise<void>",
      "  open: boolean",
      "}",
    ].join("\n");
    const props = parsePropsInterface(src, "Foo");
    // passphrase 是 sync 的形参，不是 props
    expect(props?.has("passphrase")).toBe(false);
    expect(props?.get("sync")).toBe(true);
    expect(props?.get("open")).toBe(true);
  });

  it("readonly 前缀不进属性名", () => {
    const src = ["export interface FooProps {", "  readonly id: string", "}"].join("\n");
    const props = parsePropsInterface(src, "Foo");
    expect(props?.get("id")).toBe(true);
    expect(props?.has("readonly")).toBe(false);
  });

  it("属性解析跳过回调体里的关键字（首版 97 处误报的根因）", () => {
    const attrs = ' onClick={() => { if (x) return 1 }} title="hi" count={3}';
    const passed = parseJsxProps(attrs);
    expect([...(passed ?? [])].sort()).toEqual(["count", "onClick", "title"]);
  });

  it("含展开的调用点返回 null（无法静态求值，不猜）", () => {
    expect(parseJsxProps(" {...props} extra={1}")).toBeNull();
  });

  it("扫描标签时跳过 `=>` 里的 `>`（否则属性被截断）", () => {
    const text = "<Foo onCancel={() => setOpen(false)} count={2} />";
    const [hit] = scanJsxAttributes(text, "Foo");
    expect(hit.attrs).toContain("onCancel");
    expect(hit.attrs).toContain("count");
  });
});
