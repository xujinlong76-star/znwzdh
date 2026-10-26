import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffOverlay,
  findOwnedOrphans,
  isBinary,
  isExcluded,
  normBuildInjectedConfig,
  sameContent,
  walkTree,
} from "./overlay-drift.mjs";

/**
 * 覆盖层漂移闸门的单测。
 *
 * 这个检查是 overlay ↔ apps/web 唯一的一致性闸门：它一旦悄悄变宽松，
 * 漂移就会静默入仓，然后在 vendor / 镜像构建时丢掉自研改动
 * （真实事故：apps/web 的 React 19 / TS 5.9 手改被上游 tarball 覆盖，CI 全红）。
 */
const roots: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "navhub-overlay-drift-"));
  roots.push(dir);
  return dir;
}

function makeTree(dir: string, files: Record<string, string | Buffer>): string {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, ...rel.split("/"));
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("isExcluded", () => {
  it("excludes build artifacts, generated files and third-party assets", () => {
    for (const rel of [
      "node_modules/pkg/index.js",
      "src/node_modules/pkg/index.js",
      ".next/server/page.js",
      ".next-pwa2/sw.js",
      ".turbo/x.json",
      "dist/app.js",
      "coverage/lcov.info",
      "tsconfig.tsbuildinfo",
      "public/fonts/inter.woff2",
      "public/assets/images/logos/acme.svg",
      "next-env.d.ts",
      "UPSTREAM.md",
      ".vendor-stage/x.ts",
      "build-log.txt",
    ]) {
      expect(isExcluded(rel), rel).toBe(true);
    }
  });

  it("keeps real source files, and normalizes Windows separators", () => {
    for (const rel of [
      "package.json",
      "src/app/page.tsx",
      "src/lib/storage-adapter.ts",
      "test/auth-guard.test.ts",
      "public/assets/images/covers/hero.png",
    ]) {
      expect(isExcluded(rel), rel).toBe(false);
    }
    // vendor 在 Windows 上拿到的相对路径可能是反斜杠，也不能因此漏判排除规则
    expect(isExcluded("node_modules\\pkg\\index.js")).toBe(true);
    expect(isExcluded("src\\app\\page.tsx")).toBe(false);
  });
});

describe("sameContent", () => {
  it("treats CRLF and LF as the same text", () => {
    expect(sameContent(Buffer.from("a\r\nb\r\n"), Buffer.from("a\nb\n"))).toBe(true);
    expect(sameContent(Buffer.from("a\nb\n"), Buffer.from("a\nc\n"))).toBe(false);
  });

  it("compares binary content by hash", () => {
    const png1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    const png2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02]);
    expect(isBinary(png1)).toBe(true);
    expect(sameContent(png1, png1)).toBe(true);
    expect(sameContent(png1, png2)).toBe(false);
    // 二进制 vs 文本：也不能因为 NUL 只在一侧就误判为"相等"
    expect(sameContent(png1, Buffer.from("not-binary"))).toBe(false);
  });
});

describe("walkTree", () => {
  it("lists files as sorted posix paths and skips excluded entries", () => {
    const dir = makeTree(makeRoot(), {
      "b.txt": "B",
      "a/x.txt": "X",
      "node_modules/pkg/index.js": "dep",
      ".next/build.json": "{}",
      "sub/.turbo/cache": "c",
    });

    expect(walkTree(dir)).toEqual(["a/x.txt", "b.txt"]);
  });
});

