/**
 * 验证 overlay -> web 镜像生成器的合并、幂等、mtime 与漂移自愈语义。
 *
 * 使用小型合成目录，避免在 Windows 上反复复制 2000+ 真实文件把单测拖到分钟级；
 * 真实 overlay 的完整性由 check:overlay / check:generated 负责。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateMirror } from "../generate-web-mirror.mjs";
import { diffOverlay } from "../lib/overlay-drift.mjs";

let root;
let overlay;
let web;

function write(path, content) {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "navhub-mirror-"));
  overlay = join(root, "overlay");
  web = join(root, "web");
  write("overlay/src/a.ts", "export const a = 1\n");
  write("overlay/src/nested/b.ts", "export const b = 2\n");
  write("overlay/public/asset.txt", "asset\n");
  write("overlay/node_modules/pkg/index.js", "must not be mirrored\n");
  write("web/upstream-only.txt", "keep me\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("generate-web-mirror", () => {
  it("produces a web mirror byte-identical to overlay and skips excluded paths", () => {
    const { errors } = generateMirror({ source: overlay, target: web });
    const { missing, drifted } = diffOverlay({ overlayDir: overlay, targetDir: web });
    expect(errors).toEqual([]);
    expect(missing).toEqual([]);
    expect(drifted).toEqual([]);
    expect(existsSync(join(web, "node_modules", "pkg", "index.js"))).toBe(false);
  });

  it("is idempotent: running twice yields no diff and no writes", () => {
    generateMirror({ source: overlay, target: web });
    const second = generateMirror({ source: overlay, target: web });
    expect(second.errors).toEqual([]);
    expect(second.copied).toBe(0);
    expect(diffOverlay({ overlayDir: overlay, targetDir: web })).toMatchObject({ missing: [], drifted: [] });
  });

  it("second run writes nothing and leaves mtimes untouched", () => {
    generateMirror({ source: overlay, target: web });
    const files = ["src/a.ts", "src/nested/b.ts", "public/asset.txt"];
    const before = new Map(files.map((rel) => [rel, statSync(join(web, rel)).mtimeMs]));
    const second = generateMirror({ source: overlay, target: web });
    expect(second.errors).toEqual([]);
    expect(second.copied).toBe(0);
    expect(second.unchanged).toBe(before.size);
    for (const [rel, mtime] of before) {
      expect(statSync(join(web, rel)).mtimeMs).toBe(mtime);
    }
  });

  it("self-heals forward drift in the web mirror", () => {
    generateMirror({ source: overlay, target: web });
    write("web/src/a.ts", "DRIFTED\n");
    expect(diffOverlay({ overlayDir: overlay, targetDir: web }).drifted.length).toBeGreaterThan(0);
    const { copied, errors } = generateMirror({ source: overlay, target: web });
    expect(copied).toBe(1);
    expect(errors).toEqual([]);
    expect(diffOverlay({ overlayDir: overlay, targetDir: web })).toMatchObject({ missing: [], drifted: [] });
  });

  it("does not delete upstream-base files that are absent from overlay", () => {
    const { errors } = generateMirror({ source: overlay, target: web });
    expect(errors).toEqual([]);
    expect(existsSync(join(web, "upstream-only.txt"))).toBe(true);
    expect(diffOverlay({ overlayDir: overlay, targetDir: web })).toMatchObject({ missing: [], drifted: [] });
  });
});
