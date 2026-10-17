import type { Repository } from "../repository.ts";
import {
  auditSiteCategorization,
  auditTagConsolidation,
  auditZeroResultGaps,
  type TaxonomyProposal,
} from "@navhub/core";
import { rowToTaxonomyProposal, slugify } from "./dialect.ts";

/**
 * 保存或更新治理提案（幂等：已采纳或已驳回的状态不被覆盖）
 */
export async function saveTaxonomyProposals(
  repo: Repository,
  proposals: TaxonomyProposal[],
): Promise<number> {
  if (proposals.length === 0) return 0;
  let savedCount = 0;

  for (const p of proposals) {
    const existing = await getTaxonomyProposal(repo, p.id);
    if (existing) {
      // 若已有且不是 pending，保留人工审核决议
      if (existing.status !== "pending") continue;

      await repo.run(
        "UPDATE taxonomy_proposals SET " +
          "confidence = ?, reason = ?, meta = ? WHERE id = ? AND status = 'pending'",
        [
          p.confidence,
          p.reason,
          p.meta ? JSON.stringify(p.meta) : null,
          p.id,
        ],
      );
      savedCount++;
    } else {
      await repo.run(
        "INSERT INTO taxonomy_proposals " +
          "(id, kind, target_id, target_title, current_value, suggested_value, confidence, reason, status, meta, created_at, applied_at) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [
          p.id,
          p.kind,
          p.targetId,
          p.targetTitle ?? null,
          p.currentValue ?? null,
          p.suggestedValue,
          p.confidence,
          p.reason,
          p.status ?? "pending",
          p.meta ? JSON.stringify(p.meta) : null,
          p.createdAt ?? Date.now(),
          p.appliedAt ?? null,
        ],
      );
      savedCount++;
    }
  }

  return savedCount;
}

/**
 * 列出治理提案（支持按 status/kind 筛选与分页）
 */
