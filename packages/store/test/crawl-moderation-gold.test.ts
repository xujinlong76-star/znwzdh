import { afterEach, describe, expect, it } from "vitest";
import { openDb, Repository } from "../src/index.ts";
import {
  adjudicateCrawlModerationGoldCase,
  annotateCrawlModerationGoldCase,
  createCrawlModerationGoldCase,
  getCrawlModerationGoldCase,
  listCrawlModerationGoldAnnotations,
  listCrawlModerationGoldCases,
} from "../src/index.ts";

describe("人工金标双人标注与仲裁", () => {
  let repository: Repository | null = null;

  afterEach(async () => {
    if (repository) await repository.db.close();
    repository = null;
  });

  async function setup() {
    const db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repository = new Repository(db);
    return repository;
  }

  it("金标队列查询支持超过 100 条的数据集分页", async () => {
    const repo = await setup();
    for (let index = 0; index < 105; index++) {
      await createCrawlModerationGoldCase(repo, {
        id: "gold-page-" + index,
        sourceFingerprint: "page-" + String(index).padStart(64, "0"),
        title: "分页样本 " + index,
        createdBy: "admin-creator",
      });
    }
    const rows = await listCrawlModerationGoldCases(repo, { limit: 5000 });
    expect(rows).toHaveLength(105);
  });

  it("两位标注员一致时自动形成金标", async () => {
    const repo = await setup();
    await createCrawlModerationGoldCase(repo, {
      id: "gold-consensus", sourceFingerprint: "a".repeat(64),
      title: "脱敏样本", createdBy: "admin-creator",
    });
    const first = await annotateCrawlModerationGoldCase(repo, {
      id: "annotation-a", caseId: "gold-consensus", annotatorId: "reviewer-a",
      label: "approve", risk: false, evidence: "网站内容完整且具有明确使用价值",
    });
    expect(first).toBe("annotating");
    const second = await annotateCrawlModerationGoldCase(repo, {
      id: "annotation-b", caseId: "gold-consensus", annotatorId: "reviewer-b",
      label: "approve", risk: false, evidence: "页面信息与服务说明均符合收录标准",
    });
    expect(second).toBe("gold_ready");
    const gold = await getCrawlModerationGoldCase(repo, "gold-consensus");
    expect(gold?.status).toBe("gold_ready");
    expect(gold?.final_label).toBe("approve");
    expect(Boolean(gold?.final_risk)).toBe(false);
  });

  it("同一采集候选来源指纹不能并发重复进入金标队列", async () => {
    const repo = await setup();
    const fingerprint = "candidate:" + "c".repeat(64);
    await createCrawlModerationGoldCase(repo, {
      id: "gold-candidate-first", sourceFingerprint: fingerprint,
      title: "真实采集候选", createdBy: "admin-a",
    });
    await expect(createCrawlModerationGoldCase(repo, {
      id: "gold-candidate-duplicate", sourceFingerprint: fingerprint,
      title: "重复候选", createdBy: "admin-b",
    })).rejects.toThrow();
    const rows = await repo.raw(
      "SELECT id FROM crawl_moderation_gold_cases WHERE source_fingerprint = ?",
      [fingerprint],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("gold-candidate-first");
  });

  it("标注任务双席位互斥，过期租约可回收且保留历史", async () => {
    const repo = await setup();
    await createCrawlModerationGoldCase(repo, {
      id: "gold-task-claims", sourceFingerprint: "d".repeat(64),
      title: "任务领取测试", createdBy: "admin-creator",
    });
    const now = Date.now();
    await repo.run(
      "INSERT INTO crawl_moderation_gold_assignments (id,case_id,annotator_id,slot,status,lease_expires_at,created_at,claimed_at) VALUES (?,?,?,?,?,?,?,?)",
      ["claim-a", "gold-task-claims", "reviewer-a", 1, "claimed", now + 60_000, now, now],
    );
    await repo.run(
      "INSERT INTO crawl_moderation_gold_assignments (id,case_id,annotator_id,slot,status,lease_expires_at,created_at,claimed_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
      ["claim-a-duplicate", "gold-task-claims", "reviewer-b", 1, "claimed", now + 60_000, now, now],
    );
    await repo.run(
      "INSERT INTO crawl_moderation_gold_assignments (id,case_id,annotator_id,slot,status,lease_expires_at,created_at,claimed_at) VALUES (?,?,?,?,?,?,?,?)",
      ["claim-b", "gold-task-claims", "reviewer-b", 2, "claimed", now + 60_000, now, now],
    );
    const activeBefore = await repo.raw(
      "SELECT id FROM crawl_moderation_gold_assignments WHERE case_id=? AND status='claimed'",
      ["gold-task-claims"],
    );
    expect(activeBefore).toHaveLength(2);
    await repo.run(
      "UPDATE crawl_moderation_gold_assignments SET status='expired' WHERE id='claim-a'",
      [],
    );
    await repo.run(
      "INSERT INTO crawl_moderation_gold_assignments (id,case_id,annotator_id,slot,status,lease_expires_at,created_at,claimed_at) VALUES (?,?,?,?,?,?,?,?)",
      ["claim-c", "gold-task-claims", "reviewer-c", 1, "claimed", now + 60_000, now, now],
    );
    const history = await repo.raw(
      "SELECT status FROM crawl_moderation_gold_assignments WHERE case_id=? ORDER BY id",
      ["gold-task-claims"],
    );
    expect(history).toHaveLength(3);
    expect(history.filter(row => row.status === "claimed")).toHaveLength(2);
    expect(history.filter(row => row.status === "expired")).toHaveLength(1);
  });

  it("标签或风险意见不一致时进入仲裁，且独立仲裁人才能完成金标", async () => {
    const repo = await setup();
    await createCrawlModerationGoldCase(repo, {
      id: "gold-dispute", sourceFingerprint: "b".repeat(64),
      title: "存在分歧的脱敏样本", createdBy: "admin-creator",
    });
    await annotateCrawlModerationGoldCase(repo, {
      id: "annotation-c", caseId: "gold-dispute", annotatorId: "reviewer-c",
      label: "approve", risk: false, evidence: "页面结构完整，内容具有实际用途",
    });
    const second = await annotateCrawlModerationGoldCase(repo, {
      id: "annotation-d", caseId: "gold-dispute", annotatorId: "reviewer-d",
      label: "review", risk: true, evidence: "页面存在尚未排除的风险线索",
    });
    expect(second).toBe("needs_adjudication");
    const annotations = await listCrawlModerationGoldAnnotations(repo, "gold-dispute");
    expect(annotations).toHaveLength(2);
    expect(await adjudicateCrawlModerationGoldCase(repo, {
      caseId: "gold-dispute", adjudicatorId: "reviewer-e",
      label: "review", risk: true, reason: "证据仍不足以支持安全收录，保留人工复核结论",
    })).toBe(true);
    const gold = await getCrawlModerationGoldCase(repo, "gold-dispute");
    expect(gold?.status).toBe("gold_ready");
    expect(gold?.final_label).toBe("review");
    expect(gold?.adjudicator_id).toBe("reviewer-e");
    expect(gold?.adjudication_reason).toContain("证据仍不足");
  });
});
