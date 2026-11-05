/**
 * 验证 apps/web 镜像生成器：幂等 + 与 overlay 逐文件一致。
 *
 * 不碰真实 apps/web（那是 vendored 底座 + overlay 合并态，跑生成器会就地改写），
 * 改为在临时目录里做隔离验证：把真实 overlay 当作事实源，
 *   1) 造一份「含上游底座 + overlay」的合成 web（用 overlay 复制充当底座，够覆盖语义），
 *      跑生成器，断言 web 里 overlay 的每个非排除文件都 byte-identical；
 *   2) 再跑一次生成器断言幂等（无变化）；
 *   3) 故意制造一处漂移，断言生成器能修复（自愈）。
 *
 * 复用 scripts/lib/overlay-drift.mjs 的 isExcluded / walkTree，口径与 check-web-overlay 一致。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { generateMirror } from "../generate-web-mirror.mjs";
import { walkTree, isExcluded, diffOverlay } from "../lib/overlay-drift.mjs";

const ROOT = resolve(".");
const OVERLAY = join(ROOT, "apps", "web-overlay");

const tmpDirs = [];
function makeTmp() {
  const d = mkdtempSync(join(tmpdir(), "navhub-mirror-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

/** 把 overlay 当作上游底座 + 覆盖层合成一份 web（足以覆盖「合并 + 幂等 + 漂移修复」语义） */
function seedWebFromOverlay(web) {
  for (const rel of walkTree(OVERLAY)) {
    const from = join(OVERLAY, rel);
    const to = join(web, rel);
    mkdirSync(join(to, ".."), { recursive: true });
    copyFileSync(from, to);
  }
}

describe("generate-web-mirror", () => {
  it("produces a web mirror byte-identical to overlay (parity)", () => {
    const web = makeTmp();
    seedWebFromOverlay(web);
    const { copied, errors } = generateMirror({ source: OVERLAY, target: web });
    expect(errors).toEqual([]);
    expect(copied).toBeGreaterThan(0);

    // 用 check-web-overlay 同款 diffOverlay 断言一致（前向严格）
    const { missing, drifted } = diffOverlay({ overlayDir: OVERLAY, targetDir: web });
    expect(missing).toEqual([]);
    expect(drifted).toEqual([]);
  });

  it("is idempotent: running twice yields no diff", () => {
    const web = makeTmp();
    seedWebFromOverlay(web);
    generateMirror({ source: OVERLAY, target: web });
    // 第二遍仍应把 overlay 内容重写为一致状态，且不报错
    const second = generateMirror({ source: OVERLAY, target: web });
    expect(second.errors).toEqual([]);
    // 校验二次结果仍与 overlay 一致
    const { missing, drifted } = diffOverlay({ overlayDir: OVERLAY, targetDir: web });
    expect(missing).toEqual([]);
    expect(drifted).toEqual([]);
  });

  it("self-heals forward drift in the web mirror", () => {
    const web = makeTmp();
    seedWebFromOverlay(web);
    generateMirror({ source: OVERLAY, target: web });

    // 故意在 web 侧制造一处内容漂移（overlay 不变）
    const probe = walkTree(OVERLAY).find((r) => !isExcluded(r) && !r.startsWith("tsconfig.json"));
    expect(probe).toBeTruthy();
    const target = join(web, probe);
    writeFileSync(target, "DRIFTED-CONTENT-THAT-MUST-BE-FIXED\n", "utf8");

    // 跑生成器前应处于漂移态
    const before = diffOverlay({ overlayDir: OVERLAY, targetDir: web });
    expect(before.drifted.length).toBeGreaterThan(0);

    // 生成器自愈
    const { errors } = generateMirror({ source: OVERLAY, target: web });
    expect(errors).toEqual([]);
    const after = diffOverlay({ overlayDir: OVERLAY, targetDir: web });
    expect(after.missing).toEqual([]);
    expect(after.drifted).toEqual([]);
  });

  it("does not delete upstream-base files that are absent from overlay", () => {
    const web = makeTmp();
    seedWebFromOverlay(web);
    // 放一个 overlay 没有、但不被排除的「上游底座文件」
    const upstreamOnly = "public/assets/cover/upstream-only-cover.jpg";
    mkdirSync(join(web, "public", "assets", "cover"), { recursive: true });
    writeFileSync(join(web, upstreamOnly), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "binary");
    generateMirror({ source: OVERLAY, target: web });
    // 该上游文件应当被保留（合并式，不删除）
    expect(existsSync(join(web, upstreamOnly))).toBe(true);
    // 同时 overlay 的内容仍逐文件一致
    const { missing, drifted } = diffOverlay({ overlayDir: OVERLAY, targetDir: web });
    expect(missing).toEqual([]);
    expect(drifted).toEqual([]);
  });
});
