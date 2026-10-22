import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

describe("Taxonomy Phase 1: 多维标签治理与概念别名 (SKOS)", () => {
  let db: Db;
  let repo: Repository;
  let search: SearchEngine;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    search = new SearchEngine({ db, fts: null, vectors: null, repo });
  });

  afterAll(async () => {
    await db.close();
  });

  it("标签支持多维分组 (group) 与颜色 (color) 属性", async () => {
    const cat = await repo.createCategory({ title: "开发与AI" });
    const s1 = await repo.createSite({
      url: "https://example.com/openai",
      title: "OpenAI",
      categoryId: cat.id,
      tags: ["人工智能", "SaaS", "开发工具"],
      status: "active",
    });
    expect(s1.tags).toContain("人工智能");

    const allTags = await repo.listTagsWithCounts();
    const aiTag = allTags.find((t) => t.name === "人工智能");
    expect(aiTag).toBeTruthy();
    expect(aiTag!.group).toBe("topic"); // 默认 topic

    // 更新维度为 topic，赋予品牌色
    await repo.updateTag(aiTag!.id, {
      group: "topic",
      color: "#10a37f",
      description: "生成式人工智能核心模型与平台",
    });

    const saasTag = allTags.find((t) => t.name === "SaaS");
    expect(saasTag).toBeTruthy();
    // 更新维度为 form (形态)
    await repo.updateTag(saasTag!.id, {
      group: "form",
      color: "#3b82f6",
    });

    // 验证更新结果
    const updatedTags = await repo.listTagsWithCounts();
    const updatedAi = updatedTags.find((t) => t.id === aiTag!.id)!;
    expect(updatedAi.group).toBe("topic");
    expect(updatedAi.color).toBe("#10a37f");
    expect(updatedAi.description).toBe("生成式人工智能核心模型与平台");

    const updatedSaas = updatedTags.find((t) => t.id === saasTag!.id)!;
    expect(updatedSaas.group).toBe("form");
    expect(updatedSaas.color).toBe("#3b82f6");

    // 验证按维度分组过滤
    const formTags = await repo.listTagsWithCounts(1, "form");
    expect(formTags.some((t) => t.id === saasTag!.id)).toBe(true);
    expect(formTags.some((t) => t.id === aiTag!.id)).toBe(false);
  });

  it("支持为标签绑定与解绑概念别名 (SKOS altLabels)", async () => {
    const tags = await repo.listTagsWithCounts();
    const aiTag = tags.find((t) => t.name === "人工智能")!;

    // 绑定别名 "AIGC" 和 "AI"
    const a1 = await repo.addTagAlias(aiTag.id, "AIGC");
    const a2 = await repo.addTagAlias(aiTag.id, "AI");
    expect(a1.alias).toBe("aigc");
    expect(a2.alias).toBe("ai");

    // 查询验证
    const aliases = await repo.listTagAliases(aiTag.id);
    expect(aliases.map((a) => a.alias)).toContain("aigc");
    expect(aliases.map((a) => a.alias)).toContain("ai");

    // listTagsWithCounts 中附带 aliases
    const tagList = await repo.listTagsWithCounts();
    const refreshedAi = tagList.find((t) => t.id === aiTag.id)!;
    expect(refreshedAi.aliases).toContain("aigc");
    expect(refreshedAi.aliases).toContain("ai");

    // 重复添加相同别名幂等放行
    const repeat = await repo.addTagAlias(aiTag.id, "AIGC");
    expect(repeat.alias).toBe("aigc");

    // 冲突拦截：尝试将相同别名赋给其他标签应抛错
    const saasTag = tagList.find((t) => t.name === "SaaS")!;
    await expect(repo.addTagAlias(saasTag.id, "AIGC")).rejects.toThrow("已被其他标签绑定");
  });

  it("resolveTag 支持从规范名称、slug 及任意别名归一化解析", async () => {
    // 1. 直查名称
    const res1 = await repo.resolveTag("人工智能");
    expect(res1?.name).toBe("人工智能");

    // 2. 查别名 "AIGC"
    const res2 = await repo.resolveTag("AIGC");
    expect(res2?.name).toBe("人工智能");

    // 3. 查别名 "ai"
    const res3 = await repo.resolveTag("ai");
    expect(res3?.name).toBe("人工智能");

    // 4. 不存在的标签返回 null
    const resNone = await repo.resolveTag("完全不存在的未知词");
    expect(resNone).toBeNull();
  });

  it("站点打标输入别名时，自动归一化关联到规范标签", async () => {
    const cat = (await repo.listCategories())[0]!;
    // 创建新站点，打上别名标签 "aigc"（此时规范标签是 "人工智能"）
    const s2 = await repo.createSite({
      url: "https://example.com/claude",
      title: "Anthropic Claude",
      categoryId: cat.id,
      tags: ["aigc"], // 传入别名
      status: "active",
    });

    // 站点关联的标签应被归一化为规范标签
    const site = (await repo.getSite(s2.id))!;
    expect(site.tags).toContain("人工智能");

    // 引用计数相应增加
    const aiTag = (await repo.listTagsWithCounts()).find((t) => t.name === "人工智能")!;
    expect(aiTag.count).toBeGreaterThanOrEqual(2);
  });

  it("检索引擎支持按别名过滤站点 (Search by alias)", async () => {
    // 按别名 "aigc" 过滤
    const resAlias = await search.search({ tag: "aigc", limit: 10 });
    expect(resAlias.hits.length).toBeGreaterThanOrEqual(2);

    // 命中包含打标了 "人工智能" 的两个站点
    const urls = (await Promise.all(resAlias.hits.map((h) => repo.getSite(h.siteId)))).map((s) => s?.url);
    expect(urls).toContain("https://example.com/openai");
    expect(urls).toContain("https://example.com/claude");
  });

  it("标签合并时，自动将源标签名称与 slug 转换为目标标签的别名", async () => {
    const cat = (await repo.listCategories())[0]!;
    // 创建一个旧标签 "LLM"
    await repo.createSite({
      url: "https://example.com/deepseek",
      title: "DeepSeek",
      categoryId: cat.id,
      tags: ["LLM大模型"],
      status: "active",
    });

    const tags = await repo.listTagsWithCounts();
    const source = tags.find((t) => t.name === "LLM大模型")!;
    const target = tags.find((t) => t.name === "人工智能")!;

    // 合并源标签到目标标签
    const mergeRes = await repo.mergeTags(source.id, target.id);
    expect(mergeRes.moved).toBeGreaterThanOrEqual(1);

    // 源标签已删除
    const afterTags = await repo.listTagsWithCounts();
    expect(afterTags.find((t) => t.id === source.id)).toBeUndefined();

    // 目标标签收录了源标签的 slug 作为别名
    const resolvedOld = await repo.resolveTag("LLM大模型");
    expect(resolvedOld?.id).toBe(target.id);

    // 搜索旧词也能命中
    const hitsOld = await search.search({ tag: "llm大模型", limit: 10 });
    expect(hitsOld.hits.length).toBeGreaterThanOrEqual(1);
  });

  it("解绑别名与删除标签时级联清理别名记录", async () => {
    const tags = await repo.listTagsWithCounts();
    const aiTag = tags.find((t) => t.name === "人工智能")!;

    // 移除别名 "ai"
    await repo.removeTagAlias("ai");
    expect(await repo.resolveTag("ai")).toBeNull();

    // 删除标签级联清空别名
    await repo.deleteTag(aiTag.id);
    const aliases = await repo.listTagAliases(aiTag.id);
    expect(aliases.length).toBe(0);
    expect(await repo.resolveTag("aigc")).toBeNull();
  });

  it("listTagsWithCounts 只计存活站点：软删除、停用与非 active 状态都不进计数", async () => {
    // 口径守卫：曾用裸 COUNT(st.site_id) 把软删除站点也算进引用计数
    // （dev 库实测「开源」报 123 而存活站点只有 3），chip 计数、TAG_LINK_MIN
    // 渲染规则、sitemap 的 ≥5 门槛全部失真。计数必须与 catalog/sitemap 同口径：
    // deleted_at IS NULL AND enabled AND status = 'active'——broken 站点的标签页
    // 本身不可索引，计进来会把门槛撑过 5、提交软 404。
    const cat = (await repo.listCategories())[0]!;
    const doomed = await repo.createSite({
      url: "https://example.com/count-a",
      title: "计数甲",
      categoryId: cat.id,
      tags: ["计数口径"],
      status: "active",
    });
    await repo.createSite({
      url: "https://example.com/count-b",
      title: "计数乙",
      categoryId: cat.id,
      tags: ["计数口径"],
      status: "active",
    });
    await repo.createSite({
      url: "https://example.com/count-c",
      title: "计数丙",
      categoryId: cat.id,
      tags: ["计数口径"],
      status: "active",
      enabled: false,
    });
    await repo.createSite({
      url: "https://example.com/count-d",
      title: "计数丁",
      categoryId: cat.id,
      tags: ["计数口径"],
      status: "broken",
    });
    // 4 条关联：1 条随后软删除、1 条停用、1 条 broken → 存活计数应为 1
    await repo.deleteSite(doomed.id);

    const hit = (await repo.listTagsWithCounts()).find((t) => t.name === "计数口径");
    expect(hit).toBeTruthy();
    expect(hit!.count).toBe(1);

    // minCount=2 不应再返回该标签（旧口径会因虚高计数误进 minCount 门槛）
    const above = await repo.listTagsWithCounts(2);
    expect(above.find((t) => t.name === "计数口径")).toBeUndefined();
  });
});
