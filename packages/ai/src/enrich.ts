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
import { getEnhancedSiteData, type SiteRelation } from "@navhub/core";
import { guardedFetch, type FetchGuardOptions } from "./ssrf.ts";
import { extractMetadata } from "./metadata.ts";
import { AGNES_BASE_URL, AGNES_MODEL, LlmError, chatCompletion, type JsonMode } from "./llm.ts";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
  /** JSON 约束策略；auto 时遇到不支持 response_format 的端点会自动去参重试 */
  jsonMode?: JsonMode;
  /** 允许内网端点（本地 Ollama）；仅系统级配置可开启 */
  allowPrivateNetwork?: boolean;
  /** 是否开启深度思考（Agnes 3.0 Flash native thinking） */
  thinking?: boolean;
  /** 备选 LLM 轮换池配置（主模型失败或超时后依次尝试） */
  fallbacks?: LlmConfig[];
}

export const DEFAULT_LLM: LlmConfig = {
  baseUrl: AGNES_BASE_URL,
  apiKey: null,
  model: AGNES_MODEL,
  timeoutMs: 20_000,
};

export interface EnrichmentResult {
  url: string;
  title: string;
  description: string;
  tags: string[];
  keywords: string[];
  suggestedCategory: string | null;
  suggestedFacets?: Record<string, string[]>;
  suggestedRelations?: SiteRelation[];
  iconUrl: string | null;
  imageUrl: string | null;
  lang: string | null;
  httpStatus: number | null;
  /** 结果来源，前端据此标注可信度 */
  provenance: "llm" | "heuristic";
  /** 逐字段来源：审核界面据此逐项决定「采纳 / 保留原值」 */
  fields: EnrichmentFields;
  warnings: string[];
}

/**
 * 每个字段的值从哪来。
 *
 * `missing` 是"没拿到"，不是"拿到了空值"：页面没有 description 元数据、
 * 抽不出标签、没有图标，都属于这一档。审核界面必须把它和 `scraped` 分开，
 * 否则空值会被当成"最新信息"覆盖掉人工填写的内容。
 */
export type FieldSource = "llm" | "scraped" | "heuristic" | "missing";

export interface EnrichmentField<T> {
  value: T;
  source: FieldSource;
  /** 为什么是这个来源（missing 时说明缺什么），界面直接展示 */
  note?: string;
}

export interface EnrichmentFields {
  title: EnrichmentField<string>;
  description: EnrichmentField<string>;
  tags: EnrichmentField<string[]>;
  category: EnrichmentField<string | null>;
  icon: EnrichmentField<string | null>;
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

/** 单次富化 LLM 调用的用量信息（成功与失败都会回调，供上层落 llm_usage） */
export interface EnrichLlmCallInfo {
  ok: boolean;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  /** 归一化错误码（config/ssrf/timeout/auth/…），成功时为 undefined */
  errorCode?: string;
  /** 本次是否启用深度思考 */
  thinking?: boolean;
}

export interface EnrichOptions {
  llm?: Partial<LlmConfig>;
  guard?: Partial<FetchGuardOptions>;
  /** 分类候选，供 LLM 从中选择（提升一致性） */
  knownCategories?: string[];
  /** 禁用 LLM，仅启发式（测试或隐私模式） */
  heuristicOnly?: boolean;
  /**
   * 每次模型调用后的用量回调。
   *
   * 为什么用回调而不是让 enrich 依赖 store：本包保持「纯 AI 能力」，
   * 不引入持久化依赖；调用方（REST / jobs）自己决定记到哪张表。
   * 成功与失败都回调 —— 观测要能看见失败，而不是只统计成功。
   */
  onLlmCall?: (info: EnrichLlmCallInfo) => void;
}

export async function enrichUrl(rawUrl: string, options: EnrichOptions = {}): Promise<EnrichmentResult> {
  const warnings: string[] = [];
  let httpStatus: number | null = null;
  let html = "";
  let finalUrl = rawUrl;
  let iconUrl: string | null = null;
  let iconSource: "declared" | "fallback" | null = null;
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
    iconSource = meta.iconSource;
    imageUrl = meta.image;
    lang = meta.lang;
  }

