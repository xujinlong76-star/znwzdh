/**
 * 考试核验数据层（01-verification-workflow §2.5 / §2.6 / §10 A3·A11）。
 *
 * 覆盖：
 *  - 两张表建表 + 索引（openDb 启动即建，SQLite :memory: 库验证）；
 *  - 去重键：同一 (exam_id, node_label, assertion_hash) 多行以 checked_at 最新为准；
 *  - verdict / rating 合法组合逐条（方案 §2.5 表）；
 *  - assertionHash 规范化（去首尾空白、连续空白折叠为单空格）；
 *  - 更正草稿分支（§9.3）：仅 how_discovered='reader_tip' 的草稿行允许
 *    corrected_text 为空，正式更正行必填；
 *  - R3：草稿行 original_published_at 与 correction_published_at 可为 NULL
 *    （未知即 NULL，不得用举报时间占位）；正式更正行缺任一时间戳写失败；
 *  - 迁移幂等（A11）：20261119_exam_verifications 连续跑两次，第二次 0 报错，
 *    两表各建且仅建一次。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import {
  BUILTIN_MIGRATIONS,
  runVersionedMigrations,
} from "../src/migrations/schema-migrations.ts";
import {
  assertionHash,
  insertExamCorrection,
  insertExamVerification,
  latestVerificationForNode,
  listCorrectionsForNode,
  listVerificationsByHash,
  recordConflictRuling,
} from "../src/exam-verification-store.ts";

const EXAM_ID = "jingkao";
const NODE_LABEL = "报名";
const ASSERTION = "京考报名窗口 11-12 9:00–11-18 18:00";
const CHECKED_AT = Date.parse("2026-11-19T09:00:00+08:00");

function verificationInput(overrides: Record<string, unknown> = {}) {
  return {
    examId: EXAM_ID,
    nodeLabel: NODE_LABEL,
    assertion: ASSERTION,
    verificationLevel: "official" as const,
    verdict: "verified" as const,
    rating: "true" as const,
    confidence: "high" as const,
    sourceUrl: "http://rsj.beijing.gov.cn/bm/ztzl/gwy/",
    sourceKind: "official_announcement" as const,
    checkedAt: CHECKED_AT,
    checkedBy: "evolve-2026-11-19",
    evidenceJson: JSON.stringify([
      { kind: "official_document", url: "http://rsj.beijing.gov.cn/bm/ztzl/gwy/", note: "公告原文" },
    ]),
    ...overrides,
  };
}

function correctionInput(overrides: Record<string, unknown> = {}) {
  return {
    examId: EXAM_ID,
    nodeLabel: NODE_LABEL,
    assertionHash: assertionHash(ASSERTION),
    originalText: "天津成考复核 11-23 09:00",
    correctedText: "天津成考复核 11-19 17:00 公布",
    errorType: "date" as const,
    reason: "跨年份拼贴：2025 年公告刊出日与 2026 年公布时点拼错",
    howDiscovered: "internal_review" as const,
    originalPublishedAt: Date.parse("2026-11-18T10:00:00+08:00"),
    correctionPublishedAt: Date.parse("2026-11-19T12:00:00+08:00"),
    correctedBy: "evolve-2026-11-19",
    ...overrides,
  };
}

describe("考试核验数据层（01-verification-workflow §2.5/§2.6）", () => {
  let db: Db;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  });

  afterAll(async () => {
    await db.close();
  });

  it("两张表建表：exam_verifications 与 exam_corrections 及全部索引", () => {
    const tables = db.sqlite!
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('exam_verifications','exam_corrections')")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toEqual(["exam_corrections", "exam_verifications"]);

    const indexes = db.sqlite!
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'exam_%'")
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name).sort();
    expect(names).toEqual([
      "exam_corrections_exam_node_idx",
      "exam_corrections_hash_idx",
      "exam_corrections_published_idx",
      "exam_verifications_checked_idx",
      "exam_verifications_exam_node_idx",
      "exam_verifications_hash_idx",
    ]);
  });

  it("去重键：同一 (exam_id, node_label, assertion_hash) 多行以 checked_at 最新为准", async () => {
    const older = await insertExamVerification(db, verificationInput({ checkedAt: CHECKED_AT }));
    const newer = await insertExamVerification(
      db,
      verificationInput({ checkedAt: CHECKED_AT + 3_600_000, confidence: "medium" as const }),
    );
    // 同一断言、同一 hash：两行并存，不覆盖
    expect(newer.assertionHash).toBe(older.assertionHash);
    expect(newer.id).not.toBe(older.id);

    const latest = await latestVerificationForNode(db, EXAM_ID, NODE_LABEL);
    expect(latest?.id).toBe(newer.id);
    expect(latest?.confidence).toBe("medium");

    const byHash = await listVerificationsByHash(db, older.assertionHash);
    expect(byHash).toHaveLength(2);
    expect(byHash[0]?.id).toBe(newer.id); // checked_at 倒序
    expect(byHash[1]?.id).toBe(older.id);
  });

  it("latestVerificationForNode：无记录时返回 null", async () => {
    expect(await latestVerificationForNode(db, "no-such-exam", "不存在的节点")).toBeNull();
  });

  it("verdict/rating 合法组合逐条（§2.5 表）：合法的 6 组全部写入成功", async () => {
    const legal: Array<{ verdict: "verified" | "false" | "unverifiable"; rating: "true" | "mostly_true" | "mostly_false" | "false" | "pants_on_fire" | null }> = [
      { verdict: "verified", rating: "true" },
      { verdict: "verified", rating: "mostly_true" },
      { verdict: "false", rating: "mostly_false" },
      { verdict: "false", rating: "false" },
      { verdict: "false", rating: "pants_on_fire" },
      { verdict: "unverifiable", rating: null },
    ];
    for (const [i, combo] of legal.entries()) {
      const row = await insertExamVerification(
        db,
        verificationInput({
          assertion: `合法组合断言 ${i}`,
          checkedAt: CHECKED_AT + i * 1000,
          ...combo,
        }),
      );
      expect(row.verdict).toBe(combo.verdict);
      expect(row.rating).toBe(combo.rating);
    }
  });

  it("verdict/rating 合法组合逐条（§2.5 表）：非法组合全部抛错且不落库", async () => {
    const illegal: Array<Record<string, unknown>> = [
      { verdict: "verified", rating: null }, // verified 必须带 rating
      { verdict: "verified", rating: "false" }, // verified 只能是 true / mostly_true
      { verdict: "verified", rating: "half_true" }, // half_true 无合法 verdict
      { verdict: "false", rating: null }, // false 必须带 rating
      { verdict: "false", rating: "true" }, // false 只能是 mostly_false / false / pants_on_fire
      { verdict: "false", rating: "mostly_true" },
      { verdict: "unverifiable", rating: "true" }, // unverifiable 时 rating 必须为空
      { verdict: "unverifiable", rating: "mostly_false" },
      { verdict: "maybe", rating: null }, // 非法 verdict
      { verdict: "verified", rating: "bogus" }, // 非法 rating
    ];
    for (const combo of illegal) {
      await expect(
        insertExamVerification(
          db,
          verificationInput({ assertion: `非法组合断言 ${JSON.stringify(combo)}`, ...combo }),
        ),
      ).rejects.toThrow();
    }
    // 非法组合没有落库：按 hash 查不到
    expect(await listVerificationsByHash(db, assertionHash("非法组合断言"))).toHaveLength(0);
  });

  it("assertionHash：规范化后 SHA-256 hex 小写；空白差异不改变指纹", () => {
    const hash = assertionHash(ASSERTION);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(assertionHash(`  京考报名窗口   11-12 9:00–11-18   18:00 `)).toBe(hash);
    expect(assertionHash("另一条断言")).not.toBe(hash);
  });

  it("insertExamVerification：assertion_hash 由 assertion 派生，与 assertionHash() 一致", async () => {
    const row = await insertExamVerification(
      db,
      verificationInput({ assertion: "派生指纹断言", checkedAt: CHECKED_AT + 99_000 }),
    );
    expect(row.assertionHash).toBe(assertionHash("派生指纹断言"));
  });

  it("更正草稿分支（§9.3）：仅 reader_tip 草稿行允许 corrected_text 为空", async () => {
    const draft = await insertExamCorrection(
      db,
      correctionInput({
        howDiscovered: "reader_tip" as const,
        correctedText: "",
        correctionPublishedAt: null,
      }),
    );
    expect(draft.correctedText).toBeNull();
    expect(draft.correctionPublishedAt).toBeNull();

    // 非 reader_tip 的空 corrected_text 草稿：拒绝
    await expect(
      insertExamCorrection(
        db,
        correctionInput({ howDiscovered: "internal_review" as const, correctedText: "" }),
      ),
    ).rejects.toThrow();
    await expect(
      insertExamCorrection(
        db,
        correctionInput({ howDiscovered: "source_complaint" as const, correctedText: null }),
      ),
    ).rejects.toThrow();
  });

  it("R3 草稿行：两时间戳为 NULL 可入库（未知即 NULL，不用举报时间占位）", async () => {
    const draft = await insertExamCorrection(
      db,
      correctionInput({
        howDiscovered: "reader_tip" as const,
        correctedText: "",
        originalPublishedAt: null,
        correctionPublishedAt: null,
      }),
    );
    expect(draft.correctedText).toBeNull();
    expect(draft.originalPublishedAt).toBeNull();
    expect(draft.correctionPublishedAt).toBeNull();

    // 回读同一行：NULL 不是 0，仍为 NULL
    const rows = await listCorrectionsForNode(db, EXAM_ID, NODE_LABEL);
    const found = rows.find((r) => r.id === draft.id);
    expect(found?.originalPublishedAt).toBeNull();
    expect(found?.correctionPublishedAt).toBeNull();

    // 草稿行带真实时间戳仍可入库（不强制 NULL）
    const stamped = await insertExamCorrection(
      db,
      correctionInput({
        howDiscovered: "reader_tip" as const,
        correctedText: "",
        originalPublishedAt: Date.parse("2026-11-18T10:00:00+08:00"),
        correctionPublishedAt: null,
      }),
    );
    expect(stamped.originalPublishedAt).toBe(Date.parse("2026-11-18T10:00:00+08:00"));
  });

  it("正式更正行：corrected_text 与 correction_published_at 必填", async () => {
    await expect(
      insertExamCorrection(db, correctionInput({ correctedText: "   " })),
    ).rejects.toThrow();
    await expect(
      insertExamCorrection(db, correctionInput({ correctionPublishedAt: null })),
    ).rejects.toThrow();
    // R3：正式更正行缺 original_published_at 同样写失败
    await expect(
      insertExamCorrection(db, correctionInput({ originalPublishedAt: null })),
    ).rejects.toThrow();
    await expect(
      insertExamCorrection(db, correctionInput({ originalPublishedAt: undefined })),
    ).rejects.toThrow();
  });

  it("listCorrectionsForNode：按 correction_published_at 倒序返回该节点更正", async () => {
    await insertExamCorrection(db, correctionInput());
    const rows = await listCorrectionsForNode(db, EXAM_ID, NODE_LABEL);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // 正式行在前（有发布时间），草稿行（null）在后
    expect(rows[0]?.correctedText).toBe("天津成考复核 11-19 17:00 公布");
    expect(rows[rows.length - 1]?.correctedText).toBeNull();
    expect(await listCorrectionsForNode(db, "no-such-exam", "不存在的节点")).toEqual([]);
  });

  it("迁移幂等（A11）：20261119_exam_verifications 连续跑两次，第二次 0 报错且两表各建且仅建一次", async () => {
    const migration = BUILTIN_MIGRATIONS.find((m) => m.version === "20261119_exam_verifications");
    expect(migration).toBeDefined();

    const first = await runVersionedMigrations(db, { force: true, migrations: [migration!] });
    expect(first.applied).toEqual(["20261119_exam_verifications"]);
    const second = await runVersionedMigrations(db, { force: true, migrations: [migration!] });
    expect(second.applied).toEqual(["20261119_exam_verifications"]);

    for (const table of ["exam_verifications", "exam_corrections"]) {
      const count = db.sqlite!
        .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?")
        .get(table) as { c: number };
      expect(count.c).toBe(1);
    }
  });
});

describe("A8 更正流程闭环（R1）：verdict=false 行 → 最新行可查 → 更正行落库", () => {
  let db: Db;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  });

  afterAll(async () => {
    await db.close();
  });

  // 演练用例：correctedText 为虚构的演练值，仅验证 original_text 与旧节点文案
  // 逐字一致 + 行可查，不代表真实口径；真实更正须走七步流水线核查。
  const JINGKAO_APPLY_DETAIL =
    "11 月 12 日 9:00 至 11 月 18 日 18:00，登录北京市人事考试通用平台提交报考申请；未通过资格审查者可在 11 月 18 日 18:00 前改报其他职位";

  it("false 核查行写入后 latestVerificationForNode 可查到 verdict='false'（下架信号）", async () => {
    const row = await insertExamVerification(
      db,
      verificationInput({
        nodeLabel: "演练节点",
        assertion: "演练断言：京考报名窗口 11-12 9:00–11-18 18:00",
        verificationLevel: "reprint",
        verdict: "false",
        rating: "false",
        confidence: "low",
        checkedAt: CHECKED_AT + 500_000,
      }),
    );
    expect(row.verdict).toBe("false");
    const latest = await latestVerificationForNode(db, EXAM_ID, "演练节点");
    expect(latest?.id).toBe(row.id);
    expect(latest?.verdict).toBe("false");
  });

  it("写 exam_corrections 行：original_text 与旧节点文案逐字一致，且行可查", async () => {
    const hash = assertionHash("演练断言：京考报名窗口 11-12 9:00–11-18 18:00");
    const corrected = await insertExamCorrection(db, {
      examId: EXAM_ID,
      nodeLabel: "演练节点",
      assertionHash: hash,
      originalText: JINGKAO_APPLY_DETAIL,
      correctedText: JINGKAO_APPLY_DETAIL.replaceAll("18:00", "17:00"),
      errorType: "date",
      reason: "演练：截止时刻核查为 false，按 §6 更正流程公开更正",
      howDiscovered: "internal_review",
      originalPublishedAt: Date.parse("2026-11-17T10:00:00+08:00"),
      correctionPublishedAt: Date.parse("2026-11-19T15:00:00+08:00"),
      correctedBy: "evolve-2026-11-19",
    });
    expect(corrected.originalText).toBe(JINGKAO_APPLY_DETAIL);
    const rows = await listCorrectionsForNode(db, EXAM_ID, "演练节点");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.originalText).toBe(JINGKAO_APPLY_DETAIL);
    expect(rows[0]?.correctedText).toContain("17:00");
  });
});

describe("A9 双源冲突裁决记录（R2）：recordConflictRuling", () => {
  let db: Db;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  });

  afterAll(async () => {
    await db.close();
  });

  // 天津 D2 裁决（2026-11-20 02:35 紧急核实结论 A，已核实内容）：
  // 采信库内值，窗口确为 11-19 09:00–18:00、已关闭；11-20 12:00 是 eol.cn
  // 所标的 2025 年窗口；节点仍为 reprint 级（zhaokao.net 官方原文仍未直读到）。
  // Y10：裁决前级别不写死——缺省由 recordConflictRuling() 按库内快照推导；
  // 天津裁决时无既往核查行，故 before 为 unverified（F1b 自认快照仍为
  // unverified/low），diff 应为 unverified → reprint。
  const TIANJIN_RULING = {
    examId: "chengkao",
    nodeLabel: "天津成绩复核",
    assertion: "天津成考复核 11-19 09:00–18:00",
    verificationLevelAfter: "reprint" as const,
    sourceAUrl: "https://www.hqwx.com/chengrengk-kaoshi/news/17859084897258.html",
    sourceAClaim: "天津成考复核 11 月 19 日 9 时至 18 时网上申请缴费；复核结果 11 月 25 日 9 时至 11 月 30 日 17 时可查",
    sourceBUrl: "https://www.eol.cn/chengkao/ck-tjckdy/20261022152837.html",
    sourceBClaim: "2025 年的复核时段为 11 月 19 日 9 时至 20 日 12 时；2026 年沿用同一节奏，具体时段以当次公告为准；复核申请为现场办理",
    ruling: "采信库内值：天津成考复核窗口确为 11-19 09:00–18:00、已关闭；PEAK 与 chip 的“已截止”显示正确，无需改动",
    rulingBasis:
      "11-20 12:00 已证实是 eol.cn 所标的 2025 年窗口——eol.cn 2026-10-22 原文自述“2025年的复核时段为11月19日9时至20日12时；2026年沿用同一节奏，具体时段以当次公告为准”；其“现场办理”描述与 2026 年实际“网上申请缴费”矛盾；全网无信源称 2026 年窗口到 11-20 12:00；zhaokao.net 官方原文仍未直读到，节点仍为转载级",
    checkedAt: Date.parse("2026-11-20T02:35:00+08:00"),
    checkedBy: "batch0-fix-f1",
  };

  it("裁决写入后 notes 与 audit 行均可查（天津 D2）", async () => {
    const { verification, auditId } = await recordConflictRuling(db, TIANJIN_RULING);
    expect(verification.verdict).toBe("verified");
    expect(verification.verificationLevel).toBe("reprint");
    expect(verification.notes).toContain(TIANJIN_RULING.sourceAUrl);
    expect(verification.notes).toContain(TIANJIN_RULING.sourceAClaim);
    expect(verification.notes).toContain(TIANJIN_RULING.sourceBUrl);
    expect(verification.notes).toContain(TIANJIN_RULING.sourceBClaim);
    expect(verification.notes).toContain(TIANJIN_RULING.ruling);
    expect(verification.notes).toContain(TIANJIN_RULING.rulingBasis);

    const audits = db.sqlite!
      .prepare("SELECT id, actor, action, target, diff FROM audit_logs WHERE action = 'exam_verification_conflict_ruling' AND id = ?")
      .all(auditId) as Array<{ id: number; actor: string; action: string; target: string; diff: string }>;
    expect(audits).toHaveLength(1);
    expect(audits[0]?.target).toBe("exam:chengkao:天津成绩复核");
    const diff = JSON.parse(audits[0]!.diff) as Record<string, unknown>;
    expect(diff["assertion_hash"]).toBe(verification.assertionHash);
    // Y10：裁决时快照为 unverified（无既往核查行），diff 须为 unverified → reprint，
    // 不得是 reprint → reprint 空转。
    expect(diff["verification_level_before"]).toBe("unverified");
    expect(diff["verification_level_after"]).toBe("reprint");
    expect(verification.notes).toContain("裁决后级别：unverified → reprint。");
  });

  it("before 缺省时读快照：有既往核查行取行值（official → reprint）", async () => {
    // 既往行：演练节点先有一行 official 核查，裁决时快照即为 official。
    await insertExamVerification(
      db,
      verificationInput({
        nodeLabel: "演练节点",
        assertion: "演练断言：快照取行值",
        verificationLevel: "official" as const,
      }),
    );
    const { verification, auditId } = await recordConflictRuling(db, {
      ...TIANJIN_RULING,
      examId: EXAM_ID,
      nodeLabel: "演练节点",
      assertion: "演练断言：快照取行值",
      verificationLevelAfter: "reprint",
      ruling: "演练裁决：快照 official → reprint",
    });
    const audits = db.sqlite!
      .prepare("SELECT diff FROM audit_logs WHERE id = ?")
      .all(auditId) as Array<{ diff: string }>;
    const diff = JSON.parse(audits[0]!.diff) as Record<string, unknown>;
    expect(diff["assertion_hash"]).toBe(verification.assertionHash);
    expect(diff["verification_level_before"]).toBe("official");
    expect(diff["verification_level_after"]).toBe("reprint");
    expect(verification.notes).toContain("裁决后级别：official → reprint。");
  });

  it("裁决降级记入 diff：official → reprint 的裁决前后级别可查", async () => {
    const { verification, auditId } = await recordConflictRuling(db, {
      ...TIANJIN_RULING,
      assertion: "演练断言：双源冲突降级",
      verificationLevelBefore: "official",
      verificationLevelAfter: "reprint",
      ruling: "演练裁决：冲突时降级为转载级并标注",
    });
    const audits = db.sqlite!
      .prepare("SELECT diff FROM audit_logs WHERE id = ?")
      .all(auditId) as Array<{ diff: string }>;
    const diff = JSON.parse(audits[0]!.diff) as Record<string, unknown>;
    expect(diff["assertion_hash"]).toBe(verification.assertionHash);
    expect(diff["verification_level_before"]).toBe("official");
    expect(diff["verification_level_after"]).toBe("reprint");
  });

  it("守卫：无 notes 要素的裁决拒绝写入（0 条无记录裁决）", async () => {
    const hash = assertionHash("演练断言：无记录裁决应被拒绝");
    await expect(
      recordConflictRuling(db, {
        ...TIANJIN_RULING,
        assertion: "演练断言：无记录裁决应被拒绝",
        rulingBasis: "",
      }),
    ).rejects.toThrow();
    await expect(
      recordConflictRuling(db, {
        ...TIANJIN_RULING,
        assertion: "演练断言：无记录裁决应被拒绝",
        sourceBClaim: "   ",
      }),
    ).rejects.toThrow();
    await expect(
      recordConflictRuling(db, {
        ...TIANJIN_RULING,
        assertion: "演练断言：无记录裁决应被拒绝",
        ruling: "",
      }),
    ).rejects.toThrow();
    // 三次拒绝均未落库：该断言无核查行、无 audit 行
    expect(await listVerificationsByHash(db, hash)).toHaveLength(0);
    const audits = db.sqlite!
      .prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'exam_verification_conflict_ruling' AND diff LIKE ?")
      .get(`%${hash}%`) as { c: number };
    expect(audits.c).toBe(0);
  });
});
