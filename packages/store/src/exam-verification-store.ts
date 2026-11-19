/**
 * 考试核验仓储（01-verification-workflow §2.5 / §2.6 / §8）。
 *
 * 两张表 exam_verifications / exam_corrections 的读写入口（Drizzle sqlite 先行，
 * 裁决 D1）。SQL 用 `?` 占位符手写、PG 分支经 toPgSql 翻成 $n，与 migrate.ts /
 * repository/io.ts 同款方言写法；不走 db.orm（orm 按 sqlite 定型，PG 上不可靠）。
 *
 * 校验（写进函数，不许自由搭配）：
 *  - verdict / rating 合法组合（§2.5 表）：verified→true/mostly_true；
 *    false→mostly_false/false/pants_on_fire；unverifiable→rating 必须为空。
 *    half_true 在 §2.5 表里没有合法 verdict，一律拒绝。
 *  - 更正草稿分支（§9.3）：仅 how_discovered='reader_tip' 的草稿行允许
 *    corrected_text 为空；草稿行 original_published_at 与 correction_published_at
 *    可为 NULL（R3：未知即 NULL，不得用举报时间占位）；正式更正行 corrected_text
 *    与两时间戳必填。
 */
import { createHash } from "node:crypto";
import type { Db } from "./driver.ts";
import { toPgSql } from "./repository/dialect.ts";

export type ExamVerificationLevel = "official" | "reprint" | "unverified";
export type ExamVerdict = "verified" | "false" | "unverifiable";
export type ExamRating =
  | "true"
  | "mostly_true"
  | "half_true"
  | "mostly_false"
  | "false"
  | "pants_on_fire";
export type ExamConfidence = "high" | "medium" | "low";
export type ExamSourceKind = "official_announcement" | "reprint" | "snapshot" | "other";
export type ExamErrorType = "factual" | "date" | "url" | "attribution" | "context";
export type ExamHowDiscovered = "reader_tip" | "internal_review" | "source_complaint";
export type ExamCorrectionLocation = "in_article" | "corrections_page" | "both";

export interface ExamVerificationRecord {
  id: number;
  examId: string;
  nodeLabel: string;
  assertion: string;
  assertionHash: string;
  verificationLevel: string;
  verdict: string;
  rating: string | null;
  confidence: string;
  sourceUrl: string | null;
  sourceKind: string;
  archivedUrl: string | null;
  archivedTimestamp: string | null;
  archivedDigest: string | null;
  checkedAt: number;
  checkedBy: string;
  reviewedBy: string | null;
  evidenceJson: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ExamCorrectionRecord {
  id: number;
  examId: string;
  nodeLabel: string;
  assertionHash: string;
  originalText: string;
  correctedText: string | null;
  errorType: string;
  reason: string;
  howDiscovered: string;
  originalPublishedAt: number | null;
  correctionPublishedAt: number | null;
  location: string;
  correctedBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface InsertExamVerificationInput {
  examId: string;
  nodeLabel: string;
  assertion: string;
  verificationLevel: ExamVerificationLevel;
  verdict: ExamVerdict;
  rating?: ExamRating | null;
  confidence: ExamConfidence;
  sourceUrl?: string | null;
  sourceKind?: ExamSourceKind;
  archivedUrl?: string | null;
  archivedTimestamp?: string | null;
  archivedDigest?: string | null;
  checkedAt: number;
  checkedBy: string;
  reviewedBy?: string | null;
  evidenceJson?: string;
  notes?: string | null;
}

export interface InsertExamCorrectionInput {
  examId: string;
  nodeLabel: string;
  assertionHash: string;
  originalText: string;
  /** 草稿行（仅 reader_tip）可为空；正式更正行必填 */
  correctedText?: string | null;
  errorType: ExamErrorType;
  reason: string;
  howDiscovered: ExamHowDiscovered;
  /** 草稿行可为 null（未知即 NULL，R3）；正式更正行必填 */
  originalPublishedAt: number | null;
  /** 草稿行未发布时为空；正式更正行必填 */
  correctionPublishedAt?: number | null;
  location?: ExamCorrectionLocation;
  correctedBy: string;
}

/** 断言指纹：assertion 规范化后（去首尾空白、连续空白折叠为单空格）的 SHA-256 hex 小写。 */
export function assertionHash(assertion: string): string {
  const normalized = assertion.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** verdict → 允许的 rating（§2.5 表；unverifiable 对应空列表 = rating 必须为空）。 */
const VERDICT_RATINGS: Readonly<Record<ExamVerdict, readonly ExamRating[]>> = {
  verified: ["true", "mostly_true"],
  false: ["mostly_false", "false", "pants_on_fire"],
  unverifiable: [],
};

const VERIFICATION_LEVELS: readonly string[] = ["official", "reprint", "unverified"];
const CONFIDENCES: readonly string[] = ["high", "medium", "low"];
const SOURCE_KINDS: readonly string[] = ["official_announcement", "reprint", "snapshot", "other"];
const ERROR_TYPES: readonly string[] = ["factual", "date", "url", "attribution", "context"];
const HOW_DISCOVERED_VALUES: readonly string[] = ["reader_tip", "internal_review", "source_complaint"];
const LOCATIONS: readonly string[] = ["in_article", "corrections_page", "both"];

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`[exam-verification] ${field} 不能为空`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`[exam-verification] ${field} 必须是有限数字（毫秒时间戳）`);
  }
  return value;
}

