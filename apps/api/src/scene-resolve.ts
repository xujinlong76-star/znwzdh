/**
 * 场景包的「服务端展开」单一实现：按步骤 queries 逐组走站内混合检索，
 * 跨步骤全局去重（同一站点只出现在它命中的第一个步骤），召回不到的
 * 步骤整步跳过而不是编造。
 *
 * 为什么单独成模块：POST /api/ai/find（交互找站）与 GET /api/scenes
 * （SEO 落地页取数）必须同口径——同一套检索参数（lexicalOnly 策展过滤、
 * pinCategory: false）、同一步内上限、同一种去重。此前只有 ai/find 一条
 * 链路，落地页若各写一份展开逻辑，两边迟早漂移（前端手抄 SCENES 清单
 * 就是同类教训）。这里是唯一实现，两条链路共用。
 */
import type { Site as NavSite } from "@navhub/core";
import type { AppContext } from "./context.ts";
import { retrieveCopilotCandidates, retrievalQueryOf } from "./routes/copilot.ts";
import {
  SCENE_PACKS,
  finderSiteOf,
  localReasonOf,
  type FinderSite,
  type ScenePack,
} from "./ai-finder.ts";

/** 每步最多下发几个站点（与 ai/find 的 PER_STEP_LIMIT 同值，抽为共用常量） */
export const SCENE_STEP_SITE_LIMIT = 4;

export interface SceneStepGroup {
  label: string;
  sites: NavSite[];
}

export interface SceneResolution {
  groups: SceneStepGroup[];
  /** 任一步检索失败：调用方据此如实标注，不把部分结果冒充完整 */
  retrievalFailed: boolean;
}

/**
 * 把一个场景包展开成「步骤 → 真实站点」分组。顺序即建议使用顺序；
 * 空步骤不出现在结果里（与 ai/find 的既有行为一致）。
 */
export async function resolveSceneGroups(ctx: AppContext, scene: ScenePack): Promise<SceneResolution> {
  const groups: SceneStepGroup[] = [];
  let retrievalFailed = false;
  // 跨步骤全局去重：同一个站点只出现在它命中的第一个步骤里。
  // 只在单步内去重会出现「同一站点在 3 个步骤里各来一次」。
  const usedAcrossSteps = new Set<string>();
  for (const step of scene.steps) {
    const seen = new Set<string>();
    const sites: NavSite[] = [];
    for (const q of step.queries) {
      const r = await retrieveCopilotCandidates(ctx, retrievalQueryOf(q), { pinCategory: false, lexicalOnly: true });
      if (r.failed) retrievalFailed = true;
      for (const s of r.sites) {
        if (!seen.has(s.id) && !usedAcrossSteps.has(s.id)) {
          seen.add(s.id);
          sites.push(s);
        }
      }
      if (sites.length >= SCENE_STEP_SITE_LIMIT) break;
    }
    if (sites.length > 0) {
      const kept = sites.slice(0, SCENE_STEP_SITE_LIMIT);
      for (const s of kept) usedAcrossSteps.add(s.id);
      groups.push({ label: step.label, sites: kept });
    }
  }
  return { groups, retrievalFailed };
}

export interface SceneStepView {
  label: string;
  /** 这一步的检索词（页面不展示，留作口径可审计：站点就是按它们召回的） */
  queries: string[];
  sites: FinderSite[];
}

export interface SceneDetailView {
  id: string;
  title: string;
  description: string;
  intro: string;
  steps: SceneStepView[];
  /** 全部步骤去重后的真实站点数（按本次召回算，不是写死数字） */
  siteCount: number;
  /** 本页站点的最近更新时间（毫秒戳），供 sitemap lastmod；无站点时为 null */
  updatedAt: number | null;
}

export interface SceneSummaryView {
  id: string;
  title: string;
  description: string;
  intro: string;
  /** 场景定义的步骤数（含本次未召回站点的步骤——那是流程本身的长度） */
  stepCount: number;
  /** 本次真实召回到的站点步数：口径与 stepCount 分开，页面文案不得混用 */
  resolvedStepCount: number;
  siteCount: number;
  /** 每步的标题（定义顺序），索引页做流程预览 */
  stepLabels: string[];
  updatedAt: number | null;
}

function toStepViews(scene: ScenePack, groups: SceneStepGroup[], categoryTitle: Map<string, string>): SceneStepView[] {
  const queriesByLabel = new Map(scene.steps.map((s) => [s.label, s.queries]));
  return groups.map((g) => ({
    label: g.label,
    queries: queriesByLabel.get(g.label) ?? [],
    sites: g.sites.map((s) => finderSiteOf(s, localReasonOf(s, categoryTitle.get(s.categoryId)))),
  }));
}

function maxUpdatedAt(groups: SceneStepGroup[]): number | null {
  let max: number | null = null;
  for (const g of groups) {
    for (const s of g.sites) {
      if (typeof s.updatedAt === "number" && (max === null || s.updatedAt > max)) max = s.updatedAt;
    }
  }
  return max;
}

async function categoryTitleMap(ctx: AppContext): Promise<Map<string, string>> {
  const categories = await ctx.repo.listCategories();
  return new Map(categories.map((c) => [c.id, c.title]));
}

/** 详情口径：一个场景包的完整展开（落地页用） */
export async function resolveSceneDetail(
  ctx: AppContext,
  scene: ScenePack,
): Promise<{ detail: SceneDetailView; retrievalFailed: boolean }> {
  const [categoryTitle, { groups, retrievalFailed }] = await Promise.all([
    categoryTitleMap(ctx),
    resolveSceneGroups(ctx, scene),
  ]);
  const steps = toStepViews(scene, groups, categoryTitle);
  return {
    detail: {
      id: scene.id,
      title: scene.title,
      description: scene.description,
      intro: scene.intro,
      steps,
      siteCount: steps.reduce((n, s) => n + s.sites.length, 0),
      updatedAt: maxUpdatedAt(groups),
    },
    retrievalFailed,
  };
}

/** 列表口径：全部场景包的摘要（索引页与首页场景区用），与详情同一展开逻辑 */
export async function resolveSceneSummaries(
  ctx: AppContext,
): Promise<{ scenes: SceneSummaryView[]; retrievalFailed: boolean }> {
  const scenes: SceneSummaryView[] = [];
  let retrievalFailed = false;
  for (const scene of SCENE_PACKS) {
    const { groups, retrievalFailed: failed } = await resolveSceneGroups(ctx, scene);
    if (failed) retrievalFailed = true;
    scenes.push({
      id: scene.id,
      title: scene.title,
      description: scene.description,
      intro: scene.intro,
      stepCount: scene.steps.length,
      resolvedStepCount: groups.length,
      siteCount: groups.reduce((n, g) => n + g.sites.length, 0),
      stepLabels: scene.steps.map((s) => s.label),
      updatedAt: maxUpdatedAt(groups),
    });
  }
  return { scenes, retrievalFailed };
}
