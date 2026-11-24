import { describe, expect, it } from "vitest";
import { scoreCrawlCandidate, selectStratifiedCrawlCandidates, selectGoldEvaluationSample, moderationVerdictToPrediction, buildModerationErrorAnalysis, summarizeModerationEvaluationUsage } from "../src/routes/crawl-operations.ts";

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
});
describe("moderation evaluation error analysis", () => {
  it("groups label mismatches and lists risk false negatives/positives without page content", () => {
    const result = buildModerationErrorAnalysis([
      {id:"a",expected:"approve",actual:"reject",expectedRisk:false,actualRisk:true},
      {id:"b",expected:"reject",actual:"review",expectedRisk:true,actualRisk:false},
      {id:"c",expected:"reject",actual:"review",expectedRisk:true,actualRisk:false},
      {id:"d",expected:"approve",actual:"approve",expectedRisk:false,actualRisk:false},
    ]);
    expect(result.labelMismatchCount).toBe(3);
    expect(result.riskMismatchCount).toBe(3);
    expect(result.confusionGroups).toEqual([{expected:"reject",actual:"review",count:2,sampleIds:["b","c"]},{expected:"approve",actual:"reject",count:1,sampleIds:["a"]}]);
    expect(result.riskFalseNegativeIds).toEqual(["b","c"]);
    expect(result.riskFalsePositiveIds).toEqual(["a"]);
    expect(JSON.stringify(result)).not.toMatch(/https?:|<html|网页正文/);
  });
  it("bounds per-group sample identifiers and reports truncation", () => {
    const cases = Array.from({length:80},(_,index)=>({id:"id-"+index,expected:"reject" as const,actual:"review" as const,expectedRisk:true,actualRisk:false}));
    const result = buildModerationErrorAnalysis(cases);
    expect(result.labelMismatchCount).toBe(80);
    expect(result.confusionGroups[0]?.sampleIds).toHaveLength(20);
    expect(result.riskFalseNegativeIds).toHaveLength(50);
    expect(result.samplesTruncated).toBe(true);
  });
});
describe("moderation evaluation usage accounting", () => {
  it("keeps unknown model cost null instead of treating it as free", () => {
    expect(summarizeModerationEvaluationUsage({calls:2,prompt_tokens:1200,completion_tokens:300,priced_calls:0,cost_rmb:null,failed_calls:1})).toEqual({
      calls:2,promptTokens:1200,completionTokens:300,totalTokens:1500,costRmb:null,pricedCalls:0,unpricedCalls:2,failedCalls:1,
    });
  });
  it("aggregates known cost and bounds counters by actual call count", () => {
    expect(summarizeModerationEvaluationUsage({calls:2,prompt_tokens:1000,completion_tokens:500,priced_calls:3,cost_rmb:0.0123,failed_calls:5})).toEqual({
      calls:2,promptTokens:1000,completionTokens:500,totalTokens:1500,costRmb:0.0123,pricedCalls:2,unpricedCalls:0,failedCalls:2,
    });
  });
});