function requireEnum(value: string, allowed: readonly string[], field: string): void {
  if (!allowed.includes(value)) {
    throw new Error(`[exam-verification] ${field} 非法：${value}（允许：${allowed.join(" / ")}）`);
  }
}

/** §2.5 表：verdict 与 rating 的合法组合，不合法就抛错（不落库）。 */
function validateVerdictRating(verdict: string, rating: string | null | undefined): void {
  const allowed = (VERDICT_RATINGS as Readonly<Record<string, readonly string[]>>)[verdict];
  if (!allowed) {
    throw new Error(
      `[exam-verification] verdict 非法：${verdict}（允许：verified / false / unverifiable）`,
    );
  }
  if (verdict === "unverifiable") {
    if (rating !== null && rating !== undefined && rating !== "") {
      throw new Error("[exam-verification] verdict='unverifiable' 时 rating 必须为空");
    }
    return;
  }
  if (rating === null || rating === undefined || rating === "") {
    throw new Error(`[exam-verification] verdict='${verdict}' 时 rating 不能为空`);
  }
  if (!allowed.includes(rating)) {
    throw new Error(
      `[exam-verification] verdict='${verdict}' 时 rating 只允许 ${allowed.join(" / ")}，收到：${rating}`,
    );
  }
}

// ---------- 方言无关的读写小件（同 migrate.ts 的 read/write 写法） ----------

type Row = Record<string, unknown>;

async function queryAll(db: Db, sqlText: string, params: unknown[]): Promise<Row[]> {
  if (db.dialect !== "pg" && db.sqlite) {
    const maybe = db.sqlite.prepare(sqlText).all(...params) as unknown;
    const rows = maybe && typeof (maybe as { then?: unknown }).then === "function"
      ? await (maybe as Promise<Row[]>)
      : (maybe as Row[]);
    return rows;
  }
  if (!db.pg) throw new Error("[exam-verification] 未连接数据库（sqlite 与 pg 均不可用）");
  return (await db.pg.query(toPgSql(sqlText), params)).rows as Row[];
}

async function insertAndGetId(db: Db, sqlText: string, params: unknown[]): Promise<number> {
  if (db.dialect !== "pg" && db.sqlite) {
    const maybe = db.sqlite.prepare(sqlText).run(...params) as unknown;
    const info = maybe && typeof (maybe as { then?: unknown }).then === "function"
      ? await (maybe as Promise<{ lastInsertRowid?: number | bigint }>)
      : (maybe as { lastInsertRowid?: number | bigint });
    return Number(info?.lastInsertRowid);
  }
  if (!db.pg) throw new Error("[exam-verification] 未连接数据库（sqlite 与 pg 均不可用）");
  const res = await db.pg.query(`${toPgSql(sqlText)} RETURNING id`, params);
  return Number((res.rows as Row[])[0]?.["id"]);
}

