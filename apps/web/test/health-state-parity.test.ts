/**
 * 体检状态机的「同构副本」一致性守卫。
 *
 * 前端那份 `src/lib/health-state.ts` 是 `packages/core/src/health-state.ts` 的
 * 同步副本——因为 Web 生产镜像只拷贝 overlay，镜像里没有 packages/core，
 * 前端不能直接跨包 import（2026-10-27 main 的镜像构建因此红过）。
 *
 * 复制本身可以接受（仓库对 category-url / shortlink-target 也是这么做的），
 * 不可接受的是两份**悄悄分叉**：面板说「待复检」、只读 API 说「健康」。
 * 这里用同一组快照矩阵同时喂给两份实现，要求输出逐字段相等。
 */
import { describe, expect, it } from "vitest";
import { deriveHealthPanelState as fromCopy } from "../src/lib/health-state";
// @ts-expect-error 走 vitest alias 指向 packages/core/src/index.ts，无独立类型入口
import { deriveHealthPanelState as fromCore } from "@navhub/core";

const SNAPSHOTS = [
  null,
  undefined,
  {},
  { stale: true },
  { stale: true, declared: 12 },
  { declared: 5 },
  { reachability: 0 },
  { reachability: 1, okCount: 3, blockedCount: 1, suspiciousCount: 0, brokenCount: 0, sampled: 4, declared: 4 },
  { reachability: 0.42, sampled: 100, declared: 120 },
  { reachability: Number.NaN, declared: 7 },
  { reachability: 0.9, okCount: 9, brokenCount: 1 },
  { stale: false, reachability: 0.5, declared: null },
];

describe("health-state 同构副本与 core 逐字段一致", () => {
  it.each(SNAPSHOTS.map((s, i) => [i, s] as const))("快照 #%i", (_i, snap) => {
    expect(fromCopy(snap as never)).toEqual(fromCore(snap as never));
  });

  it("副本文件与 core 实现除说明头外逐字一致（防手改分叉）", async () => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    // 测试可能跑在 apps/web-overlay/test 或镜像 apps/web/test，向上找仓库根
    let root = __dirname;
    for (let i = 0; i < 6 && !existsSync(resolve(root, "pnpm-workspace.yaml")); i++) {
      root = dirname(root);
    }
    const core = readFileSync(resolve(root, "packages/core/src/health-state.ts"), "utf8");
    const copy = readFileSync(resolve(root, "apps/web-overlay/src/lib/health-state.ts"), "utf8");
    // 副本允许有一段落款说明，其余必须一致
    const body = copy.slice(copy.indexOf("*/") + 2).trimStart();
    // 行尾归一后再比：仓库在 Windows 上可能出现 CRLF，语义不受影响
    const normalize = (text: string) => text.split("\r\n").join("\n");
    expect(normalize(body)).toBe(normalize(core).trimStart());
  });
});
