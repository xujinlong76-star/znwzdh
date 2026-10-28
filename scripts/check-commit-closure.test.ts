/**
 * `scripts/check-commit-closure.mjs` 的判定逻辑单测。
 *
 * 这个脚本回答的是一个**二元问题**：「这组文件能不能作为一个完整提交」。
 * 它自己错了会两头都坑人 —— 假绿（漏文件 ⇒ HEAD 编译不过）或假红（脏依赖的噪音
 * ⇒ 明明能提交却放弃）。所以判据要逐条钉死：
 *
 *   1. 不在 HEAD 的依赖必须进集合 → 否则报缺口；
 *   2. 脏依赖（HEAD 有、工作区也改过）不要求纳入，但**用到而 HEAD 没有**的符号要报；
 *   3. `export * from` 的 barrel 要穿透，否则每个经 barrel 的符号都会误报；
 *   4. HEAD 有且工作区干净 → 永远不报。
 *
 * 用真实临时目录做 resolveSpecifier 的对象（它依赖文件系统），HEAD 内容用注入的
 * 映射代替 —— 这样不用碰本仓的 git 状态，测试可以离线、可重复。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { declares, findGaps, namedImports, posixNormalize } from "./check-commit-closure.mjs";

const FILES: Record<string, string> = {
  "src/a.ts": 'import { need } from "./b.ts";\nimport * as ns from "./barrel.ts";\nconsole.log(need, ns.throughBarrel);\n',
  "src/b.ts": "export const need = 1;\n",
  "src/c.ts": "export const throughBarrel = 2;\n",
  "src/barrel.ts": 'export * from "./c.ts";\n',
};

let root = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "closure-test-"));
  for (const [rel, body] of Object.entries(FILES)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    // 目录与文件都在这里显式创建，避免依赖 mkdir -p 的隐式行为
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(abs, body);
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

const run = (candidates: string[], head: Record<string, string>, dirty: string[] = []) =>
  findGaps({
    candidates,
    root,
    readFile: (rel: string) => FILES[rel] ?? (() => { throw new Error("missing " + rel); })(),
    headOfFile: (rel: string) => (rel in head ? head[rel] : null),
    dirtyOf: (rel: string) => dirty.includes(rel),
  });

describe("符号与路径解析", () => {
  it("namedImports 剥掉 type 修饰与别名", () => {
    expect(namedImports("a, b as c, type D")).toEqual(["a", "b", "D"]);
    expect(namedImports("")).toEqual([]);
    expect(namedImports(undefined as unknown as string)).toEqual([]);
  });

  it("declares 认声明式与 export {...} 列表，不认同名内部函数", () => {
    expect(declares("export function f(){}", "f")).toBe(true);
    expect(declares("export const g = 1;", "g")).toBe(true);
    expect(declares("export type T = 1;", "T")).toBe(true);
    expect(declares("const h = 1;\nexport { h };", "h")).toBe(true);
    expect(declares("function i(){}\nexport { i as j };", "i")).toBe(false);
  });

  it("posixNormalize 处理 . 与 ..", () => {
    expect(posixNormalize("a/./b/../c")).toBe("a/c");
    expect(posixNormalize("./x")).toBe("x");
  });
});

describe("闭包判定", () => {
  it("依赖不在 HEAD 且不在集合内 → 报缺口", () => {
    const { problems } = run(["src/a.ts"], { "src/barrel.ts": FILES["src/barrel.ts"], "src/c.ts": FILES["src/c.ts"] });
    expect(problems.join("\n")).toContain("src/b.ts：不在 HEAD");
  });

  it("把缺口补进集合 → 不再报", () => {
    const { problems, fileCount } = run(
      ["src/a.ts", "src/b.ts"],
      { "src/barrel.ts": FILES["src/barrel.ts"], "src/c.ts": FILES["src/c.ts"] },
    );
    expect(problems).toEqual([]);
    // 只统计「实际读过内容」的文件：集合内的 b 不再深入，干净的 HEAD 依赖也不深入
    expect(fileCount).toBe(2);
  });

  it("脏依赖里 HEAD 没有该符号 → 报缺口", () => {
    // b 不在集合内（只在 HEAD 里且被改脏），此时才需要核对符号是否已存在于 HEAD
    const { problems } = run(
      ["src/a.ts"],
      { "src/b.ts": "export const other = 1;\n", "src/barrel.ts": FILES["src/barrel.ts"], "src/c.ts": FILES["src/c.ts"] },
      ["src/b.ts"],
    );
    expect(problems.join("\n")).toContain("用到 need");
  });

  it("脏依赖是 barrel 时穿透 export * from，不误报", () => {
    const { problems } = run(
      ["src/a.ts", "src/b.ts"],
      {
        "src/b.ts": FILES["src/b.ts"],
        "src/barrel.ts": FILES["src/barrel.ts"],
        "src/c.ts": FILES["src/c.ts"],
      },
      ["src/barrel.ts"],
    );
    expect(problems).toEqual([]);
  });

  it("HEAD 有且工作区干净 → 永远不报（即使 HEAD 里没有该符号）", () => {
    const { problems } = run(["src/a.ts", "src/b.ts"], { "src/barrel.ts": "", "src/c.ts": "" });
    expect(problems).toEqual([]);
  });

  it("文件不存在时报出来，而不是静默跳过", () => {
    const { problems } = run(["src/nope.ts"], {});
    expect(problems.join("\n")).toContain("文件不存在");
  });
});
