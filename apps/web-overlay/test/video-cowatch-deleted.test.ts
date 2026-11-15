/**
 * CoWatch / CRDT 自习室删除守卫（C 组第 5 簇）。
 *
 * 删掉的是「协同共赏 + 伴学自习室」这个社交功能，不是 CRDT 同步本身：
 *   删：自习室对话框组件、CoWatch 会话 lib、自习室 CRDT 状态 lib、
 *       播放器页内嵌的 CoWatch 弹窗/按钮/加入离开逻辑、控制条「伴学自习室」入口
 *   不碰：/api/crdt/sync（apps/api/src/routes/crdt.ts，别的同步接口），
 *       以及漫游同步栈（lib/crdt-sync.ts、hooks/use-crdt-roaming.ts、
 *       components/crdt/crdt-sync-status-pill.tsx）
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, "..", rel), resolve(HERE, "..", "..", "web-overlay", rel)];
  const hit = candidates.find((p) => p.includes("web-overlay") && existsSync(p));
  if (!hit) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(hit, "utf8").replace(/\r\n/g, "\n");
}

function overlayExists(rel: string): boolean {
  return existsSync(resolve(HERE, "..", rel)) || existsSync(resolve(HERE, "..", "..", "web-overlay", rel));
}

function apiExists(rel: string): boolean {
  return existsSync(resolve(HERE, "..", "..", "api", rel)) || existsSync(resolve(HERE, "..", "..", "..", "apps", "api", rel));
}

const PAGE = "src/components/video-player-page.tsx";
const CONTROL_BAR = "src/components/video-player-control-bar.tsx";

describe("CoWatch / CRDT 自习室已删除", () => {
  it("自习室对话框与两个 CoWatch 专属 lib 的文件不存在", () => {
    for (const rel of [
      "src/components/video-crdt-study-room-dialog.tsx",
      "src/lib/video-crdt-room.ts",
      "src/lib/video-study-room-crdt.ts",
    ]) {
      expect(overlayExists(rel)).toBe(false);
    }
  });

  it("播放器页与控制条不再有 CoWatch / 自习室的调用、状态与入口", () => {
    for (const rel of [PAGE, CONTROL_BAR]) {
      const src = overlaySource(rel);
      for (const name of [
        "CoWatch",
        "coWatch",
        "CrdtStudyRoom",
        "StudyRoom",
        "studyRoom",
        "video-crdt-room",
        "video-study-room-crdt",
      ]) {
        expect(src).not.toContain(name);
      }
    }
    const page = overlaySource(PAGE);
    expect(page).not.toContain("协同共赏");
    expect(page).not.toContain("伴学自习室");
    expect(overlaySource(CONTROL_BAR)).not.toContain("伴学自习室");
  });

  it("/api/crdt/sync 与漫游同步栈 untouched（别的同步接口，留着）", () => {
    expect(apiExists("src/routes/crdt.ts")).toBe(true);
    for (const rel of [
      "src/lib/crdt-sync.ts",
      "src/hooks/use-crdt-roaming.ts",
      "src/components/crdt/crdt-sync-status-pill.tsx",
    ]) {
      expect(overlayExists(rel)).toBe(true);
    }
    const pill = overlaySource("src/components/crdt/crdt-sync-status-pill.tsx");
    expect(pill).toContain("useCrdtRoaming");
  });
});
