/**
 * NavHub 4.0 生态增强库：为高频工具提供深链微动作、平替雷达（AlternativeTo）与工作台映射。
 */
import type { SiteAction, SiteRelation, SiteLiveMetrics } from "./types.ts";

export interface EnhancedSiteData {
  actions?: SiteAction[];
  relations?: SiteRelation[];
  liveMetrics?: SiteLiveMetrics;
  workspaces?: string[];
}

/** 规则字典：按 URL / 关键词匹配 */
export const ECOSYSTEM_MAP: Record<string, EnhancedSiteData> = {
  // --- AI 领域 ---
  "cursor.com": {
    workspaces: ["dev", "ai"],
    actions: [
      { id: "docs", label: "查文档", urlTemplate: "https://docs.cursor.com", icon: "book" },
      { id: "forum", label: "社区", urlTemplate: "https://forum.cursor.com", icon: "message" },
    ],
    relations: [
      { targetTitle: "Continue.dev", targetUrl: "https://continue.dev", relationType: "alternative", isFreeOrOpenSource: true, note: "开源本地模型代码助手" },
      { targetTitle: "GitHub Copilot", targetUrl: "https://github.com/features/copilot", relationType: "alternative", isFreeOrOpenSource: false, note: "微软官方 AI 编程插件" },
    ],
    liveMetrics: { openSource: false },
  },
  "github.com/features/copilot": {
    workspaces: ["dev", "ai"],
    relations: [
      { targetTitle: "Cursor", targetUrl: "https://cursor.com", relationType: "alternative", isFreeOrOpenSource: false, note: "深度集成的 AI 原生 IDE" },
      { targetTitle: "Continue.dev", targetUrl: "https://continue.dev", relationType: "alternative", isFreeOrOpenSource: true, note: "开源 VSCode / JetBrains 扩展" },
    ],
  },
  "chatgpt.com": {
    relations: [
      { targetTitle: "Claude", targetUrl: "https://claude.ai", relationType: "alternative", isFreeOrOpenSource: false, note: "长文本与代码见长的对话助手" },
      { targetTitle: "DeepSeek", targetUrl: "https://chat.deepseek.com", relationType: "alternative", isFreeOrOpenSource: true, note: "开源权重、网页端免费" },
      { targetTitle: "Kimi", targetUrl: "https://kimi.moonshot.cn", relationType: "alternative", isFreeOrOpenSource: true, note: "超长上下文与中文检索问答" },
      { targetTitle: "Google Gemini", targetUrl: "https://gemini.google.com", relationType: "alternative", isFreeOrOpenSource: false, note: "Google 多模态助手" },
      { targetTitle: "智谱清言", targetUrl: "https://chatglm.cn", relationType: "alternative", isFreeOrOpenSource: true, note: "GLM 系国产对话模型" },
      { targetTitle: "Ollama", targetUrl: "https://ollama.com", relationType: "alternative", isFreeOrOpenSource: true, note: "本地私有化跑开源模型" },
    ],
  },
  "claude.ai": {
    workspaces: ["ai", "dev", "efficiency"],
    actions: [
      { id: "chat", label: "快速对话", urlTemplate: "https://claude.ai/new", placeholder: "直达新会话" },
    ],
    relations: [
      { targetTitle: "DeepSeek", targetUrl: "https://chat.deepseek.com", relationType: "alternative", isFreeOrOpenSource: true, note: "高性价比国产大模型" },
      // 库里活着的那条 ChatGPT 是 https://chatgpt.com；chat.openai.com 已被巡检软删，
      // 写成旧域名只会让面板上这条平替永远点不进站内。
      { targetTitle: "ChatGPT", targetUrl: "https://chatgpt.com", relationType: "alternative", isFreeOrOpenSource: false, note: "OpenAI 旗舰对话模型" },
    ],
  },
  "chat.deepseek.com": {
    workspaces: ["ai", "dev", "efficiency"],
    actions: [
      { id: "chat", label: "新会话", urlTemplate: "https://chat.deepseek.com", placeholder: "开启新会话" },
    ],
    relations: [
      { targetTitle: "Ollama", targetUrl: "https://ollama.com", relationType: "alternative", isFreeOrOpenSource: true, note: "本地离线私有化运行大模型" },
    ],
    liveMetrics: { openSource: true },
  },
  "ollama.com": {
    workspaces: ["dev", "ai"],
    actions: [
      { id: "models", label: "模型库", urlTemplate: "https://ollama.com/library", icon: "box" },
      { id: "search", label: "搜模型", urlTemplate: "https://ollama.com/library?q={q}", placeholder: "搜索 qwen, llama3, deepseek-r1" },
    ],
    relations: [
      { targetTitle: "vLLM", targetUrl: "https://github.com/vllm-project/vllm", relationType: "ecosystem", isFreeOrOpenSource: true, note: "高吞吐量大模型推理引擎" },
    ],
    liveMetrics: { openSource: true, license: "MIT" },
  },

  // --- 开发与代码 ---
  "github.com": {
    workspaces: ["dev"],
    actions: [
      { id: "search-repo", label: "搜开源库", urlTemplate: "https://github.com/search?q={q}&type=repositories", placeholder: "搜索开源项目或组织" },
      { id: "trending", label: "Trending", urlTemplate: "https://github.com/trending", icon: "flame" },
    ],
    relations: [
      // 收录的是 about.gitlab.com（GitLab 官方站条目），写成 gitlab.com 会永远对不上
      { targetTitle: "GitLab", targetUrl: "https://about.gitlab.com", relationType: "alternative", isFreeOrOpenSource: true, note: "支持私有化部署的代码托管平台" },
      { targetTitle: "Gitee", targetUrl: "https://gitee.com", relationType: "alternative", isFreeOrOpenSource: false, note: "国内快速访问的代码托管" },
    ],
  },
  "npmjs.com": {
    workspaces: ["dev"],
    actions: [
      { id: "search-package", label: "搜索 npm 包", urlTemplate: "https://www.npmjs.com/search?q={q}", placeholder: "输入包名 (如 react, fastify, zod)" },
    ],
    relations: [
      { targetTitle: "npmmirror", targetUrl: "https://npmmirror.com", relationType: "mirror", isFreeOrOpenSource: true, note: "国内极速镜像源" },
    ],
  },
  "developer.mozilla.org": {
    workspaces: ["dev"],
    actions: [
      { id: "search-mdn", label: "查 Web API", urlTemplate: "https://developer.mozilla.org/zh-CN/search?q={q}", placeholder: "查 JS / CSS / WebAPI 语法" },
    ],
  },
  "leetcode.cn": {
    workspaces: ["dev"],
    actions: [
      { id: "search-problem", label: "搜题目", urlTemplate: "https://leetcode.cn/problemset/?search={q}", placeholder: "题号或算法名 (如 两数之和)" },
    ],
  },
  "vercel.com": {
    workspaces: ["dev"],
    actions: [
      { id: "deploy", label: "极速部署", urlTemplate: "https://vercel.com/new", icon: "upload" },
    ],
    relations: [
      { targetTitle: "Coolify", targetUrl: "https://coolify.io", relationType: "alternative", isFreeOrOpenSource: true, note: "开源可自托管的 Vercel/Heroku 替代品" },
      { targetTitle: "Zeabur", targetUrl: "https://zeabur.com", relationType: "alternative", isFreeOrOpenSource: false, note: "多语言无感部署云平台" },
      { targetTitle: "Cloudflare Pages", targetUrl: "https://pages.cloudflare.com", relationType: "alternative", isFreeOrOpenSource: true, note: "全球边缘极速静态托管" },
    ],
  },
  "hub.docker.com": {
    workspaces: ["dev"],
    actions: [
      { id: "search-image", label: "搜索镜像", urlTemplate: "https://hub.docker.com/search?q={q}", placeholder: "输入镜像名 (如 nginx, postgres)" },
    ],
  },

  // --- UI 设计与创意 ---
  "figma.com": {
    workspaces: ["design"],
    actions: [
      { id: "community", label: "探索社区素材", urlTemplate: "https://www.figma.com/community", icon: "palette" },
    ],
    relations: [
      { targetTitle: "Penpot", targetUrl: "https://penpot.app", relationType: "alternative", isFreeOrOpenSource: true, note: "开源 Web 原生设计与协作平替" },
      { targetTitle: "Pixso", targetUrl: "https://pixso.cn", relationType: "alternative", isFreeOrOpenSource: false, note: "国产专业级高保真协同工具" },
    ],
  },
  "unsplash.com": {
    workspaces: ["design", "content"],
    actions: [
      { id: "search-photo", label: "免版权高清搜图", urlTemplate: "https://unsplash.com/s/photos/{q}", placeholder: "输入英文搜图 (如 office, nature)" },
    ],
    relations: [
      { targetTitle: "Pexels", targetUrl: "https://www.pexels.com/zh-cn/", relationType: "alternative", isFreeOrOpenSource: true, note: "免费商用高清图库与短视频" },
      { targetTitle: "Pixabay", targetUrl: "https://pixabay.com/zh/", relationType: "alternative", isFreeOrOpenSource: true, note: "海量免费插画、矢量图与音效" },
    ],
  },
  "tinypng.com": {
    workspaces: ["design", "dev", "content"],
    actions: [
      { id: "compress", label: "在线压缩", urlTemplate: "https://tinypng.com", icon: "minimize" },
    ],
    relations: [
      { targetTitle: "Squoosh", targetUrl: "https://squoosh.app", relationType: "alternative", isFreeOrOpenSource: true, note: "Google 开源端侧无损图片压缩神器" },
    ],
  },
  "excalidraw.com": {
    workspaces: ["design", "dev", "efficiency"],
    actions: [
      { id: "draw", label: "新建手绘白板", urlTemplate: "https://excalidraw.com", icon: "pen" },
    ],
    relations: [
      { targetTitle: "tldraw", targetUrl: "https://www.tldraw.com", relationType: "alternative", isFreeOrOpenSource: true, note: "轻量易用的开源协同画板" },
      { targetTitle: "Draw.io", targetUrl: "https://app.diagrams.net", relationType: "alternative", isFreeOrOpenSource: true, note: "专业架构与流程图利器" },
    ],
    liveMetrics: { openSource: true, license: "MIT" },
  },
  "iconify.design": {
    workspaces: ["design", "dev"],
    actions: [
      { id: "search-icon", label: "搜索矢量图标", urlTemplate: "https://icon-sets.iconify.design/?query={q}", placeholder: "搜索图标关键词" },
    ],
    relations: [
      { targetTitle: "Lucide Icons", targetUrl: "https://lucide.dev", relationType: "ecosystem", isFreeOrOpenSource: true, note: "精美现代的无依赖矢量图标库" },
    ],
  },

  // --- 效率与笔记 ---
  "notion.so": {
    workspaces: ["efficiency", "content"],
    relations: [
      { targetTitle: "AppFlowy", targetUrl: "https://appflowy.io", relationType: "alternative", isFreeOrOpenSource: true, note: "Notion 开源私有化看板与知识库" },
      { targetTitle: "Obsidian", targetUrl: "https://obsidian.md", relationType: "alternative", isFreeOrOpenSource: true, note: "本地 Markdown 离线双链知识库" },
      { targetTitle: "AFFiNE", targetUrl: "https://affine.pro", relationType: "alternative", isFreeOrOpenSource: true, note: "下一代开源全能画布与协同工作区" },
      // 这两条是「点了能进站内详情页」的补集：AppFlowy / AFFiNE 库里还没收，
      // 而 events 里 `notion 平替` 恰恰要的是一次能比出多个候选的平替雷达。
      { targetTitle: "Logseq", targetUrl: "https://logseq.com", relationType: "alternative", isFreeOrOpenSource: true, note: "开源大纲笔记，本地优先双链" },
      { targetTitle: "思源笔记", targetUrl: "https://b3log.org/siyuan", relationType: "alternative", isFreeOrOpenSource: true, note: "开源块级编辑器，可完全离线" },
    ],
  },
};

