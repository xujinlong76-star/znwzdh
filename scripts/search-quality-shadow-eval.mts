#!/usr/bin/env node
/**
 * 站点质量影子重排离线评测。
 *
 * 输入是脱敏人工金标 + 同一时间点的真实质量快照；脚本不连接生产数据库，
 * 不写回线上排序，也不生成/推断相关性标签。
 *
 * 用法：
 *   node scripts/search-quality-shadow-eval.mts fixture.json [--json]
 *
 * 输入格式：
 * {
 *   "schemaVersion": "search-quality-shadow-v1",
 *   "k": 10,
 *   "qualityWeight": 0.12,
 *   "minEvidenceCoverage": 40,
 *   "cases": [{
 *     "query": "...",
 *     "baselineHits": ["site-id-1", "site-id-2"],
 *     "relevance": { "site-id-1": 3, "site-id-2": 0 },
 *     "qualityBySite": {
 *       "site-id-1": { "score": 82, "evidenceCoverage": 70, "band": "high" }
 *     }
 *   }]
 * }
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateSearch,
  ndcgAtK,
  mrrAtK,
  recallAtK,
  type SearchEvalCase,
} from "../packages/core/src/search-eval.ts";
import {
  rerankBySiteQualityShadow,
  type SiteQualityShadowCandidate,
} from "../packages/core/src/quality-shadow-rerank.ts";
import type { SiteQualityBand } from "../packages/core/src/site-quality.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BANDS = new Set<SiteQualityBand>([
  "high", "medium", "low", "high_risk", "insufficient_evidence",
]);

interface ShadowCase {
  query: string;
  baselineHits: string[];
  relevance: Record<string, number>;
  qualityBySite: Record<string, {
    score: number | null;
    evidenceCoverage: number;
    band: SiteQualityBand;
  }>;
}

interface Fixture {
  schemaVersion: "search-quality-shadow-v1";
  k?: number;
  qualityWeight?: number;
  minEvidenceCoverage?: number;
  cases: ShadowCase[];
}

function fail(message: string): never {
  throw new Error(message);
}

function validateFixture(value: unknown): Fixture {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("输入必须是 JSON 对象");
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== "search-quality-shadow-v1") fail("schemaVersion 必须是 search-quality-shadow-v1");
  const k = input.k ?? 10;
  if (!Number.isInteger(k) || Number(k) < 1 || Number(k) > 100) fail("k 必须是 1–100 的整数");
  const qualityWeight = input.qualityWeight ?? 0.12;
  if (typeof qualityWeight !== "number" || !Number.isFinite(qualityWeight) || qualityWeight < 0 || qualityWeight > 0.25) {
    fail("qualityWeight 必须在 0–0.25 之间");
  }
  const minEvidenceCoverage = input.minEvidenceCoverage ?? 40;
  if (typeof minEvidenceCoverage !== "number" || !Number.isFinite(minEvidenceCoverage) || minEvidenceCoverage < 0 || minEvidenceCoverage > 100) {
    fail("minEvidenceCoverage 必须在 0–100 之间");
  }
  if (!Array.isArray(input.cases) || input.cases.length === 0) fail("cases 必须是非空数组");

  const cases = input.cases.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(`第 ${index + 1} 条 case 必须是对象`);
    const item = raw as Record<string, unknown>;
    if (typeof item.query !== "string" || !item.query.trim()) fail(`第 ${index + 1} 条 query 不能为空`);
    if (!Array.isArray(item.baselineHits) || item.baselineHits.some((id) => typeof id !== "string" || !id)) {
      fail(`第 ${index + 1} 条 baselineHits 必须是非空字符串 ID 数组`);
    }
    if (new Set(item.baselineHits).size !== item.baselineHits.length) {
      fail(`第 ${index + 1} 条 baselineHits 存在重复 siteId`);
    }
    if (!item.relevance || typeof item.relevance !== "object" || Array.isArray(item.relevance)) {
      fail(`第 ${index + 1} 条 relevance 必须是对象`);
    }
    for (const [siteId, grade] of Object.entries(item.relevance as Record<string, unknown>)) {
      if (!siteId || typeof grade !== "number" || !Number.isInteger(grade) || grade < 0 || grade > 3) {
        fail(`第 ${index + 1} 条 relevance[${siteId}] 必须是 0–3 整数`);
      }
    }
    const qualityBySite = item.qualityBySite ?? {};
    if (!qualityBySite || typeof qualityBySite !== "object" || Array.isArray(qualityBySite)) {
      fail(`第 ${index + 1} 条 qualityBySite 必须是对象`);
    }
    for (const [siteId, rawQuality] of Object.entries(qualityBySite as Record<string, unknown>)) {
      if (!rawQuality || typeof rawQuality !== "object" || Array.isArray(rawQuality)) fail(`质量快照 ${siteId} 格式无效`);
      const q = rawQuality as Record<string, unknown>;
      if (q.score !== null && (typeof q.score !== "number" || !Number.isFinite(q.score) || q.score < 0 || q.score > 100)) {
        fail(`质量快照 ${siteId}.score 必须为 null 或 0–100`);
      }
      if (typeof q.evidenceCoverage !== "number" || !Number.isFinite(q.evidenceCoverage) || q.evidenceCoverage < 0 || q.evidenceCoverage > 100) {
        fail(`质量快照 ${siteId}.evidenceCoverage 必须在 0–100 之间`);
      }
      if (typeof q.band !== "string" || !BANDS.has(q.band as SiteQualityBand)) fail(`质量快照 ${siteId}.band 无效`);
    }
    return {
      query: item.query,
      baselineHits: item.baselineHits as string[],
      relevance: item.relevance as Record<string, number>,
      qualityBySite: qualityBySite as ShadowCase["qualityBySite"],
    };
  });
  return {
    schemaVersion: "search-quality-shadow-v1",
    k: Number(k),
    qualityWeight: Number(qualityWeight),
    minEvidenceCoverage: Number(minEvidenceCoverage),
    cases,
  };
}

const argv = process.argv.slice(2);
const jsonOutput = argv.includes("--json");
const file = argv.find((arg) => !arg.startsWith("-"));
if (!file || argv.some((arg) => arg.startsWith("-") && arg !== "--json")) {
  console.error("用法: node scripts/search-quality-shadow-eval.mts fixture.json [--json]");
  process.exit(1);
}

try {
  const fullPath = path.resolve(ROOT, file);
  const fixture = validateFixture(JSON.parse(readFileSync(fullPath, "utf8")));
  const baselineCases: SearchEvalCase[] = [];
  const shadowCases: SearchEvalCase[] = [];
  const queryDetails = [];

  for (const item of fixture.cases) {
    const candidates: SiteQualityShadowCandidate[] = item.baselineHits.map((siteId) => {
      const quality = item.qualityBySite[siteId];
      return quality
        ? { siteId, ...quality }
        : { siteId, qualityScore: null, evidenceCoverage: 0, band: "insufficient_evidence" };
    });
    const shadow = rerankBySiteQualityShadow(candidates, {
      qualityWeight: fixture.qualityWeight,
      minEvidenceCoverage: fixture.minEvidenceCoverage,
    });
    const baseline: SearchEvalCase = {
      query: item.query,
      hits: item.baselineHits,
      relevance: item.relevance,
    };
    const reranked: SearchEvalCase = {
      query: item.query,
      hits: shadow.map((candidate) => candidate.siteId),
      relevance: item.relevance,
    };
    baselineCases.push(baseline);
    shadowCases.push(reranked);
    queryDetails.push({
      query: item.query,
      baseline: { ndcgAtK: ndcgAtK(baseline, fixture.k!), mrrAtK: mrrAtK(baseline, fixture.k!), recallAtK: recallAtK(baseline, fixture.k!) },
      shadow: { ndcgAtK: ndcgAtK(reranked, fixture.k!), mrrAtK: mrrAtK(reranked, fixture.k!), recallAtK: recallAtK(reranked, fixture.k!) },
      moved: shadow.filter((candidate) => candidate.baselineRank !== candidate.shadowRank).length,
      applied: shadow.filter((candidate) => candidate.applied).length,
      excluded: shadow.filter((candidate) => !candidate.applied).length,
    });
  }

  const baselineMetrics = evaluateSearch(baselineCases, fixture.k);
  const shadowMetrics = evaluateSearch(shadowCases, fixture.k);
  const result = {
    file,
    k: fixture.k,
    qualityWeight: fixture.qualityWeight,
    minEvidenceCoverage: fixture.minEvidenceCoverage,
    baseline: baselineMetrics,
    shadow: shadowMetrics,
    delta: {
      ndcgAtK: shadowMetrics.ndcgAtK - baselineMetrics.ndcgAtK,
      mrrAtK: shadowMetrics.mrrAtK - baselineMetrics.mrrAtK,
      recallAtK: shadowMetrics.recallAtK - baselineMetrics.recallAtK,
    },
    cases: queryDetails,
    note: "仅用于离线对照；相关性标签必须由人工标注，脚本不会更改生产搜索排序。",
  };
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`搜索质量影子评测  file=${file}  k=${fixture.k}  queries=${fixture.cases.length}`);
    console.log(`Baseline NDCG=${baselineMetrics.ndcgAtK.toFixed(4)} MRR=${baselineMetrics.mrrAtK.toFixed(4)} Recall=${baselineMetrics.recallAtK.toFixed(4)}`);
    console.log(`Shadow   NDCG=${shadowMetrics.ndcgAtK.toFixed(4)} MRR=${shadowMetrics.mrrAtK.toFixed(4)} Recall=${shadowMetrics.recallAtK.toFixed(4)}`);
    console.log(`Delta    NDCG=${result.delta.ndcgAtK.toFixed(4)} MRR=${result.delta.mrrAtK.toFixed(4)} Recall=${result.delta.recallAtK.toFixed(4)}`);
    for (const detail of queryDetails) console.log(`  ${detail.query}: moved=${detail.moved} applied=${detail.applied} excluded=${detail.excluded}`);
    console.log(result.note);
  }
} catch (error) {
  console.error("搜索质量影子评测失败: " + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
