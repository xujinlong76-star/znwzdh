/**
 * AI 学习三件套合入口守卫（C 组第 4 簇）：只合入口，不删。
 *
 * 三件套 = AI伴学 Copilot + 概念图谱 + 抽认卡（原先三个顶层入口：
 * 侧栏「AI 伴学」tab、控制条「抽认卡」按钮、控制条「概念图谱」按钮）。
 * 现在只有一个「AI 学习」入口，打开 AI 学习中心弹窗，里面三个 tab。
 * 三个功能的逻辑、数据与 gating 原样保留：
 *   - 概念图谱 tab 只在 conceptAvailable（当前视频自带真实章节）时出现
 *   - 抽认卡无卡片时显示空态，不再靠「按钮不渲染」来隐藏
 * 脑图（章节结构视图）不在三件套内，保持不动。
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

const HUB = "src/components/video-ai-learning-dialog.tsx";
const DECK = "src/components/video-flashcard-deck.tsx";
const GRAPH = "src/components/video-concept-graph-dialog.tsx";
const COPILOT = "src/components/video-assistant-copilot.tsx";
const CONTROL_BAR = "src/components/video-player-control-bar.tsx";
const SIDE_PANEL = "src/components/video-player-side-panel.tsx";
const PAGE = "src/components/video-player-page.tsx";

describe("AI 学习三件套：只合入口，不删", () => {
  it("控制条只有一个 AI 学习入口 opener", () => {
    const src = overlaySource(CONTROL_BAR);
    expect(src).toContain("aiLearning: () => void");
    expect(src).toContain("onClick={openers.aiLearning}");
    expect(src).toContain("AI 学习");
    expect(src).not.toContain("openers.flashcards");
    expect(src).not.toContain("openers.conceptGraph");
    expect(src).not.toContain("抽认卡 (");
    // 概念图谱按钮已删（「概念图谱」四字只许出现在注释里交代合并去向）
    expect(src).not.toContain("<span>概念图谱</span>");
  });

  it("播放器页只传一个 aiLearning opener，只挂一个 AI 学习中心", () => {
    const src = overlaySource(PAGE);
    expect(src).toContain("aiLearning: () => setShowAiLearningDialog(true)");
    expect(src).toContain("VideoAiLearningDialog");
    expect(src).not.toContain("VideoFlashcardDeck");
    expect(src).not.toContain("VideoConceptGraphDialog");
    expect(src).not.toContain("showFlashcardsDialog");
    expect(src).not.toContain("showConceptGraphDialog");
  });

  it("AI 学习中心有三个 tab：AI伴学 / 概念图谱 / 抽认卡", () => {
    const src = overlaySource(HUB);
    expect(src).toContain('role="tablist"');
    expect(src).toContain("VideoAssistantCopilot");
    expect(src).toContain("VideoConceptGraphPanel");
    expect(src).toContain("VideoFlashcardPanel");
    expect(src).toContain("AI伴学");
    expect(src).toContain("概念图谱");
    expect(src).toContain("抽认卡");
  });

  it("概念图谱 tab 保留原 gating（仅真实章节）", () => {
    const src = overlaySource(HUB);
    expect(src).toContain("conceptAvailable");
    expect(src).toContain("{conceptAvailable && tabButton('concept', '概念图谱')}");
    const page = overlaySource(PAGE);
    expect(page).toContain("conceptAvailable={hasRealChapters}");
  });

  it("抽认卡与概念图谱已抽成面板：逻辑保留，独立 Dialog 外壳已去", () => {
    const deck = overlaySource(DECK);
    expect(deck).toContain("export function VideoFlashcardPanel");
    expect(deck).not.toContain("VideoFlashcardDeck");
    expect(deck).not.toContain("<Dialog");
    expect(deck).toContain("calculateNextSM2Schedule");
    const graph = overlaySource(GRAPH);
    expect(graph).toContain("export function VideoConceptGraphPanel");
    expect(graph).not.toContain("VideoConceptGraphDialog");
    expect(graph).not.toContain("<Dialog");
    expect(graph).toContain("findShortestLearningPath");
    expect(graph).toContain("buildConceptGraphFromVideos");
  });

  it("三个功能文件一个都没删，侧栏 AI伴学 tab 已并入中心", () => {
    for (const rel of [HUB, DECK, GRAPH, COPILOT]) {
      expect(overlayExists(rel)).toBe(true);
    }
    const sidePanel = overlaySource(SIDE_PANEL);
    expect(sidePanel).not.toContain("'copilot'");
    expect(sidePanel).not.toContain("VideoAssistantCopilot");
    // AI 伴学 tab 按钮已删（「AI 伴学」四字只许出现在文件头注释里交代合并去向）
    expect(sidePanel).not.toMatch(/>\s*AI 伴学\s*</);
  });

  it("脑图不在三件套内，保持不动", () => {
    const sidePanel = overlaySource(SIDE_PANEL);
    expect(sidePanel).toContain("VideoMindmapView");
    expect(sidePanel).toContain("activeTab === 'mindmap'");
  });
});
