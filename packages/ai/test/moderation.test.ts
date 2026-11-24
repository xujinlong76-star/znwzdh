import { describe, expect, it } from "vitest";
import { decideSiteModerationVerdict, moderateSiteWithAi, type LlmProvider } from "../src/index.ts";

const provider = { name: "test-provider", model: "test-model" } as LlmProvider;
const modelOutput = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  confidence: 0.98,
  qualityScore: 92,
  category: "AI工具",
  tags: ["assistant"],
  risks: ["none"],
  reasons: ["页面内容清晰"],
  evidence: ["标题与描述一致"],
  ...overrides,
});

describe("网站 AI 审核引擎", () => {
  it("只有无风险、高置信度且达到质量阈值才自动通过", () => {
    expect(decideSiteModerationVerdict({ confidence: 0.98, qualityScore: 92, risks: ["none"] }, { minQualityScore: 80 })).toBe("auto_approve");
    expect(decideSiteModerationVerdict({ confidence: 0.99, qualityScore: 79, risks: ["none"] }, { minQualityScore: 80 })).toBe("manual_review");
    expect(decideSiteModerationVerdict({ confidence: 0.99, qualityScore: 99, risks: ["spam"] })).toBe("manual_review");
  });

  it("严重风险达到拒绝阈值时拒绝，否则转人工复核", () => {
    expect(decideSiteModerationVerdict({ confidence: 0.98, qualityScore: 20, risks: ["phishing"] }, { rejectConfidence: 0.97 })).toBe("reject");
    expect(decideSiteModerationVerdict({ confidence: 0.90, qualityScore: 20, risks: ["malware"] }, { rejectConfidence: 0.97 })).toBe("manual_review");
  });

  it("支持注入模型 completion，验证输入裁剪和结构化输出，不发起真实网络请求", async () => {
    let submitted: Record<string, unknown> | null = null;
    const result = await moderateSiteWithAi(provider, {
      url: "https://example.com/",
      title: "  Example  ",
      description: "Useful directory",
      contentExcerpt: "x".repeat(800),
      declaredCategory: "AI工具",
      knownCategories: ["AI工具", "办公效率"],
      evidence: { provenance: "unit-test", warnings: [] },
    }, { maxExcerptChars: 300, minQualityScore: 75 }, {
      complete: async (_provider, request) => {
        submitted = JSON.parse(request.messages[1]?.content ?? "{}") as Record<string, unknown>;
        return { content: modelOutput(), model: "mock-moderation-v1" };
      },
    });

    expect(submitted?.title).toBe("Example");
    expect(String(submitted?.contentExcerpt)).toHaveLength(300);
    expect(result.model).toBe("mock-moderation-v1");
    expect(result.verdict).toBe("auto_approve");
    expect(result.policyVersion).toBe("site-moderation-v1");
  });

  it("未知风险类别必须失败关闭，不能被静默当成 none", async () => {
    await expect(moderateSiteWithAi(provider, { url: "https://example.com/" }, {}, {
      complete: async () => ({ content: modelOutput({ risks: ["credential_theft"] }), model: "mock" }),
    })).rejects.toThrow(/未知风险类别/);
  });

  it("模型发明的类别不进入目录分类，回退为 null", async () => {
    const result = await moderateSiteWithAi(provider, { url: "https://example.com/", knownCategories: ["AI工具"] }, {}, {
      complete: async () => ({ content: modelOutput({ category: "游戏娱乐" }), model: "mock" }),
    });
    expect(result.category).toBeNull();
  });
  it("模型 JSON 无效时失败关闭，不返回自动通过结论", async () => {
    await expect(moderateSiteWithAi(provider, { url: "https://example.com/" }, {}, {
      complete: async () => ({ content: "not-json", model: "mock" }),
    })).rejects.toThrow(/JSON/);
  });
});
