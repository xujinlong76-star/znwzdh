import type { Repository } from "../repository.ts";
import {
  UNCATEGORIZED_CATEGORY_ID,
  UNCATEGORIZED_CATEGORY_TITLE,
  assertCategoryName,
  auditDuplicateTitles,
  auditLeafTooSmall,
  auditSiteCategorization,
  auditTagConsolidation,
  auditZeroResultGaps,
  categoryGapProposalId,
  type TaxonomyProposal,
  type TaxonomyProposalKind,
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
 * 记一条「类目缺口」提案（AI / MCP / 投稿建议了一个树里不存在的类目名）。
 *
 * 替代的是旧行为：解析不到就 `createCategory` 建一个**根**类目。
 * 那条口子是层级坍塌的主要来源之一 —— 模型每次自由发挥都往树顶加一根新柱子，
 * 装包时代因此长到 106 个平铺根。现在站点落「未分类」，建树的动作交给人工采纳。
 *
 * 幂等：同名（忽略大小写/空格/连字符）只有一条提案，重复出现累加 `seenCount`
 * 并把站点补进 `meta.siteIds`（采纳时一次性回填）。已驳回/已采纳的行不动 ——
 * 那是人工决议。
 */
export async function recordCategoryGap(
  repo: Repository,
  input: {
    title: string;
    siteId?: string;
    siteUrl?: string;
    source: string;
    /** 树里有多个同名类目：既产缺口提案，也说明这批类目该合并 */
    ambiguousCategoryIds?: string[];
    reasonNote?: string;
  }
): Promise<{ proposalId: string; seenCount: number }> {
  const title = (input.title ?? "").trim();
  const id = categoryGapProposalId(title);
  const existing = await getTaxonomyProposal(repo, id);
  if (existing && existing.status !== "pending") {
    return { proposalId: id, seenCount: Number(existing.meta?.seenCount ?? 1) };
  }
  const priorSiteIds = Array.isArray(existing?.meta?.siteIds) ? (existing!.meta!.siteIds as string[]) : [];
  const siteIds = [...new Set([...priorSiteIds, ...(input.siteId ? [input.siteId] : [])])].slice(0, 50);
  const seenCount = Number(existing?.meta?.seenCount ?? 0) + 1;
  const ambiguous = Array.isArray(existing?.meta?.ambiguousCategoryIds)
    ? (existing!.meta!.ambiguousCategoryIds as string[])
    : (input.ambiguousCategoryIds ?? []);

  await saveTaxonomyProposals(repo, [
    {
      id,
      kind: "category_gap",
      targetId: title.toLowerCase(),
      targetTitle: title,
      currentValue: UNCATEGORIZED_CATEGORY_TITLE,
      suggestedValue: title,
      // 反复出现 = 真需求；一次性幻觉 = 低置信。上限 0.9：建树始终要人工点头
      confidence: Math.min(0.9, 0.5 + seenCount * 0.1),
      reason:
        `${input.source} 建议新建类目「${title}」，现树中没有唯一匹配（第 ${seenCount} 次）。` +
        `站点已落「未分类」，请判定：在某个一级根下建子类目，或改挂现有类目。` +
        (ambiguous.length > 0 ? `注意：树里已有 ${ambiguous.length} 个同名类目，属合并候选。` : "") +
        (input.reasonNote ? ` ${input.reasonNote}` : ""),
      status: "pending",
      meta: {
        seenCount,
        siteIds,
        source: input.source,
        siteUrl: input.siteUrl ?? null,
        ambiguousCategoryIds: ambiguous,
      },
      createdAt: existing?.createdAt ?? Date.now(),
    },
  ]);
  return { proposalId: id, seenCount };
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
  overrides?: { parentId?: string | null; titleEn?: string | null; icon?: string | null }
): Promise<{ ok: boolean; message: string; proposal: TaxonomyProposal }> {
  let proposal = await getTaxonomyProposal(repo, id);
  if (!proposal) {
    throw new Error(`治理提案不存在: ${id}`);
  }
  // category_gap 的「建在哪、英文名/图标是什么」由审核人在采纳时补齐。
  // 先写回 meta 再执行：这样审计里看到的提案就是真正落地的那一份。
  if (overrides && proposal.status !== "applied") {
    const merged = {
      ...proposal.meta,
      ...(overrides.parentId !== undefined ? { parentId: overrides.parentId } : {}),
      ...(overrides.titleEn !== undefined ? { titleEn: overrides.titleEn } : {}),
      ...(overrides.icon !== undefined ? { icon: overrides.icon } : {}),
    };
    await repo.run("UPDATE taxonomy_proposals SET meta = ? WHERE id = ?", [JSON.stringify(merged), id]);
    proposal = (await getTaxonomyProposal(repo, id))!;
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

    if (action === "delete") {
      // 迁移脚本只对「零引用」标签出删除提案；采纳时再核一次，引用不为零就拒绝，
      // 人工采纳是删除 tags 行的唯一入口（禁止脚本直接 DELETE FROM tags）。
      const sourceTagRow = (await repo.raw("SELECT id FROM tags WHERE name = ? OR slug = ? LIMIT 1", [fromTag, slugify(fromTag)]))[0];
      if (!sourceTagRow) {
        actionMessage = `标签 "${fromTag}" 已不存在，提案按已删除处理`;
      } else {
        const sourceTagId = String(sourceTagRow.id);
        const refRow = (await repo.raw("SELECT COUNT(*) AS n FROM site_tags WHERE tag_id = ?", [sourceTagId]))[0];
        const refs = Number(refRow?.n ?? 0);
        if (refs > 0) {
          throw new Error(`标签 "${fromTag}" 仍有 ${refs} 个站点引用，拒绝删除`);
        }
        await repo.run("DELETE FROM tag_aliases WHERE tag_id = ?", [sourceTagId]);
        await repo.run("DELETE FROM tags WHERE id = ?", [sourceTagId]);
        actionMessage = `已删除零引用标签 "${fromTag}"`;
      }
    } else {
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
    }
  } else if (proposal.kind === "zero_result_gap") {
    const tagName = proposal.suggestedValue;
    await repo.upsertTag(tagName, slugify(tagName), "topic");
    actionMessage = `已将未收录热词 "${tagName}" 扩充为系统领域标签`;
  } else if (proposal.kind === "category_gap") {
    const title = proposal.suggestedValue;
    const titleEn = typeof proposal.meta?.titleEn === "string" ? proposal.meta.titleEn : null;
    const icon = typeof proposal.meta?.icon === "string" ? proposal.meta.icon : null;
    const parentId = typeof proposal.meta?.parentId === "string" ? proposal.meta.parentId : null;
    // 必须挂在某个父级下：一级根的数量是编辑决策（新树 18 根），不能由提案随手加柱子。
    // 真要新增一级根，走类目管理页 —— 那里是显式的人工动作。
    if (!parentId) {
      throw new Error("该提案需要先指定父类目（meta.parentId）：站点只挂子类目，新增一级根请走类目管理");
    }
    assertCategoryName({ title, titleEn });
    const parent = await repo.getCategory(parentId);
    if (!parent) {
      throw new Error(`父类目不存在: ${parentId}`);
    }
    const created = await repo.createCategory({ title, titleEn, icon, parentId, source: "api" });
    const siteIds = Array.isArray(proposal.meta?.siteIds) ? (proposal.meta.siteIds as string[]) : [];
    let reassigned = 0;
    for (const siteId of siteIds) {
      const site = await repo.getSite(siteId);
      // 只搬仍落在「未分类」的站点：审核期间人工可能已经单独归好类，不能覆盖
      if (site && site.categoryId === UNCATEGORIZED_CATEGORY_ID) {
        await repo.updateSite(siteId, { categoryId: created.id });
        reassigned += 1;
      }
    }
    actionMessage = `已在「${parent.title}」下新建子类目「${created.title}」，回填 ${reassigned}/${siteIds.length} 个站点`;
  } else if (proposal.kind === "leaf_too_small" || proposal.kind === "duplicate_title") {
    // 这两类只记录人工决议：合并/降级是类目管理页上的显式动作。
    // 自动执行会绕过编辑判断——空叶子可能是刚建的，十九站的叶子可能是刻意收窄的垂直类。
    actionMessage =
      proposal.kind === "duplicate_title"
        ? `已记录合并决议：请到类目管理把「${proposal.targetTitle}」的站点并入保留项后删除（本次未改动类目树）`
        : `已记录处理决议：请到类目管理复核「${proposal.targetTitle}」的合并/降级（本次未改动类目树）`;
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
): Promise<{
  proposalsCount: number;
  proposals: TaxonomyProposal[];
  /** 按 kind 汇总：日报与运营看板靠它判断「这一轮新增了什么」 */
  byKind: Partial<Record<TaxonomyProposalKind, number>>;
}> {
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

  // 3. 类目树健康：过小叶子 + 同父同名（只出提案，人工合并，绝不自动动树）
  const rawCounts = await repo.categorySiteCounts();
  const siteCountByCategory = new Map(rawCounts.map((r) => [r.categoryId, r.sites] as const));
  const healthNodes = categories.map((c) => ({
    id: c.id,
    title: c.title,
    slug: c.slug ?? null,
    parentId: c.parentId ?? null,
    sites: siteCountByCategory.get(c.id) ?? 0,
  }));
  allProposals.push(...auditLeafTooSmall(healthNodes));
  allProposals.push(...auditDuplicateTitles(healthNodes));

  // 4. 站点归类契合度审计
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

  const byKind: Partial<Record<TaxonomyProposalKind, number>> = {};
  for (const p of allProposals) {
    byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  }

  return {
    proposalsCount: allProposals.length,
    proposals: allProposals,
    byKind,
  };
}
