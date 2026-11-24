import type { Repository } from "../repository.ts";
import { computeConsecutiveFailures, isBotBlockedHealthRecord, type SiteQualityResult } from "@navhub/core";

export async function updateSiteHealth(repo: Repository, siteId: string, health: {
    httpStatus: number | null
    ok: boolean
    latencyMs: number
    redirectTo: string | null
    error: string | null
    /** 失败时是否把 status 置为 broken */
    markBroken?: boolean
    currentStatus?: string
  }): Promise<void> {
  const now = Date.now();
  // 三条写必须同生同死：只写了 sites 而没写进 health_checks，
  // 连续失败判定（recentHealthChecks）就少算一次，站点会被误判或漏判为 broken；
  // consecutive_failures 与 health 写回 + lastCheckedAt 同一次写入、同一事务
  // 可见（03 §3.3，W1 §13 第 2 条 verdict ①），否则计数与 health 状态漂移。
  return repo.withTransaction(async () => {
  // 计数转移与 core 的 computeConsecutiveFailures 同一条规则（成功清零、
  // bot-blocked 打断链、失败 +1）；旧值读库内行（事实源），不读进程内登记。
  // bot-blocked 判定用 error 前缀（isBotBlockedHealthRecord），不用状态码猜：
  // “站点拒绝巡检抓取”是未测准、不是失败，ok === false 也必须清零，否则
  // 永久 WAF 站迟早被误标 broken（2026-10-18 事故）。
  const prevRows = await repo.raw(
    "SELECT consecutive_failures FROM sites WHERE id = ?",
    [siteId],
  );
  const previous = Number(prevRows[0]?.consecutive_failures ?? 0) || 0;
  const { consecutiveFailures } = computeConsecutiveFailures(previous, {
    ok: health.ok,
    httpStatus: health.httpStatus,
    checkedAt: now,
    botBlocked: isBotBlockedHealthRecord(health.error),
  });
  await repo.run(
    `UPDATE sites SET http_status = ?, health_ok = ?, latency_ms = ?, redirect_to = ?,
            health_error = ?, last_checked_at = ?, consecutive_failures = ?, status = ? WHERE id = ?`,
    [
      health.httpStatus, health.ok, health.latencyMs, health.redirectTo, health.error, now,
      consecutiveFailures,
      health.ok ? (health.currentStatus ?? "active") : (health.markBroken === false ? (health.currentStatus ?? "active") : "broken"),
      siteId,
    ],
  );
  await repo.run(
    "INSERT INTO health_checks (site_id, checked_at, ok, http_status, latency_ms, redirect_to, error) VALUES (?,?,?,?,?,?,?)",
    [siteId, now, health.ok, health.httpStatus, health.latencyMs, health.redirectTo, health.error],
  );
  });
}

/**
 * 读某站点的持久连续失败计数（sites.consecutive_failures，事实源）。
 *
 * 旧库缺列时抛 "no such column"：调用方（shouldBreak）按保守处理返回 false，
 * 不在这里吞错——缺列是迁移未跑的部署问题，读路径静默返回 0 会把“没迁移”
 * 伪装成“没失败过”。migrateColumns 在启动时补列，正常部署不会走到这里。
 */
