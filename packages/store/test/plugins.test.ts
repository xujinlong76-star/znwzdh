/**
 * 插件市场存储层：发布 → 审核 → 安装 → 卸载 → 星标 → 举报全链路。
 * 用例对应真实风险：重复安装重复计数、重复 URL 入库、卸载误删用户数据、
 * slug 冲突、状态机被绕过。去掉实现里的守卫，必有断言变红。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndCleanPluginManifest, type PluginManifest, type SitePackPayload } from "@navhub/core";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";

let dir: string;
let db!: Db;
let repo!: Repository;

function manifestOf(raw: unknown): PluginManifest {
  const res = validateAndCleanPluginManifest(raw);
  if (!res.ok) throw new Error("fixture 未通过契约校验：" + res.errors.join(" | "));
  return res.manifest;
}

function sitePackRaw(
  name: string,
  sites: Array<{ url: string; title: string; category?: string; tags?: string[] }>,
) {
  return {
    manifestVersion: 1,
    kind: "site-pack",
    name,
    description: "测试用网址包",
    icon: "🧪",
    version: "1.0.0",
    tags: ["测试"],
    payload: { categories: [{ title: "AI 编程" }], sites },
  };
}

const themeManifest = () =>
  manifestOf({
    manifestVersion: 1,
    kind: "theme",
    name: "暗紫主题",
    version: "1.0.0",
    payload: { accent: "violet", tokens: { "--primary": "262 83% 58%" } },
  });

const searchPackRaw = (name: string, prefix = "!t") =>
  manifestOf({
    manifestVersion: 1,
    kind: "search-pack",
    name,
    description: "测试用搜索引擎包",
    version: "1.0.0",
    payload: {
      engines: [{ name: name + " 引擎", prefix, searchUrl: `https://search.example.com/?q={q}` }],
    },
  });

const bundleRaw = (
  name: string,
  items: Array<{ slug: string; kind: "site-pack" | "search-pack" | "theme" }>,
) =>
  manifestOf({
    manifestVersion: 1,
    kind: "bundle",
    name,
    description: "测试用组合包",
    version: "1.0.0",
    payload: { items },
  });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugins-"));
  db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "test.db") });
  repo = new Repository(db);
});

afterAll(async () => {
  try {
    await db?.close();
  } catch {
    // 数据库关闭异常不阻塞退出
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 忽略 Windows 上 SQLite 文件句柄延迟释放产生的短暂占用
  }
});

describe("插件注册表：发布 / slug / 列表", () => {
  it("发布默认 pending；slug 由名称生成（保留中文）；审计留痕", async () => {
    const created = await repo.createPlugin(
      { manifest: manifestOf(sitePackRaw("AI 工具集", [{ url: "https://a.example.com", title: "A" }])) },
      { actor: "tester", actorKind: "token" },
    );
    expect(created.status).toBe("pending");
    expect(created.slug).toBe("ai-工具集");
    expect(created.installCount).toBe(0);
    expect(created.publishedAt).toBeNull();
    const audits = await repo.raw("SELECT action FROM audit_logs WHERE target = ?", [created.slug]);
    expect(audits.map((a) => a.action)).toContain("plugin.publish");
  });

  it("同名冲突自动去重（-2 后缀）；无有效字符的名称回落 plugin", async () => {
    const first = await repo.createPlugin({ manifest: manifestOf(sitePackRaw("去重演示", [{ url: "https://b1.example.com", title: "B1" }])) });
    const second = await repo.createPlugin({ manifest: manifestOf(sitePackRaw("去重演示", [{ url: "https://b2.example.com", title: "B2" }])) });
    expect(first.slug).toBe("去重演示");
    expect(second.slug).toBe("去重演示-2");
    const odd = await repo.createPlugin({ manifest: manifestOf(sitePackRaw("★ ★", [{ url: "https://b3.example.com", title: "B3" }])) });
    expect(odd.slug).toBe("plugin");
  });

  it("显式 slug 重复时报错（导入不允许覆盖既有插件）", async () => {
    await repo.createPlugin({ manifest: manifestOf(sitePackRaw("固定 slug", [{ url: "https://c.example.com", title: "C" }])), slug: "fixed-slug", status: "published" });
    await expect(
      repo.createPlugin({ manifest: manifestOf(sitePackRaw("固定 slug 2", [{ url: "https://c2.example.com", title: "C2" }])), slug: "fixed-slug" }),
    ).rejects.toThrow(/已存在/);
  });

  it("列表：状态/类型/关键词过滤 + 排序 + 分页 total", async () => {
    const published = await repo.listPlugins({ status: "published" });
    expect(published.items.every((p) => p.status === "published")).toBe(true);
    expect(published.total).toBeGreaterThan(0);

    const themed = await repo.listPlugins({ kind: "theme" });
    expect(themed.total).toBe(0);

    await repo.createPlugin({ manifest: themeManifest(), status: "published", source: "import", slug: "theme-violet" });
    expect((await repo.listPlugins({ kind: "theme" })).total).toBe(1);

    const searched = await repo.listPlugins({ q: "网址包" });
    expect(searched.total).toBeGreaterThan(0);
    const miss = await repo.listPlugins({ q: "不存在的内容-xyz" });
    expect(miss.total).toBe(0);

    const paged = await repo.listPlugins({ limit: 1, offset: 1 });
    expect(paged.items.length).toBe(1);
  });
});

describe("插件状态机：审核 / 更新重审", () => {
  it("approve：pending → published 且有 publishedAt；重复 approve 拒绝", async () => {
    const plugin = await repo.createPlugin({ manifest: manifestOf(sitePackRaw("审核演示", [{ url: "https://d.example.com", title: "D" }])) });
    const approved = await repo.reviewPlugin(plugin.slug, "approve", "内容合规", { actor: "admin" });
    expect(approved.status).toBe("published");
    expect(approved.publishedAt).toBeGreaterThan(0);
    await expect(repo.reviewPlugin(plugin.slug, "approve", null)).rejects.toThrow(/pending\/delisted/);
  });

  it("reject 记录理由；更新后回到 pending（重审门槛）", async () => {
    const plugin = await repo.createPlugin({ manifest: manifestOf(sitePackRaw("驳回演示", [{ url: "https://e.example.com", title: "E" }])) });
    const rejected = await repo.reviewPlugin(plugin.slug, "reject", "描述太简短", { actor: "admin" });
    expect(rejected.status).toBe("rejected");
    expect(rejected.reviewNote).toBe("描述太简短");

    const updated = await repo.updatePlugin(
      plugin.slug,
      manifestOf(sitePackRaw("驳回演示", [{ url: "https://e.example.com", title: "E" }, { url: "https://e2.example.com", title: "E2" }])),
    );
    expect(updated.status).toBe("pending");
    expect((updated.manifest.payload as SitePackPayload).sites.length).toBe(2);
  });

  it("已发布插件更新：状态回到 pending 并清空 publishedAt（更新必须重审）", async () => {
    const plugin = await repo.createPlugin({ manifest: manifestOf(sitePackRaw("更新重审", [{ url: "https://n1.example.com", title: "N1" }])) });
    const approved = await repo.reviewPlugin(plugin.slug, "approve", null);
    expect(approved.publishedAt).toBeGreaterThan(0);

    const updated = await repo.updatePlugin(
      plugin.slug,
      manifestOf(sitePackRaw("更新重审", [{ url: "https://n1.example.com", title: "N1" }, { url: "https://n2.example.com", title: "N2" }])),
    );
    expect(updated.status).toBe("pending");
    expect(updated.publishedAt).toBeNull();
  });

  it("delist：published → delisted，可再 approve 恢复", async () => {
    const plugin = await repo.createPlugin({ manifest: manifestOf(sitePackRaw("下架演示", [{ url: "https://f.example.com", title: "F" }])), status: "published" });
    const delisted = await repo.reviewPlugin(plugin.slug, "delist", "收到举报", { actor: "admin" });
    expect(delisted.status).toBe("delisted");
    const restored = await repo.reviewPlugin(plugin.slug, "approve", "已整改");
    expect(restored.status).toBe("published");
    const audits = await repo.raw("SELECT action FROM audit_logs WHERE target = ?", [plugin.slug]);
    const actions = audits.map((a) => a.action);
    expect(actions).toContain("plugin.delist");
    expect(actions).toContain("plugin.review.approve");
  });
});

describe("安装 / 卸载（site-pack 真实落库）", () => {
  it("安装：去重既有 URL、建缺失分类、写 source 标记、计数与幂等", async () => {
    const categoryId = await repo.ensureCategory("AI 编程");
    await repo.createSite({ url: "https://existing.example.com/", title: "已有站点", categoryId });

    const plugin = await repo.createPlugin({
      manifest: manifestOf(
        sitePackRaw("安装演示", [
          { url: "https://existing.example.com", title: "重复（应跳过）" },
          { url: "https://new1.example.com", title: "新站 1", tags: ["新"] },
          { url: "https://new2.example.com", title: "新站 2" },
        ]),
      ),
      status: "published",
    });

    const first = await repo.installPlugin(plugin.slug, "visitor-1");
    expect(first.alreadyInstalled).toBe(false);
    expect(first.applied.sitesAdded).toBe(2);
    expect(first.applied.sitesSkipped).toBe(1);
    expect(first.plugin.installCount).toBe(1);
    expect(first.install.removedAt).toBeNull();

    const imported = await repo.raw("SELECT id, source FROM sites WHERE source = ? AND deleted_at IS NULL", ["plugin:" + plugin.slug]);
    expect(imported.length).toBe(2);

    // 重复安装：不重复入库、不重复计数（幂等）
    const second = await repo.installPlugin(plugin.slug, "visitor-1");
    expect(second.alreadyInstalled).toBe(true);
    expect(second.applied.sitesAdded).toBe(0);
    expect(second.applied.sitesSkipped).toBe(3);
    expect(second.plugin.installCount).toBe(1);
  });

  it("未上架插件拒绝安装", async () => {
    const pending = await repo.createPlugin({ manifest: manifestOf(sitePackRaw("待审禁装", [{ url: "https://g.example.com", title: "G" }])) });
    await expect(repo.installPlugin(pending.slug, "visitor-1")).rejects.toThrow(/只有已上架/);
  });

  it("主题类安装：不落站点，仅记录（前端负责应用）", async () => {
    const result = await repo.installPlugin("theme-violet", "visitor-1");
    expect(result.applied.sitesAdded).toBe(0);
    expect(result.applied.createdSiteIds).toEqual([]);
    expect(result.plugin.installCount).toBe(1);
  });

  it("卸载默认保留站点；removeSites=true 只软删本插件来源的站点（回收站可恢复）", async () => {
    const plugin = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("卸载演示", [{ url: "https://h1.example.com", title: "H1" }, { url: "https://h2.example.com", title: "H2" }])),
      status: "published",
    });
    await repo.installPlugin(plugin.slug, "visitor-2");

    const soft = await repo.uninstallPlugin(plugin.slug, "visitor-2");
    expect(soft.removed).toBe(true);
    expect(soft.removedSites).toBe(0);
    let alive = await repo.raw("SELECT COUNT(*) AS cnt FROM sites WHERE source = ? AND deleted_at IS NULL", ["plugin:" + plugin.slug]);
    expect(Number(alive[0].cnt)).toBe(2);
    expect(soft.plugin.installCount).toBe(0);

    // 重装后按 removeSites 卸载：进入回收站（deleted_at 非空），物理行仍在
    await repo.installPlugin(plugin.slug, "visitor-2");
    const hard = await repo.uninstallPlugin(plugin.slug, "visitor-2", { removeSites: true });
    expect(hard.removedSites).toBe(2);
    alive = await repo.raw("SELECT COUNT(*) AS cnt FROM sites WHERE source = ? AND deleted_at IS NULL", ["plugin:" + plugin.slug]);
    expect(Number(alive[0].cnt)).toBe(0);
    const all = await repo.raw("SELECT COUNT(*) AS cnt FROM sites WHERE source = ?", ["plugin:" + plugin.slug]);
    expect(Number(all[0].cnt)).toBe(2);

    // 幂等：重复卸载不报错
    const again = await repo.uninstallPlugin(plugin.slug, "visitor-2", { removeSites: true });
    expect(again.removed).toBe(false);
    expect(again.removedSites).toBe(0);
  });
  it("卸载 site-pack 且 removeSites=true 时同步清理专属分类与子分类", async () => {
    const pluginWithCat = await repo.createPlugin({
      manifest: manifestOf({
        manifestVersion: 1,
        kind: "site-pack",
        name: "专属分类包",
        description: "测试专属分类同步清理",
        icon: "🧪",
        version: "1.0.0",
        tags: ["测试"],
        payload: {
          categories: [{ title: "专属测试主分类" }],
          sites: [
            {
              url: "https://cat-test-1.example.com",
              title: "CatSite 1",
              category: "专属测试主分类",
              subCategory: "专属测试子分类",
            },
          ],
        },
      }),
      status: "published",
    });

    await repo.installPlugin(pluginWithCat.slug, "user-cat-test");
    let catRows = await repo.raw("SELECT id FROM categories WHERE source = ?", ["plugin:" + pluginWithCat.slug]);
    expect(catRows.length).toBe(2); // 主分类与子分类

    const uninst = await repo.uninstallPlugin(pluginWithCat.slug, "user-cat-test", { removeSites: true });
    expect(uninst.removed).toBe(true);
    expect(uninst.removedSites).toBe(1);
    expect(uninst.removedCategories).toBe(2);

    catRows = await repo.raw("SELECT id FROM categories WHERE source = ?", ["plugin:" + pluginWithCat.slug]);
    expect(catRows.length).toBe(0);
  });

  it("回收站里的用户站点也保护插件分类：卸载后保留分类，恢复站点仍落回原分类", async () => {
    // 分类名必须独有：ensureCategory 按 title 去重，复用已有分类时 source 不会记为 plugin
    const plugin = await repo.createPlugin({
      manifest: manifestOf({
        manifestVersion: 1,
        kind: "site-pack",
        name: "回收站分类保护",
        description: "测试用网址包",
        icon: "🧪",
        version: "1.0.0",
        tags: ["测试"],
        payload: {
          categories: [{ title: "回收站专属分类" }],
          sites: [
            {
              url: "https://trash-cat-own.example.com",
              title: "插件站点",
              category: "回收站专属分类",
            },
          ],
        },
      }),
      status: "published",
    });
    await repo.installPlugin(plugin.slug, "user-trash-cat");
    const catRows = await repo.raw("SELECT id FROM categories WHERE source = ?", ["plugin:" + plugin.slug]);
    expect(catRows.length).toBe(1);
    const categoryId = String(catRows[0]!.id);

    // 用户把自己的站点放进插件分类，随后删除（进回收站）
    const userSite = await repo.createSite({
      url: "https://trash-cat-user.example.com",
      title: "用户站点",
      categoryId,
    });
    await repo.deleteSite(userSite.id);

    const uninst = await repo.uninstallPlugin(plugin.slug, "user-trash-cat", { removeSites: true });
    expect(uninst.removedSites).toBe(1);
    // 旧实现只看 deleted_at IS NULL，会把仍被回收站引用的分类一并删掉
    expect(uninst.removedCategories).toBe(0);
    const kept = await repo.getCategory(categoryId);
    expect(kept).not.toBeNull();
    expect(kept!.source).toBe("api");

    const restored = await repo.restoreSite(userSite.id);
    expect(restored!.categoryId).toBe(categoryId);
  });

});

describe("星标 / 举报 / 安装状态", () => {
  it("星标幂等：重复点亮不重复计数，取消后计数回落", async () => {
    const plugin = await repo.createPlugin({ manifest: manifestOf(sitePackRaw("星标演示", [{ url: "https://i.example.com", title: "I" }])), status: "published" });
    const s1 = await repo.starPlugin(plugin.slug, "user-a");
    expect(s1.starCount).toBe(1);
    const s2 = await repo.starPlugin(plugin.slug, "user-a");
    expect(s2.starCount).toBe(1);
    const s3 = await repo.starPlugin(plugin.slug, "user-b");
    expect(s3.starCount).toBe(2);
    const u1 = await repo.unstarPlugin(plugin.slug, "user-a");
    expect(u1.starCount).toBe(1);
    const u2 = await repo.unstarPlugin(plugin.slug, "user-a");
    expect(u2.starCount).toBe(1);
    expect(u2.starred).toBe(false);
  });

  it("举报：计数 + 事件 + 审计三处留痕", async () => {
    const plugin = await repo.createPlugin({ manifest: manifestOf(sitePackRaw("举报演示", [{ url: "https://j.example.com", title: "J" }])), status: "published" });
    const result = await repo.reportPlugin(plugin.slug, { reason: "包含失效链接", identity: "user-c" });
    expect(result.reportCount).toBe(1);
    const events = await repo.raw("SELECT kind FROM events WHERE kind = 'plugin_report'");
    expect(events.length).toBeGreaterThan(0);
    const audits = await repo.raw("SELECT action FROM audit_logs WHERE target = ?", [plugin.slug]);
    expect(audits.map((a) => a.action)).toContain("plugin.report");
  });

  it("getPluginInstall 可回读安装状态（详情页按钮态）", async () => {
    const plugin = await repo.createPlugin({ manifest: manifestOf(sitePackRaw("回读演示", [{ url: "https://k.example.com", title: "K" }])), status: "published" });
    await repo.installPlugin(plugin.slug, "visitor-3");
    const install = await repo.getPluginInstall(plugin.id, "visitor-3");
    expect(install).not.toBeNull();
    expect(install?.version).toBe("1.0.0");
    expect(install?.meta).toBeTruthy();
    const none = await repo.getPluginInstall(plugin.id, "visitor-404");
    expect(none).toBeNull();

    const snapshot = await repo.getPluginInstalledManifest(plugin.id, "visitor-3");
    expect(snapshot).not.toBeNull();
    expect(snapshot?.name).toBe("回读演示");
    expect(snapshot?.version).toBe("1.0.0");
  });

  it("getPluginTelemetry 正确统计大盘指标与 TOP 安装插件", async () => {
    const telemetry = await repo.getPluginTelemetry();
    expect(telemetry.totalPlugins).toBeGreaterThan(0);
    expect(telemetry.publishedCount).toBeGreaterThan(0);
    expect(telemetry.activeInstalls).toBeGreaterThan(0);
    expect(telemetry.kindDistribution.sitePack).toBeGreaterThan(0);
    expect(Array.isArray(telemetry.topInstalled)).toBe(true);
    expect(telemetry.topInstalled.length).toBeGreaterThan(0);
  });

  it("插件发布与审核时自动记录 plugin_versions 快照并支持查询", async () => {
    const p = await repo.createPlugin({
      manifest: manifestOf({
        manifestVersion: 1,
        kind: "site-pack",
        name: "版本流转包",
        version: "1.0.0",
        payload: { sites: [{ url: "https://v1.com", title: "V1" }] },
      }),
      status: "published",
    });

    const versions = await repo.listPluginVersions(p.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe("1.0.0");
    expect(versions[0]?.checksum).toBeTruthy();
    expect(versions[0]?.manifest.name).toBe("版本流转包");

    const v1 = await repo.getPluginVersion(p.id, "1.0.0");
    expect(v1).not.toBeNull();
    expect(v1?.version).toBe("1.0.0");

    const vNone = await repo.getPluginVersion(p.id, "2.0.0");
    expect(vNone).toBeNull();
  });

  it("真实安装者才允许对插件打分与评价，支持幂等更新与大盘统计", async () => {
    const p = await repo.createPlugin({
      manifest: manifestOf({
        manifestVersion: 1,
        kind: "site-pack",
        name: "评价体验包",
        version: "1.0.0",
        payload: { sites: [{ url: "https://rev.com", title: "Rev" }] },
      }),
      status: "published",
    });

    // 1. 未安装直接打分报错
    await expect(
      repo.createPluginReview(p.slug, "uninstalled-user", { rating: 5, content: "好" })
    ).rejects.toThrow("只有已安装该插件的用户才能发表评价与打分");

    // 2. 安装后成功打分
    await repo.installPlugin(p.slug, "reviewer-1");
    const review1 = await repo.createPluginReview(p.slug, "reviewer-1", {
      rating: 5,
      title: "强烈推荐",
      content: "内容非常实用！",
    });
    expect(review1.rating).toBe(5);
    expect(review1.installedVersion).toBe("1.0.0");

    // 3. 第二位用户打分 4 星
    await repo.installPlugin(p.slug, "reviewer-2");
    await repo.createPluginReview(p.slug, "reviewer-2", { rating: 4, content: "很不错" });

    // 4. 统计指标计算
    const stats = await repo.getPluginReviewStats(p.id);
    expect(stats.reviewCount).toBe(2);
    expect(stats.avgRating).toBe(4.5);
    expect(stats.ratingDistribution[5]).toBe(1);
    expect(stats.ratingDistribution[4]).toBe(1);

    // 5. 评价列表与回读
    const list = await repo.listPluginReviews(p.id);
    expect(list.total).toBe(2);
    expect(list.items).toHaveLength(2);

    const myRev = await repo.getUserPluginReview(p.id, "reviewer-1");
    expect(myRev?.title).toBe("强烈推荐");

    // 6. 重复提交幂等更新评分
    const updatedRev = await repo.createPluginReview(p.slug, "reviewer-1", {
      rating: 3,
      title: "重新评价",
    });
    expect(updatedRev.rating).toBe(3);
    const refreshedStats = await repo.getPluginReviewStats(p.id);
    expect(refreshedStats.avgRating).toBe(3.5);
  });

  it("支持 search-pack 安装记录 enginesAdded，并支持 3 次举报自动熔断隔离及审核解封", async () => {
    const sp = await repo.createPlugin({
      manifest: manifestOf({
        manifestVersion: 1,
        kind: "search-pack",
        name: "极客搜索包",
        version: "1.0.0",
        payload: {
          engines: [
            { id: "gh", name: "GitHub", prefix: "!gh", searchUrl: "https://github.com/search?q={q}" },
            { id: "npm", name: "npm", prefix: "!npm", searchUrl: "https://www.npmjs.com/search?q={q}" },
          ],
        },
      }),
      status: "published",
    });

    // 1. 安装记录 enginesAdded
    const installRes = await repo.installPlugin(sp.slug, "dev-user");
    expect(installRes.applied.enginesAdded).toBe(2);

    // 2. 举报第 1、2 次，状态依然 published
    const rep1 = await repo.reportPlugin(sp.slug, { reason: "搜索失效1", identity: "user-1" });
    expect(rep1.reportCount).toBe(1);
    expect(rep1.quarantined).toBe(false);
    expect((await repo.getPluginBySlug(sp.slug))?.status).toBe("published");

    const rep2 = await repo.reportPlugin(sp.slug, { reason: "搜索失效2", identity: "user-2" });
    expect(rep2.reportCount).toBe(2);
    expect(rep2.quarantined).toBe(false);

    // 3. 举报第 3 次，自动熔断隔离为 quarantined
    const rep3 = await repo.reportPlugin(sp.slug, { reason: "恶意诱导", identity: "user-3" });
    expect(rep3.reportCount).toBe(3);
    expect(rep3.quarantined).toBe(true);
    expect(rep3.status).toBe("quarantined");

    const quarantinedPlugin = await repo.getPluginBySlug(sp.slug);
    expect(quarantinedPlugin?.status).toBe("quarantined");
    expect(quarantinedPlugin?.reviewNote).toContain("自动熔断隔离");

    // 4. 遥测统计包含 quarantinedCount 和 searchPack
    const telemetry = await repo.getPluginTelemetry();
    expect(telemetry.quarantinedCount).toBeGreaterThanOrEqual(1);
    expect(telemetry.kindDistribution.searchPack).toBeGreaterThanOrEqual(0);

    // 5. 管理员审核通过，恢复为 published
    const unquarantined = await repo.reviewPlugin(sp.slug, "approve", "经人工核查无恶意行为，解封上架");
    expect(unquarantined.status).toBe("published");
  });

  it("支持按 trending 综合飙升热度排序", async () => {
    const p1 = await repo.createPlugin({
      manifest: manifestOf({
        manifestVersion: 1,
        kind: "site-pack",
        name: "普通插件",
        version: "1.0.0",
        payload: { sites: [{ url: "https://p1.example.com", title: "P1" }] },
      }),
      status: "published",
    });

    const p2 = await repo.createPlugin({
      manifest: manifestOf({
        manifestVersion: 1,
        kind: "site-pack",
        name: "热门插件",
        version: "1.0.0",
        payload: { sites: [{ url: "https://p2.example.com", title: "P2" }] },
      }),
      status: "published",
    });

    // 给 p2 刷安装与星标
    await repo.installPlugin(p2.slug, "user-hot-1");
    await repo.installPlugin(p2.slug, "user-hot-2");
    await repo.starPlugin(p2.slug, "user-hot-1");

    const list = await repo.listPlugins({ sort: "trending", limit: 10 });
    const p2Idx = list.items.findIndex((item) => item.slug === p2.slug);
    const p1Idx = list.items.findIndex((item) => item.slug === p1.slug);
    expect(p2Idx).toBeLessThan(p1Idx);
  });
});


describe("F4 组合包（bundle）：引用校验 / 安装复用 / 失效 fail closed / 不级联卸载", () => {
  it("创建与更新：引用必须已上架、类型一致、非自身非嵌套；成员状态可解析", async () => {
    const member = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("组合成员包", [{ url: "https://bundle-member.example.com", title: "M" }])),
      status: "published",
    });
    const engineMember = await repo.createPlugin({
      manifest: searchPackRaw("组合成员引擎包", "!bm"),
      status: "published",
    });

    // 引用不存在的插件 -> 拒绝
    await expect(
      repo.createPlugin({ manifest: bundleRaw("坏组合-缺失", [{ slug: "not-exist-slug", kind: "site-pack" }]) }),
    ).rejects.toThrow("组合包引用的成员不可用");

    // 引用未上架插件 -> 拒绝
    const pending = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("未上架成员", [{ url: "https://pending-member.example.com", title: "P" }])),
    });
    await expect(
      repo.createPlugin({ manifest: bundleRaw("坏组合-未上架", [{ slug: pending.slug, kind: "site-pack" }]) }),
    ).rejects.toThrow("组合包引用的成员不可用");

    // 类型漂移 -> 拒绝
    await expect(
      repo.createPlugin({ manifest: bundleRaw("坏组合-类型漂移", [{ slug: member.slug, kind: "theme" }]) }),
    ).rejects.toThrow("组合包引用的成员不可用");

    // 合法组合包：创建成功且成员状态可用
    const bundle = await repo.createPlugin({
      manifest: bundleRaw("合法组合包", [
        { slug: member.slug, kind: "site-pack" },
        { slug: engineMember.slug, kind: "search-pack" },
      ]),
      status: "published",
    });
    const members = await repo.getPluginBundleMembers(bundle);
    expect(members).toHaveLength(2);
    expect(members.every((m) => m.available)).toBe(true);
    expect(members[0]?.summary?.siteCount).toBe(1);
    expect(members[1]?.summary?.engineCount).toBe(1);

    // 自引用 -> 拒绝
    await expect(
      repo.updatePlugin(bundle.slug, bundleRaw("合法组合包", [{ slug: bundle.slug, kind: "site-pack" }])),
    ).rejects.toThrow("组合包引用的成员不可用");

    // 成员被下架后：解析标记不可用，更新组合包被拒绝
    await repo.reviewPlugin(member.slug, "delist", "测试下架", { actor: "admin", actorKind: "admin" });
    const broken = await repo.getPluginBundleMembers(bundle);
    expect(broken.find((m) => m.slug === member.slug)?.available).toBe(false);
    await expect(
      repo.updatePlugin(bundle.slug, bundleRaw("合法组合包", [{ slug: member.slug, kind: "site-pack" }])),
    ).rejects.toThrow("组合包引用的成员不可用");
  });

  it("安装：顺序复用成员安装管道，聚合 applied，幂等且卸载不级联", async () => {
    const siteMember = await repo.createPlugin({
      manifest: manifestOf(
        sitePackRaw("组合安装站点包", [{ url: "https://bundle-install-1.example.com", title: "B1" }]),
      ),
      status: "published",
    });
    const engineMember = await repo.createPlugin({
      manifest: searchPackRaw("组合安装引擎包", "!bi"),
      status: "published",
    });
    const themeMember = await repo.createPlugin({
      manifest: themeManifest(),
      status: "published",
      slug: "bundle-theme-member",
    });
    const bundle = await repo.createPlugin({
      manifest: bundleRaw("组合安装包", [
        { slug: siteMember.slug, kind: "site-pack" },
        { slug: engineMember.slug, kind: "search-pack" },
        { slug: themeMember.slug, kind: "theme" },
      ]),
      status: "published",
    });

    const first = await repo.installPlugin(bundle.slug, "bundle-visitor-1");
    expect(first.alreadyInstalled).toBe(false);
    expect(first.applied.sitesAdded).toBe(1);
    expect(first.applied.sitesSkipped).toBe(0);
    expect(first.applied.bundleItems).toHaveLength(3);
    expect(first.applied.bundleItems?.map((i) => i.slug)).toEqual([
      siteMember.slug,
      engineMember.slug,
      themeMember.slug,
    ]);
    expect(first.applied.bundleItems?.find((i) => i.slug === themeMember.slug)?.alreadyInstalled).toBe(false);

    // 成员与组合包各自计数，且组合包自身不落站点
    const siteMemberAfter = await repo.getPluginBySlug(siteMember.slug);
    expect(siteMemberAfter?.installCount).toBe(1);
    expect(first.plugin.installCount).toBe(1);

    // 重复安装：组合包与成员都幂等，不重复计数、不重复建站点
    const again = await repo.installPlugin(bundle.slug, "bundle-visitor-1");
    expect(again.alreadyInstalled).toBe(true);
    expect(again.applied.sitesAdded).toBe(0);
    expect(again.applied.sitesSkipped).toBe(1);
    expect(again.applied.bundleItems?.every((i) => i.alreadyInstalled)).toBe(true);

    // 卸载组合包：只解绑自身，成员安装记录与站点都保留
    const uninstalled = await repo.uninstallPlugin(bundle.slug, "bundle-visitor-1", { removeSites: true });
    expect(uninstalled.removed).toBe(true);
    expect(uninstalled.removedSites).toBe(0);
    const siteMemberInstall = await repo.getPluginInstall(siteMember.id, "bundle-visitor-1");
    expect(siteMemberInstall?.removedAt).toBeNull();
    const stillThere = await repo.raw("SELECT id FROM sites WHERE source = ? AND deleted_at IS NULL", [
      `plugin:${siteMember.slug}`,
    ]);
    expect(stillThere.length).toBe(1);
  });

  it("成员失效后安装 fail closed；恢复上架后重新可安装", async () => {
    const member = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("失效成员包", [{ url: "https://broken-member.example.com", title: "BM" }])),
      status: "published",
    });
    const bundle = await repo.createPlugin({
      manifest: bundleRaw("待失效组合包", [{ slug: member.slug, kind: "site-pack" }]),
      status: "published",
    });

    await repo.reviewPlugin(member.slug, "delist", "模拟下架", { actor: "admin", actorKind: "admin" });
    await expect(repo.installPlugin(bundle.slug, "bundle-visitor-2")).rejects.toThrow("组合包暂不可安装");

    // 审核恢复后再 approve 组合包自身（模拟治理流程）即可重新安装
    await repo.reviewPlugin(member.slug, "approve", null, { actor: "admin", actorKind: "admin" });
    const retry = await repo.installPlugin(bundle.slug, "bundle-visitor-2");
    expect(retry.applied.bundleItems).toHaveLength(1);
    expect(retry.applied.sitesAdded).toBe(1);
  });
});

describe("F0 作者归属 / 编辑精选 / 版本提交", () => {
  it("ownerKey 对同一身份稳定、不同身份不同；公开作者列表只含已上架", async () => {
    const owner = "owner-" + Date.now();
    const a = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("作者归属 A", [{ url: `https://owner-a-${Date.now()}.example.com`, title: "A" }])),
      ownerIdentity: owner,
    });
    const b = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("作者归属 B", [{ url: `https://owner-b-${Date.now()}.example.com`, title: "B" }])),
      ownerIdentity: owner,
    });
    const other = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("作者归属 C", [{ url: `https://owner-c-${Date.now()}.example.com`, title: "C" }])),
      ownerIdentity: owner + "-other",
    });

    expect(a.ownerKey).toMatch(/^[a-f0-9]{24}$/);
    expect(a.ownerKey).toBe(b.ownerKey);
    expect(other.ownerKey).not.toBe(a.ownerKey);

    const mine = await repo.listPluginsByOwner(owner);
    expect(mine.items.map((p) => p.slug).sort()).toEqual([a.slug, b.slug].sort());

    // 未上架时公开作者页为空
    expect((await repo.listPluginsByOwnerKey(a.ownerKey!)).total).toBe(0);
    await repo.reviewPlugin(a.slug, "approve", null, { actor: "admin" });
    const publicPage = await repo.listPluginsByOwnerKey(a.ownerKey!);
    expect(publicPage.items.map((p) => p.slug)).toEqual([a.slug]);
  });

  it("新版本提交：pending 存变更说明；驳回后允许同版本修复；通过后写入版本历史", async () => {
    const owner = "version-owner-" + Date.now();
    const created = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("版本提交演示", [{ url: `https://version-${Date.now()}.example.com`, title: "V1" }])),
      ownerIdentity: owner,
      status: "published",
    });

    const v11 = manifestOf({
      ...sitePackRaw("版本提交演示", [
        { url: `https://version-${Date.now()}.example.com`, title: "V1" },
        { url: `https://version-2-${Date.now()}.example.com`, title: "V2" },
      ]),
      version: "1.1.0",
    });
    const submitted = await repo.submitPluginVersion(created.slug, v11, "新增站点 V2", { actor: owner });
    expect(submitted.status).toBe("pending");
    expect(submitted.version).toBe("1.1.0");
    expect(submitted.pendingChangelog).toBe("新增站点 V2");
    expect(submitted.publishedAt).toBeNull();

    await repo.reviewPlugin(created.slug, "reject", "来源需补充", { actor: "admin" });
    // 驳回后同一版本号允许修正内容再次提交
    const resubmitted = await repo.submitPluginVersion(created.slug, v11, "补充来源后重新提交", { actor: owner });
    expect(resubmitted.status).toBe("pending");
    expect(resubmitted.pendingChangelog).toBe("补充来源后重新提交");

    const approved = await repo.reviewPlugin(created.slug, "approve", null, { actor: "admin" });
    expect(approved.status).toBe("published");
    expect(approved.pendingChangelog).toBeNull();
    const versions = await repo.listPluginVersions(created.id);
    expect(versions.map((v) => v.version)).toEqual(["1.1.0", "1.0.0"]);
    const v11Record = versions.find((v) => v.version === "1.1.0");
    expect(v11Record?.changelog).toBe("补充来源后重新提交");

    // 已上架后同版本修正被拒绝，必须递增
    await expect(repo.submitPluginVersion(created.slug, v11, "覆盖已发布版本", { actor: owner })).rejects.toThrow(
      /必须大于当前版本/,
    );
  });

  it("编辑精选：featured 过滤与 rank 排序；关闭后退出精选列表", async () => {
    const one = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("精选一号", [{ url: `https://featured-1-${Date.now()}.example.com`, title: "F1" }])),
      status: "published",
    });
    const two = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("精选二号", [{ url: `https://featured-2-${Date.now()}.example.com`, title: "F2" }])),
      status: "published",
    });

    await repo.setPluginFeatured(two.slug, true, 10, { actor: "admin" });
    await repo.setPluginFeatured(one.slug, true, 20, { actor: "admin" });
    const featured = await repo.listPlugins({ status: "published", featured: true, sort: "featured", limit: 100 });
    const slugs = featured.items.map((p) => p.slug);
    expect(slugs.indexOf(one.slug)).toBeLessThan(slugs.indexOf(two.slug));
    expect(featured.items.find((p) => p.slug === one.slug)?.featured).toBe(true);
    expect(featured.items.find((p) => p.slug === one.slug)?.featuredRank).toBe(20);

    await repo.setPluginFeatured(one.slug, false, 0, { actor: "admin" });
    const after = await repo.listPlugins({ status: "published", featured: true, limit: 100 });
    expect(after.items.some((p) => p.slug === one.slug)).toBe(false);
    const audits = await repo.raw("SELECT action FROM audit_logs WHERE target = ?", [one.slug]);
    expect(audits.map((a) => a.action)).toContain("plugin.featured");
  });
});

describe("E5/E6 评价聚合与治理", () => {
  it("隐藏评价立即退出公开列表与评分统计；作者本人仍可看到状态；恢复后回归", async () => {
    const plugin = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("评价治理演示", [{ url: `https://review-mod-${Date.now()}.example.com`, title: "R" }])),
      status: "published",
    });
    await repo.installPlugin(plugin.slug, "reviewer-hide-1");
    const review = await repo.createPluginReview(plugin.slug, "reviewer-hide-1", {
      rating: 5,
      title: "很好用",
      content: "真实体验",
    });

    const reported = await repo.reportPluginReview(plugin.slug, review.id, "含广告嫌疑", "reporter-1", {
      actor: "reporter-1",
      actorKind: "identity",
    });
    expect(reported.reportCount).toBe(1);
    // 举报不自动隐藏
    expect((await repo.getPluginReviewStats(plugin.id)).reviewCount).toBe(1);

    const hidden = await repo.moderatePluginReview(review.id, "hide", "人工复核后隐藏", {
      actor: "admin",
      actorKind: "admin",
    });
    expect(hidden.status).toBe("hidden");
    expect(hidden.moderationNote).toBe("人工复核后隐藏");

    const publicList = await repo.listPluginReviews(plugin.id);
    expect(publicList.total).toBe(0);
    const stats = await repo.getPluginReviewStats(plugin.id);
    expect(stats.reviewCount).toBe(0);
    expect(stats.avgRating).toBe(0);

    const mine = await repo.getUserPluginReview(plugin.id, "reviewer-hide-1");
    expect(mine?.status).toBe("hidden");

    const adminVisible = await repo.listPluginReviewsForAdmin({ status: "hidden" });
    expect(adminVisible.items.some((r) => r.id === review.id)).toBe(true);
    const restored = await repo.moderatePluginReview(review.id, "restore", "申诉通过", { actor: "admin" });
    expect(restored.status).toBe("visible");
    expect((await repo.getPluginReviewStats(plugin.id)).reviewCount).toBe(1);
  });
});

describe("E4/E3 漏斗、治理与 F2 短链", () => {
  it("漏斗按日聚合插件浏览/点击/安装/卸载/评价举报事件", async () => {
    const before = await repo.getPluginFunnel(1);
    for (const kind of [
      "plugin_view",
      "plugin_install_click",
      "plugin_install_success",
      "plugin_uninstall",
      "plugin_review_report",
    ] as const) {
      await repo.recordEvent(kind, { meta: { slug: "funnel-demo" } });
    }
    const after = await repo.getPluginFunnel(1);
    expect(after.totals.views - before.totals.views).toBe(1);
    expect(after.totals.installClicks - before.totals.installClicks).toBe(1);
    expect(after.totals.installs - before.totals.installs).toBe(1);
    expect(after.totals.uninstalls - before.totals.uninstalls).toBe(1);
    expect(after.totals.reports - before.totals.reports).toBe(1);
    expect(after.series).toHaveLength(1);
    expect(after.series[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("治理告警：待审 SLA、插件举报、评价举报都只读提示", async () => {
    const pending = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("SLA 待审演示", [{ url: `https://sla-${Date.now()}.example.com`, title: "S" }])),
    });
    await repo.run("UPDATE plugins SET created_at = ? WHERE slug = ?", [Date.now() - 80 * 3600_000, pending.slug]);

    const reportedPlugin = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("举报插件演示", [{ url: `https://gov-${Date.now()}.example.com`, title: "G" }])),
      status: "published",
    });
    await repo.run("UPDATE plugins SET report_count = 4 WHERE slug = ?", [reportedPlugin.slug]);

    await repo.installPlugin(reportedPlugin.slug, "gov-reviewer");
    const review = await repo.createPluginReview(reportedPlugin.slug, "gov-reviewer", { rating: 4, content: "还行" });
    await repo.run("UPDATE plugin_reviews SET report_count = 3 WHERE id = ?", [review.id]);

    const alerts = await repo.getPluginGovernanceAlerts();
    expect(alerts.some((a) => a.kind === "pending_sla" && a.slug === pending.slug)).toBe(true);
    expect(alerts.some((a) => a.kind === "reported" && a.slug === reportedPlugin.slug)).toBe(true);
    expect(alerts.some((a) => a.kind === "review_reported" && a.slug === reportedPlugin.slug)).toBe(true);
    // 只读告警：不改变插件/评价状态
    expect((await repo.getPluginBySlug(pending.slug))?.status).toBe("pending");
    expect((await repo.getPluginBySlug(reportedPlugin.slug))?.status).toBe("published");
    expect((await repo.listPluginReviews(reportedPlugin.id)).total).toBe(1);
  });

  it("短链：只解析内部 /marketplace/ 目标并累计点击；非法目标拒绝", async () => {
    const plugin = await repo.createPlugin({
      manifest: manifestOf(sitePackRaw("短链演示", [{ url: `https://short-${Date.now()}.example.com`, title: "S" }])),
      status: "published",
    });
    const link = await repo.createShortLink({
      target: `/marketplace/${plugin.slug}?install=1`,
      pluginSlug: plugin.slug,
    });
    expect(link.code).toMatch(/^[a-f0-9]{8}$/);
    expect(link.target).toBe(`/marketplace/${plugin.slug}?install=1`);
    const resolved = await repo.resolveShortLink(link.code);
    expect(resolved?.target).toBe(link.target);
    expect(resolved?.clicks).toBe(1);
    const again = await repo.resolveShortLink(link.code);
    expect(again?.clicks).toBe(2);

    await repo.run("INSERT INTO short_links (code, target, plugin_slug, clicks, created_at) VALUES (?,?,?,?,?)", [
      "eviltest",
      "https://evil.example.com",
      null,
      0,
      Date.now(),
    ]);
    expect(await repo.resolveShortLink("eviltest")).toBeNull();
    expect(await repo.resolveShortLink("missing1")).toBeNull();
  });
});
