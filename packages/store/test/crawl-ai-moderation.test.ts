import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import {
  listCrawlAiModerationDecisions,
  recordCrawlAiModerationDecision,
} from "../src/repository/crawl-ai-moderation.ts";

describe("不可变采集 AI 审核历史", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });
  beforeEach(async () => {
    await repo.run("DELETE FROM crawl_ai_moderation_decisions");
  });
  afterAll(async () => { await db.close(); });

  it("追加多次审核结果并按时间倒序读取", async () => {
    await recordCrawlAiModerationDecision(repo, {
      candidateId: "candidate-1", canonicalUrl: "https://example.com/",
      mode: "shadow", status: "completed", verdict: "manual_review",
      confidence: 0.82, qualityScore: 75, risks: ["none"],
      reasons: ["证据不足"], evidence: ["网页正文摘要"], model: "model-a",
      policyVersion: "site-moderation-v1", createdAt: 100,
    });
    await recordCrawlAiModerationDecision(repo, {
      candidateId: "candidate-1", canonicalUrl: "https://example.com/",
      mode: "shadow", status: "completed", verdict: "auto_approve",
      confidence: 0.97, qualityScore: 91, risks: ["none"],
      reasons: ["内容质量较高"], model: "model-b", createdAt: 200,
    });
    const rows = await listCrawlAiModerationDecisions(repo, { candidateId: "candidate-1" });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.createdAt).toBe(200);
    expect(rows[0]?.model).toBe("model-b");
    expect(rows[1]?.verdict).toBe("manual_review");
  });

  it("拒绝超范围置信度与质量分", async () => {
    await expect(recordCrawlAiModerationDecision(repo, {
      candidateId: "candidate-1", canonicalUrl: "https://example.com/",
      mode: "shadow", status: "completed", confidence: 1.2,
    })).rejects.toThrow("confidence");
    await expect(recordCrawlAiModerationDecision(repo, {
      candidateId: "candidate-1", canonicalUrl: "https://example.com/",
      mode: "shadow", status: "completed", qualityScore: 101,
    })).rejects.toThrow("qualityScore");
  });
});