describe("diffOverlay", () => {
  it("reports nothing when the overlay and the vendored tree agree", () => {
    const overlay = makeTree(makeRoot(), { "package.json": "{}\n", "src/lib/x.ts": "export const x = 1;\n" });
    const target = makeTree(makeRoot(), { "package.json": "{}\n", "src/lib/x.ts": "export const x = 1;\n" });

    const r = diffOverlay({ overlayDir: overlay, targetDir: target });

    expect(r.overlayFiles).toEqual(["package.json", "src/lib/x.ts"]);
    expect(r.missing).toEqual([]);
    expect(r.drifted).toEqual([]);
    expect(r.reverseCandidates).toEqual([]);
  });

  it("flags content drift, tolerating CRLF-only differences", () => {
    const overlay = makeTree(makeRoot(), {
      "src/lib/drift.ts": "export const v = 2;\n",
      "src/lib/crlf.ts": "line1\nline2\n",
    });
    const target = makeTree(makeRoot(), {
      "src/lib/drift.ts": "export const v = 1;\n",
      "src/lib/crlf.ts": "line1\r\nline2\r\n",
    });

    const r = diffOverlay({ overlayDir: overlay, targetDir: target });

    expect(r.drifted.map((d) => d.rel)).toEqual(["src/lib/drift.ts"]);
    expect(r.drifted[0].kind).toContain("文本内容漂移");
    expect(r.missing).toEqual([]);
  });

  it("flags files the overlay ships but the vendored tree is missing", () => {
    const overlay = makeTree(makeRoot(), { "src/lib/a.ts": "a", "src/lib/b.ts": "b" });
    const target = makeTree(makeRoot(), { "src/lib/a.ts": "a" });

    const r = diffOverlay({ overlayDir: overlay, targetDir: target });

    expect(r.missing).toEqual(["src/lib/b.ts"]);
    expect(r.drifted).toEqual([]);
  });

  it("reports binary drift by hash instead of pretending it is text", () => {
    const overlay = makeTree(makeRoot(), { "public/logo.png": Buffer.from([0, 1, 2]) });
    const target = makeTree(makeRoot(), { "public/logo.png": Buffer.from([0, 1, 3]) });

    const r = diffOverlay({ overlayDir: overlay, targetDir: target });

    expect(r.drifted).toHaveLength(1);
    expect(r.drifted[0].kind).toContain("二进制不一致");
  });

  it("lists reverse candidates as warnings, never as failures", () => {
    const overlay = makeTree(makeRoot(), { "src/lib/a.ts": "a" });
    const target = makeTree(makeRoot(), {
      "src/lib/a.ts": "a",
      "src/lib/upstream-only.ts": "u",
      "src/app/page.tsx": "p",
    });

    const r = diffOverlay({ overlayDir: overlay, targetDir: target });

    expect(r.drifted).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.reverseCandidates).toEqual(["src/app/page.tsx", "src/lib/upstream-only.ts"]);
  });

  it("ignores excluded files on both sides (no false drift, no reverse noise)", () => {
    const overlay = makeTree(makeRoot(), { "src/lib/a.ts": "a", "node_modules/x/index.js": "o" });
    const target = makeTree(makeRoot(), {
      "src/lib/a.ts": "a",
      "node_modules/x/index.js": "different",
      ".next/server/page.js": "generated",
      "tsconfig.tsbuildinfo": "cache",
    });

    const r = diffOverlay({ overlayDir: overlay, targetDir: target });

    expect(r.overlayFiles).toEqual(["src/lib/a.ts"]);
    expect(r.drifted).toEqual([]);
    expect(r.reverseCandidates).toEqual([]);
  });

  it("does not compare doc files (README) but still requires them in the tree", () => {
    const overlay = makeTree(makeRoot(), { "README.md": "overlay docs", "src/lib/a.ts": "a" });
    const target = makeTree(makeRoot(), { "README.md": "apps/web docs", "src/lib/a.ts": "a" });

    const r = diffOverlay({ overlayDir: overlay, targetDir: target });

    expect(r.overlayFiles).toEqual(["src/lib/a.ts"]);
    expect(r.drifted).toEqual([]);
  });

  it("tolerates a missing vendored tree (nothing vendored yet) without throwing", () => {
    const overlay = makeTree(makeRoot(), { "src/lib/a.ts": "a" });

    const r = diffOverlay({ overlayDir: overlay, targetDir: join(makeRoot(), "does-not-exist") });

    expect(r.missing).toEqual(["src/lib/a.ts"]);
    expect(r.reverseCandidates).toEqual([]);
  });
});

describe("findOwnedOrphans", () => {
  it("flags git-tracked apps/web files that never made it into the overlay", () => {
    const overlay = ["package.json", "src/lib/github.ts"];

    // 真实事故现场：apps/web 的 package.json 手改（React 19 / TS 5.9）没同步回 overlay
    expect(findOwnedOrphans(["package.json", "src/lib/github.ts", "src/lib/navhub-api.ts"], overlay)).toEqual([
      "src/lib/navhub-api.ts",
    ]);
    expect(findOwnedOrphans(["package.json", "UPSTREAM.md"], overlay)).toEqual([]);
    // 被 git 跟踪但属于排除规则的文件（生成物）不算自研漏同步
    expect(findOwnedOrphans(["tsconfig.tsbuildinfo", "node_modules/x/y.js"], overlay)).toEqual([]);
  });
});

