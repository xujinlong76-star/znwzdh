/**
 * AI-2 入口契约守卫。
 *
 * 已实锤的两起事故：
 *   1. GlobalAiGateway 首次唤起时重放的是无负载 `new Event('open-ai-copilot')`，
 *      Spotlight 带来的问题被丢掉——抽屉开了，输入框空着；
 *   2. Spotlight 的 AI 模式按 `{ prompt }` 派发，抽屉只读 `{ query }`，问题静默消失。
 *
 * 这里锁四件事：
 *   - 负载归一化是唯一入口（非法值不得进入 handleSend）；
 *   - 网关把 detail 寄存而不是无负载重放；
 *   - 抽屉挂载后取走寄存意图、用最新发送实现，忙碌时把问题放进输入框；
 *   - Spotlight 三处派发统一走 openCopilot，AI 模式载荷键名是 query。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COPILOT_OPEN_QUERY_MAX,
  isCopilotDrawerReady,
  markCopilotDrawerReady,
  normalizeAiStudioOpenDetail,
  normalizeCopilotOpenDetail,
  stashCopilotOpen,
  takeStashedCopilotOpen,
} from "@/lib/ai-entry";

const HERE = dirname(fileURLToPath(import.meta.url));

function repoRoot(): string {
  const candidates = [resolve(HERE, "..", "..", ".."), resolve(HERE, "..", "..")];
  const hit = candidates.find((p) => existsSync(join(p, "apps", "api", "src", "routes", "copilot.ts")));
  if (!hit) throw new Error("无法定位仓库根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = repoRoot();
const gateway = readFileSync(join(ROOT, "apps/web-overlay/src/components/ai/global-ai-gateway.tsx"), "utf8");
const drawer = readFileSync(join(ROOT, "apps/web-overlay/src/components/ai/ai-copilot-drawer.tsx"), "utf8");
const spotlight = readFileSync(join(ROOT, "apps/web-overlay/src/components/search/spotlight-modal.tsx"), "utf8");

function blockAround(src: string, marker: string, size = 600): string {
  const at = src.indexOf(marker);
  expect(at, `找不到锚点：${marker}`).toBeGreaterThanOrEqual(0);
  return src.slice(at, at + size);
}

describe("normalizeCopilotOpenDetail：非法负载不得漏进 handleSend", () => {
  it("非对象一律回空对象", () => {
    expect(normalizeCopilotOpenDetail(undefined)).toEqual({});
    expect(normalizeCopilotOpenDetail(null)).toEqual({});
    expect(normalizeCopilotOpenDetail("query=1")).toEqual({});
    expect(normalizeCopilotOpenDetail(42)).toEqual({});
  });

  it("query 去空白、拒绝非字符串与空串", () => {
    expect(normalizeCopilotOpenDetail({ query: "  帮我找前端工具  " })).toEqual({ query: "帮我找前端工具" });
    expect(normalizeCopilotOpenDetail({ query: 123 })).toEqual({});
    expect(normalizeCopilotOpenDetail({ query: "   " })).toEqual({});
  });

  it("超长 query 截断到与中枢 chatSchema 相同的上限", () => {
    const long = "问".repeat(COPILOT_OPEN_QUERY_MAX + 500);
    expect(normalizeCopilotOpenDetail({ query: long }).query).toHaveLength(COPILOT_OPEN_QUERY_MAX);
  });

  it("source 只认白名单，未知来源丢弃而不是原样透传", () => {
    expect(normalizeCopilotOpenDetail({ source: "spotlight" })).toEqual({ source: "spotlight" });
    expect(normalizeCopilotOpenDetail({ source: "keyboard" })).toEqual({ source: "keyboard" });
    expect(normalizeCopilotOpenDetail({ source: "injected" })).toEqual({});
  });

  it("工坊负载只认字符串 prompt", () => {
    expect(normalizeAiStudioOpenDetail({ prompt: "做个插件" })).toEqual({ prompt: "做个插件" });
    expect(normalizeAiStudioOpenDetail({ prompt: 1 })).toEqual({});
    expect(normalizeAiStudioOpenDetail(null)).toEqual({});
  });
});

describe("寄存槽：首屏网关与抽屉之间的交接", () => {
  it("后到的无问题意图不覆盖先到的问题", () => {
    stashCopilotOpen({ query: "第一次带来的问题", source: "spotlight" });
    stashCopilotOpen({ source: "keyboard" });
    expect(takeStashedCopilotOpen()).toEqual({ query: "第一次带来的问题", source: "keyboard" });
  });

  it("取走即清空，不会重复重放", () => {
    stashCopilotOpen({ query: "只该发一次" });
    expect(takeStashedCopilotOpen()).toEqual({ query: "只该发一次" });
    expect(takeStashedCopilotOpen()).toBeNull();
  });

  it("抽屉登记 ready 后保持为真", () => {
    markCopilotDrawerReady();
    expect(isCopilotDrawerReady()).toBe(true);
  });
});

describe("网关：首次唤起原样保住 detail", () => {
  it("不再用无负载的 new Event 重放", () => {
    expect(gateway).not.toMatch(/new Event\(\s*['"]open-ai-copilot/);
    expect(gateway).not.toMatch(/dispatchEvent\(/);
  });

  it("把归一化后的 detail 寄存给抽屉，而不是扔给空气", () => {
    expect(gateway).toMatch(/normalizeCopilotOpenDetail\(\(e as CustomEvent\)\.detail\)/);
    expect(gateway).toMatch(/stashCopilotOpen\(detail\)/);
    // 抽屉已在监听时网关不再插手，避免同一操作被处理两次
    expect(gateway).toMatch(/if \(isCopilotDrawerReady\(\)\) return/);
  });

  it("键盘唤起也带来源标记", () => {
    expect(gateway).toMatch(/open\(\{ source: 'keyboard' \}\)/);
  });

  it("监听常量事件，不再手写事件名字符串", () => {
    expect(gateway).toMatch(/window\.addEventListener\(COPILOT_OPEN_EVENT, onEvent\)/);
  });
});

describe("抽屉：接收端走契约", () => {
  it("监听常量事件而非手写字符串", () => {
    expect(drawer).toMatch(/window\.addEventListener\(COPILOT_OPEN_EVENT, handleOpen\)/);
    expect(drawer).not.toMatch(/addEventListener\('open-ai-copilot'/);
  });

  it("挂载后登记 ready 并取走网关寄存的意图", () => {
    expect(drawer).toMatch(/markCopilotDrawerReady\(\)/);
    expect(drawer).toMatch(/const stashed = takeStashedCopilotOpen\(\)[\s\S]{0,160}if \(stashed\) applyOpen\(stashed\)/);
  });

  it("事件处理调用最新发送实现，而不是首帧 stale closure", () => {
    expect(drawer).toMatch(/sendRef\.current = handleSend/);
    expect(drawer).toMatch(/void sendRef\.current\?\.\(detail\.query\)/);
  });

  it("忙碌时不再静默丢弃：问题放进输入框并说明原因", () => {
    const block = blockAround(drawer, "if (loadingRef.current)", 500);
    expect(block).toMatch(/setInput\(detail\.query\)/);
    expect(block).toMatch(/setStatusMessage\(/);
    expect(block).toMatch(/return/);
  });
});

describe("降级说明只出现一次", () => {
  it("剥掉中枢正文里的同义首段，交给横幅统一承载", () => {
    expect(drawer).toMatch(/splitDegradedPreamble\(m\.content\)/);
    expect(drawer).toMatch(/const notice = degradedNotice\(m\) \?\? shown\.notice/);
    expect(drawer).toMatch(/renderMessageContent\(shown\.body\)/);
  });

  it("前缀不匹配时不剥离正文（宁可重复也不吞内容）", () => {
    expect(drawer).toMatch(/DEGRADED_PREAMBLE_PREFIXES\.some\(\(prefix\) => first\.startsWith\(prefix\)\)/);
  });
});

describe("Spotlight：三处 AI 入口统一走契约", () => {
  it("不再手写事件名（统一从 ai-entry 派发）", () => {
    expect(spotlight).not.toMatch(/CustomEvent\(\s*['"]open-ai-copilot/);
    expect(spotlight).toMatch(/import \{ openCopilot \} from '@\/lib\/ai-entry'/);
  });

  it("AI 模式载荷键名是 query，不是抽屉读不到的 prompt", () => {
    expect(spotlight).toMatch(/openCopilot\(\{ query: cleanAiPrompt, source: 'spotlight' \}\)/);
    expect(spotlight).not.toMatch(/detail: \{ prompt: cleanAiPrompt \}/);
  });

  it("命令面板与工具格入口也带来源标记", () => {
    const bare = spotlight.match(/openCopilot\(\{ source: 'spotlight' \}\)/g) ?? [];
    expect(bare.length).toBeGreaterThanOrEqual(2);
  });
});