export async function listTaxonomyProposals(
  repo: Repository,
  filter: { status?: string; kind?: string; limit?: number; offset?: number } = {},
): Promise<{ items: TaxonomyProposal[]; total: number }> {
  const wheres: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    wheres.push("status = ?");
    params.push(filter.status);
  }
  if (filter.kind) {
    wheres.push("kind = ?");
    params.push(filter.kind);
  }

  const whereClause = wheres.length > 0 ? " WHERE " + wheres.join(" AND ") : "";

  const countRow = (
    await repo.raw(`SELECT COUNT(*) AS cnt FROM taxonomy_proposals${whereClause}`, params)
  )[0];
  const total = Number(countRow?.cnt ?? 0);

  const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
  const offset = Math.max(0, filter.offset ?? 0);

  const rows = await repo.raw(
    `SELECT * FROM taxonomy_proposals${whereClause} ORDER BY confidence DESC, created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return {
    items: rows.map(rowToTaxonomyProposal),
    total,
  };
}

/**
 * 获取单条治理提案
 */
export async function getTaxonomyProposal(
  repo: Repository,
  id: string,
): Promise<TaxonomyProposal | null> {
  const rows = await repo.raw("SELECT * FROM taxonomy_proposals WHERE id = ?", [id]);
  if (!rows[0]) return null;
  return rowToTaxonomyProposal(rows[0]);
}

/**
 * 采纳并执行治理提案
 */
export async function applyTaxonomyProposal(
  repo: Repository,
  id: string,
  actor = "admin",
): Promise<{ ok: boolean; message: string; proposal: TaxonomyProposal }> {
  const proposal = await getTaxonomyProposal(repo, id);
  if (!proposal) {
    throw new Error(`治理提案不存在: ${id}`);
  }
  if (proposal.status === "applied") {
    return { ok: true, message: "该提案已处于采纳状态", proposal };
  }

  let actionMessage = "";

  if (proposal.kind === "categorization_mismatch") {
    const siteId = (proposal.meta?.siteId as string) || proposal.targetId;
    const toCatId = (proposal.meta?.toCategoryId as string);
    if (!toCatId) {
      throw new Error("提案缺少目标分类 ID (meta.toCategoryId)");
    }
    const site = await repo.getSite(siteId);
    if (!site) {
      throw new Error(`目标站点不存在: ${siteId}`);
    }
    await repo.updateSite(siteId, { categoryId: toCatId });
    actionMessage = `已将站点 "${site.title}" 分类变更为目标分类 (${toCatId})`;
  } else if (proposal.kind === "tag_consolidation") {
    const action = proposal.meta?.action as string;
    const fromTag = proposal.targetId;
    const toTag = proposal.suggestedValue;

    // 获取或创建目标主标签
    const targetTagRow = (await repo.raw("SELECT id FROM tags WHERE name = ? OR slug = ? LIMIT 1", [toTag, slugify(toTag)]))[0];
    const targetTagId = targetTagRow ? String(targetTagRow.id) : await repo.upsertTag(toTag, slugify(toTag), "topic");

    if (action === "alias") {
      await repo.addTagAlias(targetTagId, fromTag);
      actionMessage = `已为标签 "${fromTag}" 创建指向 "${toTag}" 的同义别名`;
    } else {
      const sourceTagRow = (await repo.raw("SELECT id FROM tags WHERE name = ? OR slug = ? LIMIT 1", [fromTag, slugify(fromTag)]))[0];
      if (sourceTagRow && String(sourceTagRow.id) !== targetTagId) {
        await repo.mergeTags(String(sourceTagRow.id), targetTagId);
        actionMessage = `已将低频标签 "${fromTag}" 合并至主标签 "${toTag}"`;
      } else {
        await repo.addTagAlias(targetTagId, fromTag);
        actionMessage = `已为标签 "${fromTag}" 创建指向 "${toTag}" 的同义别名`;
      }
    }
  } else if (proposal.kind === "zero_result_gap") {
    const tagName = proposal.suggestedValue;
    await repo.upsertTag(tagName, slugify(tagName), "topic");
    actionMessage = `已将未收录热词 "${tagName}" 扩充为系统领域标签`;
  } else {
    actionMessage = `已标记采纳治理提案 (${proposal.kind})`;
  }

  const now = Date.now();
  await repo.run(
    "UPDATE taxonomy_proposals SET status = 'applied', applied_at = ? WHERE id = ?",
    [now, id],
  );

  await repo.audit({
    actor,
    actorKind: "admin",
    action: "taxonomy.proposal.apply",
    target: id,
    diff: { kind: proposal.kind, targetId: proposal.targetId, message: actionMessage },
  });

  const updated = (await getTaxonomyProposal(repo, id))!;
  return { ok: true, message: actionMessage, proposal: updated };
}

/**
 * 驳回治理提案
 */
export async function dismissTaxonomyProposal(
  repo: Repository,
  id: string,
  actor = "admin",
): Promise<{ ok: boolean; proposal: TaxonomyProposal }> {
  const proposal = await getTaxonomyProposal(repo, id);
  if (!proposal) {
    throw new Error(`治理提案不存在: ${id}`);
  }

  await repo.run(
    "UPDATE taxonomy_proposals SET status = 'dismissed' WHERE id = ?",
    [id],
  );

  await repo.audit({
    actor,
    actorKind: "admin",
    action: "taxonomy.proposal.dismiss",
    target: id,
    diff: { kind: proposal.kind, targetId: proposal.targetId },
  });

  const updated = (await getTaxonomyProposal(repo, id))!;
  return { ok: true, proposal: updated };
}

/**
 * 执行全站分类与标签健康度审计
 */
export async function runTaxonomyAudit(
  repo: Repository,
  options: { dryRun?: boolean; siteLimit?: number } = {},
): Promise<{ proposalsCount: number; proposals: TaxonomyProposal[] }> {
  const allProposals: TaxonomyProposal[] = [];

  // 1. 标签冗余与同义词合并审计
  const tagsWithCounts = await repo.listTagsWithCounts();
  const aliasList = await repo.listTagAliases();
  const tagIdToName = new Map<string, string>();
  for (const t of tagsWithCounts) tagIdToName.set(t.id, t.name);

  const aliasMap: Record<string, string> = {};
  for (const a of aliasList) {
    aliasMap[a.alias.toLowerCase()] = tagIdToName.get(a.tagId) || a.tagId;
  }

  const tagProposals = auditTagConsolidation(
    tagsWithCounts.map((t) => ({ tag: t.name, count: t.count })),
    aliasMap,
  );
  allProposals.push(...tagProposals);

  // 2. 零结果搜索聚类与缺口发现
  const zeroQueries = await repo.zeroResultQueries(30, 50);
  const categories = await repo.listCategories();
  const gapProposals = auditZeroResultGaps(
    zeroQueries,
    tagsWithCounts.map((t) => t.name),
    categories.map((c) => ({ id: c.id, title: c.title, altLabels: c.altLabels })),
    2,
  );
  allProposals.push(...gapProposals);

  // 3. 站点归类契合度审计
  const sites = await repo.listSites({ limit: options.siteLimit ?? 500 });
  const siteProposals = auditSiteCategorization(
    sites.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description ?? "",
      categoryId: s.categoryId,
      tags: s.tags,
    })),
    categories.map((c) => ({ id: c.id, title: c.title, altLabels: c.altLabels })),
  );
  allProposals.push(...siteProposals);

  if (!options.dryRun && allProposals.length > 0) {
    await saveTaxonomyProposals(repo, allProposals);
  }

  return {
    proposalsCount: allProposals.length,
    proposals: allProposals,
  };
}