const VERIFICATION_COLUMNS =
  "id, exam_id, node_label, assertion, assertion_hash, verification_level, verdict, rating, " +
  "confidence, source_url, source_kind, archived_url, archived_timestamp, archived_digest, " +
  "checked_at, checked_by, reviewed_by, evidence_json, notes, created_at, updated_at";

const CORRECTION_COLUMNS =
  "id, exam_id, node_label, assertion_hash, original_text, corrected_text, error_type, reason, " +
  "how_discovered, original_published_at, correction_published_at, location, corrected_by, " +
  "created_at, updated_at";

function rowToVerification(row: Row): ExamVerificationRecord {
  return {
    id: Number(row["id"]),
    examId: String(row["exam_id"]),
    nodeLabel: String(row["node_label"]),
    assertion: String(row["assertion"]),
    assertionHash: String(row["assertion_hash"]),
    verificationLevel: String(row["verification_level"]),
    verdict: String(row["verdict"]),
    rating: row["rating"] === null || row["rating"] === undefined ? null : String(row["rating"]),
    confidence: String(row["confidence"]),
    sourceUrl: row["source_url"] === null || row["source_url"] === undefined ? null : String(row["source_url"]),
    sourceKind: String(row["source_kind"]),
    archivedUrl: row["archived_url"] === null || row["archived_url"] === undefined ? null : String(row["archived_url"]),
    archivedTimestamp: row["archived_timestamp"] === null || row["archived_timestamp"] === undefined ? null : String(row["archived_timestamp"]),
    archivedDigest: row["archived_digest"] === null || row["archived_digest"] === undefined ? null : String(row["archived_digest"]),
    checkedAt: Number(row["checked_at"]),
    checkedBy: String(row["checked_by"]),
    reviewedBy: row["reviewed_by"] === null || row["reviewed_by"] === undefined ? null : String(row["reviewed_by"]),
    evidenceJson: String(row["evidence_json"]),
    notes: row["notes"] === null || row["notes"] === undefined ? null : String(row["notes"]),
    createdAt: Number(row["created_at"]),
    updatedAt: Number(row["updated_at"]),
  };
}

function rowToCorrection(row: Row): ExamCorrectionRecord {
  return {
    id: Number(row["id"]),
    examId: String(row["exam_id"]),
    nodeLabel: String(row["node_label"]),
    assertionHash: String(row["assertion_hash"]),
    originalText: String(row["original_text"]),
    correctedText: row["corrected_text"] === null || row["corrected_text"] === undefined ? null : String(row["corrected_text"]),
    errorType: String(row["error_type"]),
    reason: String(row["reason"]),
    howDiscovered: String(row["how_discovered"]),
    originalPublishedAt: row["original_published_at"] === null || row["original_published_at"] === undefined
      ? null
      : Number(row["original_published_at"]),
    correctionPublishedAt: row["correction_published_at"] === null || row["correction_published_at"] === undefined
      ? null
      : Number(row["correction_published_at"]),
    location: String(row["location"]),
    correctedBy: String(row["corrected_by"]),
    createdAt: Number(row["created_at"]),
    updatedAt: Number(row["updated_at"]),
  };
}

async function getRowById(db: Db, table: string, columns: string, id: number): Promise<Row> {
  const rows = await queryAll(db, `SELECT ${columns} FROM ${table} WHERE id = ?`, [id]);
  const row = rows[0];
  if (!row) throw new Error(`[exam-verification] 写入后回读失败：${table} id=${id}`);
  return row;
}

// ---------- 写 ----------

