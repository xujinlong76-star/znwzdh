/**
 * `scripts/check-deps-integrity.mjs` 的自检。
 *
 * 它抓的是「安装被中断把包装残」这类事故：2026-10-29 一天内遇到两次
 * （better-sqlite3 少 package.json → 154 个套件同时红；lucide-react 少整个
 * dist/cjs → vite 报 resolve entry 失败）。症状与代码毫无关系，越早认出越好。
 *
 * 用合成目录做夹具：**绝不碰真实 node_modules**——那是别人正在用的东西。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type DepsIntegrityModule = {
  listPnpmPackages: (pnpmDir: string) => Array<{ path: string; tmpLeftover: boolean; name: string }>;
  inspectPackage: (pkgDir: string, name: string) => Array<{ kind: string; detail: string }>;
};
let mod: DepsIntegrityModule;

beforeAll(async () => {
  // @ts-expect-error —— .mjs 无类型声明
  mod = (await import("./check-deps-integrity.mjs")) as DepsIntegrityModule;
});

describe("依赖完整性：包目录发现", () => {
  let root: string;
  let pnpm: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "navhub-deps-integrity-"));
    pnpm = join(root, "node_modules", ".pnpm");
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("找得到普通包与 scope 包，并把 *_tmp_* 标成残留", () => {
    // 普通包
    mkdirSync(join(pnpm, "foo@1.0.0", "node_modules", "foo"), { recursive: true });
    writeFileSync(join(pnpm, "foo@1.0.0", "node_modules", "foo", "package.json"), "{}");
    // scope 包
    mkdirSync(join(pnpm, "@bar+core@2.0.0", "node_modules", "@bar", "core"), { recursive: true });
    writeFileSync(join(pnpm, "@bar+core@2.0.0", "node_modules", "@bar", "core", "package.json"), "{}");
    // 失败的原子重命名残留
    mkdirSync(join(pnpm, "baz@3.0.0", "node_modules", "baz_tmp_1234_2"), { recursive: true });

    const found = mod.listPnpmPackages(pnpm);
    const names = found.map((f) => f.name).sort();
    expect(names).toContain("foo");
    expect(names).toContain("@bar/core");
    // 残留目录要被认出来，而不是当成一个叫 baz_tmp_1234_2 的包
    const leftover = found.find((f) => f.tmpLeftover);
    expect(leftover?.name).toBe("baz_tmp_1234_2");
  });
});

describe("依赖完整性：单包体检", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "navhub-deps-pkg-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("缺 package.json = 残缺（better-sqlite3 那次的形态）", () => {
    const pkg = join(dir, "no-manifest");
    mkdirSync(pkg, { recursive: true });
    const problems = mod.inspectPackage(pkg, "no-manifest");
    expect(problems.map((p) => p.kind)).toEqual(["missing-manifest"]);
  });

  it("package.json 指向的文件不在 = 残缺（lucide-react 少 dist/cjs 那次的形态）", () => {
    const pkg = join(dir, "missing-entry");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "missing-entry", main: "dist/cjs/index.js" }),
    );
    mkdirSync(join(pkg, "dist", "esm"), { recursive: true });
    const problems = mod.inspectPackage(pkg, "missing-entry");
    expect(problems.map((p) => p.kind)).toEqual(["missing-entry"]);
    expect(problems[0].detail).toContain("dist/cjs/index.js");
  });

  it("0 字节入口不算残缺：上游就有合法空文件（client-only / @standard-schema/spec）", () => {
    const pkg = join(dir, "empty-marker");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "empty-marker", main: "index.js" }));
    writeFileSync(join(pkg, "index.js"), ""); // 上游 tarball 里就是 0 字节
    expect(mod.inspectPackage(pkg, "empty-marker")).toEqual([]);
  });

  it("例外清单里的入口缺失不算残缺（@humanfs/* 的 main 冗余）", () => {
    const pkg = join(dir, "upstream-quirk");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@humanfs/core", main: "dist/index.js" }));
    const problems = mod.inspectPackage(pkg, "@humanfs/core");
    expect(problems).toEqual([]);
  });

  it("健康的包不报任何问题", () => {
    const pkg = join(dir, "healthy");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "healthy", main: "dist/index.js", types: "dist/index.d.ts" }));
    writeFileSync(join(pkg, "dist", "index.js"), "module.exports = {}");
    writeFileSync(join(pkg, "dist", "index.d.ts"), "export {}");
    expect(mod.inspectPackage(pkg, "healthy")).toEqual([]);
  });
});
