/**
 * AI 智能找站（结构化版）的纯逻辑层。
 *
 * 与对话式 Copilot 的分工：Copilot 回答「一段话」，这里回答「一组可点开的卡片」。
 * 两者共用同一份站内混合检索、同一套 LLM 配置/额度层；这里多一层硬约束——
 * 无论模型说什么，最终下发的每个站点都必须能映射回本次检索召回的候选，
 * 模型给的站外 id / 编造 URL 在这一层就被丢掉，绝不透传到前端。
 */
import type { Site } from "@navhub/core";
import { citationOfSite, type CopilotCitation } from "./copilot-grounding.ts";

export interface FinderSite {
  siteId: string;
  title: string;
  url: string;
  description: string | null;
  categoryId: string;
  /** 一句推荐理由：模型生成（已校验归属）或本地兜底（分类+简介拼装） */
  reason: string;
}

export interface FinderStep {
  /** 步骤名，如「第一步：做稿件」；非场景模式为空数组不下发 */
  label: string;
  sites: FinderSite[];
}

export interface ScenePack {
  id: string;
  title: string;
  /** 每个步骤给一组检索词：按词召回站内目录，召回不到的步骤会被跳过而不是编造 */
  steps: Array<{ label: string; queries: string[] }>;
}

/**
 * AI 场景包：访客最常见的几件「要用一串网站才能办完」的事。
 * 步骤顺序就是建议使用顺序；每步的站点只来自站内目录对 queries 的真实召回。
 */
export const SCENE_PACKS: ScenePack[] = [
  {
    id: "make-ppt",
    title: "做 PPT",
    steps: [
      { label: "第一步：找模板与灵感", queries: ["PPT 模板", "演示模板"] },
      { label: "第二步：做稿件", queries: ["在线 PPT 制作", "幻灯片"] },
      { label: "第三步：配图与图标", queries: ["免费图片素材", "图标"] },
    ],
  },
  {
    id: "edit-video",
    title: "剪视频",
    steps: [
      { label: "第一步：剪辑成片", queries: ["视频剪辑", "在线剪辑"] },
      { label: "第二步：配音与字幕", queries: ["配音", "字幕"] },
      { label: "第三步：找素材", queries: ["视频素材", "免费素材"] },
    ],
  },
  {
    id: "write-paper",
    title: "写论文",
    steps: [
      { label: "第一步：查文献", queries: ["学术论文", "文献检索"] },
      { label: "第二步：写作与排版", queries: ["在线文档", "写作"] },
      { label: "第三步：查重与降重", queries: ["论文查重", "查重"] },
    ],
  },
  {
    id: "watch-drama",
    title: "追短剧",
    steps: [
      { label: "第一步：找短剧平台", queries: ["短剧"] },
      { label: "第二步：看长剧与电影", queries: ["影视", "在线视频"] },
    ],
  },
  {
    id: "learn-english",
    title: "学英语",
    steps: [
      { label: "第一步：背单词", queries: ["英语单词", "背单词"] },
      { label: "第二步：练听力口语", queries: ["英语听力", "口语"] },
      { label: "第三步：查词典翻译", queries: ["翻译", "词典"] },
    ],
  },
];

export function scenePackById(id: string | undefined | null): ScenePack | null {
  if (!id) return null;
  return SCENE_PACKS.find((s) => s.id === id) ?? null;
}

export function finderSiteOf(site: Site, reason: string): FinderSite {
  const c = citationOfSite(site);
  return { ...c, categoryId: site.categoryId, reason };
}

/** 本地兜底理由：不走模型时也不能只甩链接，要说清「这是什么、归哪类」 */
export function localReasonOf(site: Site, categoryTitle?: string): string {
  const desc = (site.description ?? "").trim();
  const cat = categoryTitle ? `属于「${categoryTitle}」分类` : "";
  if (desc && cat) return `${desc}（${cat}）`;
  if (desc) return desc;
  if (cat) return cat;
  return "站内收录站点，可直接打开使用";
}

export interface ModelPick {
  siteId: string;
  reason?: string;
}

/**
 * 校验模型给出的挑站结果：只保留 candidate 集内的 siteId，按模型顺序去重，
 * 理由截断到一句。模型编造的 id 在这里静默丢弃——调用方用 dropped 数记观测。
 */
export function validateModelPicks(
  raw: unknown,
  candidates: readonly CopilotCitation[],
  maxReasonChars = 60,
): { picks: ModelPick[]; dropped: number } {
  const allowed = new Set(candidates.map((c) => c.siteId));
  const seen = new Set<string>();
  const picks: ModelPick[] = [];
  let dropped = 0;
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { picks?: unknown }).picks)
      ? ((raw as { picks: unknown[] }).picks as unknown[])
      : [];
  for (const item of list) {
    if (!item || typeof item !== "object") { dropped += 1; continue; }
    const siteId = (item as { siteId?: unknown }).siteId;
    if (typeof siteId !== "string" || !allowed.has(siteId) || seen.has(siteId)) {
      dropped += 1;
      continue;
    }
    seen.add(siteId);
    const reasonRaw = (item as { reason?: unknown }).reason;
    const reason = typeof reasonRaw === "string" ? reasonRaw.replace(/\s+/g, " ").trim().slice(0, maxReasonChars) : "";
    picks.push({ siteId, ...(reason ? { reason } : {}) });
  }
  return { picks, dropped };
}

/**
 * 无结果/降级时的分类入口建议：优先标题与需求有字面交集的分类，
 * 没有交集时给站点最多的几个一级分类——目标是让访客下一步有地方点，
 * 而不是对着一句「暂未收录」离开。
 */
export function suggestCategories<T extends { id: string; title: string; parentId?: string | null; slug?: string | null }>(
  categories: readonly T[],
  query: string,
  counts?: ReadonlyMap<string, number>,
  limit = 3,
): Array<{ id: string; title: string; slug: string | null }> {
  const q = query.trim();
  const matched = q
    ? categories.filter((c) => c.title.includes(q) || (q.length >= 2 && q.includes(c.title)))
    : [];
  const pool = matched.length > 0
    ? matched
    : [...categories]
        .filter((c) => !c.parentId)
        .sort((a, b) => (counts?.get(b.id) ?? 0) - (counts?.get(a.id) ?? 0));
  return pool.slice(0, limit).map((c) => ({ id: c.id, title: c.title, slug: c.slug ?? null }));
}
