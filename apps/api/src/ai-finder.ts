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
 *
 * queries 的选词纪律：只用能在当前站内目录里真实召回对口站点的词（已逐词实测），
 * 目录里没有对应站点的事情（如做简历、在线表格）宁可不立场景包，也不编造步骤。
 */
export const SCENE_PACKS: ScenePack[] = [
  {
    id: "make-ppt",
    title: "做 PPT",
    steps: [
      { label: "第一步：找模板与灵感", queries: ["PPT 模板", "在线设计"] },
      { label: "第二步：做稿件", queries: ["在线 PPT 制作", "PPT 制作"] },
      { label: "第三步：配图与图标", queries: ["免费图片素材", "图标"] },
    ],
  },
  {
    id: "edit-video",
    title: "剪视频",
    steps: [
      { label: "第一步：剪辑成片", queries: ["剪映", "视频剪辑"] },
      { label: "第二步：配音与字幕", queries: ["配音", "语音合成"] },
      { label: "第三步：找素材", queries: ["视频素材", "免费素材"] },
    ],
  },
  {
    id: "write-paper",
    title: "写论文",
    steps: [
      { label: "第一步：查文献", queries: ["文献检索", "学术论文"] },
      { label: "第二步：写作与排版", queries: ["写作助手", "AI 写作"] },
      { label: "第三步：查重与降重", queries: ["知网", "论文查重"] },
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
      { label: "第一步：查词与翻译", queries: ["翻译", "词典"] },
      { label: "第二步：AI 对话练口语", queries: ["AI 对话", "对话助手"] },
      { label: "第三步：上课系统学", queries: ["英语课程", "在线课程"] },
    ],
  },
  {
    id: "design-poster",
    title: "做图设计",
    steps: [
      { label: "第一步：找灵感", queries: ["设计灵感", "作品集"] },
      { label: "第二步：在线做设计", queries: ["在线设计", "海报设计"] },
      { label: "第三步：配素材与配色", queries: ["图片素材", "配色"] },
    ],
  },
  {
    id: "generate-video",
    title: "AI 生视频",
    steps: [
      { label: "第一步：文生视频", queries: ["文生视频", "AI 视频生成"] },
      { label: "第二步：图生视频", queries: ["图生视频"] },
      { label: "第三步：配音与配乐", queries: ["配音", "AI 音乐"] },
    ],
  },
  {
    id: "learn-coding",
    title: "学编程",
    steps: [
      { label: "第一步：入门教程", queries: ["编程教程", "编程学习"] },
      { label: "第二步：系统学课程", queries: ["在线课程"] },
      { label: "第三步：刷题练手", queries: ["算法刷题", "面试刷题"] },
    ],
  },
  {
    id: "job-interview",
    title: "求职面试",
    steps: [
      { label: "第一步：刷题备战", queries: ["面试刷题", "算法刷题"] },
      { label: "第二步：看面经与攻略", queries: ["面试经验", "求职"] },
      { label: "第三步：AI 模拟面试", queries: ["AI 对话", "对话助手"] },
    ],
  },
  {
    id: "travel-plan",
    title: "旅行规划",
    steps: [
      { label: "第一步：订票订行程", queries: ["火车票", "旅行"] },
      { label: "第二步：查地图路线", queries: ["地图", "路线规划"] },
      { label: "第三步：找攻略与美食", queries: ["旅游攻略", "美食点评"] },
    ],
  },
  {
    id: "mind-map",
    title: "思维导图",
    steps: [
      { label: "第一步：画思维导图", queries: ["思维导图"] },
      { label: "第二步：白板与流程图", queries: ["在线白板", "流程图"] },
      { label: "第三步：AI 整理成文", queries: ["AI 总结", "长文本"] },
    ],
  },
  {
    id: "write-code",
    title: "写代码",
    steps: [
      { label: "第一步：AI 帮你写", queries: ["AI 编程", "代码生成"] },
      { label: "第二步：查官方文档", queries: ["官方文档", "开发文档"] },
      { label: "第三步：托管与协作", queries: ["代码托管", "开源代码"] },
    ],
  },
  {
    id: "photo-retouch",
    title: "修图美化",
    steps: [
      { label: "第一步：抠图去背景", queries: ["抠图", "去背景"] },
      { label: "第二步：压缩与编辑", queries: ["图片压缩", "图片编辑"] },
      { label: "第三步：AI 修图生图", queries: ["AI 修图", "AI 生图"] },
    ],
  },
  {
    id: "meeting-notes",
    title: "会议纪要",
    steps: [
      { label: "第一步：录音转文字", queries: ["语音合成", "语音识别"] },
      { label: "第二步：AI 提炼要点", queries: ["AI 总结", "长文本"] },
      { label: "第三步：整理成导图", queries: ["思维导图"] },
    ],
  },
  {
    id: "make-music",
    title: "做音乐",
    steps: [
      { label: "第一步：AI 作曲写歌", queries: ["AI 音乐", "AI 作曲"] },
      { label: "第二步：配音与语音合成", queries: ["语音合成", "配音"] },
    ],
  },
  {
    id: "build-agent",
    title: "搭 AI 智能体",
    steps: [
      { label: "第一步：选搭建平台", queries: ["智能体", "智能体搭建"] },
      { label: "第二步：编排工作流", queries: ["工作流自动化"] },
      { label: "第三步：选模型与数据集", queries: ["模型社区", "开源模型"] },
    ],
  },
  {
    id: "translate-doc",
    title: "翻译润色",
    steps: [
      { label: "第一步：整段翻译", queries: ["翻译"] },
      { label: "第二步：AI 精翻润色", queries: ["长文本", "AI 对话"] },
      { label: "第三步：查背景资料", queries: ["百科", "电子书"] },
    ],
  },
  {
    id: "online-shopping",
    title: "网购购物",
    steps: [
      { label: "第一步：逛商城比价", queries: ["电商购物", "购物"] },
      { label: "第二步：批发拿货", queries: ["批发"] },
      { label: "第三步：查快递物流", queries: ["快递", "物流"] },
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
