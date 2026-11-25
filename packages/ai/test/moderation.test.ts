import { afterAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  decideSiteModerationVerdict,
  evaluateSiteModerationGoldSet,
  moderateSiteWithAi,
  type SiteModerationGoldCase,
  type SiteModerationInput,
} from "../src/moderation.ts";
import type { ChatMessage, LlmProvider } from "../src/llm.ts";

const provider: LlmProvider = { baseUrl: "https://api.example.com/v1", model: "stub-model" };

const input: SiteModerationInput = {
  url: "https://example.com/tool",
  title: "示例工具",
  description: "一个可公开收录的效率工具",
  contentExcerpt: "示例工具提供在线转换能力。",
  declaredCategory: "工具",
  knownCategories: ["工具", "资讯"],
};

function modelReply(payload: Record<string, unknown>): string {
  return JSON.stringify({
    confidence: 0.96,
    qualityScore: 92,
    category: "工具",
    tags: ["效率"],
    risks: ["none"],
    reasons: ["内容可验证"],
    evidence: ["标题：示例工具"],
    ...payload,
  });
}

describe("evaluateSiteModerationGoldSet", () => {
  it("按混淆矩阵计算精确率/召回率/覆盖率与风险检出指标", () => {
    const cases: SiteModerationGoldCase[] = [
      { id: "a", expected: "approve", actual: "approve", expectedRisk: false, actualRisk: false },
      { id: "b", expected: "approve", actual: "reject", expectedRisk: false, actualRisk: true },
      { id: "c", expected: "reject", actual: "reject", expectedRisk: true, actualRisk: true },
      { id: "d", expected: "reject", actual: "review", expectedRisk: true, actualRisk: false },
      { id: "e", expected: "review", actual: "review" },
    ];
    const metrics = evaluateSiteModerationGoldSet(cases);

    expect(metrics.sampleSize).toBe(5);
    expect(metrics.exactMatchRate).toBeCloseTo(3 / 5);
    // review 预测属于 abstention，不计入覆盖率
    expect(metrics.coverage).toBeCloseTo(3 / 5);
    expect(metrics.confusionMatrix.approve).toEqual({ approve: 1, reject: 1, review: 0 });
    expect(metrics.confusionMatrix.reject).toEqual({ approve: 0, reject: 1, review: 1 });
    expect(metrics.confusionMatrix.review).toEqual({ approve: 0, reject: 0, review: 1 });

    expect(metrics.perLabel.approve).toMatchObject({ precision: 1, recall: 0.5, support: 2 });
    expect(metrics.perLabel.reject).toMatchObject({ precision: 0.5, recall: 0.5, support: 2 });
    expect(metrics.perLabel.review).toMatchObject({ precision: 0.5, recall: 1, support: 1 });
    expect(metrics.perLabel.approve.f1).toBeCloseTo(2 / 3);
    expect(metrics.perLabel.reject.f1).toBeCloseTo(0.5);

    expect(metrics.riskDetection).toEqual({
      precision: 0.5,
      recall: 0.5,
      falseNegatives: 1,
      falsePositives: 1,
      support: 4,
    });
  });

  it("空样本返回空指标而不是 0，避免把「没有样本」误读成「全错」", () => {
    const metrics = evaluateSiteModerationGoldSet([]);
    expect(metrics.sampleSize).toBe(0);
    expect(metrics.exactMatchRate).toBeNull();
    expect(metrics.coverage).toBeNull();
    expect(metrics.perLabel.approve).toEqual({ precision: null, recall: null, f1: null, support: 0 });
    expect(metrics.riskDetection.precision).toBeNull();
    expect(metrics.riskDetection.recall).toBeNull();
  });

  it("拒绝重复/空 ID、未知标签和半对风险字段", () => {
    const base: SiteModerationGoldCase = { id: "x", expected: "approve", actual: "approve" };
    expect(() => evaluateSiteModerationGoldSet([base, { ...base, id: " " }])).toThrow("金标样本 ID 不能为空且必须唯一");
    expect(() => evaluateSiteModerationGoldSet([base, { ...base }])).toThrow("金标样本 ID 不能为空且必须唯一");
    expect(() => evaluateSiteModerationGoldSet([{ ...base, expected: "pass" as never }])).toThrow("金标标签无效");
    expect(() => evaluateSiteModerationGoldSet([{ ...base, expectedRisk: true }])).toThrow(
      "风险金标与模型风险结果必须成对提供",
    );
  });
});

describe("decideSiteModerationVerdict", () => {
  it("自动通过要求无风险 + 高置信度 + 质量分达标", () => {
    expect(decideSiteModerationVerdict({ confidence: 0.96, qualityScore: 92, risks: ["none"] })).toBe("auto_approve");
    expect(decideSiteModerationVerdict({ confidence: 0.9, qualityScore: 92, risks: ["none"] })).toBe("manual_review");
    expect(decideSiteModerationVerdict({ confidence: 0.96, qualityScore: 60, risks: ["none"] })).toBe("manual_review");
  });

  it("关键风险按拒绝阈值判定，非关键风险只进人工复核", () => {
    expect(decideSiteModerationVerdict({ confidence: 0.98, qualityScore: 10, risks: ["phishing"] })).toBe("reject");
    expect(decideSiteModerationVerdict({ confidence: 0.9, qualityScore: 10, risks: ["phishing"] })).toBe("manual_review");
    expect(decideSiteModerationVerdict({ confidence: 0.99, qualityScore: 95, risks: ["spam"] })).toBe("manual_review");
  });

  it("requireHttps 生效时 http 站点不能自动通过", () => {
    expect(
      decideSiteModerationVerdict(
        { confidence: 0.99, qualityScore: 95, risks: ["none"] },
        { requireHttps: true },
        "http://example.com/",
      ),
    ).toBe("manual_review");
  });
});

