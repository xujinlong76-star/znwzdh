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
  /**
   * 本步是否走了关键词回落：门控（categories）召回为空时，整步才回落关键词召回，
   * 调用方须明确标为「相关推荐」，不得冒充本步工具。
   */
  fallback: boolean;
}

export interface SceneResolution {
  groups: SceneStepGroup[];
  /** 任一步检索失败：调用方据此如实标注，不把部分结果冒充完整 */
  retrievalFailed: boolean;
}

/**
 * 把一个场景包展开成「步骤 → 真实站点」分组。顺序即建议使用顺序；
 * 空步骤不出现在结果里（与 ai/find 的既有行为一致）。
 *
 * 门控（step.categories，1–2 个子分类）：
 *  - 锚点（pins，每步最多 2 个）先占位：只留库里真实存在、在门控内、在用的站点；
 *  - 再按 queries 召回并过滤到门控内：同一步多个查询轮流取位，避免第一个
 *    查询占满 4 席（如「配音」挤掉「AI 音乐」）；
 *  - 门控召回为空（锚点也没命中）时才回落关键词召回（不过滤），整步标
 *    fallback，调用方须明确标为「相关推荐」；
 *  - 没有 categories 的步骤沿用旧行为（查询按顺序填满），其它场景包不受影响。
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
    let fallback = false;
    const allowed = step.categories && step.categories.length > 0 ? new Set(step.categories) : null;
    const take = (s: NavSite): boolean => {
      if (seen.has(s.id) || usedAcrossSteps.has(s.id) || sites.length >= SCENE_STEP_SITE_LIMIT) return false;
      seen.add(s.id);
      sites.push(s);
      return true;
    };
    // 1. 锚点先占位：只认库里真实存在、在门控内、在用的站点；取不到不拖垮本步。
    const pins = (step.pins ?? []).slice(0, 2);
    if (pins.length > 0) {
      try {
        const pinned = await ctx.repo.getSitesByIds(pins);
        for (const id of pins) {
          const s = pinned.get(id);
          if (!s || s.status !== "active") continue;
          if (allowed && !allowed.has(s.categoryId)) continue;
          take(s);
        }
      } catch {
        /* 锚点取不到不拖垮本步：走正常召回 */
      }
    }
    // 2. 按 queries 召回（与 ai/find 同一套检索参数）。
    const perQuery: NavSite[][] = [];
    for (const q of step.queries) {
      const r = await retrieveCopilotCandidates(ctx, retrievalQueryOf(q), { pinCategory: false, lexicalOnly: true });
      if (r.failed) retrievalFailed = true;
      perQuery.push(r.sites);
    }
    if (allowed) {
      // 门控召回：过滤到允许的子分类内，多查询轮流取位。
      const gated = perQuery.map((list) => list.filter((s) => allowed.has(s.categoryId)));
      const pointers = gated.map(() => 0);
      let progressed = true;
      while (sites.length < SCENE_STEP_SITE_LIMIT && progressed) {
        progressed = false;
        for (let qi = 0; qi < gated.length; qi++) {
          if (sites.length >= SCENE_STEP_SITE_LIMIT) break;
          const list = gated[qi]!;
          while (pointers[qi]! < list.length) {
            const s = list[pointers[qi]!++]!;
            if (take(s)) { progressed = true; break; }
          }
        }
      }
      // 3. 门控召回为空（锚点也没命中）时才回落关键词召回，整步标为相关推荐。
      if (sites.length === 0) {
        fallback = true;
        for (const list of perQuery) {
          for (const s of list) {
            if (!take(s)) continue;
            if (sites.length >= SCENE_STEP_SITE_LIMIT) break;
          }
          if (sites.length >= SCENE_STEP_SITE_LIMIT) break;
        }
      }
    } else {
      for (const list of perQuery) {
        for (const s of list) {
          if (!take(s)) continue;
          if (sites.length >= SCENE_STEP_SITE_LIMIT) break;
        }
        if (sites.length >= SCENE_STEP_SITE_LIMIT) break;
      }
    }
    if (sites.length > 0) {
      const kept = sites.slice(0, SCENE_STEP_SITE_LIMIT);
      for (const s of kept) usedAcrossSteps.add(s.id);
      groups.push({ label: step.label, sites: kept, fallback });
    }
  }
  return { groups, retrievalFailed };
}

export interface SceneStepView {
  label: string;
  /** 这一步的检索词（页面不展示，留作口径可审计：站点就是按它们召回的） */
  queries: string[];
  /** 本步是否走了关键词回落（门控召回为空）：页面须标为「相关推荐」，与本步工具区分 */
  fallback: boolean;
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

/**
 * 卡片理由：有 purpose 的步骤，reason = 本步用途 + 站点简介——
 * 卡片只渲染 reason（模板不再另渲 description），简介文字在整张卡片里只出现一次；
 * 没有 purpose 的步骤沿用本地兜底（简介 + 分类），同样只出现一次。
 */
function reasonOf(site: NavSite, purpose: string | undefined, categoryTitle: string | undefined): string {
  if (purpose) {
    const desc = (site.description ?? "").trim();
    return desc ? `${purpose}——${desc}` : purpose;
  }
  return localReasonOf(site, categoryTitle);
}

function toStepViews(scene: ScenePack, groups: SceneStepGroup[], categoryTitle: Map<string, string>): SceneStepView[] {
  const defByLabel = new Map(scene.steps.map((s) => [s.label, s]));
  return groups.map((g) => {
    const def = defByLabel.get(g.label);
    return {
      label: g.label,
      queries: def?.queries ?? [],
      fallback: g.fallback,
      sites: g.sites.map((s) => finderSiteOf(s, reasonOf(s, def?.purpose, categoryTitle.get(s.categoryId)))),
    };
  });
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
