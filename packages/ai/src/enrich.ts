/**
 * AI 富化：给一个 URL，产出 {标题, 描述, 分类, 标签}。
 *
 * 三条不可妥协的设计约束：
 *
 *  1. **LLM 不是硬依赖。** 没有 API Key、或调用失败时，必须降级为启发式结果
 *     （用 meta description 做摘要、用关键词规则猜分类与标签），并如实标记
 *     provenance = "heuristic"。用户能一眼看出哪些是 AI 生成的。
 *  2. **JSON 结构强约束。** 要求模型只输出 JSON，并用 zod 校验；
 *     校验失败就重试一次，再失败则降级 —— 绝不把半成品结构写进数据库。
 *  3. **抓取必须过 SSRF 防护。** 见 ssrf.ts。
 */
import { z } from "zod";
import { guardedFetch, type FetchGuardOptions } from "./ssrf.ts";
import { extractMetadata } from "./metadata.ts";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
}

export const DEFAULT_LLM: LlmConfig = {
  baseUrl: "https://api.deepseek.com",
  apiKey: null,
  model: "deepseek-chat",
  timeoutMs: 20_000,
};

export interface EnrichmentResult {
  url: string;
  title: string;
  description: string;
  tags: string[];
  keywords: string[];
  suggestedCategory: string | null;
  iconUrl: string | null;
  imageUrl: string | null;
  lang: string | null;
  httpStatus: number | null;
  /** 结果来源，前端据此标注可信度 */
  provenance: "llm" | "heuristic";
  warnings: string[];
}

export const EnrichmentSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(4).max(300),
  tags: z.array(z.string().min(1).max(24)).max(8),
  keywords: z.array(z.string().min(1).max(32)).max(12),
  category: z.string().min(1).max(32),
});
export type EnrichmentPayload = z.infer<typeof EnrichmentSchema>;

/**
 * 启发式分类规则。
 *
 * 为什么是「加权关键词」而不是「计数关键词」：
 *   最初的实现是每个命中关键词 +1。结果 "GitHub Copilot AI 代码补全" 被判成「开发运维」——
 *   因为 GitHub + 代码 命中 2 次，而 AI 只命中 1 次。但显然这是个 AI 工具。
 *   计数法的问题在于把"强信号"和"弱信号"当成等权。
 *
 * 修正：给每个关键词一个权重，并让标题中的命中获得额外加成（标题比正文更能代表站点性质）。
 * 拉丁词用词边界匹配，避免 "ai" 命中 "email"、"ui" 命中 "build" 这类误伤。
 */
export interface HeuristicRule {
  category: string;
  /** 关键词 -> 权重（1 = 普通，3 = 强指示） */
  keywords: Array<[string, number]>;
}

export const HEURISTIC_RULES: HeuristicRule[] = [
  { category: "AI 工具", keywords: [
    ["人工智能", 3], ["大模型", 3], ["ai", 3], ["copilot", 3], ["gpt", 3], ["llm", 3],
    ["机器学习", 2], ["深度学习", 2], ["智能", 1], ["生成", 1], ["提示词", 2], ["prompt", 1],
  ] },
  { category: "开发运维", keywords: [
    ["编程", 2], ["代码", 2], ["开发", 2], ["github", 2], ["gitlab", 2], ["gitee", 2],
    ["docker", 2], ["kubernetes", 2], ["npm", 1], ["api", 1], ["devops", 2], ["服务器", 2],
    ["数据库", 2], ["部署", 1], ["运维", 2], ["前端", 2], ["后端", 2],
  ] },
  { category: "设计资源", keywords: [
    ["设计", 2], ["ui", 1], ["ux", 1], ["figma", 2], ["图片", 2], ["素材", 2],
    ["字体", 2], ["配色", 2], ["图标", 2], ["原型", 2], ["design", 2],
  ] },
  { category: "学习教育", keywords: [
    ["教程", 2], ["课程", 2], ["学习", 2], ["百科", 2], ["书籍", 2], ["论文", 2],
    ["文档", 1], ["tutorial", 2], ["docs", 1], ["算法", 2], ["题解", 2],
  ] },
  { category: "影音娱乐", keywords: [
    ["视频", 2], ["音乐", 2], ["影视", 2], ["直播", 2], ["游戏", 2], ["动漫", 2],
    ["bilibili", 2], ["youtube", 2], ["电影", 2],
  ] },
  { category: "生活服务", keywords: [
    ["天气", 3], ["地图", 2], ["外卖", 2], ["购物", 2], ["旅游", 2], ["健康", 2],
    ["银行", 2], ["快递", 2], ["出行", 2], ["导航", 1], ["缴费", 2],
  ] },
  { category: "效率办公", keywords: [
    ["办公", 2], ["笔记", 2], ["协作", 2], ["日程", 2], ["待办", 2], ["表单", 2],
    ["会议", 2], ["思维导图", 2], ["表格", 2],
  ] },
];