  const fallbackTitle = metaTitle ?? hostnameOf(finalUrl);
  const fallbackText = [metaTitle, metaDesc, finalUrl].filter(Boolean).join(" ");

  /**
   * 图标字段的来源必须按「页面声明的」与「按根路径猜的」分开：
   * `/favicon.ico` 回退不保证存在，标成 scraped 等于替页面作证。
   */
  const iconField: EnrichmentField<string | null> =
    iconSource === "fallback" && iconUrl
      ? { value: iconUrl, source: "heuristic", note: "页面没有声明图标，按站点根 /favicon.ico 推测" }
      : iconUrl
        ? { value: iconUrl, source: "scraped" }
        : { value: null, source: "missing", note: "没有抓到页面，无法确认图标" };

  // ---- 3. LLM 富化（可选） ----
  const llm = { ...DEFAULT_LLM, ...options.llm };
  // 本地 Ollama 等网关允许空密钥；是否放行内网由 allowPrivateNetwork 显式声明
  const llmReady = (c: LlmConfig) => Boolean(c.apiKey) || c.allowPrivateNetwork === true;
  const canUseLlm = !options.heuristicOnly && llmReady(llm);

  if (canUseLlm) {
    const configsToTry = [llm, ...(llm.fallbacks || [])].filter(llmReady);
    for (const activeLlm of configsToTry) {
      const payload = await tryLlm(
        activeLlm,
        { url: finalUrl, title: fallbackTitle, description: metaDesc, knownCategories: options.knownCategories },
        warnings,
        options.onLlmCall,
      );
      if (payload) {
        return {
          url: finalUrl, httpStatus,
          title: payload.title,
          description: payload.description,
          tags: payload.tags,
          keywords: payload.keywords,
          suggestedCategory: payload.category,
          suggestedFacets: heuristicFacets(finalUrl, fallbackText, lang),
          suggestedRelations: getEnhancedSiteData(finalUrl).relations ?? [],
          iconUrl, imageUrl, lang,
          provenance: "llm",
          fields: {
            title: { value: payload.title, source: "llm" },
            description: { value: payload.description, source: "llm" },
            tags: payload.tags.length
              ? { value: payload.tags, source: "llm" }
              : { value: [], source: "missing", note: "模型没有给出标签" },
            category: { value: payload.category, source: "llm" },
            icon: iconField,
          },
          warnings,
        };
      }
    }
    warnings.push("LLM 富化失败，已降级为启发式");
  } else if (!options.heuristicOnly) {
    warnings.push("未配置 LLM API Key，使用启发式富化");
  }

