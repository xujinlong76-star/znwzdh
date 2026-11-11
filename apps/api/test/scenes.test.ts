/**
 * 场景包只读接口（GET /api/scenes、GET /api/scenes/:id）的硬约束测试：
 *  1. 列表与定义同源：数量、顺序、description/intro 都来自 SCENE_PACKS，
 *     不存在第二份清单（新增包没写说明文案会在这里直接红）；
 *  2. 详情只出站内真实召回：站点 id 只能是库里真实存在的，跨步骤不重复；
 *  3. 与 POST /api/ai/find 的场景展开同口径：同一步的站点集合必须一致，
 *     两条链路漂移会在这里被抓出来；
 *  4. 未知场景如实 404，不给空壳假页面。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { SCENE_PACKS, scenePackById } from "../src/ai-finder.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
const seededIds = new Set<string>();

interface SceneSummary {
  id: string;
  title: string;
  description: string;
  intro: string;
  stepCount: number;
  resolvedStepCount: number;
  siteCount: number;
  stepLabels: string[];
}
interface SceneDetail {
  id: string;
  title: string;
  description: string;
  intro: string;
  siteCount: number;
  steps: Array<{ label: string; sites: Array<{ siteId: string; title: string; url: string }> }>;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-scenes-"));
  ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
  app = await buildServer(ctx);
  await app.ready();

  const office = await ctx.repo.createCategory({ title: "效率办公", slug: "office" });
  const seeds = [
    { url: "https://www.zhaozhanzhe.example/ppt-master", title: "PPT 大师在线制作", description: "在线做 PPT 的演示文稿工具", tags: ["PPT", "幻灯片", "演示"] },
    { url: "https://slides.example.com/free", title: "免费幻灯片模板站", description: "PPT 模板与幻灯片素材下载", tags: ["PPT", "模板"] },
    { url: "https://pic.example.com/free", title: "免费图片素材库", description: "免费图片素材与图标下载", tags: ["图片", "素材", "图标"] },
  ];
  for (const s of seeds) {
    const site = await ctx.repo.createSite({ ...s, categoryId: office.id });
    seededIds.add(site.id);
  }
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/scenes", () => {
  it("列表与 SCENE_PACKS 定义逐项一致（数量/顺序/标题/步骤数）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/scenes" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; total: number; scenes: SceneSummary[] };
    expect(body.ok).toBe(true);
    expect(body.total).toBe(SCENE_PACKS.length);
    expect(body.scenes.map((s) => s.id)).toEqual(SCENE_PACKS.map((s) => s.id));
    for (const [i, summary] of body.scenes.entries()) {
      const def = SCENE_PACKS[i]!;
      expect(summary.title).toBe(def.title);
      expect(summary.description).toBe(def.description);
      expect(summary.intro).toBe(def.intro);
      expect(summary.stepCount).toBe(def.steps.length);
      expect(summary.stepLabels).toEqual(def.steps.map((s) => s.label));
      expect(summary.resolvedStepCount).toBeLessThanOrEqual(summary.stepCount);
    }
  });

  it("每个场景包都写了真实可用的说明与开场白（防新包漏字段）", () => {
    for (const pack of SCENE_PACKS) {
      expect(pack.description.trim().length, pack.id).toBeGreaterThanOrEqual(20);
      expect(pack.intro.trim().length, pack.id).toBeGreaterThan(0);
      expect(scenePackById(pack.id)?.id).toBe(pack.id);
    }
  });

  it("make-ppt 摘要的站点数来自真实召回（种子数据应命中）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/scenes" });
    const body = res.json() as { scenes: SceneSummary[] };
    const ppt = body.scenes.find((s) => s.id === "make-ppt")!;
    expect(ppt.siteCount).toBeGreaterThanOrEqual(2);
    expect(ppt.resolvedStepCount).toBeGreaterThanOrEqual(2);
  });
});

describe("GET /api/scenes/:id", () => {
  it("详情只含站内真实站点且跨步骤不重复", async () => {
    const res = await app.inject({ method: "GET", url: "/api/scenes/make-ppt" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; scene: SceneDetail };
    expect(body.scene.id).toBe("make-ppt");
    expect(body.scene.steps.length).toBeGreaterThanOrEqual(2);
    const seen = new Set<string>();
    for (const step of body.scene.steps) {
      expect(step.sites.length).toBeGreaterThan(0);
      expect(step.sites.length).toBeLessThanOrEqual(4);
      for (const site of step.sites) {
        expect(seededIds.has(site.siteId)).toBe(true);
        expect(site.url).not.toContain("undefined");
        expect(seen.has(site.siteId)).toBe(false);
        seen.add(site.siteId);
      }
    }
    expect(body.scene.siteCount).toBe(seen.size);
  });

  it("与 POST /api/ai/find 场景展开同口径（同一步站点集合一致）", async () => {
    const def = scenePackById("make-ppt")!;
    const get = await app.inject({ method: "GET", url: "/api/scenes/make-ppt" });
    const detail = (get.json() as { scene: SceneDetail }).scene;
    const post = await app.inject({
      method: "POST",
      url: "/api/ai/find",
      payload: { query: def.intro, sceneId: "make-ppt" },
    });
    expect(post.statusCode).toBe(200);
    const postBody = post.json() as { steps: Array<{ label: string; sites: Array<{ siteId: string }> }> };
    const byLabel = (steps: Array<{ label: string; sites: Array<{ siteId: string }> }>) =>
      new Map(steps.map((s) => [s.label, s.sites.map((x) => x.siteId).sort()]));
    expect(byLabel(postBody.steps)).toEqual(byLabel(detail.steps));
  });

  it("未知场景如实 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/scenes/no-such-scene" });
    expect(res.statusCode).toBe(404);
  });
});