export async function insertExamVerification(
  db: Db,
  input: InsertExamVerificationInput,
): Promise<ExamVerificationRecord> {
  const examId = requireNonEmpty(input.examId, "examId");
  const nodeLabel = requireNonEmpty(input.nodeLabel, "nodeLabel");
  const assertion = requireNonEmpty(input.assertion, "assertion");
  requireEnum(input.verificationLevel, VERIFICATION_LEVELS, "verificationLevel");
  requireEnum(input.confidence, CONFIDENCES, "confidence");
  if (input.sourceKind !== undefined && input.sourceKind !== null) {
    requireEnum(input.sourceKind, SOURCE_KINDS, "sourceKind");
  }
  validateVerdictRating(input.verdict, input.rating ?? null);
  const checkedAt = requireFiniteNumber(input.checkedAt, "checkedAt");
  const checkedBy = requireNonEmpty(input.checkedBy, "checkedBy");
  const hash = assertionHash(assertion);
  const nowMs = Date.now();
  const id = await insertAndGetId(
    db,
    `INSERT INTO exam_verifications (${VERIFICATION_COLUMNS.replace(/^id, /, "")}) ` +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      examId,
      nodeLabel,
      assertion,
      hash,
      input.verificationLevel,
      input.verdict,
      input.rating ?? null,
      input.confidence,
      input.sourceUrl ?? null,
      input.sourceKind ?? "official_announcement",
      input.archivedUrl ?? null,
      input.archivedTimestamp ?? null,
      input.archivedDigest ?? null,
      checkedAt,
      checkedBy,
      input.reviewedBy ?? null,
      input.evidenceJson ?? "[]",
      input.notes ?? null,
      nowMs,
      nowMs,
    ],
  );
  return rowToVerification(await getRowById(db, "exam_verifications", VERIFICATION_COLUMNS, id));
}

export async function insertExamCorrection(
  db: Db,
  input: InsertExamCorrectionInput,
): Promise<ExamCorrectionRecord> {
  const examId = requireNonEmpty(input.examId, "examId");
  const nodeLabel = requireNonEmpty(input.nodeLabel, "nodeLabel");
  const hash = requireNonEmpty(input.assertionHash, "assertionHash");
  const originalText = requireNonEmpty(input.originalText, "originalText");
  requireEnum(input.errorType, ERROR_TYPES, "errorType");
  requireEnum(input.howDiscovered, HOW_DISCOVERED_VALUES, "howDiscovered");
  if (input.location !== undefined && input.location !== null) {
    requireEnum(input.location, LOCATIONS, "location");
  }
  const reason = requireNonEmpty(input.reason, "reason");
  const correctedBy = requireNonEmpty(input.correctedBy, "correctedBy");

  // 草稿分支（§9.3）：corrected_text 为空只允许 how_discovered='reader_tip' 的草稿行。
  const correctedText = input.correctedText === null || input.correctedText === undefined
    ? null
    : input.correctedText.trim() === ""
      ? null
      : input.correctedText;
  const isDraft = correctedText === null;
  if (isDraft && input.howDiscovered !== "reader_tip") {
    throw new Error(
      "[exam-verification] corrected_text 为空只允许 how_discovered='reader_tip' 的草稿行",
    );
  }
  // R3：两时间戳草稿行可为 NULL（未知即 NULL，不得用举报时间占位冒充原文发布时间）；
  // 正式更正行两者必填（更正注须带原文发布与更正发布日期，§6.3）。草稿行若传了
  // 时间戳，仍须为有限数字（拒绝 NaN / Infinity 入库）。
  let originalPublishedAt: number | null = null;
  let correctionPublishedAt: number | null = null;
  if (!isDraft) {
    originalPublishedAt = requireFiniteNumber(
      input.originalPublishedAt,
      "originalPublishedAt（正式更正行必填）",
    );
    correctionPublishedAt = requireFiniteNumber(
      input.correctionPublishedAt,
      "correctionPublishedAt（正式更正行必填）",
    );
  } else {
    if (input.originalPublishedAt !== null && input.originalPublishedAt !== undefined) {
      originalPublishedAt = requireFiniteNumber(input.originalPublishedAt, "originalPublishedAt");
    }
    if (input.correctionPublishedAt !== null && input.correctionPublishedAt !== undefined) {
      correctionPublishedAt = requireFiniteNumber(input.correctionPublishedAt, "correctionPublishedAt");
    }
  }

  const nowMs = Date.now();
  const id = await insertAndGetId(
    db,
    `INSERT INTO exam_corrections (${CORRECTION_COLUMNS.replace(/^id, /, "")}) ` +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      examId,
      nodeLabel,
      hash,
      originalText,
      correctedText,
      input.errorType,
      reason,
      input.howDiscovered,
      originalPublishedAt,
      correctionPublishedAt,
      input.location ?? "both",
      correctedBy,
      nowMs,
      nowMs,
    ],
  );
  return rowToCorrection(await getRowById(db, "exam_corrections", CORRECTION_COLUMNS, id));
}

