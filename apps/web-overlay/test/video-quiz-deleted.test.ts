/**
 * 模板自测题删除守卫（C 组第 6 簇）。
 *
 * 删的是整条模板出题链：题目按章节标题套模板生成，没有真实题库——
 * 自测题对话框、模板出题 lib、以及把模板题转成闪卡的转换器
 * （模板题混进抽认卡等于把编造当记忆内容）。
 * 抽认卡本身保留：现在只从用户真实笔记派生。
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

const PAGE = "src/components/video-player-page.tsx";
const CONTROL_BAR = "src/components/video-player-control-bar.tsx";
const SPACED_REPETITION = "src/lib/video-spaced-repetition.ts";

describe("模板自测题已删除", () => {
  it("自测题对话框与模板出题 lib 的文件不存在", () => {
    expect(overlayExists("src/components/video-quiz-dialog.tsx")).toBe(false);
    expect(overlayExists("src/lib/video-quiz-generator.ts")).toBe(false);
  });

  it("播放器页与控制条不再有自测题的调用、状态与入口", () => {
    for (const rel of [PAGE, CONTROL_BAR]) {
      const src = overlaySource(rel);
      for (const name of [
        "VideoQuizDialog",
        "video-quiz-dialog",
        "video-quiz-generator",
        "generateVideoQuizzes",
        "quizQuestions",
        "showQuizDialog",
        "quizCount",
        "openers.quiz",
      ]) {
        expect(src).not.toContain(name);
      }
    }
    expect(overlaySource(CONTROL_BAR)).not.toContain("自测");
  });

  it("模板题不再转成闪卡：转换器已删，抽认卡只从用户笔记派生", () => {
    const lib = overlaySource(SPACED_REPETITION);
    expect(lib).not.toContain("generateFlashcardsFromQuizzes");
    expect(lib).not.toContain("video-quiz-generator");
    expect(lib).toContain("generateFlashcardsFromNotes");
    expect(lib).toContain("calculateNextSM2Schedule");
    const page = overlaySource(PAGE);
    expect(page).toContain("generateFlashcardsFromNotes(notesList)");
    expect(page).not.toContain("generateFlashcardsFromQuizzes");
  });
});
