/**
 * P1-4 类目缺口闸门（2026-10-22 类目树升级方案 §5.3）。
 *
 * 旧行为：AI / MCP 建议的类目名在树里找不到 → 立刻 `createCategory` 建一个**根**。
 * 那是层级坍塌的成因之一（装包时代 106 个平铺根）。现在站点落「未分类」，
 * 缺口记成 category_gap 提案，由人工在采纳时选定父级。
 *
 * 这里锁四条：
 * 1. 提案幂等：同一个名字只有一条，重复出现累加 seenCount 并补齐 siteIds；
 *    已驳回的决议不被覆盖。
 * 2. 采纳必须带父级 —— 一级根的新增不由提案决定。
 * 3. 采纳时同样过命名规则：不能靠「采纳提案」把时效/受众轴词重新种进树。
 * 4. 回填只搬仍落在「未分类」的站点，人工已单独归好类的不覆盖。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { UNCATEGORIZED_CATEGORY_ID, categoryGapProposalId } from "@navhub/core";

let db: Db;
let repo: Repository;

beforeEach(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
});

async function gapSite(url: string, title: string): Promise<string> {
  const categoryId = await repo.ensureUncategorized();
  const site = await repo.createSite({ url, title, categoryId });
  return site.id;
}

describe("recordCategoryGap", () => {
  it("同名只有一条提案，重复出现累加并补齐站点", async () => {
    const a = await gapSite("https://gap-1.example.com", "会议纪要站");
    const first = await repo.recordCategoryGap({ title: "会议纪要", siteId: a, siteUrl: "https://gap-1.example.com", source: "AI 富化" });
    expect(first.seenCount).toBe(1);

    const b = await gapSite("https://gap-2.example.com", "另一个纪要站");
    const second = await repo.recordCategoryGap({ title: " 会议纪要 ", siteId: b, source: "MCP add_site" });
    expect(second.proposalId).toBe(first.proposalId);
    expect(second.proposalId).toBe(categoryGapProposalId("会议纪要"));

    const proposal = await repo.getTaxonomyProposal(first.proposalId);
    expect(proposal!.kind).toBe("category_gap");
    expect(proposal!.status).toBe("pending");
    expect(Number(proposal!.meta?.seenCount)).toBe(2);
    expect((proposal!.meta?.siteIds as string[]).sort()).toEqual([a, b].sort());
    // 队列里不会长出两条同名提案
    const list = await repo.listTaxonomyProposals({ kind: "category_gap" });
    expect(list.total).toBe(1);
  });

  it("驳回后再出现不复活、不重复计数", async () => {
    const siteId = await gapSite("https://gap-3.example.com", "冷门工具");
    const { proposalId } = await repo.recordCategoryGap({ title: "冷门工具", siteId, source: "AI 富化" });
    await repo.dismissTaxonomyProposal(proposalId, "admin");
    const again = await repo.recordCategoryGap({ title: "冷门工具", siteId: await gapSite("https://gap-4.example.com", "又一个"), source: "AI 富化" });
    expect(again.seenCount).toBe(1);
    expect((await repo.getTaxonomyProposal(proposalId))!.status).toBe("dismissed");
  });

  it("歧义命中会在理由里提示合并候选", async () => {
    const { proposalId } = await repo.recordCategoryGap({
      title: "语言",
      source: "AI 富化",
      ambiguousCategoryIds: ["cat-lang-1", "cat-lang-2"],
    });
    const proposal = await repo.getTaxonomyProposal(proposalId);
    expect(proposal!.reason).toMatch(/合并候选/);
    expect(proposal!.meta?.ambiguousCategoryIds).toEqual(["cat-lang-1", "cat-lang-2"]);
  });
});

describe("采纳 category_gap", () => {
  it("没给父级就拒绝：一级根的新增不由提案决定", async () => {
    const siteId = await gapSite("https://gap-5.example.com", "播客站");
    const { proposalId } = await repo.recordCategoryGap({ title: "播客与音频", siteId, source: "AI 富化" });
    await expect(repo.applyTaxonomyProposal(proposalId, "admin")).rejects.toThrow(/父类目/);
  });

  it("在指定父级下建叶子，slug 自动生成，并回填仍挂在未分类的站点", async () => {
    const parent = await repo.createCategory({ title: "影音娱乐", titleEn: "Entertainment" });
    const keep = await gapSite("https://gap-6.example.com", "音频站一");
    const moved = await gapSite("https://gap-7.example.com", "音频站二");
    const { proposalId } = await repo.recordCategoryGap({ title: "播客与音频", siteId: keep, source: "AI 富化" });
    // 第二个站点在提案生成之后才落进未分类：手动补进提案的 siteIds 队列
    const proposal = (await repo.getTaxonomyProposal(proposalId))!;
    await repo.saveTaxonomyProposals([
      { ...proposal, meta: { ...proposal.meta, siteIds: [keep, moved] } },
    ]);

    const result = await repo.applyTaxonomyProposal(proposalId, "admin", { parentId: parent.id, titleEn: "Podcasts & Audio" });
    expect(result.message).toMatch(/回填 2\/2/);

    const leaf = await repo.getCategoryBySlug("podcasts-and-audio");
    expect(leaf).not.toBeNull();
    expect(leaf!.parentId).toBe(parent.id);
    expect(leaf!.title).toBe("播客与音频");
    expect((await repo.getSite(keep))!.categoryId).toBe(leaf!.id);
    expect((await repo.getSite(moved))!.categoryId).toBe(leaf!.id);
    // 采纳后的提案带上落地信息，供审计回看
    const applied = (await repo.getTaxonomyProposal(proposalId))!;
    expect(applied.status).toBe("applied");
    expect(applied.meta?.parentId).toBe(parent.id);
  });

  it("人工已单独归类的站点不被覆盖", async () => {
    const parent = await repo.createCategory({ title: "效率办公", titleEn: "Office Productivity" });
    const elsewhere = await repo.createCategory({ title: "笔记与知识库", parentId: parent.id });
    const siteId = await gapSite("https://gap-8.example.com", "笔记站");
    const { proposalId } = await repo.recordCategoryGap({ title: "网盘与传输", siteId, source: "AI 富化" });
    await repo.updateSite(siteId, { categoryId: elsewhere.id });

    const result = await repo.applyTaxonomyProposal(proposalId, "admin", { parentId: parent.id });
    expect(result.message).toMatch(/回填 0\/1/);
    expect((await repo.getSite(siteId))!.categoryId).toBe(elsewhere.id);
  });

  it("名字违规的提案采纳不了（闸门不能被采纳绕过）", async () => {
    const parent = await repo.createCategory({ title: "资讯媒体", titleEn: "News & Media" });
    const siteId = await gapSite("https://gap-9.example.com", "热榜站");
    const { proposalId } = await repo.recordCategoryGap({ title: "热门榜单", siteId, source: "AI 富化" });
    const before = await repo.listCategories();
    await expect(repo.applyTaxonomyProposal(proposalId, "admin", { parentId: parent.id })).rejects.toThrow(/命名不合规/);
    expect(await repo.listCategories()).toHaveLength(before.length);
  });

  it("同名提案在同一个父级下重复采纳不会撞标题", async () => {
    const parent = await repo.createCategory({ title: "学习成长", titleEn: "Learning & Growth" });
    const siteId = await gapSite("https://gap-10.example.com", "公开课站");
    const { proposalId } = await repo.recordCategoryGap({ title: "公开课与方法", siteId, source: "AI 富化" });
    const first = await repo.applyTaxonomyProposal(proposalId, "admin", { parentId: parent.id });
    expect(first.ok).toBe(true);
    // 已采纳的提案再点一次是幂等空转，不会二次建类目
    const second = await repo.applyTaxonomyProposal(proposalId, "admin", { parentId: parent.id });
    expect(second.message).toBe("该提案已处于采纳状态");
    const leaves = await repo.listCategories();
    expect(leaves.filter((c) => c.title === "公开课与方法").length).toBe(1);
  });
});

describe("UNCATEGORIZED 作为缺口落点", () => {
  it("提案建在固定 id 的兜底类目下，不新建同名类目", async () => {
    await gapSite("https://gap-11.example.com", "无建议站");
    expect(await repo.getCategory(UNCATEGORIZED_CATEGORY_ID)).not.toBeNull();
    const cats = await repo.listCategories();
    expect(cats.filter((c) => c.title === "未分类").length).toBe(1);
  });
});