/** 命中判定：拉丁/数字词用词边界，中文用包含 */
function matchesKeyword(haystack: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (/^[a-z0-9+#.]+$/.test(kw)) {
    // 词边界：避免 ai 命中 email、ui 命中 build
    return new RegExp("(^|[^a-z0-9])" + kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^a-z0-9])", "i").test(haystack);
  }
  return haystack.includes(kw);
}

/**
 * 按加权分数选类目。
 * @param text 用于判定的文本（通常是 标题 + 描述 + 网址）
 * @param titleHint 可选标题，命中时额外加成
 */
export function heuristicCategory(text: string, titleHint?: string): string {
  const haystack = text.toLowerCase();
  const title = (titleHint ?? "").toLowerCase();
  let best = { category: "未分类", score: 0 };

  for (const rule of HEURISTIC_RULES) {
    let score = 0;
    for (const [kw, weight] of rule.keywords) {
      if (matchesKeyword(haystack, kw)) score += weight;
      // 标题命中权重 ×1.5：标题比正文更能代表站点性质
      if (title && matchesKeyword(title, kw)) score += weight * 0.5;
    }
    if (score > best.score) best = { category: rule.category, score };
  }
  return best.category;
}

export function heuristicTags(text: string): string[] {
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (const rule of HEURISTIC_RULES) {
    for (const [kw] of rule.keywords) {
      if (kw.length >= 2 && matchesKeyword(lower, kw)) out.add(kw);
    }
  }
  for (const w of text.match(/[A-Za-z][A-Za-z0-9+#.-]{2,}/g) ?? []) {
    if (out.size >= 8) break;
    out.add(w.toLowerCase());
  }
  return [...out].slice(0, 8);
}

export interface EnrichOptions {
  llm?: Partial<LlmConfig>;
  guard?: Partial<FetchGuardOptions>;
  /** 分类候选，供 LLM 从中选择（提升一致性） */
  knownCategories?: string[];
  /** 禁用 LLM，仅启发式（测试或隐私模式） */
  heuristicOnly?: boolean;
}

export async function enrichUrl(rawUrl: string, options: EnrichOptions = {}): Promise<EnrichmentResult> {
  const warnings: string[] = [];
  let httpStatus: number | null = null;
  let html = "";
  let finalUrl = rawUrl;
  let iconUrl: string | null = null;
  let imageUrl: string | null = null;
  let metaTitle: string | null = null;
  let metaDesc: string | null = null;
  let lang: string | null = null;

  // ---- 1. 安全抓取（任何失败都不抛给调用方） ----
  try {
    const res = await guardedFetch(rawUrl, options.guard);
    httpStatus = res.status;
    finalUrl = res.finalUrl;
    html = res.body;
    if (res.truncated) warnings.push("响应体被截断（超过大小上限）");
  } catch (err) {
    warnings.push("抓取失败：" + (err instanceof Error ? err.message : String(err)));
  }

  // ---- 2. 元数据抽取 ----
  if (html) {
    const meta = extractMetadata(html, finalUrl);
    metaTitle = meta.title;
    metaDesc = meta.description;
    iconUrl = meta.icon;
    imageUrl = meta.image;
    lang = meta.lang;
  }

  const fallbackTitle = metaTitle ?? hostnameOf(finalUrl);
  const fallbackText = [metaTitle, metaDesc, finalUrl].filter(Boolean).join(" ");

  // ---- 3. LLM 富化（可选） ----
  const llm = { ...DEFAULT_LLM, ...options.llm };
  const canUseLlm = !options.heuristicOnly && Boolean(llm.apiKey);

  if (canUseLlm) {
    const payload = await tryLlm(
      llm,
      { url: finalUrl, title: fallbackTitle, description: metaDesc, knownCategories: options.knownCategories },
      warnings,
    );
    if (payload) {
      return {
        url: finalUrl, httpStatus,
        title: payload.title,
        description: payload.description,
        tags: payload.tags,
        keywords: payload.keywords,
        suggestedCategory: payload.category,
        iconUrl, imageUrl, lang,
        provenance: "llm",
        warnings,
      };
    }
    warnings.push("LLM 富化失败，已降级为启发式");
  } else if (!options.heuristicOnly) {
    warnings.push("未配置 LLM API Key，使用启发式富化");
  }

  // ---- 4. 启发式降级 ----
  return {
    url: finalUrl,
    httpStatus,
    title: fallbackTitle,
    description: metaDesc ?? "（未能获取站点描述）",
    tags: heuristicTags(fallbackText),
    keywords: heuristicTags(fallbackText).slice(0, 6),
    suggestedCategory: heuristicCategory(fallbackText, metaTitle ?? undefined),
    iconUrl, imageUrl, lang,
    provenance: "heuristic",
    warnings,
  };
}

function hostnameOf(u: string): string {
  try { return new URL(u).hostname; } catch { return u; }
}

/** 调用 OpenAI 兼容的 chat completions，返回经 zod 校验的结构；失败返回 null */
async function tryLlm(
  llm: LlmConfig,
  input: { url: string; title: string; description: string | null; knownCategories?: string[] },
  warnings: string[],
): Promise<EnrichmentPayload | null> {
  const categoryHint = input.knownCategories?.length
    ? "请从以下分类中选择最合适的一个：" + input.knownCategories.join("、")
    : "请给出一个简短的中文分类名";

  const system = [
    "你是一个网址目录的编辑助手。",
    "根据给定网站信息，输出严格的 JSON（不要 markdown 代码块、不要多余文字），字段：",
    '{ "title": string, "description": string, "tags": string[], "keywords": string[], "category": string }',
    "要求：title 用站点本名，不超过 30 字；description 用中文一句话概括用途，30~80 字；",
    "tags 3~6 个中文或英文短标签；keywords 5~10 个便于检索的词；",
    categoryHint,
  ].join("\n");

  const user = [
    "网址：" + input.url,
    "页面标题：" + input.title,
    "页面描述：" + (input.description ?? "（无）"),
  ].join("\n");

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), llm.timeoutMs);
      const res = await fetch(llm.baseUrl.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + llm.apiKey,
        },
        body: JSON.stringify({
          model: llm.model,
          temperature: attempt === 1 ? 0.2 : 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        warnings.push("LLM HTTP " + res.status);
        continue;
      }
      const json: any = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") { warnings.push("LLM 返回结构异常"); continue; }

      const parsed = EnrichmentSchema.safeParse(JSON.parse(stripCodeFence(content)));
      if (!parsed.success) {
        warnings.push("LLM 输出未通过 schema 校验（第 " + attempt + " 次）");
        continue;
      }
      return parsed.data;
    } catch (err) {
      warnings.push("LLM 调用异常：" + (err instanceof Error ? err.message : String(err)));
    }
  }
  return null;
}

/** 模型有时仍会包一层 markdown 代码块或夹带前后说明文字，提取干净的 JSON 字符串 */
export function stripCodeFence(s: string): string {
  const t = s.trim();
  const fence = String.fromCharCode(96).repeat(3);
  if (t.startsWith(fence) && t.endsWith(fence)) {
    return t.slice(fence.length, t.length - fence.length).replace(/^(json)?\s*/i, "").trim();
  }
  const match = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return s.slice(firstBrace, lastBrace + 1).trim();
  }
  return t;
}

