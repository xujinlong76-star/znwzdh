/**
 * P2a-6 站点归属的边界校验（方案 §2.6）：站点只能挂叶子，一级根只作导航。
 *
 * 这条规矩**刻意只做在写入口**，仓储层 repo.createSite 保持宽松：
 * 迁移脚本与 SKOS 导出要直挂根，存量夹具也普遍把站点挂在平铺根上，
 * 把它做成存储不变量的收益为负。所以最后一组用例锁的是「仓储仍然放行」，
 * 而不是「仓储也拦」。
 *
 * 另一个容易被忽略的点：校验器接受 slug，落库必须是解析后的真实 id——
 * 把 slug 直接写进 sites.category_id 就是悬空外键，前台类目页看不到这条站点。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UNCATEGORIZED_CATEGORY_ID } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-attach-guard-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "attach.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
  // 用权威树而不是自造层级：叶子/根的关系与线上一致
  await ctx.repo.seedCategoryRegistry();
  await ctx.repo.ensureUncategorized();
  await ctx.repo.createCategory({ id: "bare-root", title: "无子级的根" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function createSite(payload: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: "/api/sites", payload });
  return { status: res.statusCode, body: res.json() as Record<string, any> };
}

describe("POST /api/sites 只接受叶子", () => {
  it("挂到一级根被拒，且文案直接列出可改挂的叶子", async () => {
    const root = await ctx.repo.getCategoryBySlug("ai-tools");
    const res = await createSite({ url: "https://attach-root.example.com/", title: "挂根的站", categoryId: root!.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/一级根/);
    expect(res.body.error).toMatch(/AI 编程助手/);
    expect(await ctx.repo.findSiteByUrl("https://attach-root.example.com/")).toBeNull();
  });

  it("根下没有叶子时给出「先建叶子」的指路而不是空列表", async () => {
    const res = await createSite({ url: "https://attach-bare.example.com/", title: "空根", categoryId: "bare-root" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/下还没有子类目/);
  });

  it("不存在的类目也被拒：写入口不再造悬空 category_id", async () => {
    const res = await createSite({ url: "https://attach-ghost.example.com/", title: "幽灵类目", categoryId: "cat-does-not-exist" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/不存在/);
  });

  it("传 slug 能建，但落库的是解析后的真实 id", async () => {
    const leaf = await ctx.repo.getCategoryBySlug("ai-coding-assistant");
    const res = await createSite({ url: "https://attach-slug.example.com/", title: "按 slug 挂", categoryId: "ai-coding-assistant" });
    expect(res.status).toBe(201);
    expect(res.body.categoryId).toBe(leaf!.id);
    const stored = await ctx.repo.getSite(res.body.id as string);
    expect(stored!.categoryId).toBe(leaf!.id);
  });

  it("「未分类」是唯一的根例外：兜底桶按设计挂在顶层", async () => {
    const res = await createSite({ url: "https://attach-none.example.com/", title: "进兜底桶", categoryId: UNCATEGORIZED_CATEGORY_ID });
    expect(res.status).toBe(201);
    expect(res.body.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
  });
});

describe("PATCH 与批量口子同一套规矩", () => {
  it("PATCH 把站点挪到一级根 → 400，挪到叶子 → 200", async () => {
    const created = await createSite({ url: "https://attach-patch.example.com/", title: "待挪站", categoryId: "ai-coding-assistant" });
    expect(created.status).toBe(201);
    const root = await ctx.repo.getCategoryBySlug("ai-tools");
    const bad = await app.inject({ method: "PATCH", url: "/api/sites/" + created.body.id, payload: { categoryId: root!.id } });
    expect(bad.statusCode).toBe(400);
    expect((await ctx.repo.getSite(created.body.id as string))!.categoryId).toBe(created.body.categoryId);

    const good = await app.inject({ method: "PATCH", url: "/api/sites/" + created.body.id, payload: { categoryId: "chat-assistants" } });
    expect(good.statusCode).toBe(200);
    const leaf = await ctx.repo.getCategoryBySlug("chat-assistants");
    expect(good.json().categoryId).toBe(leaf!.id);
  });

  it("bulk setCategory 指向一级根 → 400，且 dryRun 也先校验", async () => {
    const site = await ctx.repo.createSite({ url: "https://attach-bulk.example.com/", title: "批量目标", categoryId: await ctx.repo.ensureUncategorized() });
    const root = await ctx.repo.getCategoryBySlug("design-and-creative");
    for (const dryRun of [true, false]) {
      const res = await app.inject({ method: "POST", url: "/api/sites/bulk", payload: { op: "setCategory", ids: [site.id], categoryId: root!.id, dryRun } });
      expect(res.statusCode, `dryRun=${dryRun}`).toBe(400);
    }
    const ok = await app.inject({
      method: "POST", url: "/api/sites/bulk",
      payload: { op: "setCategory", ids: [site.id], categoryId: "models-and-datasets", dryRun: false },
    });
    expect(ok.statusCode).toBe(200);
    const leaf = await ctx.repo.getCategoryBySlug("models-and-datasets");
    expect((await ctx.repo.getSite(site.id))!.categoryId).toBe(leaf!.id);
  });

  it("批导入没有 400 可退：不可挂的类目一律降级到未分类，而不是塞进 sort 最靠前的真实类目", async () => {
    const root = await ctx.repo.getCategoryBySlug("ai-tools");
    const res = await app.inject({
      method: "POST", url: "/api/sites/batch",
      payload: {
        sites: [
          { url: "https://batch-root.example.com/", title: "默认类目是根", categoryId: root!.id },
          { url: "https://batch-ok.example.com/", title: "合法叶子", categoryId: "ai-coding-assistant" },
        ],
        defaultCategoryId: "bare-root",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().categoryDegraded).toBe(1);
    const bad = await ctx.repo.findSiteByUrl("https://batch-root.example.com/");
    expect(bad!.categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
    const leaf = await ctx.repo.getCategoryBySlug("ai-coding-assistant");
    const good = await ctx.repo.findSiteByUrl("https://batch-ok.example.com/");
    expect(good!.categoryId).toBe(leaf!.id);
  });
});

describe("仓储层保持宽松（刻意的边界规则，不是存储不变量）", () => {
  it("repo.createSite 仍能把站点直接挂到一级根", async () => {
    const root = await ctx.repo.getCategoryBySlug("ai-tools");
    const site = await ctx.repo.createSite({ url: "https://repo-root.example.com/", title: "迁移脚本形态", categoryId: root!.id });
    expect(site.categoryId).toBe(root!.id);
  });
});