  // ---- 4. 启发式降级 ----
  const heuristicTagList = heuristicTags(fallbackText);
  const heuristicCategoryName = heuristicCategory(fallbackText, metaTitle ?? undefined);
  return {
    url: finalUrl,
    httpStatus,
    title: fallbackTitle,
    description: metaDesc ?? "（未能获取站点描述）",
    tags: heuristicTagList,
    keywords: heuristicTagList.slice(0, 6),
    suggestedCategory: heuristicCategoryName,
    suggestedFacets: heuristicFacets(finalUrl, fallbackText, lang),
    suggestedRelations: getEnhancedSiteData(finalUrl).relations ?? [],
    iconUrl, imageUrl, lang,
    provenance: "heuristic",
    fields: {
      title: metaTitle
        ? { value: fallbackTitle, source: "scraped" }
        : { value: fallbackTitle, source: "missing", note: "页面没有 title，只能用主机名占位" },
      description: metaDesc
        ? { value: metaDesc, source: "scraped" }
        : { value: metaDesc ?? "", source: "missing", note: "页面没有 description 元数据" },
      tags: heuristicTagList.length
        ? { value: heuristicTagList, source: "heuristic" }
        : { value: [], source: "missing", note: "关键词规则没有命中" },
      category: heuristicCategoryName
        ? { value: heuristicCategoryName, source: "heuristic" }
        : { value: null, source: "missing", note: "关键词规则无法判断类目" },
      icon: iconField,
    },
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
  onLlmCall?: (call: {
    ok: boolean;
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    errorCode?: string;
    thinking?: boolean;
  }) => void,
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
    const startedAt = Date.now();
    try {
      // 统一网关：负责 SSRF 校验、鉴权头、超时、JSON 模式兼容与错误归一化
      const result = await chatCompletion(
        {
          baseUrl: llm.baseUrl,
          model: llm.model,
          apiKey: llm.apiKey,
          timeoutMs: llm.timeoutMs,
          jsonMode: llm.jsonMode,
          allowPrivateNetwork: llm.allowPrivateNetwork,
        },
        {
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: attempt === 1 ? 0.2 : 0,
          maxTokens: 1024,
          json: true,
          // 直连 chatCompletion 绕过了 llm-usage.ts 那个注入 thinking 的包装，不显式传就静默丢掉；
          // 而用量回调记的却是 llm.thinking —— 后台显示 100% 思考调用，实际一个字段都没发。
          thinking: llm.thinking,
        },
      );

      // 用量回调：即使 schema 校验失败，这次调用也已经真实发生并计费
      onLlmCall?.({
        ok: true,
        model: result.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        latencyMs: result.latencyMs,
        // 按「参数是否真的下发」记账：端点拒收思维链时网关会去参重试，
        // 这次调用其实没思考，记成 llm.thinking 会把后台的思考调用数虚增。
        thinking: result.thinkingApplied === true,
      });
      const parsed = EnrichmentSchema.safeParse(JSON.parse(stripCodeFence(result.content)));
      if (!parsed.success) {
        warnings.push("LLM 输出未通过 schema 校验（第 " + attempt + " 次）");
        continue;
      }
      return parsed.data;
    } catch (err) {
      const errorCode = err instanceof LlmError ? err.code : "unknown";
      onLlmCall?.({
        ok: false,
        model: llm.model,
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: Date.now() - startedAt,
        errorCode,
        thinking: llm.thinking,
      });
      if (err instanceof LlmError) {
        if (err.code === "invalid_response") warnings.push("LLM 返回结构异常");
        else if (typeof err.status === "number") warnings.push("LLM HTTP " + err.status);
        else warnings.push("LLM 调用异常：" + err.message);
      } else {
        warnings.push("LLM 调用异常：" + (err instanceof Error ? err.message : String(err)));
      }
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

/**
 * 启发式分面属性推断规则 (Heuristic Facet Extraction)
 */
export function heuristicFacets(url: string, text: string, lang?: string | null): Record<string, string[]> {
  const facets: Record<string, string[]> = {};
  const lowerUrl = url.toLowerCase();
  const lowerText = text.toLowerCase();

  // 1. 付费模式 (Pricing)
  if (
    lowerUrl.includes("github.com") ||
    lowerUrl.includes("gitee.com") ||
    lowerText.includes("开源") ||
    lowerText.includes("open source") ||
    lowerText.includes("mit license") ||
    lowerText.includes("apache 2.0")
  ) {
    facets.pricing = ["open_source"];
  } else if (
    lowerText.includes("免费增值") ||
    lowerText.includes("freemium") ||
    lowerText.includes("按量付费") ||
    lowerText.includes("订阅")
  ) {
    facets.pricing = ["freemium"];
  } else if (
    lowerText.includes("100% 免费") ||
    lowerText.includes("完全免费") ||
    lowerText.includes("免费使用") ||
    lowerText.includes("永久免费")
  ) {
    facets.pricing = ["free"];
  }

  // 2. 运行平台 (Platform)
  const platforms: string[] = [];
  if (
    lowerText.includes("chrome") ||
    lowerText.includes("firefox") ||
    lowerText.includes("插件") ||
    lowerText.includes("扩展") ||
    lowerText.includes("extension")
  ) {
    platforms.push("extension");
  }
  if (lowerText.includes("ios") || lowerText.includes("iphone") || lowerText.includes("ipad") || lowerText.includes("app store")) {
    platforms.push("ios");
  }
  if (lowerText.includes("android") || lowerText.includes("安卓") || lowerText.includes("google play")) {
    platforms.push("android");
  }
  if (lowerText.includes("macos") || lowerText.includes("mac app")) {
    platforms.push("macos");
  }
  if (lowerText.includes("windows") || lowerText.includes("win10") || lowerText.includes("win11")) {
    platforms.push("windows");
  }
  if (lowerText.includes("linux")) {
    platforms.push("linux");
  }
  if (platforms.length === 0 || lowerText.includes("web") || lowerText.includes("在线") || lowerText.includes("网页") || lowerUrl.startsWith("http")) {
    platforms.push("web");
  }
  facets.platform = [...new Set(platforms)];

  // 3. 产品形态 (Form)
  const forms: string[] = [];
  if (
    lowerUrl.includes("github.com") ||
    lowerUrl.includes("gitee.com") ||
    lowerText.includes("npm") ||
    lowerText.includes("pypi") ||
    lowerText.includes("crate")
  ) {
    forms.push("library");
  }
  if (lowerText.includes("api") || lowerText.includes("sdk") || lowerText.includes("接口") || lowerText.includes("开发者")) {
    forms.push("api");
  }
  if (lowerText.includes("cli") || lowerText.includes("命令行") || lowerText.includes("终端")) {
    forms.push("cli");
  }
  if (lowerText.includes("docker") || lowerText.includes("self-hosted") || lowerText.includes("自托管") || lowerText.includes("私有化部署")) {
    forms.push("self_hosted");
  }
  if (lowerText.includes("saas") || lowerText.includes("在线服务") || forms.length === 0) {
    forms.push("saas");
  }
  facets.form = [...new Set(forms)];

  // 4. 语言支持 (Language)
  if (lang?.toLowerCase().startsWith("zh") || /[\u4e00-\u9fff]/.test(text)) {
    facets.language = ["zh"];
  } else {
    facets.language = ["en"];
  }

  // 5. 应用场景 (Scene)
  const scenes: string[] = [];
  if (lowerText.includes("代码") || lowerText.includes("编程") || lowerText.includes("开发") || lowerText.includes("git") || lowerText.includes("developer")) {
    scenes.push("dev");
  }
  if (lowerText.includes("设计") || lowerText.includes("ui") || lowerText.includes("ux") || lowerText.includes("figma") || lowerText.includes("图标")) {
    scenes.push("design");
  }
  if (lowerText.includes("ai") || lowerText.includes("人工智能") || lowerText.includes("gpt") || lowerText.includes("大模型") || lowerText.includes("prompt")) {
    scenes.push("ai");
  }
  if (lowerText.includes("写作") || lowerText.includes("博客") || lowerText.includes("自媒体") || lowerText.includes("文章") || lowerText.includes("排版")) {
    scenes.push("content");
  }
  if (lowerText.includes("协同") || lowerText.includes("表格") || lowerText.includes("文档") || lowerText.includes("效率") || lowerText.includes("日程")) {
    scenes.push("productivity");
  }
  if (lowerText.includes("运维") || lowerText.includes("监控") || lowerText.includes("云原生") || lowerText.includes("kubernetes") || lowerText.includes("k8s")) {
    scenes.push("ops");
  }
  if (scenes.length > 0) {
    facets.scene = [...new Set(scenes)];
  }

  return facets;
}


