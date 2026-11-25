/**
 * 做短剧场景（make-drama）的 P0 重构测试：
 *  1. 步骤定义守卫：每步 purpose 非空、categories 1–2 个、pins 最多 2 个；
 *  2. 分类型门控：每步只出门控内子分类的站点，看剧/合作平台不再串步；
 *  3. 多查询轮流取位：第四步「配音 + AI 音乐」两路都有席位；
 *  4. 门控召回为空时整步回落关键词召回并标 fallback（相关推荐）；
 *  5. 锚点置顶且只认门控内真实在用站点；
 *  6. reason = 本步用途 + 简介：简介文字在 reason 里只出现一次；
 *  7. 与 POST /api/ai/find 场景展开同口径。
 *
 * 用合成种子 + 真实分类 id（reg-ai-drama-creation 等）测机制与真实定义，
 * 不依赖 navigation.json 全量数据（全量召回由本机 API 实测另行核对）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { SCENE_PACKS, scenePackById, type ScenePack } from "../src/ai-finder.ts";
import { resolveSceneDetail } from "../src/scene-resolve.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const DRAMA = "reg-ai-drama-creation";
const IMAGE = "reg-ai-image-generation";
const VIDEO = "reg-ai-video-generation";
const AUDIO = "reg-ai-audio-voice";
const WATCH_FREE = "reg-short-drama-free";
const WATCH_PLATFORM = "reg-short-drama-platform";
const DISTRIBUTE = "reg-short-drama-distribute";
const EMPTY = "reg-empty-cat";

const ids = new Map<string, string>();

async function seedSite(title: string, description: string, categoryId: string, url: string) {
  const site = await ctx.repo.createSite({ url, title, description, tags: [], categoryId });
  ids.set(title, site.id);
  return site;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-make-drama-"));
  ctx = await createContext(loadConfig({ mode: "lite", sqlitePath: join(dir, "api.db"), corsOrigins: ["*"] }));
  app = await buildServer(ctx);
  await app.ready();

  for (const [id, title] of [
    [DRAMA, "AI 短剧与漫剧创作"],
    [IMAGE, "AI 图像生成"],
    [VIDEO, "AI 视频生成"],
    [AUDIO, "AI 音频语音"],
    [WATCH_FREE, "免费短剧"],
    [WATCH_PLATFORM, "平台短剧"],
    [DISTRIBUTE, "短剧分发与变现"],
    [EMPTY, "空分类"],
  ] as const) {
    await ctx.repo.createCategory({ id, title, slug: id });
  }

  // 剧本 AI（门控内）
  await seedSite("有戏AI", "AI 短剧剧本生成与漫剧创作平台：剧本拆解、角色设计、智能分镜", DRAMA, "https://youxi.example.com/");
  await seedSite("小云雀AI", "短剧 Agent：把长剧本自动拆分镜并生成短剧成片", DRAMA, "https://xiaoyunque.example.com/");
  await seedSite("Topview", "AI 视频创作 Agent：可从剧本生成短剧与短片", DRAMA, "https://topview.example.com/");
  await seedSite("SkyReels", "AI 短剧创作平台：剧本生成、智能分镜、视频合成一站式成剧", DRAMA, "https://skyreels.example.com/");
  // 看剧平台（门控外：词法上也命中「短剧」，但绝不能进创作步）
  await seedSite("红果短剧", "免费短剧平台，海量短剧看广告免费看全集", WATCH_FREE, "https://hongguo.example.com/");
  await seedSite("央视频", "官方新媒体短剧板块，短剧需在 App 内观看", WATCH_PLATFORM, "https://yangshipin.example.com/");
  await seedSite("优酷", "App 内短剧专区，短剧库更新快", WATCH_PLATFORM, "https://youku.example.com/");
  // B 端分发与变现后台（第六步门控内；标题/简介里不写「短剧」，避免反串进看剧场景）
  await seedSite("爱奇艺号", "爱奇艺创作者平台：内容上传发布，分账、流量扶持与商业变现，个人创作者可入驻", DISTRIBUTE, "https://creator.iqiyi.example.com/");
  await seedSite("优酷内容合作平台", "优酷内容合作平台：面向创作者的内容合作入口，分账、活动激励与横屏合作", DISTRIBUTE, "https://om.youku.example.com/");
  await seedSite("抖音创作者中心", "抖音创作者的一站式创作与服务平台：发布管理作品、数据分析、商单任务变现；走版权中心上架分账", DISTRIBUTE, "https://creator.douyin.example.com/");
  await seedSite("快手创作者服务平台", "快手创作者服务平台：上传视频、管理作品、数据统计与内容推广，支持内容发布与变现合作", DISTRIBUTE, "https://cp.kuaishou.example.com/");
  // 配音与配乐（同一子分类内两路）
  await seedSite("魔音工坊", "AI 配音平台，主打短视频与有声书配音，音色选择丰富", AUDIO, "https://moyin.example.com/");
  await seedSite("Murf AI", "AI 配音平台，为视频、播客与演示生成专业旁白", AUDIO, "https://murf.example.com/");
  await seedSite("Suno", "AI 音乐生成，输入歌词即可出歌", AUDIO, "https://suno.example.com/");
  await seedSite("Udio", "AI 音乐生成平台，输入文字描述即可生成完整歌曲", AUDIO, "https://udio.example.com/");
  // Descript 在音频分类里，但它是剪辑工具：第五步门控含音频分类就是为它留的
  await seedSite("Descript", "AI 音视频编辑器，改转录文字即可剪辑音视频，适合播客与视频创作者", AUDIO, "https://descript.example.com/");
  // 剪辑与视频生成（第三步与第五步同属一个子分类：种子须够多，
  // 否则第三步按词法先取走剪辑工具，第五步门控内无站可用——真实目录该分类有 12 站）
  await seedSite("剪映专业版", "AI 驱动的音视频创作平台，含配音与识别", VIDEO, "https://jianying.example.com/");
  await seedSite("OpusClip", "AI 视频剪辑工具，长视频一键剪成短视频", VIDEO, "https://opusclip.example.com/");
  await seedSite("可灵AI", "AI 视频生成，文生视频与图生视频", VIDEO, "https://kling.example.com/");
  await seedSite("Runway", "AI 视频生成与编辑平台", VIDEO, "https://runway.example.com/");
  await seedSite("Luma AI", "AI 视频生成工具，高画质视频生成", VIDEO, "https://luma.example.com/");
  await seedSite("Genmo", "AI 视频生成引擎，支持实时视频生成", VIDEO, "https://genmo.example.com/");
  await seedSite("Haiper", "快速生成短视频的 AI 平台，支持多种风格与分辨率", VIDEO, "https://haiper.example.com/");
  // 生图
  await seedSite("Leonardo AI", "AI 生图平台，游戏与创意资产专用", IMAGE, "https://leonardo.example.com/");
  await seedSite("Midjourney", "AI 绘画与图像生成工具", IMAGE, "https://midjourney.example.com/");
});

afterAll(async () => {
  if (app) await app.close();
  if (ctx) await ctx.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

interface SceneDetail {
  id: string;
  steps: Array<{
    label: string;
    fallback: boolean;
    sites: Array<{ siteId: string; title: string; description: string | null; categoryId: string; reason: string }>;
  }>;
}

async function getMakeDrama(): Promise<SceneDetail> {
  const res = await app.inject({ method: "GET", url: "/api/scenes/make-drama" });
  expect(res.statusCode).toBe(200);
  return (res.json() as { scene: SceneDetail }).scene;
}

describe("make-drama 步骤定义守卫", () => {
  it("每步都有 purpose、1–2 个门控子分类、pins 最多 2 个", () => {
    const pack = scenePackById("make-drama")!;
    expect(pack.steps.length).toBe(6);
    for (const step of pack.steps) {
      expect(step.purpose?.trim().length, step.label).toBeGreaterThan(0);
      expect(step.categories?.length, step.label).toBeGreaterThanOrEqual(1);
      expect(step.categories?.length, step.label).toBeLessThanOrEqual(2);
      expect(step.pins?.length ?? 0, step.label).toBeLessThanOrEqual(2);
    }
  });

  it("全部场景包的步骤定义同样守规（防后来人随手加第三个分类或第三个锚点）", () => {
    for (const pack of SCENE_PACKS) {
      for (const step of pack.steps) {
        expect(step.categories?.length ?? 0, `${pack.id}/${step.label}`).toBeLessThanOrEqual(2);
        expect(step.pins?.length ?? 0, `${pack.id}/${step.label}`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe("GET /api/scenes/make-drama 门控召回", () => {
  it("第一步只出剧本 AI：无看剧平台、无合作平台", async () => {
    const scene = await getMakeDrama();
    const step = scene.steps.find((s) => s.label.startsWith("第一步"))!;
    expect(step.fallback).toBe(false);
    expect(step.sites.length).toBeGreaterThan(0);
    for (const site of step.sites) {
      expect(site.categoryId).toBe(DRAMA);
    }
    const titles = step.sites.map((s) => s.title);
    expect(titles).not.toContain("红果短剧");
    expect(titles).not.toContain("央视频");
    expect(titles).not.toContain("爱奇艺号");
  });

  it("第六步只出 B 端分发与变现后台：无 C 端看剧页", async () => {
    const scene = await getMakeDrama();
    const step = scene.steps.find((s) => s.label.startsWith("第六步"))!;
    expect(step.fallback).toBe(false);
    expect(step.sites.length).toBeGreaterThan(0);
    for (const site of step.sites) {
      expect(site.categoryId).toBe(DISTRIBUTE);
    }
    const titles = step.sites.map((s) => s.title);
    expect(titles).not.toContain("红果短剧");
    expect(titles).not.toContain("央视频");
    expect(titles).not.toContain("优酷");
  });

  it("第四步配音与 AI 配乐两路都有席位", async () => {
    const scene = await getMakeDrama();
    const step = scene.steps.find((s) => s.label.startsWith("第四步"))!;
    expect(step.fallback).toBe(false);
    const titles = step.sites.map((s) => s.title);
    expect(titles.some((t) => ["魔音工坊", "Murf AI"].includes(t))).toBe(true);
    expect(titles.some((t) => ["Suno", "Udio"].includes(t))).toBe(true);
  });

  it("第五步剪辑成片含剪映专业版与 Descript，且不含看剧平台", async () => {
    const scene = await getMakeDrama();
    const step = scene.steps.find((s) => s.label.startsWith("第五步"))!;
    expect(step.fallback).toBe(false);
    expect(step.sites.length).toBe(4);
    const titles = step.sites.map((s) => s.title);
    expect(titles).toContain("剪映专业版");
    expect(titles).toContain("Descript");
    expect(titles).not.toContain("央视频");
  });

  it("reason 承载本步用途：简介文字在 reason 里只出现一次", async () => {
    const scene = await getMakeDrama();
    const pack = scenePackById("make-drama")!;
    for (const step of scene.steps) {
      const purpose = pack.steps.find((s) => s.label === step.label)?.purpose!;
      for (const site of step.sites) {
        expect(site.reason.startsWith(purpose)).toBe(true);
        const desc = (site.description ?? "").trim();
        if (desc) {
          const occurrences = site.reason.split(desc).length - 1;
          expect(occurrences).toBe(1);
        }
      }
    }
  });

  it("与 POST /api/ai/find 场景展开同口径（同一步站点集合一致）", async () => {
    const def = scenePackById("make-drama")!;
    const detail = await getMakeDrama();
    const post = await app.inject({
      method: "POST",
      url: "/api/ai/find",
      payload: { query: def.intro, sceneId: "make-drama" },
    });
    expect(post.statusCode).toBe(200);
    const postBody = post.json() as { steps: Array<{ label: string; sites: Array<{ siteId: string }> }> };
    const byLabel = (steps: Array<{ label: string; sites: Array<{ siteId: string }> }>) =>
      new Map(steps.map((s) => [s.label, s.sites.map((x) => x.siteId).sort()]));
    expect(byLabel(postBody.steps)).toEqual(byLabel(detail.steps));
  });
});

describe("门控为空回落与锚点", () => {
  it("门控召回为空时整步回落关键词召回并标 fallback", async () => {
    const pack: ScenePack = {
      id: "test-fallback",
      title: "测试回落",
      description: "测试用的场景包：门控分类是空的。",
      intro: "测试",
      steps: [
        {
          label: "第一步：测试",
          queries: ["短剧"],
          purpose: "测试用途",
          categories: [EMPTY],
        },
      ],
    };
    const { detail } = await resolveSceneDetail(ctx, pack);
    expect(detail.steps.length).toBe(1);
    expect(detail.steps[0]!.fallback).toBe(true);
    // 回落的是关键词召回：看剧平台可以出现，但须标为相关推荐
    expect(detail.steps[0]!.sites.length).toBeGreaterThan(0);
    expect(detail.steps[0]!.sites[0]!.reason.startsWith("测试用途")).toBe(true);
  });

  it("锚点置顶：词法排名靠后的工具被 pin 到第一位", async () => {
    const opus = ids.get("OpusClip")!;
    const pack: ScenePack = {
      id: "test-pin",
      title: "测试锚点",
      description: "测试用的场景包：锚点置顶。",
      intro: "测试",
      steps: [
        {
          label: "第一步：剪辑",
          queries: ["剪映", "视频剪辑"],
          purpose: "剪成片",
          categories: [VIDEO],
          pins: [opus],
        },
      ],
    };
    const { detail } = await resolveSceneDetail(ctx, pack);
    expect(detail.steps[0]!.fallback).toBe(false);
    expect(detail.steps[0]!.sites[0]!.siteId).toBe(opus);
  });

  it("锚点不在门控内时被忽略，不会把看剧平台钉进创作步", async () => {
    const honguo = ids.get("红果短剧")!;
    const pack: ScenePack = {
      id: "test-pin-gate",
      title: "测试锚点门控",
      description: "测试用的场景包：越界锚点应被忽略。",
      intro: "测试",
      steps: [
        {
          label: "第一步：剪辑",
          queries: ["剪映", "视频剪辑"],
          purpose: "剪成片",
          categories: [VIDEO],
          pins: [honguo],
        },
      ],
    };
    const { detail } = await resolveSceneDetail(ctx, pack);
    const titles = detail.steps[0]!.sites.map((s) => s.title);
    expect(titles).not.toContain("红果短剧");
  });
});
