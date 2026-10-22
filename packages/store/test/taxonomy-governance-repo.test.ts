import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import type { TaxonomyProposal } from "@navhub/core";

describe("Taxonomy Phase 4: AI Taxonomy Governance Repository", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it("支持治理提案的保存、幂等更新与分页多维筛选", async () => {
    const p1: TaxonomyProposal = {
      id: "prop-1",
      kind: "tag_consolidation",
      targetId: "reactjs",
      targetTitle: "reactjs",
      currentValue: "reactjs",
      suggestedValue: "React",
      confidence: 0.95,
      reason: "大小写归一建议",
      status: "pending",
      createdAt: Date.now() - 1000,
    };

    const p2: TaxonomyProposal = {
      id: "prop-2",
      kind: "zero_result_gap",
      targetId: "WebAssembly",
      suggestedValue: "WebAssembly",
      confidence: 0.88,
      reason: "高频零结果缺口",
      status: "pending",
      createdAt: Date.now(),
    };

    const saved = await repo.saveTaxonomyProposals([p1, p2]);
    expect(saved).toBe(2);

    // 筛选全部
    const all = await repo.listTaxonomyProposals();
    expect(all.total).toBe(2);
    expect(all.items.map((i) => i.id)).toContain("prop-1");

    // 筛选 kind
    const tagsOnly = await repo.listTaxonomyProposals({ kind: "tag_consolidation" });
    expect(tagsOnly.total).toBe(1);
    expect(tagsOnly.items[0].id).toBe("prop-1");

    // 幂等更新
    const p1Updated: TaxonomyProposal = {
      ...p1,
      confidence: 0.98,
      reason: "更高置信度归一",
    };
    await repo.saveTaxonomyProposals([p1Updated]);
    const fetchedP1 = await repo.getTaxonomyProposal("prop-1");
    expect(fetchedP1?.confidence).toBe(0.98);
    expect(fetchedP1?.reason).toBe("更高置信度归一");
  });

  it("支持采纳分类不匹配提案 (categorization_mismatch) 并自动迁移站点与落审计", async () => {
    const catDev = await repo.createCategory({ title: "开发运维" });
    const catDesign = await repo.createCategory({ title: "设计资源" });

    const site = await repo.createSite({
      url: "https://docker.com",
      title: "Docker",
      description: "容器与部署编排",
      categoryId: catDesign.id, // 误归入设计
    });

    const proposal: TaxonomyProposal = {
      id: "prop-mismatch-1",
      kind: "categorization_mismatch",
      targetId: site.id,
      targetTitle: site.title,
      currentValue: "设计资源",
      suggestedValue: "开发运维",
      confidence: 0.92,
      reason: "特征词匹配度极高",
      status: "pending",
      meta: {
        siteId: site.id,
        fromCategoryId: catDesign.id,
        toCategoryId: catDev.id,
      },
      createdAt: Date.now(),
    };

    await repo.saveTaxonomyProposals([proposal]);

    const res = await repo.applyTaxonomyProposal("prop-mismatch-1", "admin-tester");
    expect(res.ok).toBe(true);
    expect(res.proposal.status).toBe("applied");

    // 校验站点分类已实际更新
    const updatedSite = await repo.getSite(site.id);
    expect(updatedSite?.categoryId).toBe(catDev.id);

    // 校验审计日志已记录
    const auditLogs = await repo.listAuditLogs({ action: "taxonomy.proposal.apply" });
    expect(auditLogs.items.length).toBeGreaterThan(0);
    expect(auditLogs.items[0].target).toBe("prop-mismatch-1");
  });

  it("支持采纳标签合并与别名提案 (tag_consolidation)", async () => {
    const proposal: TaxonomyProposal = {
      id: "prop-tag-alias-1",
      kind: "tag_consolidation",
      targetId: "ai工具",
      targetTitle: "ai工具",
      currentValue: "ai工具",
      suggestedValue: "AI",
      confidence: 0.9,
      reason: "同义词归一",
      status: "pending",
      meta: {
        action: "alias",
      },
      createdAt: Date.now(),
    };

    await repo.saveTaxonomyProposals([proposal]);
    const res = await repo.applyTaxonomyProposal("prop-tag-alias-1");
    expect(res.ok).toBe(true);
    expect(res.proposal.status).toBe("applied");

    const resolved = await repo.resolveTag("ai工具");
    expect(resolved?.name).toBe("AI");
  });

  it("零引用删除提案：采纳后删除标签，仍有站点引用时拒绝", async () => {
    await repo.upsertTag("ZeroTag", "zerotag", "topic");
    const proposal: TaxonomyProposal = {
      id: "prop-tag-delete-1",
      kind: "tag_consolidation",
      targetId: "ZeroTag",
      targetTitle: "ZeroTag",
      currentValue: "ZeroTag",
      suggestedValue: "ZeroTag",
      confidence: 0.6,
      reason: "迁移后零引用",
      status: "pending",
      meta: { action: "delete" },
      createdAt: Date.now(),
    };
    await repo.saveTaxonomyProposals([proposal]);
    const res = await repo.applyTaxonomyProposal("prop-tag-delete-1");
    expect(res.ok).toBe(true);
    expect(res.message).toContain("已删除零引用标签");
    expect(await repo.raw("SELECT id FROM tags WHERE name = ?", ["ZeroTag"])).toHaveLength(0);

    const cat = await repo.createCategory({ title: "删除标签测试" });
    const site = await repo.createSite({
      url: "https://keep-tag.example.com",
      title: "保留标签站点",
      categoryId: cat.id,
    });
    await repo.setSiteTags(site.id, ["ReferencedTag"]);
    await repo.saveTaxonomyProposals([
      {
        id: "prop-tag-delete-2",
        kind: "tag_consolidation",
        targetId: "ReferencedTag",
        targetTitle: "ReferencedTag",
        currentValue: "ReferencedTag",
        suggestedValue: "ReferencedTag",
        confidence: 0.6,
        reason: "迁移后零引用",
        status: "pending",
        meta: { action: "delete" },
        createdAt: Date.now(),
      },
    ]);
    await expect(repo.applyTaxonomyProposal("prop-tag-delete-2")).rejects.toThrow(/仍有 1 个站点引用/);
    expect(await repo.raw("SELECT id FROM tags WHERE name = ?", ["ReferencedTag"])).toHaveLength(1);
    // 拒绝不算采纳：提案保持 pending，人工处理引用后可重试
    expect((await repo.getTaxonomyProposal("prop-tag-delete-2"))?.status).toBe("pending");
  });

  it("支持驳回提案 (dismissTaxonomyProposal)", async () => {
    const proposal: TaxonomyProposal = {
      id: "prop-dismiss-1",
      kind: "zero_result_gap",
      targetId: "temp-query",
      suggestedValue: "temp-query",
      confidence: 0.6,
      reason: "低价值临时词",
      status: "pending",
      createdAt: Date.now(),
    };

    await repo.saveTaxonomyProposals([proposal]);
    const res = await repo.dismissTaxonomyProposal("prop-dismiss-1", "admin-reviewer");
    expect(res.ok).toBe(true);
    expect(res.proposal.status).toBe("dismissed");

    const auditLogs = await repo.listAuditLogs({ action: "taxonomy.proposal.dismiss" });
    expect(auditLogs.items.some((l) => l.target === "prop-dismiss-1")).toBe(true);
  });

  it("类目健康审计产出 leaf_too_small / duplicate_title，采纳只记录决议不动树", async () => {
    const root = await repo.createCategory({ title: "健康审计根" });
    const dupA = await repo.createCategory({ title: "重名叶", parentId: root.id });
    const dupB = await repo.createCategory({ title: "重名叶B", parentId: root.id });
    // 应用层已禁同级重名；这里先摘掉 P3 的标题唯一索引再改库，
    // 模拟「索引登记之前」的历史脏行（正是治理审计要捞的那批）
    await repo.run("DROP INDEX IF EXISTS categories_child_title_uniq");
    await repo.run("DROP INDEX IF EXISTS categories_root_title_uniq");
    await repo.run("UPDATE categories SET title = ? WHERE id = ?", ["重名叶", dupB.id]);
    const small = await repo.createCategory({ title: "小叶子", parentId: root.id });
    await repo.createSite({
      url: "https://small-leaf.example.com",
      title: "小叶子站点",
      categoryId: small.id,
    });

    const audit = await repo.runTaxonomyAudit({ dryRun: true });
    expect(audit.byKind.duplicate_title).toBeGreaterThanOrEqual(1);
    expect(audit.byKind.leaf_too_small).toBeGreaterThanOrEqual(1);

    const dupProposal = audit.proposals.find(
      (p) => p.kind === "duplicate_title" && (p.targetId === dupA.id || p.targetId === dupB.id),
    );
    expect(dupProposal?.meta?.keepId).toBe(dupProposal?.targetId === dupA.id ? dupB.id : dupA.id);
    const smallProposal = audit.proposals.find((p) => p.kind === "leaf_too_small" && p.targetId === small.id);
    expect(smallProposal?.meta?.sites).toBe(1);
    // dryRun 不落库
    expect(await repo.getTaxonomyProposal(smallProposal!.id)).toBeNull();

    // 采纳只把提案标为 applied，类目树原样保留（不自动合并、不自动删除）
    await repo.saveTaxonomyProposals([smallProposal!]);
    const applied = await repo.applyTaxonomyProposal(smallProposal!.id);
    expect(applied.ok).toBe(true);
    expect(applied.message).toContain("未改动类目树");
    expect((await repo.getCategory(small.id))?.parentId).toBe(root.id);
    expect((await repo.getCategory(dupA.id))?.title).toBe("重名叶");
    expect((await repo.getCategory(dupB.id))?.title).toBe("重名叶");
  });

  it("全流程执行全站分类与标签健康度审计 (runTaxonomyAudit)", async () => {
    // 注入零结果事件
    await repo.recordEvent("zero_result", { query: "Rust" });
    await repo.recordEvent("zero_result", { query: "Rust" });

    // 注入两个标签
    await repo.upsertTag("Python", "topic");
    await repo.upsertTag("python", "topic");

    // 1. DryRun 模式：只生成不写库
    const dryRunRes = await repo.runTaxonomyAudit({ dryRun: true });
    expect(dryRunRes.proposalsCount).toBeGreaterThanOrEqual(1);

    // 2. 实际审计：写库入库
    const realRes = await repo.runTaxonomyAudit({ dryRun: false });
    expect(realRes.proposalsCount).toBeGreaterThanOrEqual(1);

    const pending = await repo.listTaxonomyProposals({ status: "pending" });
    expect(pending.total).toBeGreaterThanOrEqual(1);
  });
});