describe("moderateSiteWithAi", () => {
  it("正常调用：解析模型 JSON、过滤类目白名单并落到 auto_approve", async () => {
    const result = await moderateSiteWithAi(provider, input, {}, {
      complete: async () => ({ content: modelReply({}), model: "stub-model" }),
    });
    expect(result.verdict).toBe("auto_approve");
    expect(result.category).toBe("工具");
    expect(result.risks).toEqual(["none"]);
    expect(result.model).toBe("stub-model");
    expect(result.policyVersion).toBe("site-moderation-v1");
  });

  it("模型返回白名单外类目时置 null，不发明类目", async () => {
    const result = await moderateSiteWithAi(provider, input, {}, {
      complete: async () => ({ content: modelReply({ category: "金融理财" }), model: "stub-model" }),
    });
    expect(result.category).toBeNull();
  });

  it("高风险高置信度判 reject", async () => {
    const result = await moderateSiteWithAi(provider, input, {}, {
      complete: async () => ({
        content: modelReply({ confidence: 0.98, qualityScore: 20, risks: ["phishing"] }),
        model: "stub-model",
      }),
    });
    expect(result.verdict).toBe("reject");
  });

  it("按 maxExcerptChars 截断正文后再送模型", async () => {
    let captured: ChatMessage[] | null = null;
    await moderateSiteWithAi(
      provider,
      { ...input, contentExcerpt: "长".repeat(900) },
      { maxExcerptChars: 200 },
      {
        complete: async (_p, request) => {
          captured = request.messages;
          return { content: modelReply({}), model: "stub-model" };
        },
      },
    );
    const userMessage = captured?.[1];
    expect(typeof userMessage?.content).toBe("string");
    const sent = JSON.parse(String(userMessage?.content)) as { contentExcerpt: string };
    expect(sent.contentExcerpt).toHaveLength(200);
  });

  it("模型输出不合规直接抛错，绝不降级成通过", async () => {
    await expect(
      moderateSiteWithAi(provider, input, {}, {
        complete: async () => ({ content: "这不是 JSON", model: "stub-model" }),
      }),
    ).rejects.toThrow("AI 审核模型返回的 JSON 无法解析");

    await expect(
      moderateSiteWithAi(provider, input, {}, {
        complete: async () => ({ content: modelReply({ risks: ["unknown_risk"] }), model: "stub-model" }),
      }),
    ).rejects.toThrow("AI 审核模型返回了未知风险类别");
  });

  it("非法策略在发请求前就失败", async () => {
    const complete = vi.fn(async () => ({ content: modelReply({}), model: "stub-model" }));
    await expect(
      moderateSiteWithAi(provider, input, { autoApproveConfidence: 0.2 }, { complete }),
    ).rejects.toThrow("AI 审核策略配置无效");
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("moderateSiteWithAi 默认链路（真实 chatCompletion + 本地假端点）", () => {
  const servers: Server[] = [];

  afterAll(async () => {
    await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  });

  async function startFakeLlm(content: string, model = "local-fake-model") {
    const captured: Array<{ url?: string; body?: string }> = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", chunk => { raw += String(chunk); });
      req.on("end", () => {
        captured.push({ url: req.url, body: raw });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          model,
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 },
        }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const { port } = server.address() as AddressInfo;
    return { baseUrl: `http://127.0.0.1:${port}/v1`, captured };
  }

  it("走完 HTTP 请求 → 响应解析 → 策略裁决全链路", async () => {
    const fake = await startFakeLlm(modelReply({}));
    const result = await moderateSiteWithAi(
      {
        baseUrl: fake.baseUrl,
        model: "local-fake-model",
        apiKey: "test-key",
        allowPrivateNetwork: true,
        timeoutMs: 5000,
      },
      input,
    );

    expect(result.verdict).toBe("auto_approve");
    expect(result.model).toBe("local-fake-model");
    expect(fake.captured).toHaveLength(1);
    expect(fake.captured[0]?.url).toContain("/chat/completions");
    const body = JSON.parse(String(fake.captured[0]?.body)) as {
      temperature: number;
      response_format?: { type: string };
      messages: ChatMessage[];
    };
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toHaveLength(2);
  });

  it("上游返回非 200 时抛错，不把失败当成人工复核", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "upstream down" } }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const { port } = server.address() as AddressInfo;

    await expect(
      moderateSiteWithAi(
        { baseUrl: `http://127.0.0.1:${port}/v1`, model: "local-fake-model", apiKey: "k", allowPrivateNetwork: true },
        input,
      ),
    ).rejects.toThrow();
  });
});
