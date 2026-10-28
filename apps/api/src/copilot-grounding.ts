/**
 * Copilot 引用校验（RAG 可验证性）。
 *
 * 模型可以自由组织语言，但不能凭空造出一个「可点击的站内推荐」：
 * 回复里的 Markdown 外链必须能映射回本次混合检索召回的候选站点。
 * 不在候选集里的外链一律降级为纯文本标题——链接是用户唯一会信的「证据」，
 * 编造出来的 URL 比没有推荐更糟。
 */
import type { Site } from "@navhub/core";

export interface CopilotCitation {
  siteId: string;
  title: string;
  url: string;
  description: string | null;
}

export function citationOfSite(site: Pick<Site, "id" | "title" | "url" | "description">): CopilotCitation {
  return {
    siteId: site.id,
    title: site.title,
    url: site.url,
    description: site.description ?? null,
  };
}

/**
 * 引用比对键：只回答「这是不是同一个站内站点」。
 *
 * 忽略协议与 hash（模型常把 http 写回 https），host 小写，路径去尾部斜杠；
 * query 保留——带不同查询参数的页面不应当被当成同一引用。
 * 非 http(s) 一律返回 null（伪协议不可引用）。
 */
export function citationUrlKey(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.host.toLowerCase()}${path}${url.search}`;
}

// URL 里允许一层配对的圆括号（Wikipedia 式路径 / javascript:alert(1)），
// 否则正则会在第一个 ")" 处截断，把残留的 ")" 留进正文。
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

export interface GroundedReply {
  reply: string;
  /** 回复中真实出现的候选站点，按首次出现顺序去重 */
  citations: CopilotCitation[];
  /** 被移除的外链数量（不在候选集 / 伪协议） */
  unverifiedLinks: number;
}

export function groundCopilotReply(
  reply: string,
  candidates: readonly CopilotCitation[],
): GroundedReply {
  const byKey = new Map<string, CopilotCitation>();
  for (const candidate of candidates) {
    const key = citationUrlKey(candidate.url);
    if (key && !byKey.has(key)) byKey.set(key, candidate);
  }

  const cited = new Map<string, CopilotCitation>();
  let unverifiedLinks = 0;

  const grounded = reply.replace(MARKDOWN_LINK, (whole, title: string, rawUrl: string) => {
    const candidate = byKey.get(citationUrlKey(rawUrl) ?? "");
    if (candidate) {
      cited.set(candidate.siteId, candidate);
      return whole;
    }
    // 站内相对路径不是「外部站点引用」，交给 UI 的 safeHref 决定去向；
    // 协议相对（//host）仍属于外部链接，不能放行。
    if (rawUrl.startsWith("/") && !rawUrl.startsWith("//")) return whole;
    unverifiedLinks += 1;
    return title;
  });

  return { reply: grounded, citations: [...cited.values()], unverifiedLinks };
}
