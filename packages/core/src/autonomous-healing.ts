/**
 * AI 自动嗅探与智能动态元数据守护自愈机制 (Autonomous Healing Agent Core)
 *
 * 核心设计目标：
 * 当全站健康巡检探测到站点故障（404/410/502/域名过期/DNS解析失败）时，
 * 自动启动故障自愈诊断流程：
 * 1. 自动调用 Wayback Machine API 生成归档拯救快照镜像
 * 2. 在同类目同标签图谱中检索高相似度健康替代方案 (Alternative Mirror)
 * 3. 生成结构化诊断自愈报告并自动生成重定向与修复建议
 */
import { generateWaybackRecoveryUrl } from "./wayback-resolver.ts";

export type BrokenCause =
  | "DNS_RESOLVE_FAIL"
  | "HTTP_NOT_FOUND"
  | "HTTP_GONE"
  | "HTTP_SERVER_ERROR"
  | "SSL_CERT_ERROR"
  | "TIMEOUT"
  | "UNKNOWN";

export interface BrokenDiagnosis {
  cause: BrokenCause;
  severity: "critical" | "warning" | "temporary";
  description: string;
}

export interface ReplacementCandidate {
  id: string;
  title: string;
  url: string;
  reason: string;
  matchScore: number;
}

export interface AutonomousHealingReport {
  siteId: string;
  originalUrl: string;
  title: string;
  diagnosedAt: number;
  diagnosis: BrokenDiagnosis;
  waybackFallbackUrl: string;
  suggestedReplacements: ReplacementCandidate[];
  recommendedAction: "wayback_fallback" | "redirect_to_alternative" | "archive_and_notify";
  autoResolvable: boolean;
}

/**
 * 1. 根据 HTTP 状态码与错误信息推导根本诱因
 */
export function diagnoseBrokenCause(
  httpStatus: number | null | undefined,
  errorMessage?: string
): BrokenDiagnosis {
  const err = (errorMessage || "").toLowerCase();

  if (httpStatus === 404) {
    return {
      cause: "HTTP_NOT_FOUND",
      severity: "critical",
      description: "原网址返回 404 Not Found，页面资源已被移除或主站改版改版路由失效。",
    };
  }

  if (httpStatus === 410) {
    return {
      cause: "HTTP_GONE",
      severity: "critical",
      description: "原网址返回 410 Gone，站点管理员已永久性关闭该服务。",
    };
  }

  if (httpStatus && httpStatus >= 500) {
    return {
      cause: "HTTP_SERVER_ERROR",
      severity: "warning",
      description: `原网址返回 HTTP ${httpStatus} 服务器内部错误，可能处于维护或暂时过载中。`,
    };
  }

  if (err.includes("enotfound") || err.includes("getaddrinfo") || err.includes("dns")) {
    return {
      cause: "DNS_RESOLVE_FAIL",
      severity: "critical",
      description: "域名 DNS 解析彻底失败，域名可能已过期注销或被域名注册商停止解析。",
    };
  }

  if (err.includes("cert") || err.includes("tls") || err.includes("ssl")) {
    return {
      cause: "SSL_CERT_ERROR",
      severity: "warning",
      description: "SSL/TLS 证书已过期或无效，造成 HTTPS 安全阻断。",
    };
  }

  if (err.includes("timeout") || err.includes("etimedout")) {
    return {
      cause: "TIMEOUT",
      severity: "temporary",
      description: "网络连接超时，目标站点海外访问不稳定或遭遇 DDoS 流量清洗。",
    };
  }

  return {
    cause: "UNKNOWN",
    severity: "warning",
    description: `站点访问异常: ${errorMessage || "未知网络故障"}`,
  };
}

/**
 * 2. 诊断并生成智能自愈报告
 */
export function runAutonomousHealing(options: {
  siteId: string;
  url: string;
  title: string;
  httpStatus?: number | null;
  errorMessage?: string;
  availablePeers?: Array<{
    id: string;
    title: string;
    url: string;
    categoryId?: string;
    tags?: string[];
  }>;
  categoryId?: string;
  tags?: string[];
}): AutonomousHealingReport {
  const { siteId, url, title, httpStatus, errorMessage, availablePeers = [], categoryId, tags = [] } = options;
  const diagnosis = diagnoseBrokenCause(httpStatus, errorMessage);
  const waybackFallbackUrl = generateWaybackRecoveryUrl(url);

  // 寻找健康替代方案候选
  const candidates: ReplacementCandidate[] = [];
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));

  for (const peer of availablePeers) {
    if (peer.id === siteId || peer.url === url) continue;
    let score = 0;
    const reasons: string[] = [];

    if (categoryId && peer.categoryId === categoryId) {
      score += 0.5;
      reasons.push("同属分类");
    }

    if (peer.tags && peer.tags.length > 0) {
      const overlap = peer.tags.filter((t) => tagSet.has(t.toLowerCase())).length;
      if (overlap > 0) {
        score += Math.min(0.45, overlap * 0.15);
        reasons.push(`匹配 ${overlap} 个共有标签`);
      }
    }

    if (score >= 0.3) {
      candidates.push({
        id: peer.id,
        title: peer.title,
        url: peer.url,
        matchScore: Math.round(score * 100) / 100,
        reason: reasons.join("，") || "同生态推荐",
      });
    }
  }

  candidates.sort((a, b) => b.matchScore - a.matchScore);
  const topReplacements = candidates.slice(0, 3);

  let recommendedAction: "wayback_fallback" | "redirect_to_alternative" | "archive_and_notify";
  if (topReplacements.length > 0 && topReplacements[0]!.matchScore >= 0.7) {
    recommendedAction = "redirect_to_alternative";
  } else if (diagnosis.cause === "HTTP_GONE" || diagnosis.cause === "HTTP_NOT_FOUND" || diagnosis.cause === "DNS_RESOLVE_FAIL") {
    recommendedAction = "wayback_fallback";
  } else {
    recommendedAction = "archive_and_notify";
  }

  return {
    siteId,
    originalUrl: url,
    title,
    diagnosedAt: Date.now(),
    diagnosis,
    waybackFallbackUrl,
    suggestedReplacements: topReplacements,
    recommendedAction,
    autoResolvable: Boolean(topReplacements.length > 0 || waybackFallbackUrl),
  };
}
