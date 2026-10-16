import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diffOverlay, findOwnedOrphans, isBinary, isExcluded, sameContent, walkTree } from "./overlay-drift.mjs";

/**
 * 覆盖层漂移闸门的单测。
 *
 * 这个检查是 overlay ↔ apps/web 唯一的一致性闸门：它一旦悄悄变宽松，
 * 漂移就会静默入仓，然后在 vendor / 镜像构建时丢掉自研改动
 * （真实事故：apps/web 的 React 19 / TS 5.9 手改被上游 tarball 覆盖，CI 全红）。
 */
const roots: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "overlay-drift-"));
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
