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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync, existsSync, cpSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

/**
 * 每个用例都要一份完整的合成 web（1000+ 文件）。逐文件 copy 在 Windows 上单次就要
 * 十几秒，四个用例并行跑全量套件时会顶到默认 30s 超时（不是逻辑失败）。
 * 这里把「底座」只播种一次，用例用原生递归 cp 克隆，既保持隔离又把时间压下来。
 */
let BASELINE = null;
function cloneBaseline() {
  const d = makeTmp();
  cpSync(BASELINE, d, { recursive: true });
  return d;
}

beforeAll(() => {
  BASELINE = mkdtempSync(join(tmpdir(), "navhub-mirror-base-"));
  seedWebFromOverlay(BASELINE);
});

afterAll(() => {
  if (BASELINE) rmSync(BASELINE, { recursive: true, force: true });
  BASELINE = null;
});

// 全量套件里磁盘 IO 竞争激烈：单测自带更宽松的预算，语义断言不放松
describe("generate-web-mirror", { timeout: 120_000 }, () => {
  it("produces a web mirror byte-identical to overlay (parity)", () => {
    const web = cloneBaseline();
    // 基线本身就是「与 overlay 一致」的合成目标，所以这里 copied 通常是 0
    // （内容级跳过）。真正要证明的是**结果一致**，以及生成器确实遍历了整棵树。
    const { copied, unchanged, errors } = generateMirror({ source: OVERLAY, target: web });
    expect(errors).toEqual([]);
    expect(copied + unchanged).toBeGreaterThan(0);
    expect(unchanged).toBeGreaterThan(0);

    // 用 check-web-overlay 同款 diffOverlay 断言一致（前向严格）
    const { missing, drifted } = diffOverlay({ overlayDir: OVERLAY, targetDir: web });
    expect(missing).toEqual([]);
    expect(drifted).toEqual([]);
  });

  it("is idempotent: running twice yields no diff", () => {
    const web = cloneBaseline();
    generateMirror({ source: OVERLAY, target: web });
    // 第二遍仍应把 overlay 内容重写为一致状态，且不报错
    const second = generateMirror({ source: OVERLAY, target: web });
    expect(second.errors).toEqual([]);
    // 校验二次结果仍与 overlay 一致
    const { missing, drifted } = diffOverlay({ overlayDir: OVERLAY, targetDir: web });
    expect(missing).toEqual([]);
    expect(drifted).toEqual([]);
  });

  /**
   * 第二遍必须**一个字节都不写**。
   *
   * 2026-11-09 事故：无条件 copyFileSync 把 1000+ 个未改动文件的 mtime 全刷新，
   * Next 的文件监听判定 next.config.js「已变更」→ 自动重启 → 重启时批量删 .next
   * → 被本机 safe-delete 保护拦下 → dev server 直接退出。内容幂等不等于文件系统幂等，
   * 这里把后者也钉住：copied 归零，且目标 mtime 逐一不变。
   */
  it("second run writes nothing and leaves mtimes untouched", () => {
    const web = cloneBaseline();
    generateMirror({ source: OVERLAY, target: web })

    // 记录全部目标文件的 mtimeMs（overlay 树里的每个文件都对应一个 web 目标）
    const before = new Map()
    for (const rel of walkTree(OVERLAY, { exclude: isExcluded })) {
      const to = join(web, rel)
      const st = statSync(to, { throwIfNoEntry: false })
      if (st?.isFile()) before.set(rel, st.mtimeMs)
    }
    expect(before.size).toBeGreaterThan(0)

    const second = generateMirror({ source: OVERLAY, target: web })
    expect(second.errors).toEqual([])
    // 无内容差异 → 零写入
    expect(second.copied).toBe(0)
    expect(second.unchanged).toBe(before.size)

    const touched = []
    for (const [rel, mtime] of before) {
      if (statSync(join(web, rel)).mtimeMs !== mtime) touched.push(rel)
    }
    expect(touched).toEqual([])
  });

  it("self-heals forward drift in the web mirror", () => {
    const web = cloneBaseline();
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
    const { copied, errors } = generateMirror({ source: OVERLAY, target: web });
    expect(errors).toEqual([]);
    // 只重写被弄脏的那一个文件：多写一个都说明「内容级跳过」失效了
    expect(copied).toBe(1);
    const after = diffOverlay({ overlayDir: OVERLAY, targetDir: web });
    expect(after.missing).toEqual([]);
    expect(after.drifted).toEqual([]);
  });

  it("does not delete upstream-base files that are absent from overlay", () => {
    const web = cloneBaseline();
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
