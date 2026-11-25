/**
 * 做短剧场景（make-drama）的 P0 重构测试：
 *  1. 步骤定义守卫：每步 purpose 非空、categories 1–2 个、pins 最多 2 个；
 *  2. 分类型门控：每步只出门控内子分类的站点，看剧/合作平台不再串步；
 *  3. 多查询轮流取位：第四步「配音 + AI 音乐」两路都有席位；
 *  4. 门控召回为空时整步回落关键词召回并标 fallback（相关推荐）；
 *  5. 锚点置顶且只认门控内真实在用站点；
 *  6. reason = 本步用途 + 简介：简介文字在 reason 里只出现一次；
 *  7. 与 POST /api/ai/find 场景展开同口径；
 *  8. 分发子分类 scrub：标题/简介/站文案里不得出现「短剧」「投稿」，reason 也不得带出；
 *  9. 全场景多轮 dump：4 个分发站只出现在 make-drama 第六步（并集/交集双判定，
 *     单次 dump 曾互不一致，不足以支撑「零泄漏」强主张）；
 * 10. POST /api/ai/find 的 steps 透传 fallback（与 GET 同值），回落步可标「相关推荐」。
 *
 * 用合成种子 + 真实分类 id（reg-ai-drama-creation 等）测机制与真实定义，
 * 不依赖 navigation.json 全量数据（全量召回由本机 API 实测另行核对）。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
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
    [DISTRIBUTE, "创作者分发与变现"],
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
  // 设计灵感（design-poster 第一步的对口站：没有它们时「作品集」只命中
  // 分发站简介里的「管理作品」三元组，全量库里设计站会排在前面；种子须
  // 复现全量库的竞争格局，否则多轮 dump 的零泄漏断言测的是种子贫瘠而非机制）
  await ctx.repo.createCategory({ id: "reg-design-inspiration", title: "设计灵感", slug: "reg-design-inspiration" });
  await seedSite("站酷", "设计师作品集与灵感社区：平面、UI、插画设计灵感，发布作品集", "reg-design-inspiration", "https://zcool.example.com/");
  await seedSite("Behance", "全球设计师作品集平台：平面、摄影与插画设计灵感展示", "reg-design-inspiration", "https://behance.example.com/");
  await seedSite("Dribbble", "设计师作品集与灵感社区：UI 与品牌设计灵感", "reg-design-inspiration", "https://dribbble.example.com/");
  await seedSite("花瓣网", "设计灵感采集站：图片、插画与平面设计灵感，建画板收作品集", "reg-design-inspiration", "https://huaban.example.com/");
  // 小说平台（write-novel 的对口站：没有它们时「小说平台」只凭
  // 「平台」三元组命中分发站；同上，种子须复现有「投稿/小说」字面的对口站。
  // 两套各 4 站必须分开：第一步（小说/网文）先取走阅读站，第二步（投稿/
  // 小说平台）才有投稿站可取——同一批 4 站会被跨步去重耗尽，第二步仍漏）
  await ctx.repo.createCategory({ id: "reg-novel-platform", title: "小说平台", slug: "reg-novel-platform" });
  await seedSite("番茄小说", "免费小说阅读平台：海量小说免费看", "reg-novel-platform", "https://fanqie.example.com/");
  await seedSite("晋江文学城", "原创网络小说阅读：言情、玄幻、都市题材连载", "reg-novel-platform", "https://jjwxc.example.com/");
  await seedSite("七猫免费小说", "免费小说阅读：玄幻、言情小说在线看", "reg-novel-platform", "https://qimao.example.com/");
  await seedSite("飞卢小说网", "网络小说阅读：同人、玄幻小说连载与榜单", "reg-novel-platform", "https://feilu.example.com/");
  await seedSite("起点中文网", "网络小说投稿平台：作者投稿签约，玄幻、仙侠小说连载", "reg-novel-platform", "https://qidian.example.com/");
  await seedSite("17K小说网", "小说作者投稿签约平台：玄幻、都市小说投稿入口", "reg-novel-platform", "https://17k.example.com/");
  await seedSite("纵横中文网", "网络小说投稿签约平台：玄幻、都市题材，作者投稿通道", "reg-novel-platform", "https://zongheng.example.com/");
  await seedSite("塔读小说", "小说投稿平台：免费小说阅读，作者投稿签约", "reg-novel-platform", "https://tadu.example.com/");
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
    const postBody = post.json() as { steps: Array<{ label: string; fallback: boolean; sites: Array<{ siteId: string }> }> };
    const byLabel = (steps: Array<{ label: string; sites: Array<{ siteId: string }> }>) =>
      new Map(steps.map((s) => [s.label, s.sites.map((x) => x.siteId).sort()]));
    expect(byLabel(postBody.steps)).toEqual(byLabel(detail.steps));
  });

  it("POST /api/ai/find 的 steps 透传 fallback（与 GET 同值，均为 false）", async () => {
    const def = scenePackById("make-drama")!;
    const detail = await getMakeDrama();
    const post = await app.inject({
      method: "POST",
      url: "/api/ai/find",
      payload: { query: def.intro, sceneId: "make-drama" },
    });
    expect(post.statusCode).toBe(200);
    const postBody = post.json() as { steps: Array<{ label: string; fallback: unknown }> };
    expect(postBody.steps.length).toBe(detail.steps.length);
    for (const postStep of postBody.steps) {
      expect(typeof postStep.fallback, postStep.label).toBe("boolean");
      const getStep = detail.steps.find((s) => s.label === postStep.label)!;
      expect(postStep.fallback, postStep.label).toBe(getStep.fallback);
    }
    // 种子库里 make-drama 六步门控均命中，无回落：全 false（回落为 true 的
    // 情形由「门控为空回落」一组在 GET 侧覆盖，POST 与 GET 共用同一展开）。
    expect(postBody.steps.every((s) => s.fallback === false)).toBe(true);
  });
});

describe("分发子分类 scrub 与多轮全场景 dump 零泄漏", () => {
  const DISTRIBUTE_TITLES = ["爱奇艺号", "优酷内容合作平台", "抖音创作者中心", "快手创作者服务平台"];
  const FORBIDDEN = ["短剧", "投稿"];

  it("navigation.json 实测：分发子分类标题/简介与 4 站文案里不含「短剧」「投稿」", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const navPath = join(dirname(fileURLToPath(import.meta.url)), "../../web-overlay/src/navsphere/content/navigation.json");
    const nav = JSON.parse(readFileSync(navPath, "utf-8")) as {
      navigationItems: Array<{
        subCategories?: Array<{
          id: string;
          title: string;
          description?: string | null;
          items?: Array<{ title: string; description?: string | null; tags?: string[] }>;
        }>;
      }>;
    };
    const sub = nav.navigationItems.flatMap((c) => c.subCategories ?? []).find((s) => s.id === DISTRIBUTE);
    expect(sub, "navigation.json 须有 reg-short-drama-distribute 子分类").toBeDefined();
    for (const word of FORBIDDEN) {
      expect(sub!.title).not.toContain(word);
      expect(sub!.description ?? "").not.toContain(word);
    }
    expect(sub!.items?.length).toBe(4);
    for (const item of sub!.items ?? []) {
      for (const word of FORBIDDEN) {
        expect(item.title).not.toContain(word);
        expect(item.description ?? "").not.toContain(word);
        for (const tag of item.tags ?? []) expect(tag).not.toContain(word);
      }
    }
    expect(sub!.items?.map((i) => i.title).sort()).toEqual([...DISTRIBUTE_TITLES].sort());
  });

  it("种子库：分发子分类标题与第六步 reason 里不含「短剧」「投稿」", async () => {
    const cats = await ctx.repo.listCategories();
    const cat = cats.find((c) => c.id === DISTRIBUTE)!;
    expect(cat).toBeDefined();
    for (const word of FORBIDDEN) expect(cat.title).not.toContain(word);
    const scene = await getMakeDrama();
    const step6 = scene.steps.find((s) => s.label.startsWith("第六步"))!;
    for (const site of step6.sites) {
      for (const word of FORBIDDEN) {
        expect(site.title).not.toContain(word);
        expect(site.description ?? "").not.toContain(word);
        expect(site.reason).not.toContain(word);
      }
    }
  });

  it("三轮全场景 dump：4 个分发站只出现在 make-drama 第六步（并集/交集双判定）", async () => {
    async function dumpAll(): Promise<Map<string, Map<string, string[]>>> {
      const out = new Map<string, Map<string, string[]>>();
      for (const pack of SCENE_PACKS) {
        const { detail } = await resolveSceneDetail(ctx, pack);
        out.set(pack.id, new Map(detail.steps.map((s) => [s.label, s.sites.map((x) => x.title)])));
      }
      return out;
    }
    function locationsOf(dump: Map<string, Map<string, string[]>>): Set<string> {
      const locs = new Set<string>();
      for (const [sceneId, steps] of dump) {
        for (const [label, titles] of steps) {
          if (titles.some((t) => DISTRIBUTE_TITLES.includes(t))) locs.add(`${sceneId} / ${label}`);
        }
      }
      return locs;
    }
    const runs = [await dumpAll(), await dumpAll(), await dumpAll()];
    const unions = new Set<string>();
    let intersection: Set<string> | null = null;
    for (const run of runs) {
      const locs = locationsOf(run);
      for (const l of locs) unions.add(l);
      intersection = intersection === null ? new Set(locs) : new Set([...intersection].filter((l) => locs.has(l)));
    }
    // 并集：三轮里任何一轮出现过的位置都只许是 make-drama 第六步；
    // 交集：三轮每一轮都出现的位置同样只许是它（双判定防单次 dump 偶然干净）。
    expect([...unions].sort()).toEqual(["make-drama / 第六步：发布与变现"]);
    expect([...(intersection ?? new Set<string>())].sort()).toEqual(["make-drama / 第六步：发布与变现"]);
    // 且第六步每轮都含全部 4 站（不是“恰好有一站漏网才显得干净”）。
    for (const run of runs) {
      const step6 = run.get("make-drama")!.get("第六步：发布与变现")!;
      expect([...step6].sort()).toEqual([...DISTRIBUTE_TITLES].sort());
    }
  }, 600_000);
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
