/**
 * `scripts/lib/source-refs.mjs` 的词法边界测试。
 *
 * 为什么单独钉：这个文件被四枚门禁与模块图共用，`stripComments` 一旦状态机跑偏，
 * 后果不是报错而是**静默错判**——注释没被剥掉，示例路径变成「依赖」；或者代码被
 * 当成字符串吞掉，`import` 边消失、选测漏跑。
 *
 * 真实事故（2026-10-29）：本仓大量正则字面量写成 `/["'`]…/`（路径字面量抽取），
 * 旧状态机把里面的引号当成字符串起点，此后整段代码（含文档注释）都不再剥离，
 * 提交原子性门禁把注释里的 `packages/store/src/repository/videos.ts` 读成了真实依赖，
 * 把提交自己的实现文件拦了下来。
 */
import { describe, expect, it } from "vitest";
import { extractSpecifiers, resolveSpecifier, stripComments } from "./lib/source-refs.mjs";

describe("stripComments", () => {
  it("正则字面量里的引号/反引号不会把后面的块注释拖进「字符串」", () => {
    const source = [
      'const re = /["\'`]+/g;',
      "/**",
      " * 示例：packages/store/src/repository/videos.ts 不该被当成依赖",
      " */",
      "export const x = 1;",
      "",
    ].join("\n");
    const stripped = stripComments(source);
    expect(stripped).not.toContain("videos.ts");
    expect(stripped).toContain("export const x = 1;");
    expect(stripped).toContain('const re = /["\'`]+/g;');
  });

  it("除号不被误认成正则（含字符类、跨行都按除号处理）", () => {
    const source = ["const a = b / c; // note", "const d = 1;", ""].join("\n");
    const stripped = stripComments(source);
    expect(stripped).toContain("b / c;");
    expect(stripped).not.toContain("note");
    expect(stripped).toContain("const d = 1;");
  });

  it("字符串里的 // 不是注释；行号保持不变", () => {
    const source = 'const url = "http://x"; // tail\nconst y = 2;\n';
    const stripped = stripComments(source);
    expect(stripped).toContain('"http://x"');
    expect(stripped).not.toContain("tail");
    expect(stripped.split("\n").length).toBe(source.split("\n").length);
  });

  it("含引号的正则之后，import 说明符仍然抽得到（选测的边不能丢）", () => {
    const source = ['const re = /["\']+/;', 'import y from "./y.ts";', ""].join("\n");
    expect(extractSpecifiers(source).map((s) => s.spec)).toEqual(["./y.ts"]);
  });
});

describe("resolveSpecifier", () => {
  it("工作区包别名 + 扩展名回退 + index 回退", () => {
    const exists = (p: string) => p === "packages/store/src/index.ts";
    expect(
      resolveSpecifier("apps/api/src/routes/r.ts", "@navhub/store", {
        aliasRoots: { "@navhub/store": "packages/store/src" },
        exists,
      }),
    ).toBe("packages/store/src/index.ts");
  });

  it("外部包名与 node: 内建返回 null", () => {
    expect(resolveSpecifier("apps/api/src/r.ts", "next/server", { exists: () => true })).toBeNull();
    expect(resolveSpecifier("apps/api/src/r.ts", "node:fs", { exists: () => true })).toBeNull();
  });
});
