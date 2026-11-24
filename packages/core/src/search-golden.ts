import type { SearchEvalCase } from "./search-eval.ts";

export interface SearchGoldenJudgment {
  siteId: string;
  annotatorA: { annotatorId: string; status: "judged" | "unjudgeable"; grade?: number; evidenceUrl: string; reasonCode: string };
  annotatorB: { annotatorId: string; status: "judged" | "unjudgeable"; grade?: number; evidenceUrl: string; reasonCode: string };
  adjudication?: { adjudicatorId: string; status: "judged" | "unjudgeable"; grade?: number; evidenceUrl: string; reasonCode: string };
}

export interface SearchGoldenRecord {
  schemaVersion: "navhub-search-golden-v1";
  sampleId: string;
  query: string;
  sourceType: "search_telemetry";
  sampledAt: string;
  snapshotAt: string;
  language: string;
  intent: string;
  privacyReviewed: true;
  queryRedacted: true;
  hits: Array<{ siteId: string; rank: number }>;
  judgments: SearchGoldenJudgment[];
}

function validIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && value.includes("T");
}

/**
 * 高置信度隐私风险启发式扫描。它是导入前的第二道闸门，不替代数据负责人逐条人工脱敏审查。
 * 只拦截明显邮箱、疑似电话号码和常见凭据格式，避免把一般短数字/年份误判为个人信息。
 */
export function detectSearchGoldenQueryPrivacyRisk(query: string): string[] {
  const risks: string[] = [];
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(query)) risks.push("email");
  if (/(?:\+?\d[\s().-]*){10,}/.test(query)) risks.push("phone_like_number");
  if (/\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/.test(query) ||
      /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i.test(query)) risks.push("credential");
  return risks;
}

function validateJudgment(
  value: unknown,
  label: string,
): { annotatorId: string; status: "judged" | "unjudgeable"; grade?: number; evidenceUrl: string; reasonCode: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " 缺少标注对象");
  const row = value as Record<string, unknown>;
  if (typeof row.annotatorId !== "string" || !row.annotatorId.trim()) throw new Error(label + " 缺少 annotatorId");
  if (row.status !== "judged" && row.status !== "unjudgeable") throw new Error(label + " status 无效");
  if (row.status === "judged" && (typeof row.grade !== "number" || !Number.isInteger(row.grade) || row.grade < 0 || row.grade > 3)) {
    throw new Error(label + " grade 必须是 0–3 整数");
  }
  if (row.status === "unjudgeable" && row.grade !== undefined) throw new Error(label + " unjudgeable 不得填写 grade");
  if (typeof row.evidenceUrl !== "string") throw new Error(label + " 缺少 evidenceUrl");
  let evidence: URL;
  try { evidence = new URL(row.evidenceUrl); } catch { throw new Error(label + " evidenceUrl 无效"); }
  if (!["http:", "https:"].includes(evidence.protocol) || evidence.username || evidence.password) {
    throw new Error(label + " evidenceUrl 仅允许不含凭据的 HTTP(S)");
  }
  if (typeof row.reasonCode !== "string" || !/^[a-z0-9_:-]{2,64}$/i.test(row.reasonCode)) {
    throw new Error(label + " reasonCode 格式无效");
  }
  return {
    annotatorId: row.annotatorId, status: row.status,
    ...(row.status === "judged" ? { grade: row.grade as number } : {}),
    evidenceUrl: evidence.toString(), reasonCode: row.reasonCode,
  };
}

