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
  /**
   * 场景说明（落地页 /scenes/{id} 与索引页用）：只讲这个场景帮人办什么事、
   * 按什么顺序，不许编造站点数量、效果或排名承诺——页面上的计数全部由
   * 接口按真实召回另行合成，这里只放编辑文案。
   */
  description: string;
  /**
   * 用户点开这个场景时发给 AI 找站的那句话。原先在前端 ai-finder-panel
   * 手抄第二份清单，现收回服务端做单一事实源，前端改调 GET /api/scenes。
   */
  intro: string;
  /** 每个步骤给一组检索词：按词召回站内目录，召回不到的步骤会被跳过而不是编造 */
  steps: Array<{ label: string; queries: string[] }>;
}

/**
 * AI 场景包：访客最常见的几件「要用一串网站才能办完」的事。
 * 步骤顺序就是建议使用顺序；每步的站点只来自站内目录对 queries 的真实召回。
 *
 * queries 的选词纪律：只用能在当前站内目录里真实召回对口站点的词（已逐词实测），
 * 目录里没有对应站点的事情宁可不立场景包，也不编造步骤。
 * （做简历、在线表格、写小说、考公考研等包，是在目录补齐简历/文档/小说/考试类站点后才立的。）
 */
export const SCENE_PACKS: ScenePack[] = [
  {
    id: "make-ppt",
    title: "做 PPT",
    description: "做一份 PPT 要连着用好几个网站：先找模板和灵感，再在线做稿件，最后配上图片与图标素材。这个场景按先后顺序，把每一步能直接打开的网站都备好了。",
    intro: "我要做一份 PPT",
    steps: [
      { label: "第一步：找模板与灵感", queries: ["PPT 模板", "在线设计"] },
      { label: "第二步：做稿件", queries: ["在线 PPT 制作", "PPT 制作"] },
      { label: "第三步：配图与图标", queries: ["免费图片素材", "图标"] },
    ],
  },
  {
    id: "edit-video",
    title: "剪视频",
    description: "剪一条视频的完整流程：先用剪辑工具成片，再配音、加字幕，最后补齐视频与图片素材。按这个顺序打开下面的网站，一条片子就能从素材做到成片。",
    intro: "我要剪一个视频",
    steps: [
      { label: "第一步：剪辑成片", queries: ["剪映", "视频剪辑"] },
      { label: "第二步：配音与字幕", queries: ["配音", "语音合成"] },
      { label: "第三步：找素材", queries: ["视频素材", "免费素材"] },
    ],
  },
  {
    id: "write-paper",
    title: "写论文",
    description: "写论文的三个关键环节：查文献找资料、用写作工具成文与排版、最后查重与降重。每个环节都给出了能直接打开的学术与写作网站，按顺序用即可。",
    intro: "我要写论文查文献",
    steps: [
      { label: "第一步：查文献", queries: ["文献检索", "学术论文"] },
      { label: "第二步：写作与排版", queries: ["写作助手", "AI 写作"] },
      { label: "第三步：查重与降重", queries: ["知网", "论文查重"] },
    ],
  },
  {
    id: "watch-drama",
    title: "追短剧",
    description: "想看短剧先找对平台。这个场景先给短剧平台，再补长剧与电影的在线视频站，照着顺序打开就能看；平台的收费情况以打开后的页面为准。",
    intro: "我想看短剧",
    steps: [
      { label: "第一步：找短剧平台", queries: ["短剧"] },
      { label: "第二步：看长剧与电影", queries: ["影视", "在线视频"] },
    ],
  },
  {
    id: "make-drama",
    title: "做短剧",
    description: "自己做一部短剧的全流程：写剧本大纲、做分镜与角色图、AI 生成视频、配音配乐、剪辑成片，再到发布与变现。每一步都配了能直接上手的网站。",
    intro: "我想自己做一部短剧",
    steps: [
      { label: "第一步：写剧本与大纲", queries: ["短剧剧本", "剧本"] },
      { label: "第二步：分镜与角色生图", queries: ["分镜", "AI 生图"] },
      { label: "第三步：AI 生成视频", queries: ["AI 视频生成", "图生视频"] },
      { label: "第四步：配音与配乐", queries: ["配音", "AI 音乐"] },
      { label: "第五步：剪辑成片", queries: ["剪映", "视频剪辑"] },
      { label: "第六步：发布与变现", queries: ["短剧", "创作者平台"] },
    ],
  },
  {
    id: "make-manga-drama",
    title: "做 AI 漫剧",
    description: "做 AI 漫剧的四步：先找小说 IP 与题材，再用生成工具出片，配音剪辑成片后发布到短剧平台。适合想低成本试水漫剧的创作者。",
    intro: "我想做 AI 漫剧",
    steps: [
      { label: "第一步：找小说 IP 与题材", queries: ["小说", "免费小说"] },
      { label: "第二步：一键生成漫剧", queries: ["漫剧", "AI 短剧"] },
      { label: "第三步：配音与剪辑成片", queries: ["配音", "视频剪辑"] },
      { label: "第四步：发布到短剧平台", queries: ["短剧", "漫剧平台"] },
    ],
  },
  {
    id: "learn-english",
    title: "学英语",
    description: "学英语按查词翻译、AI 对话练口语、系统课程三步走：先解决看不懂，再开口练，最后系统补语法与词汇。下面的网站按顺序打开就能开始。",
    intro: "我要学英语",
    steps: [
      { label: "第一步：查词与翻译", queries: ["翻译", "词典"] },
      { label: "第二步：AI 对话练口语", queries: ["AI 对话", "对话助手"] },
      { label: "第三步：上课系统学", queries: ["英语课程", "在线课程"] },
    ],
  },
  {
    id: "design-poster",
    title: "做图设计",
    description: "做一张海报或设计图：先找灵感参考，再用在线设计工具动手做，最后补图片素材与配色。每一步的网站都可直接打开使用。",
    intro: "我要做一张海报图",
    steps: [
      { label: "第一步：找灵感", queries: ["设计灵感", "作品集"] },
      { label: "第二步：在线做设计", queries: ["在线设计", "海报设计"] },
      { label: "第三步：配素材与配色", queries: ["图片素材", "配色"] },
    ],
  },
  {
    id: "generate-video",
    title: "AI 生视频",
    description: "用 AI 生成视频的完整链路：文字生成视频、图片生成视频，再配上配音与音乐。适合做短视频、漫剧与广告素材的创作者。",
    intro: "我想用 AI 生成视频",
    steps: [
      { label: "第一步：文生视频", queries: ["文生视频", "AI 视频生成"] },
      { label: "第二步：图生视频", queries: ["图生视频"] },
      { label: "第三步：配音与配乐", queries: ["配音", "AI 音乐"] },
    ],
  },
  {
    id: "learn-coding",
    title: "学编程",
    description: "学编程的入门路径：先看教程打基础，再跟系统课程学，最后刷题练手准备面试。下面的网站按学习顺序排列，零基础也能跟上。",
    intro: "我想学编程",
    steps: [
      { label: "第一步：入门教程", queries: ["编程教程", "编程学习"] },
      { label: "第二步：系统学课程", queries: ["在线课程"] },
      { label: "第三步：刷题练手", queries: ["算法刷题", "面试刷题"] },
    ],
  },
  {
    id: "job-interview",
    title: "求职面试",
    description: "求职面试的备战顺序：先刷题练手，再看面经与求职攻略，最后用 AI 模拟面试练表达。每一步都有能直接打开的网站。",
    intro: "我在准备求职面试",
    steps: [
      { label: "第一步：刷题备战", queries: ["面试刷题", "算法刷题"] },
      { label: "第二步：看面经与攻略", queries: ["面试经验", "求职"] },
      { label: "第三步：AI 模拟面试", queries: ["AI 对话", "对话助手"] },
    ],
  },
  {
    id: "travel-plan",
    title: "旅行规划",
    description: "做旅行规划的三件事：订票订行程、查地图路线、找攻略与美食点评。按顺序打开下面的网站，一趟行程就能安排明白。",
    intro: "我要出去旅行做攻略",
    steps: [
      { label: "第一步：订票订行程", queries: ["火车票", "旅行"] },
      { label: "第二步：查地图路线", queries: ["地图", "路线规划"] },
      { label: "第三步：找攻略与美食", queries: ["旅游攻略", "美食点评"] },
    ],
  },
  {
    id: "mind-map",
    title: "思维导图",
    description: "画思维导图的完整用法：先用导图工具理清结构，再用白板与流程图补细节，最后让 AI 帮你整理成文。适合做笔记、备课与头脑风暴。",
    intro: "我要画一张思维导图",
    steps: [
      { label: "第一步：画思维导图", queries: ["思维导图"] },
      { label: "第二步：白板与流程图", queries: ["在线白板", "流程图"] },
      { label: "第三步：AI 整理成文", queries: ["AI 总结", "长文本"] },
    ],
  },
  {
    id: "write-code",
    title: "写代码",
    description: "写代码提效的三步：让 AI 帮你生成与补全代码、查官方文档确认用法、用代码托管平台协作交付。下面的网站都是开发者日常在用的工具。",
    intro: "我要写代码做开发",
    steps: [
      { label: "第一步：AI 帮你写", queries: ["AI 编程", "代码生成"] },
      { label: "第二步：查官方文档", queries: ["官方文档", "开发文档"] },
      { label: "第三步：托管与协作", queries: ["代码托管", "开源代码"] },
    ],
  },
  {
    id: "photo-retouch",
    title: "修图美化",
    description: "修图美化的常用流程：先抠图去背景，再压缩与编辑图片，最后用 AI 修图与生图补效果。每一步都有能直接打开的在线工具。",
    intro: "我想修一张照片",
    steps: [
      { label: "第一步：抠图去背景", queries: ["抠图", "去背景"] },
      { label: "第二步：压缩与编辑", queries: ["图片压缩", "图片编辑"] },
      { label: "第三步：AI 修图生图", queries: ["AI 修图", "AI 生图"] },
    ],
  },
  {
    id: "meeting-notes",
    title: "会议纪要",
    description: "把会议录音变成纪要：先转成文字，再让 AI 提炼要点，最后整理成思维导图方便分发。开会多的人按这个顺序用最省时间。",
    intro: "我要整理会议纪要",
    steps: [
      { label: "第一步：录音转文字", queries: ["语音合成", "语音识别"] },
      { label: "第二步：AI 提炼要点", queries: ["AI 总结", "长文本"] },
      { label: "第三步：整理成导图", queries: ["思维导图"] },
    ],
  },
  {
    id: "make-music",
    title: "做音乐",
    description: "用 AI 做一首歌：先作曲写歌，再配上合成语音与配音。人人都能试的音乐创作流程，下面的网站打开就能开始。",
    intro: "我想做一首歌",
    steps: [
      { label: "第一步：AI 作曲写歌", queries: ["AI 音乐", "AI 作曲"] },
      { label: "第二步：配音与语音合成", queries: ["语音合成", "配音"] },
    ],
  },
  {
    id: "build-agent",
    title: "搭 AI 智能体",
    description: "搭一个 AI 智能体的三步：选搭建平台、编排自动化工作流、挑模型与数据集。适合想把重复工作交给 AI 的人。",
    intro: "我想搭一个 AI 智能体",
    steps: [
      { label: "第一步：选搭建平台", queries: ["智能体", "智能体搭建"] },
      { label: "第二步：编排工作流", queries: ["工作流自动化"] },
      { label: "第三步：选模型与数据集", queries: ["模型社区", "开源模型"] },
    ],
  },
  {
    id: "translate-doc",
    title: "翻译润色",
    description: "翻译一篇外文的三步：先整段翻译，再用 AI 精翻润色，最后查百科与电子书核对背景资料。学生和职场人都可直接套用。",
    intro: "我要翻译一篇外文",
    steps: [
      { label: "第一步：整段翻译", queries: ["翻译"] },
      { label: "第二步：AI 精翻润色", queries: ["长文本", "AI 对话"] },
      { label: "第三步：查背景资料", queries: ["百科", "电子书"] },
    ],
  },
  {
    id: "online-shopping",
    title: "网购购物",
    description: "网购的省心流程：先逛商城比价，再看批发拿货渠道，最后查快递物流。按这个顺序打开下面的网站，下单前先看一遍。",
    intro: "我想网购东西",
    steps: [
      { label: "第一步：逛商城比价", queries: ["电商购物", "购物"] },
      { label: "第二步：批发拿货", queries: ["批发"] },
      { label: "第三步：查快递物流", queries: ["快递", "物流"] },
    ],
  },
  {
    id: "make-resume",
    title: "做简历",
    description: "做简历找工作的三步：套模板做出一份简历、去招聘平台投递、刷题准备面试。每一步的网站都可直接打开。",
    intro: "我要做一份简历找工作",
    steps: [
      { label: "第一步：套模板做简历", queries: ["简历", "简历模板"] },
      { label: "第二步：找工作投递", queries: ["招聘", "找工作"] },
      { label: "第三步：刷题备面试", queries: ["面试刷题", "面试经验"] },
    ],
  },
  {
    id: "data-sheets",
    title: "做表格",
    description: "做一份在线表格：先建表，再拉同事多人协作填写，最后用 AI 汇总分析。办公场景按这个顺序用最顺手。",
    intro: "我要做一份在线表格",
    steps: [
      { label: "第一步：在线建表格", queries: ["在线表格", "表格"] },
      { label: "第二步：多人协作填表", queries: ["在线文档", "协作"] },
      { label: "第三步：AI 汇总分析", queries: ["AI 总结", "长文本"] },
    ],
  },
  {
    id: "write-novel",
    title: "写小说",
    description: "写网络小说的起步路径：先看热门榜找灵感，再选平台投稿签约，最后用 AI 写作工具辅助成文。适合刚动笔的新作者。",
    intro: "我想写网络小说",
    steps: [
      { label: "第一步：找灵感看热门榜", queries: ["小说", "网文"] },
      { label: "第二步：选平台投稿签约", queries: ["投稿", "小说平台"] },
      { label: "第三步：AI 辅助写作", queries: ["AI 写作", "写作助手"] },
    ],
  },
  {
    id: "exam-prep",
    title: "考公考研",
    description: "考公考研的备考顺序：先查官方公告与报名，再学系统课程，最后刷题与模考。每一步都从下面的网站按顺序打开即可。",
    intro: "我在准备考公考研",
    steps: [
      { label: "第一步：查公告与报名", queries: ["公务员考试", "考研"] },
      { label: "第二步：学系统课程", queries: ["考公", "考研课程"] },
      { label: "第三步：刷题与模考", queries: ["题库", "刷题"] },
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
