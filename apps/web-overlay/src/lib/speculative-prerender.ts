// @core-mirror:parity-ignore-start
// 本文件由 scripts/sync-core-mirrors.mjs 自动生成，请勿手工编辑。
// 事实源：packages/core/src/speculative-prerender.ts
// 同步命令：node scripts/sync-core-mirrors.mjs
// 一致性守门：node scripts/sync-core-mirrors.mjs --check（CI 可加）
// @core-mirror:parity-ignore-end
/**
 * 自适应上下文推测性预渲染引擎 (Speculative Pre-rendering Engine)
 *
 * 核心设计目标：
 * 连接 Kalman 轨迹意图预测与浏览器原生 W3C Speculation Rules API。
 * 当用户鼠标轨迹或键盘焦点以高确定性（置信度 > 0.85 且预计抵达时间 < 180ms）
 * 扑向某个站点卡片时，在后台直接唤起 Speculation Prerender，
 * 达成点击后「零白屏、零加载、0 毫秒即时完全呈现」的极致速度体验。
 */

export interface SpeculationCandidate {
  url: string;
  confidence: number;
  predictedArrivalMs: number;
}

export type SpeculationEagerness = "immediate" | "moderate" | "conservative";

export interface SpeculationRuleGroup {
  source: "list";
  urls: string[];
  eagerness?: SpeculationEagerness;
}

export interface SpeculationRulesPayload {
  prerender?: SpeculationRuleGroup[];
  prefetch?: SpeculationRuleGroup[];
}

export interface CompilerOptions {
  /** 触发预渲染的最小置信度阈值 (默认 0.82) */
  prerenderConfidenceThreshold?: number;
  /** 触发预取的最小置信度阈值 (默认 0.45) */
  prefetchConfidenceThreshold?: number;
  /** 允许预渲染的最大 URL 数量 (默认 2，防资源浪费) */
  maxPrerenderCount?: number;
  /** 允许预取的最大 URL 数量 (默认 5) */
  maxPrefetchCount?: number;
  /** 拦截敏感/高危路径 */
  unsafePathPatterns?: RegExp[];
}

export const DEFAULT_UNSAFE_PATTERNS = [
  /\/logout/i,
  /\/signout/i,
  /\/delete/i,
  /\/destroy/i,
  /\/api\/tokens/i,
  /\/admin/i,
];

/**
 * 校验 URL 是否安全可用于推测渲染
 */
export function isSafeForSpeculation(url: string, unsafePatterns = DEFAULT_UNSAFE_PATTERNS): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    for (const pattern of unsafePatterns) {
      if (pattern.test(parsed.pathname)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 编译推测候选集为标准 W3C Speculation Rules 规则负载
 */
export function compileSpeculationRules(
  candidates: SpeculationCandidate[],
  options: CompilerOptions = {}
): SpeculationRulesPayload | null {
  const {
    prerenderConfidenceThreshold = 0.82,
    prefetchConfidenceThreshold = 0.45,
    maxPrerenderCount = 2,
    maxPrefetchCount = 5,
    unsafePathPatterns = DEFAULT_UNSAFE_PATTERNS,
  } = options;

  const validCandidates = candidates.filter((c) => isSafeForSpeculation(c.url, unsafePathPatterns));
  if (validCandidates.length === 0) return null;

  // 排序：置信度高且预测抵达时间短的优先
  validCandidates.sort((a, b) => b.confidence - a.confidence || a.predictedArrivalMs - b.predictedArrivalMs);

  const prerenderUrls: string[] = [];
  const prefetchUrls: string[] = [];

  for (const c of validCandidates) {
    if (c.confidence >= prerenderConfidenceThreshold && prerenderUrls.length < maxPrerenderCount) {
      prerenderUrls.push(c.url);
    } else if (c.confidence >= prefetchConfidenceThreshold && prefetchUrls.length < maxPrefetchCount) {
      if (!prerenderUrls.includes(c.url)) {
        prefetchUrls.push(c.url);
      }
    }
  }

  if (prerenderUrls.length === 0 && prefetchUrls.length === 0) {
    return null;
  }

  const payload: SpeculationRulesPayload = {};

  if (prerenderUrls.length > 0) {
    payload.prerender = [
      {
        source: "list",
        urls: prerenderUrls,
        eagerness: "immediate",
      },
    ];
  }

  if (prefetchUrls.length > 0) {
    payload.prefetch = [
      {
        source: "list",
        urls: prefetchUrls,
        eagerness: "moderate",
      },
    ];
  }

  return payload;
}

/**
 * 将规则编译为可在 <head> 注入的 JSON 文本
 */
export function renderSpeculationRulesScript(payload: SpeculationRulesPayload): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * 针对不支持 Speculation Rules 的低版本浏览器提供 <link rel="prefetch/prerender"> 回退标签集
 */
export function generateFallbackLinkTags(payload: SpeculationRulesPayload): string[] {
  const tags: string[] = [];
  if (payload.prerender?.[0]?.urls) {
    for (const url of payload.prerender[0].urls) {
      tags.push(`<link rel="prerender" href="${url}" />`);
    }
  }
  if (payload.prefetch?.[0]?.urls) {
    for (const url of payload.prefetch[0].urls) {
      tags.push(`<link rel="prefetch" href="${url}" />`);
    }
  }
  return tags;
}
