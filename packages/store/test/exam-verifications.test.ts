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
