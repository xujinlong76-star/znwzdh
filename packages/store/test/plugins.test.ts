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

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-plugins-"));
  db = await openDb({ dialect: "sqlite", sqlitePath: join(dir, "test.db") });
  repo = new Repository(db);
});

afterAll(async () => {
  try {
    await db?.close();
  } catch {
    // 清理失败不影响断言结果
  }
  rmSync(dir, { recursive: true, force: true });
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
  });
});
