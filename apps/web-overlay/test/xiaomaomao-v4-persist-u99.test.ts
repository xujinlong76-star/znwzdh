/**
 * 小猫猫挂件 v4 成长见证 U-99 守卫（2026-11-19）：
 *
 *  Bug（雷达 U-99，open 自 2026-11-18 16:36）：用户刚升级，连续刷新两次页面后
 *  升级庆祝永久丢失。
 *
 *  丢失链条（已在 97449010 树上复核确认）：
 *  1. `store` 初始化时不带 `v4` 键；`saved.v4` 只恢复进内存变量 `v4`，
 *     `store.v4` 只在 `persistV4()` 里才挂上。
 *  2. 加载期即可达的裸 `persist()`（K2 收起态恢复 IIFE：`store.closed` 为真且
 *     `closedAt` 未设或超 7 天 TTL 时调 `persist()`；另有 setPlayMode 等交互路径）
 *     把不带 v4 的 store 写回 localStorage。
 *  3. 下次加载 `saved.v4` 为 null → v4 回到默认（seenLevel 0、seenBadges null）
 *     → init 的 `checkGrowth(false)` 把见证静默初始化为当前等级
 *     （`seenBadges === null` 分支直接 `persistV4(); return;`），
 *     待补发的升级庆祝永不再算出。
 *
 *  修法（B 选项，最小改动）：在 v4 恢复块之后加一行 `store.v4 = v4;`，
 *  使之后任何裸 `persist()` 都带上 v4。`persistV4()` 保留不动。
 *
 *  等价性说明：本文件用源码断言（本仓挂件守卫的既有写法，不引 jsdom）。
 *  断言「恢复后、首个加载期裸 persist() 可达点之前挂上 store.v4」等价于
 *  「连续 reload 两次后庆祝仍可补发」，因为：
 *  - 挂上之后，任何一次写盘 `JSON.stringify(store)` 都含 v4；
 *  - 下次加载 `saved.v4` 非空，seenLevel/seenBadges 按旧值恢复而非 null；
 *  - init 的 `checkGrowth(false)` 不走 `seenBadges === null` 的静默初始化分支，
 *    增量（升级/新徽章）仍能在下一次 `checkGrowth(true)` 里算出并补发。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")];
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/");
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay");
  };
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p));
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = overlayRoot();
const WIDGET = readFileSync(join(ROOT, "public/xiaomaomao/xiaomaomao.js"), "utf8");

describe("U-99 v4 成长见证 reload 两次不丢失", () => {
  it("v4 恢复后立即把 v4 挂到 store 上（在首个加载期裸 persist() 可达点之前）", () => {
    // 按行定位：修复行必须是加载期直接执行的独立语句（不能是 persistV4()
    // 定义行里那句——它只在被调用时才跑，加载期的裸 persist() 走不到它）。
    const lines = WIDGET.split("\n");
    const satAtLine = lines.findIndex((l) => l.includes("if (!v4.satAt) v4.satAt = Date.now();"));
    expect(satAtLine).toBeGreaterThan(-1);
    // K2 收起态恢复 IIFE：加载期第一个可达的裸 persist()（TTL 过期分支）。
    // 订正（2026-11-20 首屏瘦身）：默认收起（closedAt === 0）不再在启动时补写
    // closedAt，旧「closedAt 未设分支」已删除；K2 首个 persist() 改为过期分支
    // 里的「store.closed = false; store.closedAt = 0; persist();」。
    const k2Line = lines.findIndex((l) =>
      l.includes("store.closed = false; store.closedAt = 0; persist();"),
    );
    expect(k2Line).toBeGreaterThan(-1);
    expect(k2Line).toBeGreaterThan(satAtLine);
    const attachLine = lines.findIndex(
      (l, i) => i > satAtLine && i < k2Line && l.trim().startsWith("store.v4 = v4;"),
    );
    expect(attachLine).toBeGreaterThan(-1);
  });

  it("persistV4() 仍挂 v4 再写盘（原有行为保留）", () => {
    expect(WIDGET).toContain("function persistV4() { store.v4 = v4; persist(); }");
  });

  it("init 的 checkGrowth(false) 仍在：见证静默初始化分支只在 seenBadges 为 null 时走", () => {
    // 该分支是丢失链条的最后一环；修复靠的不是改它，而是让 saved.v4 不再变 null。
    const at = WIDGET.indexOf("if (v4.seenBadges === null) {");
    expect(at).toBeGreaterThan(-1);
    const body = WIDGET.slice(at, at + 200);
    expect(body).toContain("v4.seenLevel = lv.level;");
    expect(body).toContain("v4.seenBadges = ids;");
  });

  it("v4 恢复仍从 saved.v4 读（加载恢复路径未被改动）", () => {
    expect(WIDGET).toContain("var sv4 = (saved && typeof saved === 'object') ? saved.v4 : null;");
  });
});
