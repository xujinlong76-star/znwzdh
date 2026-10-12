/**
 * HTML 元数据抽取。
 *
 * 不引入 cheerio 等依赖：只需要 title / og / description / icon，
 * 用轻量正则足够，且能避免把整棵 DOM 树读进内存（抓回来的页面可能很大）。
 * 顺序刻意对齐主流抓取器的优先级：og:* > twitter:* > name=description。
 */

export interface ExtractedMetadata {
  title: string | null;
  description: string | null;
  icon: string | null;
  image: string | null;
  siteName: string | null;
  lang: string | null;
  themeColor: string | null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

function clean(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = decodeEntities(s).replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
}

/** 取 <meta> 的 content，支持 name/property 两种属性顺序 */
function metaContent(html: string, key: string): string | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp('<meta[^>]+(?:property|name|itemprop)=["\']' + esc + '["\'][^>]*?content=["\']([^"\']*)', "i"),
    new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*?(?:property|name|itemprop)=["\']' + esc + '["\']', "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1] !== undefined) return clean(m[1]);
  }
  return null;
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1] !== undefined ? clean(m[1]) : null;
}

/** 相对路径 -> 绝对 URL；失败返回原值 */
export function absolutize(candidate: string | null, base: string): string | null {
  if (!candidate) return null;
  try { return new URL(candidate, base).toString(); } catch { return candidate; }
}

export function extractMetadata(html: string, pageUrl: string): ExtractedMetadata {
  const head = html.slice(0, 200_000);

  const title =
    metaContent(head, "og:title") ??
    metaContent(head, "twitter:title") ??
    firstMatch(head, /<title[^>]*>([\s\S]*?)<\/title>/i);

  const description =
    metaContent(head, "og:description") ??
    metaContent(head, "twitter:description") ??
    metaContent(head, "description");

  // favicon 优先级：显式 link rel=icon > apple-touch-icon > og:image > /favicon.ico
  const iconCandidate =
    firstMatch(head, /<link[^>]+rel=["\'][^"\']*icon[^"\']*["\'][^>]*?href=["\']([^"\']+)/i) ??
    firstMatch(head, /<link[^>]+href=["\']([^"\']+)["\'][^>]*?rel=["\'][^"\']*icon[^"\']*["\']/i) ??
    firstMatch(head, /<link[^>]+rel=["\'"]apple-touch-icon["\'"][^>]*?href=["\']([^"\']+)/i);

  const image = metaContent(head, "og:image") ?? metaContent(head, "twitter:image");

  return {
    title,
    description,
    icon: absolutize(iconCandidate, pageUrl) ?? absolutize("/favicon.ico", pageUrl),
    image: absolutize(image, pageUrl),
    siteName: metaContent(head, "og:site_name"),
    lang: firstMatch(head, /<html[^>]+lang=["\']([^"\']+)/i),
    themeColor: metaContent(head, "theme-color"),
  };
}
