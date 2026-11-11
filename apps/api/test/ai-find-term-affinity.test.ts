/**
 * A4「AI 泛词」假朋友治理：判别词亲和重排的行为锁定。
 *
 * 引擎的二元组 OR 召回 + RRF 只看排名，只命中泛词「ai」的站点（编程工具、
 * 模型平台）能靠字段权重挤进创作类查询的尾部。retrieveCopilotCandidates
 * 在候选层做稳定分区：覆盖 ≥1 个判别词的候选（站点文案命中，或所属分类
 * 标题凑齐该词的字）排前，只覆盖泛词的沉底——只挪顺序、不删候选。
 *
 * 本测试用最小夹具库锁定三件事：
 *   1. 「AI 生图」：文案没写「生图」但分类对口的图像站（靠分类回退覆盖）
 *      必须排在只命中「ai」的编程工具之前；
 *   2. 「AI 编程」：编程工具是真命中，必须居首（亲和重排不误伤正例）；
 *   3. 沉底不等于删除：假朋友仍在候选里（零召回损失）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { retrieveCopilotCandidates } from "../src/routes/copilot.ts";

let dir: string;
let ctx: AppContext;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-term-affinity-"));
  ctx = await createContext(
    loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      corsOrigins: ["*"],
      embedding: { enabled: false },
    } as never),
  );
  const imgCat = await ctx.repo.createCategory({ title: "AI 图像生成", slug: "ai-image" });
  const devCat = await ctx.repo.createCategory({ title: "AI 编程助手", slug: "ai-coding" });
  const modelCat = await ctx.repo.createCategory({ title: "模型与数据集", slug: "ai-models" });

  await ctx.repo.createSite({
    url: "https://jimeng.example.com",
    title: "即梦绘图",
    description: "AI 生图与绘画平台",
    categoryId: imgCat.id,
    sort: 1,
  });
  await ctx.repo.createSite({
    url: "https://leonardo.example.com",
    title: "Leonardo 绘图台",
    description: "AI-powered image generation platform",
    categoryId: imgCat.id,
    sort: 2,
  });
  await ctx.repo.createSite({
    url: "https://cursor.example.com",
    title: "Cursor 代码编辑器",
    description: "AI 编程助手与代码编辑器",
    categoryId: devCat.id,
    sort: 3,
  });
  await ctx.repo.createSite({
    url: "https://mistral.example.com",
    title: "Mistral 模型平台",
    description: "AI 大模型与数据集平台",
    categoryId: modelCat.id,
    sort: 4,
  });
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("判别词亲和重排（A4）", () => {
  it("「AI 生图」：分类回退覆盖的图像站排在只命中泛词的编程工具之前，且不删候选", async () => {
    const r = await retrieveCopilotCandidates(ctx, "AI 生图", {
      pinCategory: false,
      lexicalOnly: true,
    });
    const titles = r.sites.map((s) => s.title);
    expect(titles).toContain("Cursor 代码编辑器");
    expect(titles.indexOf("即梦绘图")).toBeLessThan(titles.indexOf("Cursor 代码编辑器"));
    expect(titles.indexOf("Leonardo 绘图台")).toBeLessThan(titles.indexOf("Cursor 代码编辑器"));
    expect(titles.indexOf("Leonardo 绘图台")).toBeLessThan(titles.indexOf("Mistral 模型平台"));
  });

  it("「AI 编程」：编程工具是真命中，必须居首", async () => {
    const r = await retrieveCopilotCandidates(ctx, "AI 编程", {
      pinCategory: false,
      lexicalOnly: true,
    });
    expect(r.sites[0]?.title).toBe("Cursor 代码编辑器");
  });
});