/** 验证真实遥测来源、脱敏声明、双人独立标注和分歧仲裁。 */
export function validateSearchGoldenRecord(value: unknown, index = 0): SearchGoldenRecord {
  const label = "第 " + (index + 1) + " 条金标";
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(label + " 必须是对象");
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== "navhub-search-golden-v1") throw new Error(label + " schemaVersion 无效");
  for (const key of ["sampleId", "query", "language", "intent"] as const) {
    if (typeof row[key] !== "string" || !row[key].trim()) throw new Error(label + " 缺少 " + key);
  }
  if ((row.sampleId as string).length > 128 || (row.query as string).length > 500 ||
      (row.language as string).length > 32 || (row.intent as string).length > 80) {
    throw new Error(label + " sampleId/query/language/intent 超出长度限制");
  }
  const privacyRisks = detectSearchGoldenQueryPrivacyRisk(row.query as string);
  if (privacyRisks.length) throw new Error(label + " query 疑似包含未脱敏隐私或凭据：" + privacyRisks.join(", "));
  if (row.sourceType !== "search_telemetry") throw new Error(label + " 必须来自真实搜索遥测");
  if (!validIsoDate(row.sampledAt) || !validIsoDate(row.snapshotAt)) throw new Error(label + " 时间戳必须是 ISO 日期");
  if (row.privacyReviewed !== true || row.queryRedacted !== true) throw new Error(label + " 未通过隐私审查或查询脱敏声明");
  if (!Array.isArray(row.hits)) throw new Error(label + " hits 必须是数组（允许零结果空数组）");
  const hits = row.hits as unknown[];
  const siteIds = new Set<string>();
  let previousRank = 0;
  for (const hit of hits) {
    if (!hit || typeof hit !== "object" || Array.isArray(hit)) throw new Error(label + " hits 项无效");
    const item = hit as Record<string, unknown>;
    if (typeof item.siteId !== "string" || !item.siteId.trim() || siteIds.has(item.siteId)) throw new Error(label + " siteId 缺失或重复");
    if (!Number.isInteger(item.rank) || Number(item.rank) <= previousRank) throw new Error(label + " rank 必须严格递增");
    previousRank = Number(item.rank);
    siteIds.add(item.siteId);
  }
  if (!Array.isArray(row.judgments) || (siteIds.size > 0 && row.judgments.length === 0)) throw new Error(label + " judgments 必须覆盖非空候选快照");
  const judgmentIds = new Set<string>();
  for (const raw of row.judgments) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(label + " judgment 项无效");
    const item = raw as Record<string, unknown>;
    if (typeof item.siteId !== "string" || !siteIds.has(item.siteId) || judgmentIds.has(item.siteId)) {
      throw new Error(label + " judgment siteId 必须唯一且属于 hits");
    }
    judgmentIds.add(item.siteId);
    const a = validateJudgment(item.annotatorA, label + " annotatorA");
    const b = validateJudgment(item.annotatorB, label + " annotatorB");
    if (a.annotatorId === b.annotatorId) throw new Error(label + " 两名标注员必须不同");
    const differs = a.status !== b.status || a.grade !== b.grade;
    if (differs && !item.adjudication) throw new Error(label + " 标注存在分歧，必须仲裁");
    if (!differs && item.adjudication) throw new Error(label + " 无分歧样本不应重复仲裁");
    if (item.adjudication) {
      const rawAdjudication = item.adjudication as Record<string, unknown>;
      const adjudication = validateJudgment({ ...rawAdjudication, annotatorId: rawAdjudication.adjudicatorId }, label + " adjudication");
      if (adjudication.annotatorId === a.annotatorId || adjudication.annotatorId === b.annotatorId) {
        throw new Error(label + " 仲裁员必须是第三人");
      }
    }
  }
  if (judgmentIds.size !== siteIds.size) throw new Error(label + " 每个命中站点都必须完成双人标注");
  return row as unknown as SearchGoldenRecord;
}

/** 仅把可判定的最终等级转换成评测输入；unjudgeable 不伪装成 0 分。 */
export function toSearchEvalCase(record: SearchGoldenRecord): SearchEvalCase {
  const relevance: Record<string, number> = {};
  for (const judgment of record.judgments) {
    const a = judgment.annotatorA;
    const b = judgment.annotatorB;
    const final = judgment.adjudication ?? a;
    if (final.status === "judged" && final.grade !== undefined) relevance[judgment.siteId] = final.grade;
  }
  return {
    // 评测指标不读取 query 文本；使用去标识化 sampleId 防止生成文件再次暴露查询。
    query: record.sampleId,
    hits: record.hits.map((hit) => hit.siteId),
    relevance,
  };
}
