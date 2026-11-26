/**
 * U-443：吉祥物媒体 404——`ensure-cat-media.mjs --fill-missing` 只补缺、
 * 绝不覆盖真实媒体；`dev-all.mjs` 启动前调它，普通开发栈也不再 404。
 *
 * 背景：真实猫媒体是二进制资产、从未进过 git（`.gitignore` 排除
 * `apps/web-overlay/public/xiaomaomao/media/`）；全新 checkout 下该目录
 * 为空，挂件启动时清单 HEAD 探活 9 个文件全 404、兜底链逐级失败后
 * hideCat() 藏猫。E2E 路径（e2e-web-server.mjs / CI）早已调
 * ensure-cat-media，但普通 `pnpm dev:all` 从不调——图谱复核两线在
 * dev 栈上看到的正是这组 404。
 *
 * 修复：dev-all 启动前以 --fill-missing 调同一脚本。夹具只有 3–6KB、
 * 真实媒体 ≥1.9MB（见 media-manifest.json），100KB 划线；已放过夹具的
 * （尺寸一致）也不重写。生产行为不变：生产媒体缺失时挂件仍按设计藏猫。
 *
 * 本文件用 NAVHUB_CAT_MEDIA_TARGETS 把写出目录指到临时目录，绝不碰
 * 真实 public 目录；默认模式（无 flag）仍无条件覆盖，E2E 行为不变。
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    try {
      readFileSync(resolve(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = resolve(dir, "..");
    }
  }
  throw new Error("无法定位仓库根目录");
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

const SCRIPT = resolve(ROOT, "scripts/ensure-cat-media.mjs");
const SRC_DIR = resolve(ROOT, "e2e/fixtures/cat-media");
const EXPECTED = [
  "play-idle.webm",
  "play-idle.webp",
  "play-idle.gif",
  "play-walk.webm",
  "play-walk.webp",
  "play-walk.gif",
  "play-pounce.webm",
  "play-pounce.webp",
  "play-pounce.gif",
];

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function mkTarget(): string {
  const d = mkdtempSync(join(tmpdir(), "navhub-cat-media-"));
  tmpDirs.push(d);
  return d;
}

function runScript(targets: string[], extraArgs: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, ...extraArgs], {
    cwd: ROOT,
    env: { ...process.env, NAVHUB_CAT_MEDIA_TARGETS: targets.join(",") },
    encoding: "utf8",
  });
}

describe("ensure-cat-media --fill-missing（U-443）", () => {
  it("空目录：9 个文件全部补齐，与夹具字节一致", () => {
    const target = mkTarget();
    const r = runScript([target], ["--fill-missing"]);
    expect(r.status).toBe(0);
    for (const f of EXPECTED) {
      const dst = join(target, f);
      expect(existsSync(dst)).toBe(true);
      expect(statSync(dst).size).toBe(statSync(join(SRC_DIR, f)).size);
      expect(sha256(dst)).toBe(sha256(join(SRC_DIR, f)));
    }
  });

  it("已有真实大文件：不覆盖，其余 8 个补齐", () => {
    const target = mkTarget();
    mkdirSync(target, { recursive: true });
    // 200KB 哨兵模拟真实媒体（真实文件 ≥1.9MB，夹具 ≤6KB）。
    const sentinel = join(target, "play-idle.webm");
    writeFileSync(sentinel, Buffer.alloc(200_000, 7));
    const before = sha256(sentinel);
    const r = runScript([target], ["--fill-missing"]);
    expect(r.status).toBe(0);
    expect(sha256(sentinel)).toBe(before);
    expect(statSync(sentinel).size).toBe(200_000);
    for (const f of EXPECTED.filter((x) => x !== "play-idle.webm")) {
      expect(existsSync(join(target, f))).toBe(true);
      expect(statSync(join(target, f)).size).toBe(statSync(join(SRC_DIR, f)).size);
    }
  });

  it("已有小残留文件：按夹具覆盖（缺口补齐，不留坏文件）", () => {
    const target = mkTarget();
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "play-walk.gif"), Buffer.alloc(100, 1));
    const r = runScript([target], ["--fill-missing"]);
    expect(r.status).toBe(0);
    const dst = join(target, "play-walk.gif");
    expect(statSync(dst).size).toBe(statSync(join(SRC_DIR, "play-walk.gif")).size);
    expect(sha256(dst)).toBe(sha256(join(SRC_DIR, "play-walk.gif")));
  });

  it("重复跑 --fill-missing：已放过的夹具不重写（尺寸一致即跳过）", () => {
    const target = mkTarget();
    const first = runScript([target], ["--fill-missing"]);
    expect(first.status).toBe(0);
    const before = sha256(join(target, "play-idle.webp"));
    const second = runScript([target], ["--fill-missing"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("跳过 9 个已有文件");
    expect(sha256(join(target, "play-idle.webp"))).toBe(before);
  });

  it("默认模式（无 flag）：覆盖大文件——E2E 行为不变", () => {
    const target = mkTarget();
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "play-idle.webm"), Buffer.alloc(200_000, 7));
    const r = runScript([target]);
    expect(r.status).toBe(0);
    expect(statSync(join(target, "play-idle.webm")).size).toBe(
      statSync(join(SRC_DIR, "play-idle.webm")).size
    );
  });

  it("dev-all.mjs 启动前以 --fill-missing 调本脚本", () => {
    const devAll = readFileSync(resolve(ROOT, "scripts/dev-all.mjs"), "utf8");
    expect(devAll).toContain("ensure-cat-media.mjs");
    expect(devAll).toContain("--fill-missing");
  });
});
