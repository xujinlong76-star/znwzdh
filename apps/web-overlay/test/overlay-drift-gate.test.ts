/**
 * 覆盖层漂移门禁的接线守卫。
 *
 * 本仓库同一份前端代码存在两个物理副本（overlay 事实源 / apps/web 运行目录）。
 * 2026-10-24 本轮施工中实际踩到两次「改完 overlay 忘了同步」，因此门禁必须在
 * 三个入口都真实存在，任何一个被删掉，下一次漂移就会静默进镜像：
 *   1. 本地 pre-commit：只校验本次提交涉及的文件（--staged，避免并行会话互相挡）；
 *   2. pnpm verify：全仓库校验；
 *   3. CI：独立作业 + 聚合闸门 ci-passed 依赖它。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** 从测试文件向上找 pnpm-workspace.yaml，兼容 overlay/test 与 apps/web/test 两个位置 */
function findRepoRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  throw new Error("无法定位仓库根目录");
}
const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

describe("overlay 漂移门禁", () => {
  it("pre-commit 安装器包含 --staged 校验", () => {
    const src = read("scripts/install-git-hooks.mjs");
    expect(src).toContain("check-web-overlay.mjs --staged");
  });

  it("pnpm verify 包含全仓库覆盖层校验", () => {
    const src = read("scripts/verify.mjs");
    expect(src).toContain('"scripts/check-web-overlay.mjs"');
  });

  it("CI 有独立作业，且聚合闸门依赖它", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("check-web-overlay:");
    // ci-passed 的 needs 列表必须包含该作业，否则红灯不影响合并
    const passedBlock = ci.slice(ci.indexOf("ci-passed:"));
    expect(passedBlock).toContain("check-web-overlay");
  });
});
