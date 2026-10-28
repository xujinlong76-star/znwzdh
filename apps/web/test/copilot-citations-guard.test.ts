/**
 * AI-1 前端接线守卫：中枢返回的 citations 必须真的被渲染出来，且不能绕过 safeHref。
 *
 * 对应后端行为见 apps/api/test/copilot-rag.test.ts。这里只锁「接线」：
 *   - 响应里的 citations 被写进消息并渲染成「参考来源」；
 *   - 没有引用时不渲染空壳；
 *   - 引用链接仍过 safeHref（服务端已校验候选集，前端是第二道 XSS 闸）；
 *   - 中枢侧确实用全库混合检索替代了静态 40/25 切片。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));

function repoRoot(): string {
  const candidates = [resolve(HERE, "..", "..", ".."), resolve(HERE, "..", "..")];
  const hit = candidates.find((p) => existsSync(join(p, "apps", "api", "src", "routes", "copilot.ts")));
  if (!hit) throw new Error("无法定位仓库根目录（候选：" + candidates.join(" | ") + "）");
  return hit;
}

const ROOT = repoRoot();
const drawer = readFileSync(join(ROOT, "apps/web-overlay/src/components/ai/ai-copilot-drawer.tsx"), "utf8");
const route = readFileSync(join(ROOT, "apps/api/src/routes/copilot.ts"), "utf8");

function blockAround(src: string, marker: string, size = 1400): string {
  const at = src.indexOf(marker);
  expect(at, `找不到锚点：${marker}`).toBeGreaterThanOrEqual(0);
  return src.slice(at, at + size);
}

describe("抽屉：citations 进入消息模型并渲染", () => {
  it("消息类型声明 citations，ok 分支把中枢返回值写进去", () => {
    expect(drawer).toMatch(/citations\?: CopilotCitation\[\]/);
    expect(drawer).toMatch(/citations:\s*res\.citations && res\.citations\.length > 0 \? res\.citations : undefined/);
  });

  it("参考来源只在有引用时渲染，且逐条展示 title/description", () => {
    expect(drawer).toMatch(/m\.role === 'assistant' && m\.citations && m\.citations\.length > 0 &&/);
    const block = blockAround(drawer, 'aria-label="参考来源"', 2600);
    expect(block).toMatch(/m\.citations\.map\(\(citation, index\)/);
    expect(block).toMatch(/citation\.title/);
    expect(block).toMatch(/citation\.description/);
  });

  it("引用点击上报只带 siteId + position + source：不夹问题原文、不冒充搜索通道", () => {
    const block = blockAround(drawer, 'aria-label="参考来源"', 2600);
    // 分母（meta.citations）在服务端，分子必须是这颗真实链接的点击，且带来源标记
    expect(block).toMatch(
      /hubSend\('\/api\/events', 'POST', \{[\s\S]*?kind: 'click'[\s\S]*?siteId: citation\.siteId[\s\S]*?position: index \+ 1[\s\S]*?source: 'copilot_citation'/,
    );
    // 带 query 会把用户提问原文写进 events；带 channel 会喂给搜索排序的 LinUCB 权重
    expect(block).not.toMatch(/\bquery:/);
    expect(block).not.toMatch(/\bchannel:/);
  });

  it("引用链接仍过 safeHref，不给中枢返回值开 XSS 后门", () => {
    const block = blockAround(drawer, 'aria-label="参考来源"');
    expect(block).toMatch(/safeHref\(citation\.url, ''\)/);
    expect(block).toMatch(/rel="noopener noreferrer"/);
  });

  it("降级文案与实现一致：站内混合检索，而不是关键词匹配", () => {
    expect(drawer).not.toMatch(/站内关键词匹配/);
    expect(drawer).toMatch(/站内混合检索/);
  });
});

describe("中枢：全库检索替代静态切片", () => {
  it("按提问调用 SearchEngine 召回候选，不再固定取 40/25 条", () => {
    const body = blockAround(route, "export async function retrieveCopilotCandidates", 1200);
    expect(body).toMatch(/ctx\.search\.search\(/);
    expect(body).toMatch(/limit:\s*COPILOT_RETRIEVAL_LIMIT/);
    expect(body).toMatch(/statuses:\s*\["active"\]/);
    expect(route).not.toMatch(/listSites\(\{\s*limit:\s*40/);
    expect(route).not.toMatch(/slice\(0,\s*25\)/);
  });

  it("候选同时供提示词与本地降级使用（一份召回，两种出口）", () => {
    expect(route).toMatch(/const fallbackSites = retrieval\.sites\.slice\(0, COPILOT_FALLBACK_LIMIT\)/);
    expect(route).toMatch(/const candidates = retrieval\.citations/);
  });

  it("系统提示词不再冒充固定模型，且明确「只能推荐候选」", () => {
    expect(route).not.toMatch(/你是 Agnes 3\.0 Flash/);
    const prompt = blockAround(route, "const systemPrompt = `", 1600);
    expect(prompt).toMatch(/山羊胡/);
    expect(prompt).toMatch(/候选站点/);
    expect(prompt).toMatch(/不得编造/);
  });

  it("模型回复先过 groundCopilotReply，响应带 citations 与 retrieval", () => {
    expect(route).toMatch(/groundCopilotReply\(res\.content, candidates\)/);
    expect(route).toMatch(/citations:\s*grounded\.citations/);
    expect(route).toMatch(/unverifiedLinks:\s*grounded\.unverifiedLinks/);
    // 降级路径也必须给结构化引用
    expect(route).toMatch(/const fallbackCitations = fallbackSites\.map\(citationOfSite\)/);
    expect(route).toMatch(/citations:\s*fallbackCitations/);
  });
});