export interface RecordConflictRulingInput {
  examId: string;
  nodeLabel: string;
  /** 被裁决的断言原文（如 '天津成考复核 11-19 09:00–18:00'）。 */
  assertion: string;
  /**
   * 裁决前 verification_level（§13 diff 用）。缺省时取裁决时快照：该节点
   * 最新核查行的级别；无既往核查行即从未核实过，before 为 'unverified'
   *（Y10：不得写死字面值——有既往行时取行值；也不得以 exam-calendar.ts
   * 当前文件值作 before，该文件在裁决落定后已是裁决后级别）。
   */
  verificationLevelBefore?: ExamVerificationLevel;
  /** 裁决后 verification_level（§13 diff 用；§5.1 第 2 条：裁决后强制 reprint，例外挂起时为 unverified）。 */
  verificationLevelAfter: ExamVerificationLevel;
  /** 冲突一方：来源 URL + 该来源的主张（逐字，不拼贴、不取平均，§5.1 第 3 条）。 */
  sourceAUrl: string;
  sourceAClaim: string;
  /** 冲突另一方：来源 URL + 该来源的主张。 */
  sourceBUrl: string;
  sourceBClaim: string;
  /** 裁决结论（如 '采信库内值：天津成考复核窗口确为 11-19 09:00–18:00、已关闭'）。 */
  ruling: string;
  /** 裁决依据（如 'eol.cn 2026-10-22 原文自述 11-20 12:00 是 2025 年窗口…'）。 */
  rulingBasis: string;
  /** 裁决后该断言的定级；缺省 verified/true（采信一方主张时）。 */
  verdict?: ExamVerdict;
  rating?: ExamRating | null;
  confidence?: ExamConfidence;
  /** 裁决所依据的来源 URL（缺省取 sourceAUrl，即被采信方）；sourceKind 缺省 'reprint'。 */
  sourceUrl?: string | null;
  sourceKind?: ExamSourceKind;
  checkedAt: number;
  checkedBy: string;
  reviewedBy?: string | null;
  evidenceJson?: string;
  /** audit_logs actor（缺省 checkedBy）；actorKind 缺省 'agent'。 */
  actor?: string;
  actorKind?: string;
}

export interface RecordConflictRulingResult {
  verification: ExamVerificationRecord;
  auditId: number;
}

/**
 * 双源冲突裁决记录（01-verification-workflow §5.1 第 4 条 + §13 审计日志契约）。
 *
 * 一次写两处，缺一不可：
 *  - exam_verifications 一行：notes 为裁决正文（冲突双方来源 URL + 各自主张 +
 *    裁决结论 + 裁决依据），verdict/rating 按裁决后定级写；
 *  - audit_logs 一行：action='exam_verification_conflict_ruling'，target=
 *    'exam:<exam_id>:<node_label>'，diff 含 assertion_hash 与裁决前后
 *    verification_level（verification_level_before / verification_level_after）。
 *
 * 守卫：裁决正文的任一要素（双方 URL/主张、裁决结论、裁决依据）为空即拒绝写入，
 * 绝不产生“只降级、无记录”的裁决（§10 A9：0 条无记录裁决）。
 */