/**
 * 把「站点 URL」与「ECOSYSTEM_MAP 的键」都归一成 host + path 再比较。
 *
 * 不能再用 `url.includes(key)`：`github.com/rakyll/hey` 会命中 `github.com`，
 * 于是这个压测 CLI 被标成 GitLab / Gitee 的平替；`notfigma.com` 也会命中
 * `figma.com`。匹配必须落在主机边界上，并且 host-only 的键只匹配站点首页，
 * 否则 GitHub 上的任意仓库页都会继承 GitHub 平台本身的关系与动作。
 */
interface EcosystemTarget {
  host: string;
  path: string;
  data: EnhancedSiteData;
}

function parseEcosystemUrl(raw: string): { host: string; path: string } | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return { host, path: path.toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * 把任意 URL（或 ECOSYSTEM_MAP 的键）归一成「host + path」定位串：去 `www.`、去尾斜杠、小写。
 *
 * 导出给中枢种子（apps/api/src/seed.ts:seedEcosystemRelations）用：源站与平替目标必须
 * 走同一个口径，否则库里的 `https://www.continue.dev/` 和策划里写的 `https://continue.dev`
 * 会被当成两个不同的站，把「其实收进来了」误报成「站外目标」。
 * 键本身没有协议，调用方补 `https://` 再传进来即可。非 http(s) 或非法 URL 返回 null。
 */
export function ecosystemUrlKey(raw: string): string | null {
  const parsed = parseEcosystemUrl(raw);
  if (!parsed) return null;
  return parsed.path === "/" ? parsed.host : `${parsed.host}${parsed.path}`;
}

/** 最长（最具体）的键优先：`github.com/features/copilot` 必须先于 `github.com` 尝试。 */
const ECOSYSTEM_TARGETS: EcosystemTarget[] = Object.entries(ECOSYSTEM_MAP)
  .map(([key, data]) => {
    const parsed = parseEcosystemUrl(`https://${key}`);
    return parsed ? { ...parsed, data } : null;
  })
  .filter((item): item is EcosystemTarget => item !== null)
  .sort((a, b) => b.path.length - a.path.length || b.host.length - a.host.length);

function matchesEcosystemTarget(site: { host: string; path: string }, target: EcosystemTarget): boolean {
  if (site.host !== target.host) return false;
  // 键里没有路径 = 只代表该产品首页；不能把子页面当成产品本身
  if (target.path === "/") return site.path === "/";
  return site.path === target.path || site.path.startsWith(`${target.path}/`);
}

/**
 * 根据站点 URL 或标题匹配富化数据。
 */
export function getEnhancedSiteData(url: string, title?: string): EnhancedSiteData {
  const normUrl = url.toLowerCase();
  const parsed = parseEcosystemUrl(url);
  if (parsed) {
    for (const target of ECOSYSTEM_TARGETS) {
      if (matchesEcosystemTarget(parsed, target)) {
        return target.data;
      }
    }
  }

  // 兜底启发式：根据关键词推断 Workspace
  const lowerTitle = (title || "").toLowerCase();
  const guessedWorkspaces: string[] = [];
  if (normUrl.includes(".ai") || normUrl.includes("ai.") || lowerTitle.includes("ai") || lowerTitle.includes("智能") || lowerTitle.includes("gpt") || lowerTitle.includes("模型") || lowerTitle.includes("model")) {
    guessedWorkspaces.push("ai");
  }
  if (lowerTitle.includes("代码") || lowerTitle.includes("开发") || lowerTitle.includes("api") || lowerTitle.includes("github") || lowerTitle.includes("git")) {
    guessedWorkspaces.push("dev");
  }
  if (lowerTitle.includes("设计") || lowerTitle.includes("图") || lowerTitle.includes("icon") || lowerTitle.includes("ui") || lowerTitle.includes("颜色")) {
    guessedWorkspaces.push("design");
  }

  return {
    workspaces: guessedWorkspaces.length > 0 ? guessedWorkspaces : ["dev", "efficiency"],
  };
}
