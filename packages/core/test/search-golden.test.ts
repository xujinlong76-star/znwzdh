import { describe, expect, it } from "vitest";
import { toSearchEvalCase, validateSearchGoldenRecord } from "../src/search-golden.ts";

function record(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "navhub-search-golden-v1",
    sampleId: "q-0001",
    query: "脱敏后的真实查询",
    sourceType: "search_telemetry",
    sampledAt: "2026-11-20T10:00:00.000Z",
    snapshotAt: "2026-11-20T10:05:00.000Z",
    language: "zh-CN",
    intent: "task",
    privacyReviewed: true,
    queryRedacted: true,
    hits: [{ siteId: "site-a", rank: 1 }, { siteId: "site-b", rank: 2 }],
    judgments: [
      {
        siteId: "site-a",
        annotatorA: { annotatorId: "reviewer-a", status: "judged", grade: 3, evidenceUrl: "https://a.example/", reasonCode: "task_fit" },
        annotatorB: { annotatorId: "reviewer-b", status: "judged", grade: 3, evidenceUrl: "https://a.example/", reasonCode: "task_fit" },
      },
      {
        siteId: "site-b",
        annotatorA: { annotatorId: "reviewer-a", status: "judged", grade: 1, evidenceUrl: "https://b.example/", reasonCode: "partial_fit" },
        annotatorB: { annotatorId: "reviewer-b", status: "judged", grade: 3, evidenceUrl: "https://b.example/", reasonCode: "task_fit" },
        adjudication: { adjudicatorId: "reviewer-c", status: "judged", grade: 2, evidenceUrl: "https://b.example/", reasonCode: "adjudicated_fit" },
      },
    ],
    ...overrides,
  };
}

describe("search golden record validation", () => {
  it("requires real telemetry provenance, privacy review, two annotators and third-party arbitration", () => {
    const valid = validateSearchGoldenRecord(record());
    expect(valid.sampleId).toBe("q-0001");
    expect(toSearchEvalCase(valid)).toEqual({
      query: "q-0001",
      hits: ["site-a", "site-b"],
      relevance: { "site-a": 3, "site-b": 2 },
    });
  });

  it("does not turn unjudgeable candidates into zero relevance", () => {
    const value = record({
      judgments: [{
        siteId: "site-a",
        annotatorA: { annotatorId: "reviewer-a", status: "unjudgeable", evidenceUrl: "https://a.example/", reasonCode: "unreachable" },
        annotatorB: { annotatorId: "reviewer-b", status: "unjudgeable", evidenceUrl: "https://a.example/", reasonCode: "unreachable" },
      }, {
        siteId: "site-b",
        annotatorA: { annotatorId: "reviewer-a", status: "judged", grade: 1, evidenceUrl: "https://b.example/", reasonCode: "partial_fit" },
        annotatorB: { annotatorId: "reviewer-b", status: "judged", grade: 1, evidenceUrl: "https://b.example/", reasonCode: "partial_fit" },
      }],
    });
    expect(toSearchEvalCase(validateSearchGoldenRecord(value)).relevance).toEqual({ "site-b": 1 });
  });

  it("rejects same annotator, missing arbitration, incomplete coverage and unreviewed privacy", () => {
    const sameAnnotator = record();
    (sameAnnotator.judgments[0] as any).annotatorB.annotatorId = "reviewer-a";
    expect(() => validateSearchGoldenRecord(sameAnnotator)).toThrow("必须不同");

    const noArbitration = record();
    delete (noArbitration.judgments[1] as any).adjudication;
    expect(() => validateSearchGoldenRecord(noArbitration)).toThrow("必须仲裁");

    const incomplete = record();
    incomplete.judgments.pop();
    expect(() => validateSearchGoldenRecord(incomplete)).toThrow("每个命中站点");

    expect(() => validateSearchGoldenRecord(record({ privacyReviewed: false }))).toThrow("隐私审查");
  });

  it("rejects non-telemetry, invalid evidence URLs and invalid relevance grades", () => {
    expect(() => validateSearchGoldenRecord(record({ sourceType: "synthetic" }))).toThrow("真实搜索遥测");
    const badEvidence = record();
    (badEvidence.judgments[0] as any).annotatorA.evidenceUrl = "file:///etc/passwd";
    expect(() => validateSearchGoldenRecord(badEvidence)).toThrow("HTTP(S)");
    const badGrade = record();
    (badGrade.judgments[0] as any).annotatorA.grade = 4;
    expect(() => validateSearchGoldenRecord(badGrade)).toThrow("0–3");
  });
});