export async function recordConflictRuling(
  db: Db,
  input: RecordConflictRulingInput,
): Promise<RecordConflictRulingResult> {
  const examId = requireNonEmpty(input.examId, "examId");
  const nodeLabel = requireNonEmpty(input.nodeLabel, "nodeLabel");
  const assertion = requireNonEmpty(input.assertion, "assertion");
  // Y10：before 缺省时读裁决时快照——取该节点最新核查行的级别；无既往
  // 核查行即从未核实过，before 为 'unverified'。显式传入时以传入值为准。
  const verificationLevelBefore =
    input.verificationLevelBefore ??
    (await latestVerificationForNode(db, examId, nodeLabel))?.verificationLevel ??
    "unverified";
  requireEnum(verificationLevelBefore, VERIFICATION_LEVELS, "verificationLevelBefore");
  requireEnum(input.verificationLevelAfter, VERIFICATION_LEVELS, "verificationLevelAfter");
  const sourceAUrl = requireNonEmpty(input.sourceAUrl, "sourceAUrl");
  const sourceAClaim = requireNonEmpty(input.sourceAClaim, "sourceAClaim");
  const sourceBUrl = requireNonEmpty(input.sourceBUrl, "sourceBUrl");
  const sourceBClaim = requireNonEmpty(input.sourceBClaim, "sourceBClaim");
  const ruling = requireNonEmpty(input.ruling, "ruling");
  const rulingBasis = requireNonEmpty(input.rulingBasis, "rulingBasis");
  const verdict = input.verdict ?? "verified";
  const rating = input.rating === undefined ? (verdict === "unverifiable" ? null : "true") : input.rating;
  const confidence = input.confidence ?? "medium";
  const checkedAt = requireFiniteNumber(input.checkedAt, "checkedAt");
  const checkedBy = requireNonEmpty(input.checkedBy, "checkedBy");
  const actor = input.actor ?? checkedBy;
  const actorKind = input.actorKind ?? "agent";

  const notes =
    `双源冲突裁决（固定规则 D2：官方原文优先；冲突时降级并标注；不取平均、不拼贴）：\n` +
    `来源 A：${sourceAUrl}\n主张 A：${sourceAClaim}\n` +
    `来源 B：${sourceBUrl}\n主张 B：${sourceBClaim}\n` +
    `裁决：${ruling}\n裁决依据：${rulingBasis}\n` +
    `裁决后级别：${verificationLevelBefore} → ${input.verificationLevelAfter}。`;

  const verification = await insertExamVerification(db, {
    examId,
    nodeLabel,
    assertion,
    verificationLevel: input.verificationLevelAfter,
    verdict,
    rating,
    confidence,
    sourceUrl: input.sourceUrl === undefined ? sourceAUrl : input.sourceUrl,
    sourceKind: input.sourceKind ?? "reprint",
    checkedAt,
    checkedBy,
    reviewedBy: input.reviewedBy ?? null,
    evidenceJson: input.evidenceJson ?? "[]",
    notes,
  });

  const diff = JSON.stringify({
    assertion_hash: verification.assertionHash,
    verification_level_before: verificationLevelBefore,
    verification_level_after: input.verificationLevelAfter,
    verdict,
    rating,
    ruling,
  });
  const auditId = await insertAndGetId(
    db,
    "INSERT INTO audit_logs (actor, actor_kind, action, target, diff, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [actor, actorKind, "exam_verification_conflict_ruling", `exam:${examId}:${nodeLabel}`, diff, null, Date.now()],
  );
  return { verification, auditId };
}

// ---------- 读 ----------

/** 该节点最新一条核查（按 checked_at 取最新；无记录返回 null）。 */
export async function latestVerificationForNode(
  db: Db,
  examId: string,
  nodeLabel: string,
): Promise<ExamVerificationRecord | null> {
  const rows = await queryAll(
    db,
    `SELECT ${VERIFICATION_COLUMNS} FROM exam_verifications ` +
      "WHERE exam_id = ? AND node_label = ? ORDER BY checked_at DESC, id DESC LIMIT 1",
    [examId, nodeLabel],
  );
  return rows[0] ? rowToVerification(rows[0]) : null;
}

/** 同一断言的全部核查行（按 checked_at 倒序，即最新在前）。 */
export async function listVerificationsByHash(
  db: Db,
  hash: string,
): Promise<ExamVerificationRecord[]> {
  const rows = await queryAll(
    db,
    `SELECT ${VERIFICATION_COLUMNS} FROM exam_verifications ` +
      "WHERE assertion_hash = ? ORDER BY checked_at DESC, id DESC",
    [hash],
  );
  return rows.map(rowToVerification);
}

/** 该节点的全部更正行（按 correction_published_at 倒序；草稿行 null 排最后）。 */
export async function listCorrectionsForNode(
  db: Db,
  examId: string,
  nodeLabel: string,
): Promise<ExamCorrectionRecord[]> {
  const rows = await queryAll(
    db,
    `SELECT ${CORRECTION_COLUMNS} FROM exam_corrections ` +
      "WHERE exam_id = ? AND node_label = ? ORDER BY correction_published_at DESC NULLS LAST, id DESC",
    [examId, nodeLabel],
  );
  return rows.map(rowToCorrection);
}
