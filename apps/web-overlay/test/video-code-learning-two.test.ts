/**
 * 代码学习六合二守卫（C 组第 3 簇）。
 *
 * 核对现状的结果：B 组已删 debugger-stepper-pane、sandbox-runner-pane、
 * wasm-terminal-pane、live-test-pane 四个 pane，剩余的代码学习组件正好是
 * 两个——video-code-sandbox（演练沙箱）与 video-code-diff-viewer（代码演进
 * 单步调试器）。本簇无件可删：合并目标已经达成，这里把该状态钉死——
 * 四个 pane 不许回来、不许冒出第三个代码学习 pane、lib 一律保留、
 * 两个入口（控制条沙箱开关、侧栏「演进」tab）保持接线。
 * （check-dead-modules.mjs 基线里四条 keep 记录指的就是本守卫测试。）
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const OVERLAY = resolve(HERE, "..");
const SRC = resolve(OVERLAY, "src");

function overlaySource(rel: string): string {
  const p = resolve(OVERLAY, rel);
  if (!existsSync(p)) throw new Error("无法定位 overlay 文件 " + rel);
  return readFileSync(p, "utf8").replace(/\r\n/g, "\n");
}

function overlayExists(rel: string): boolean {
  return existsSync(resolve(OVERLAY, rel));
}

/** 四个已删 pane：一个都不许回来 */
const DELETED_PANES = [
  "src/components/video-debugger-stepper-pane.tsx",
  "src/components/video-sandbox-runner-pane.tsx",
  "src/components/video-wasm-terminal-pane.tsx",
  "src/components/video-live-test-pane.tsx",
];

/** 六合二保留的两个 */
const KEPT_COMPONENTS = [
  "src/components/video-code-sandbox.tsx",
  "src/components/video-code-diff-viewer.tsx",
];

/** 一律保留的 lib（有的只有测试引用，也勿当死代码删除） */
const KEPT_LIBS = [
  "src/lib/video-code-diff.ts",
  "src/lib/video-code-sandbox-runtime.ts",
  "src/lib/video-breakpoint-debugger.ts",
  "src/lib/video-live-test-runner.ts",
  "src/lib/video-opaque-sandbox.ts",
];

describe("代码学习六合二：只剩沙箱 + 调试器", () => {
  it("四个已删 pane 的文件不存在", () => {
    for (const rel of DELETED_PANES) {
      expect(overlayExists(rel)).toBe(false);
    }
  });

  it("components 目录里没有第三个代码学习 pane", () => {
    const files = readdirSync(resolve(SRC, "components"));
    const codePanes = files.filter((f) => /video-.*-pane\.tsx$/.test(f));
    expect(codePanes).toEqual([]);
  });

  it("保留的两个组件都在，且互相不重复对方的职责", () => {
    for (const rel of KEPT_COMPONENTS) {
      expect(overlayExists(rel)).toBe(true);
    }
    const sandbox = overlaySource("src/components/video-code-sandbox.tsx");
    expect(sandbox).toContain("export function VideoCodeSandbox");
    expect(sandbox).toContain("SANDBOX_LOG");
    const diff = overlaySource("src/components/video-code-diff-viewer.tsx");
    expect(diff).toContain("export function VideoCodeDiffViewer");
    expect(diff).toContain("computeUnifiedDiff");
    // 调试器只做 diff 走查，不内嵌沙箱运行器；沙箱只做运行，不做 diff
    expect(diff).not.toContain("VideoCodeSandbox");
    expect(sandbox).not.toContain("computeUnifiedDiff");
  });

  it("lib 一律保留", () => {
    for (const rel of KEPT_LIBS) {
      expect(overlayExists(rel)).toBe(true);
    }
  });

  it("两个入口都接线：控制条沙箱开关 + 侧栏「演进」tab", () => {
    const controlBar = overlaySource("src/components/video-player-control-bar.tsx");
    expect(controlBar).toContain("演练沙箱");
    const page = overlaySource("src/components/video-player-page.tsx");
    expect(page).toContain("VideoCodeSandbox");
    expect(page).toContain("showSandbox");
    const sidePanel = overlaySource("src/components/video-player-side-panel.tsx");
    expect(sidePanel).toContain("VideoCodeDiffViewer");
    expect(sidePanel).toContain("activeTab === 'diff'");
  });

  it("任何源码不再引用已删的四个 pane", () => {
    const haystack = [
      overlaySource("src/components/video-player-page.tsx"),
      overlaySource("src/components/video-player-side-panel.tsx"),
      overlaySource("src/components/video-player-control-bar.tsx"),
      overlaySource("src/components/video-code-sandbox.tsx"),
      overlaySource("src/components/video-code-diff-viewer.tsx"),
    ].join("\n");
    for (const name of [
      "debugger-stepper-pane",
      "sandbox-runner-pane",
      "wasm-terminal-pane",
      "live-test-pane",
    ]) {
      expect(haystack).not.toContain(name);
    }
  });
});
