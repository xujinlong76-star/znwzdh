import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(HERE, "..");
const SRC = join(WEB, "src");
const STYLES = join(SRC, "styles");
const GLOBALS = join(STYLES, "globals.css");
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mdx"]);

function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkSources(p, out);
    else if (EXTS.has(name.slice(name.lastIndexOf(".")))) out.push(p);
  }
  return out;
}

function repoRoot(): string | null {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: WEB, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** 一次性拿到被 .gitignore 忽略的文件（相对仓库根）。 */
function ignoredFiles(root: string, files: string[]): Set<string> | null {
  const rel = files.map((f) => relative(root, f).replaceAll("\\", "/"));
  const out = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: root,
    input: rel.join("\n"),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (out.status !== 0 && out.status !== 1) return null;
  return new Set(
    out.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.replaceAll("\\", "/")),
  );
}

/**
 * 用构建现场的同一引擎（@tailwindcss/oxide，经 @tailwindcss/postcss 解析）
 * 直接计算 globals.css 里 @source 的实际扫描集合。
 *
 * 为什么不用「glob 字符串匹配」做守卫：宽泛通配在语法上匹配一切，
 * 但引擎遍历时会剪掉被 .gitignore 忽略的目录 —— 纯字符串匹配会把
 * 「一条都没扫到」误判为全覆盖（2026-10-20 实测，负向对照为 0 uncovered）。
 */
type OxideScanner = {
  Scanner: new (o: {
    sources: { base: string; pattern: string; negated: boolean }[];
  }) => { files?: string[] };
};

function scannedByEngine(patterns: string[]): Set<string> | null {
  let oxide: OxideScanner;
  try {
    const requireFromApp = createRequire(import.meta.url);
    // 先解析插件入口，再从插件位置解析它自带的 @tailwindcss/oxide
    const pluginEntry = requireFromApp.resolve("@tailwindcss/postcss");
    oxide = createRequire(pluginEntry)("@tailwindcss/oxide") as OxideScanner;
  } catch {
    return null;
  }
  const scanner = new oxide.Scanner({
    sources: patterns.map((pattern) => ({ base: STYLES, pattern, negated: false })),
  });
  return new Set((scanner.files ?? []).map((f) => String(f).replaceAll("\\", "/")));
}

describe("Tailwind @source 覆盖守卫（引擎级）", () => {
  it("所有被 gitignore 的源码文件都真的进入扫描集", () => {
    if (!existsSync(SRC)) return; // 未 vendor 时跳过（CI 在 vitest 前已 vendor）
    const root = repoRoot();
    if (!root) return; // 无 git 环境时跳过

    const css = readFileSync(GLOBALS, "utf8");
    const patterns = [...css.matchAll(/@source\s+'([^']+)'/g)].map((m) => m[1]);
    expect(patterns.length).toBeGreaterThan(0);

    const files = walkSources(SRC);
    const ignored = ignoredFiles(root, files);
    if (!ignored) return;
    const scanned = scannedByEngine(patterns);
    expect(scanned, "无法加载 @tailwindcss/oxide（构建引擎）").not.toBeNull();
    if (!scanned) return;

    const missing = files.filter((file) => {
      const repoRel = relative(root, file).replaceAll("\\", "/");
      if (!ignored.has(repoRel)) return false; // 未被忽略：自动检测会扫
      const abs = file.replaceAll("\\", "/");
      return ![...scanned].some((s) => s.endsWith(abs));
    });

    expect(
      missing.map((f) => relative(WEB, f).replaceAll("\\", "/")),
      missing.length === 0
        ? ""
        : `以下被 .gitignore 忽略的文件没有被任何 @source 实际扫到，其独有工具类不会生成：\n` +
            missing.slice(0, 20).map((f) => "  - " + f).join("\n") +
            `\n请在 apps/web-overlay/src/styles/globals.css 的 @source 列表中补上其所属目录` +
            `（必须指到被忽略目录内部，父级通配会被剪枝）。`,
    ).toEqual([]);
  });
});