export async function getSiteConsecutiveFailures(repo: Repository, siteId: string): Promise<number> {
  const rows = await repo.raw(
    "SELECT consecutive_failures FROM sites WHERE id = ?",
    [siteId],
  );
  const v = Number(rows[0]?.consecutive_failures ?? 0);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export async function healthCheckSeries(repo: Repository, since: number, limit = 5000): Promise<Array<{ siteId: string; checkedAt: number; ok: boolean; latencyMs: number | null }>> {
  const rows = await repo.raw(
    "SELECT site_id, checked_at, ok, latency_ms FROM health_checks WHERE checked_at >= ? ORDER BY checked_at ASC LIMIT ?",
    [since, limit],
  );
  return rows.map((r) => ({
    siteId: String(r.site_id),
    checkedAt: Number(r.checked_at ?? 0),
    ok: r.ok === null || r.ok === undefined ? false : Boolean(r.ok),
    latencyMs: r.latency_ms === null || r.latency_ms === undefined ? null : Number(r.latency_ms),
  }));
}

/**
 * 最近 N 次巡检结果（新→旧）。
 *
 * 用途：健康判定从「单次失败即 broken」改为「连续 N 次失败才 broken」。
 * 实测背景：50 个站点里 15 个被标 broken，其中 kubernetes.io / figma.com /
 * npmjs.com 全部可正常访问 —— 单次探测遇到 403/429/超时就会把健康站点打进
 * 冷宫，前台还可能显示「已失效」。连续失败阈值能过滤掉绝大多数抖动。
 *
 * 同时返回 error：shouldBreak 靠它识别 bot-blocked 行（见
 * health-check.task.ts 的 isBotBlockedHealthRecord）——“站点拒绝巡检抓取”
 * 是未测准、不是失败，不能算进连续失败，否则永久 WAF 站迟早被误标 broken。
 */
export async function recentHealthChecks(
  repo: Repository,
  siteId: string,
  limit = 5,
): Promise<Array<{ ok: boolean; checkedAt: number; error: string | null }>> {
  const rows = await repo.raw(
    "SELECT ok, checked_at, error FROM health_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT ?",
    [siteId, limit],
  );
  return rows.map((r) => ({
    ok: r.ok === null || r.ok === undefined ? false : Boolean(r.ok),
    checkedAt: Number(r.checked_at ?? 0),
    error: r.error === null || r.error === undefined ? null : String(r.error),
  }));
}

/**
 * 删除 before 之前的巡检历史，返回删除条数。
 *
 * 这张表每个站点每天一行，长期只增不删；它不承载用户内容，
 * 与 llm_usage 同属"可以按 TTL 自动清理"的内部遥测。
 * 用 checked_at 而不是 created_at —— 该表没有 created_at 列。
 */
export async function pruneHealthChecks(repo: Repository, before: number): Promise<number> {
  return repo.runCount("DELETE FROM health_checks WHERE checked_at < ?", [before]);
}

export async function bumpVisit(repo: Repository, siteId: string): Promise<void> {
  const now = Date.now();
  await repo.run(
    "UPDATE sites SET visit_count = visit_count + 1, last_visited_at = ?, updated_at = ? WHERE id = ?",
    [now, now, siteId],
  );
}

export async function setTrendScores(repo: Repository, scores: Array<{ id: string; trendScore: number }>): Promise<void> {
  if (scores.length === 0) return;
  await repo.withTransaction(async () => {
    // 分批 CASE-WHEN 批量更新（P1-3）：此前逐行 UPDATE，5 万库 = 每小时 5 万条
    // 单行语句包在一个事务里。**不碰 updated_at**：trend 巡检每小时跑一次，
    // 此前顺手把 updated_at 一起刷新 → runRefetch 的「30 天没富化过」判定
    // 被慢性短路（refetch_metadata 永远认为站点是新的）；同时 sites 的 UPDATE
    // 会推进 nav_version，快照缓存与全站 ETag 每小时翻转重建。
    const BATCH = 500;
    for (let i = 0; i < scores.length; i += BATCH) {
      const chunk = scores.slice(i, i + BATCH);
      const cases = chunk.map(() => "WHEN id = ? THEN ?").join(" ");
      const scoreParams: unknown[] = [];
      for (const s of chunk) scoreParams.push(s.id, s.trendScore);
      const ids = chunk.map((s) => s.id);
      await repo.run(
        `UPDATE sites SET
            trend_score = CASE ${cases} ELSE trend_score END,
            weight = CASE ${cases} ELSE weight END
          WHERE id IN (${ids.map(() => "?").join(",")})`,
        [...scoreParams, ...scoreParams, ...ids],
      );
    }
  });
}


/** 最新站点质量快照。保留完整维度证据，供后续审核工作台与离线评测读取。 */
export interface SiteQualityAssessmentRecord extends SiteQualityResult {
  siteId: string;
  updatedAt: number;
}

/** 幂等写入当前规则版本的最新影子评分；不触碰 sites.status / 搜索排序字段。 */
export async function saveSiteQualityAssessment(
  repo: Repository,
  siteId: string,
  assessment: SiteQualityResult,
): Promise<void> {
  const updatedAt = Date.now();
  await repo.run(
    `INSERT INTO site_quality_assessments
      (site_id, version, evaluated_at, overall_score, evidence_coverage, observed_dimensions,
       risk_score, band, dimensions_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(site_id) DO UPDATE SET
       version = excluded.version,
       evaluated_at = excluded.evaluated_at,
       overall_score = excluded.overall_score,
       evidence_coverage = excluded.evidence_coverage,
       observed_dimensions = excluded.observed_dimensions,
       risk_score = excluded.risk_score,
       band = excluded.band,
       dimensions_json = excluded.dimensions_json,
       updated_at = excluded.updated_at`,
    [
      siteId, assessment.version, assessment.evaluatedAt, assessment.score,
      assessment.evidenceCoverage, assessment.observedDimensions, assessment.riskScore,
      assessment.band, JSON.stringify(assessment.dimensions), updatedAt,
    ],
  );
}

/** 读取一站点的最新质量快照；无快照返回 null。 */
export async function getSiteQualityAssessment(
  repo: Repository,
  siteId: string,
): Promise<SiteQualityAssessmentRecord | null> {
  const rows = await repo.raw(
    "SELECT * FROM site_quality_assessments WHERE site_id = ?",
    [siteId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    siteId: String(row.site_id),
    version: String(row.version) as SiteQualityResult["version"],
    evaluatedAt: Number(row.evaluated_at),
    score: row.overall_score == null ? null : Number(row.overall_score),
    evidenceCoverage: Number(row.evidence_coverage),
    observedDimensions: Number(row.observed_dimensions),
    riskScore: row.risk_score == null ? null : Number(row.risk_score),
    band: String(row.band) as SiteQualityResult["band"],
    dimensions: JSON.parse(String(row.dimensions_json)) as SiteQualityResult["dimensions"],
    updatedAt: Number(row.updated_at),
  };
}


export interface SiteQualityOverview {
  totalSites: number;
  assessedSites: number;
  unassessedSites: number;
  highRiskCount: number;
  insufficientEvidenceCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  averageScore: number | null;
  averageEvidenceCoverage: number | null;
  lastEvaluatedAt: number | null;
}

export interface SiteQualityListItem extends SiteQualityAssessmentRecord {
  title: string;
  url: string;
  categoryId: string;
  status: string;
}

function qualityRecordFromRow(row: Record<string, unknown>): SiteQualityAssessmentRecord {
  return {
    siteId: String(row.site_id),
    version: String(row.version) as SiteQualityResult["version"],
    evaluatedAt: Number(row.evaluated_at),
    score: row.overall_score == null ? null : Number(row.overall_score),
    evidenceCoverage: Number(row.evidence_coverage),
    observedDimensions: Number(row.observed_dimensions),
    riskScore: row.risk_score == null ? null : Number(row.risk_score),
    band: String(row.band) as SiteQualityResult["band"],
    dimensions: JSON.parse(String(row.dimensions_json)) as SiteQualityResult["dimensions"],
    updatedAt: Number(row.updated_at),
  };
}

/** 质量治理列表：风险优先、证据不足次之；不包含软删除站点。 */
export async function listSiteQualityAssessments(
  repo: Repository,
  options: { band?: SiteQualityResult["band"]; limit?: number; offset?: number } = {},
): Promise<SiteQualityListItem[]> {
  const where = ["s.deleted_at IS NULL", "s.status <> 'archived'"];
  const params: unknown[] = [];
  if (options.band) {
    where.push("q.band = ?");
    params.push(options.band);
  }
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const rows = await repo.raw(
    `SELECT q.*, s.title, s.url, s.category_id, s.status
       FROM site_quality_assessments q
       JOIN sites s ON s.id = q.site_id
      WHERE ${where.join(" AND ")}
      ORDER BY CASE q.band
        WHEN 'high_risk' THEN 0
        WHEN 'insufficient_evidence' THEN 1
        WHEN 'low' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4 END,
        q.overall_score ASC, q.updated_at DESC, q.site_id ASC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map((row) => ({
    ...qualityRecordFromRow(row),
    title: String(row.title ?? ""),
    url: String(row.url ?? ""),
    categoryId: String(row.category_id ?? ""),
    status: String(row.status ?? ""),
  }));
}

/** 质量总览把「尚未评估」单独列出，不把缺少快照的站点当作零分。 */
export async function siteQualityOverview(repo: Repository): Promise<SiteQualityOverview> {
  const [siteRows, rows] = await Promise.all([
    repo.raw("SELECT COUNT(*) AS total FROM sites WHERE deleted_at IS NULL AND status <> 'archived'"),
    repo.raw(`SELECT
      COUNT(*) AS assessed,
      SUM(CASE WHEN band = 'high_risk' THEN 1 ELSE 0 END) AS high_risk,
      SUM(CASE WHEN band = 'insufficient_evidence' THEN 1 ELSE 0 END) AS insufficient,
      SUM(CASE WHEN band = 'high' THEN 1 ELSE 0 END) AS high_count,
      SUM(CASE WHEN band = 'medium' THEN 1 ELSE 0 END) AS medium_count,
      SUM(CASE WHEN band = 'low' THEN 1 ELSE 0 END) AS low_count,
      AVG(overall_score) AS average_score,
      AVG(evidence_coverage) AS average_coverage,
      MAX(evaluated_at) AS last_evaluated_at
      FROM site_quality_assessments q
      JOIN sites s ON s.id = q.site_id
      WHERE s.deleted_at IS NULL AND s.status <> 'archived'`),
  ]);
  const totalSites = Number(siteRows[0]?.total ?? 0);
  const row = rows[0] ?? {};
  const assessedSites = Number(row.assessed ?? 0);
  return {
    totalSites,
    assessedSites,
    unassessedSites: Math.max(0, totalSites - assessedSites),
    highRiskCount: Number(row.high_risk ?? 0),
    insufficientEvidenceCount: Number(row.insufficient ?? 0),
    highCount: Number(row.high_count ?? 0),
    mediumCount: Number(row.medium_count ?? 0),
    lowCount: Number(row.low_count ?? 0),
    averageScore: row.average_score == null ? null : Number(Number(row.average_score).toFixed(2)),
    averageEvidenceCoverage: row.average_coverage == null ? null : Number(Number(row.average_coverage).toFixed(2)),
    lastEvaluatedAt: row.last_evaluated_at == null ? null : Number(row.last_evaluated_at),
  };
}


export async function countSiteQualityAssessments(
  repo: Repository,
  band?: SiteQualityResult["band"],
): Promise<number> {
  const where = ["s.deleted_at IS NULL"];
  const params: unknown[] = [];
  if (band) {
    where.push("q.band = ?");
    params.push(band);
  }
  const rows = await repo.raw(
    `SELECT COUNT(*) AS total
       FROM site_quality_assessments q
       JOIN sites s ON s.id = q.site_id
      WHERE ${where.join(" AND ")}`,
    params,
  );
  return Number(rows[0]?.total ?? 0);
}
