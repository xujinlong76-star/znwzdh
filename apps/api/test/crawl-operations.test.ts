import { describe, expect, it } from "vitest";
import { scoreCrawlCandidate, selectStratifiedCrawlCandidates, selectGoldEvaluationSample, moderationVerdictToPrediction, buildGoldEvaluationCaseDiagnostics } from "../src/routes/crawl-operations.ts";

describe("crawl candidate quality hints", () => {
  it("rewards complete, substantial HTTPS pages with explainable reasons", () => {
    const result = scoreCrawlCandidate({
      url: "https://example.com/",
      title: "Example",
      description: "A useful website",
      evidence: { tokenCount: 900, nearDuplicateCandidates: [] },
    });
    expect(result.score).toBe(85);
    expect(result.reasons).toContain("正文信息量较充分");
    expect(result.reasons).toContain("使用 HTTPS");
  });
  it("penalizes exact and near duplicate evidence without making an automatic decision", () => {
    const clean = scoreCrawlCandidate({ url: "https://example.com", title: "A", description: "B", evidence: { tokenCount: 500 } });
    const duplicate = scoreCrawlCandidate({
      url: "https://example.com", title: "A", description: "B",
      evidence: { tokenCount: 500, exactDuplicateOf: "https://other.example", nearDuplicateCandidates: [{ url: "x" }, { url: "y" }] },
    });
    expect(duplicate.score).toBeLessThan(clean.score);
    expect(duplicate.reasons).toContain("存在完全重复页面证据");
  });
  it("bounds scores and reports missing content", () => {
    const result = scoreCrawlCandidate({ url: "not-a-url", evidence: { tokenCount: 0 } });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.reasons).toContain("缺少页面标题");
    expect(result.reasons).toContain("URL 格式异常");
  });
});
describe("stratified gold candidate sampling", () => {
  it("round-robins across category, risk hint, source and quality strata", () => {
    const items = [
      { id:"a1",category:"AI",source:"rss",riskBand:"risk_hint",qualityBand:"high",score:99 },
      { id:"a2",category:"AI",source:"rss",riskBand:"risk_hint",qualityBand:"high",score:95 },
      { id:"a3",category:"AI",source:"rss",riskBand:"risk_hint",qualityBand:"high",score:90 },
      { id:"b1",category:"办公",source:"sitemap",riskBand:"unknown",qualityBand:"medium",score:70 },
      { id:"c1",category:"设计",source:"page",riskBand:"no_risk_hint",qualityBand:"low",score:30 },
    ];
    const selected = selectStratifiedCrawlCandidates(items,3);
    expect(selected).toHaveLength(3);
    expect(new Set(selected.map(item=>item.category)).size).toBe(3);
  });
  it("caps batch size and never treats risk hints as gold labels", () => {
    const items = Array.from({length:150},(_,index)=>({
      id:"candidate-"+index,category:index%2?"AI":"办公",source:"rss",
      riskBand:index%3?"unknown":"risk_hint",qualityBand:"medium",score:index%100,
    }));
    const selected = selectStratifiedCrawlCandidates(items,999);
    expect(selected).toHaveLength(100);
    expect(selected.every(item=>item.riskBand==="unknown"||item.riskBand==="risk_hint")).toBe(true);
    expect(selected.every(item=>!("label" in item)&&!("risk" in item))).toBe(true);
  });
  it("returns all available candidates when fewer than requested", () => {
    const items = [{id:"only",category:"AI",source:"rss",riskBand:"unknown",qualityBand:"high",score:80}];
    expect(selectStratifiedCrawlCandidates(items,20)).toEqual(items);
  });
});
describe("automatic moderation gold evaluation helpers", () => {
  it("selects a stable deterministic subset capped at twenty samples", () => {
    const rows = Array.from({length:40},(_,index)=>({id:"gold-"+index}));
    const first = selectGoldEvaluationSample(rows,20).map(row=>row.id);
    const second = selectGoldEvaluationSample([...rows].reverse(),20).map(row=>row.id);
    expect(first).toHaveLength(20);
    expect(first).toEqual(second);
    expect(selectGoldEvaluationSample(rows,999)).toHaveLength(20);
  });
  it("maps moderation verdicts to labels and treats none as no risk", () => {
    expect(moderationVerdictToPrediction({verdict:"auto_approve",risks:["none"]})).toEqual({actual:"approve",actualRisk:false});
    expect(moderationVerdictToPrediction({verdict:"reject",risks:["phishing"]})).toEqual({actual:"reject",actualRisk:true});
    expect(moderationVerdictToPrediction({verdict:"manual_review",risks:["none","spam"]})).toEqual({actual:"review",actualRisk:true});
  });
  it("retains only per-case mismatch and risk error diagnostics without source text", () => {
    const rows = buildGoldEvaluationCaseDiagnostics([
      {id:"gold-1",expected:"reject",actual:"approve",expectedRisk:true,actualRisk:false},
      {id:"gold-2",expected:"approve",actual:"approve",expectedRisk:false,actualRisk:true},
      {id:"gold-3",expected:"review",actual:"review",expectedRisk:false,actualRisk:false},
    ]);
    expect(rows[0]).toMatchObject({labelMismatch:true,riskFalseNegative:true,riskFalsePositive:false});
    expect(rows[1]).toMatchObject({labelMismatch:false,riskFalseNegative:false,riskFalsePositive:true});
    expect(rows[2]).toMatchObject({labelMismatch:false,riskFalseNegative:false,riskFalsePositive:false});
    expect(JSON.stringify(rows)).not.toContain("sanitizedExcerpt");
  });
});
