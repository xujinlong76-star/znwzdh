/**
 * 小猫猫挂件 v6 用户自选形象 U-169 守卫（2026-11-19）：
 *
 *  Bug（雷达 U-169）：用户上传自改形象后，连续 reload 两次，形象被抹回默认视频猫。
 *
 *  丢失链条（与 U-99 的 v4 丢失链条逐行同构，已在 19c29fa6 树上复核确认）：
 *  1. `store` 初始化时不带 `avatar` 键；`saved.avatar` 只恢复进内存变量
 *     `avatarPick`，`store.avatar` 只在 `persistAvatar()` 里才挂上。
 *  2. 加载期即可达的裸 `persist()`（K2 收起态恢复 IIFE：`store.closed` 为真且
 *     `closedAt` 未设或超 7 天 TTL 时调 `persist()`；另有 setPlayMode 等交互路径）
 *     把不带 avatar 的 store 写回 localStorage。
 *  3. 下次加载 `saved.avatar` 为 null → avatarPick 回到 null
 *     → `customImageUrl()` 返回 null → 小图标与形象回落到默认视频猫，
 *     用户上传的自选形象永久丢失。
 *
 *  修法（与 U-99 同款 B 选项，最小改动）：在 avatar 恢复块之后加一行
 *  `store.avatar = avatarPick;`，使之后任何裸 `persist()` 都带上 avatar。
 *  `persistAvatar()` 保留不动。脏数据（非 data:image/、超 450KB）仍静默退化
 *  为默认视频，不得改变。
 *
 *  等价性说明：本文件用源码断言（本仓挂件守卫的既有写法，不引 jsdom）。
 *  断言「恢复后、首个加载期裸 persist() 可达点之前挂上 store.avatar」等价于
 *  「连续 reload 两次后仍是自选形象」，因为：
 *  - 挂上之后，任何一次写盘 `JSON.stringify(store)` 都含 avatar；
 *  - 下次加载 `saved.avatar` 非空，avatarPick 按旧值恢复而非 null；
 *  - `customImageUrl()` 继续返回用户上传的 data URL。
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

describe("U-169 用户自选形象 reload 两次不丢失", () => {
  it("avatar 恢复后立即把 avatarPick 挂到 store 上（在首个加载期裸 persist() 可达点之前）", () => {
    // 按行定位：修复行必须是加载期直接执行的独立语句（不能是 persistAvatar()
    // 定义行里那句——它只在被调用时才跑，加载期的裸 persist() 走不到它）。
    const lines = WIDGET.split("\n");
    // avatar 恢复块的结束：脏数据 catch 行（v6 恢复块的 catch 文案与 v4 不同）。
    const restoreEndLine = lines.findIndex((l) =>
      l.includes("} catch (e) { /* 脏数据静默退化为默认视频 */ }"),
    );
    expect(restoreEndLine).toBeGreaterThan(-1);
    // K2 收起态恢复 IIFE：加载期第一个可达的裸 persist()（TTL 过期分支）。
    // 订正（2026-11-20 首屏瘦身）：默认收起（closedAt === 0）不再在启动时补写
    // closedAt，旧「closedAt 未设分支」已删除；K2 首个 persist() 改为过期分支
    // 里的「store.closed = false; store.closedAt = 0; persist();」。
    const k2Line = lines.findIndex((l) =>
      l.includes("store.closed = false; store.closedAt = 0; persist();"),
    );
    expect(k2Line).toBeGreaterThan(-1);
    expect(k2Line).toBeGreaterThan(restoreEndLine);
    const attachLine = lines.findIndex(
      (l, i) => i > restoreEndLine && i < k2Line && l.trim().startsWith("store.avatar = avatarPick;"),
    );
    expect(attachLine).toBeGreaterThan(-1);
  });

  it("persistAvatar() 仍挂 avatar 再写盘（原有行为保留）", () => {
    expect(WIDGET).toContain("function persistAvatar() { store.avatar = avatarPick; persist(); }");
  });

  it("avatar 恢复仍从 saved.avatar 读，且脏数据守卫未变（非 data:image/、超 450KB 退化默认）", () => {
    expect(WIDGET).toContain("var savA = (saved && typeof saved === 'object') ? saved.avatar : null;");
    expect(WIDGET).toContain("savA.data.indexOf('data:image/') === 0");
    expect(WIDGET).toContain("savA.data.length <= 450000");
  });

  it("customImageUrl() 仍以 avatarPick 为唯一自选形象来源", () => {
    expect(WIDGET).toContain("return (avatarPick && avatarPick.kind === 'upload') ? avatarPick.data : null;");
  });
});