describe("构建期就地改写的 tsconfig 归一", () => {
  /** Next 写 tsconfig 时的真实形状：带注释、include 每项一行 */
  const OVERLAY_TSCONFIG = `{
  // next 会在这里追加类型目录
  "compilerOptions": {
    "strict": true,
    "jsx": "react-jsx",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": [
    "**/*.ts",
    "**/*.tsx",
    "next-env.d.ts",
    ".next/types/**/*.ts",
    ".next-e2e/dev/types/**/*.ts"
  ],
  "exclude": [
    "node_modules"
  ]
}
`;

  /** 同一份配置被另一轮 NEXT_DIST_DIR=.next-verify87 的构建就地改写后的 apps/web 侧 */
  const VENDED_TSCONFIG = `{
  // next 会在这里追加类型目录
  "compilerOptions": {
    "strict": true,
    "jsx": "react-jsx",
    "paths": { "@/*": ["./src/*"] }
  },
"include": [
    "**/*.ts",
    "**/*.tsx",
    "next-env.d.ts",
    ".next/types/**/*.ts",
    ".next-e2e/dev/types/**/*.ts",
    ".next-verify87/types/**/*.ts",
    ".next-verify87/dev/types/**/*.ts"
  ],
  "exclude": [
    "node_modules"
  ]
}
`;

  function diffWith(overlayText: string, targetText: string) {
    const overlay = makeTree(makeRoot(), { "tsconfig.json": overlayText, "src/lib/a.ts": "a\n" });
    const target = makeTree(makeRoot(), { "tsconfig.json": targetText, "src/lib/a.ts": "a\n" });
    return diffOverlay({ overlayDir: overlay, targetDir: target });
  }

  it("多出 .next* 生成项（含 include 行缩进被改写）不算漂移", () => {
    const r = diffWith(OVERLAY_TSCONFIG, VENDED_TSCONFIG);
    expect(r.drifted).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("连续多项生成项与「唯一一项就是生成项」都能吃掉", () => {
    const solo = OVERLAY_TSCONFIG.replace(
      '    ".next-e2e/dev/types/**/*.ts"\n',
      '    ".next-e2e/dev/types/**/*.ts",\n    ".next-uibuild6/types/**/*.ts"',
    );
    expect(diffWith(solo, VENDED_TSCONFIG + "\n").drifted).toEqual([]);
    const onlyGen = '{\n  "include": [\n    ".next-verify87/types/**/*.ts"\n  ]\n}\n';
    expect(diffWith('{\n  "include": []\n}\n', onlyGen).drifted).toEqual([]);
  });

  it("非 .next 的 include 差异仍算漂移（归一不是放行）", () => {
    const lost = VENDED_TSCONFIG.replace('    "**/*.tsx",\n', "");
    const r = diffWith(OVERLAY_TSCONFIG, lost);
    expect(r.drifted.map((d) => d.rel)).toEqual(["tsconfig.json"]);
    expect(r.drifted[0].kind).toContain("已归一构建生成项");
  });

  it("compilerOptions 或注释本身的差异仍算漂移", () => {
    expect(diffWith(OVERLAY_TSCONFIG, VENDED_TSCONFIG.replace('"strict": true', '"strict": false')).drifted.length).toBe(1);
    expect(diffWith(OVERLAY_TSCONFIG, VENDED_TSCONFIG.replace("// next 会在这里追加类型目录", "// 改过的注释")).drifted.length).toBe(1);
  });

  it("归一只对 tsconfig.json 生效，别的路径里的 .next 字样照旧严格", () => {
    const overlay = makeTree(makeRoot(), { "src/lib/a.json": '{"paths": [".next-x", "keep"]}\n' });
    const target = makeTree(makeRoot(), { "src/lib/a.json": '{"paths": ["keep"]}\n' });
    const r = diffOverlay({ overlayDir: overlay, targetDir: target });
    expect(r.drifted.map((d) => d.rel)).toEqual(["src/lib/a.json"]);
    expect(r.drifted[0].kind).toContain("CRLF 归一");
  });

  it("钉住本机现况：overlay 与 vendored tsconfig 只差生成项", () => {
    const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
    const a = join(root, "apps", "web-overlay", "tsconfig.json");
    const b = join(root, "apps", "web", "tsconfig.json");
    const once = normBuildInjectedConfig("tsconfig.json", readFileSync(a))!;
    // 归一必须幂等：再归一一次不变，才说明正则没啃掉生成项以外的内容
    expect(normBuildInjectedConfig("tsconfig.json", Buffer.from(once, "utf8"))).toBe(once);
    if (!existsSync(b)) return; // CI 的根测试不 vendor apps/web
    expect(once).toBe(normBuildInjectedConfig("tsconfig.json", readFileSync(b)));
  });
});
