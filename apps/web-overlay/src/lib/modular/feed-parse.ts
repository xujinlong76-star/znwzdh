/**
 * RSS / Atom / RDF 订阅源解析（纯函数，可单测）。
 *
 * 为什么要拆出来：订阅小卡以前**根本没有取数**——`config.feedUrl` 读了不用，
 * 列表是五条硬编码的假新闻（「React 19.2 正式发布」这类标题写死在源码里，
 * 点进去只有博客首页），刷新按钮只是把同一批假数据洗牌并盖上「刚刚更新」。
 * 现在 /api/rss 服务端代取（绕开 CORS）并由这里解析，解析不出来就明说解析失败。
 *
 * 解析口径：
 *  - 只认 RSS 2.0 `<item>`、Atom `<entry>`、RSS 1.0/RDF `<item rdf:about>`；
 *  - 标题/摘要一律「脱标签 → 解码 → 再脱标签」，渲染侧按纯文本输出（不 innerHTML）；
 *  - 链接只保留干净 http(s)，伪协议条目直接丢掉，不给卡片留跳转口子；
 *  - 条目数与文本长度都有上限，恶意大 feed 不能把主线程吃满。
 */
import { safeSrc } from '../safe-url';

export interface ParsedFeedItem {
  title: string;
  link: string | null;
  /** 已解析为 ISO；解析不出合法时间则为 null（不拿「刚刚」冒充时间） */
  publishedAt: string | null;
  /** 条目自带的作者/分类，作为来源副标题；没有就留 null */
  author: string | null;
  summary: string | null;
}

export interface ParsedFeed {
  feedTitle: string | null;
  format: "rss" | "atom" | "rdf" | "unknown";
  items: ParsedFeedItem[];
  /** 被丢弃的条目数（无标题或链接非法），用于诚实说明「解析到 N 条、丢弃 M 条」 */
  dropped: number;
  /** 文本在到达上限前就被截断 */
  truncated: boolean;
}

export const MAX_FEED_ITEMS = 30;
const MAX_TEXT_LENGTH = 400;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  copy: "©",
  reg: "®",
  trade: "™",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

/** 先解数字实体，再解命名实体；`&amp;lt;` 解一次后得到 `&lt;` 不再递归，避免双重解码注入 */
export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_m, code: string) => safeFromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code: string) => safeFromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeFromCodePoint(cp: number): string {
  // 控制字符与代理区码点直接丢掉：feed 里出现它们基本是构造出来的噪声
  if (!Number.isFinite(cp) || cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0xd800 && cp <= 0xdfff)) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}

function unwrapCdata(raw: string): string {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  return m ? m[1] ?? "" : raw;
}

/** 只给块级标签留空格：`<strong>` 这类行内标签替换成空格会把中文摘要切碎 */
const BLOCK_TAG = /^(?:\/)?(?:br|p|div|li|ul|ol|dl|dd|dt|blockquote|h[1-6]|tr|table|thead|tbody|section|article|header|footer)\b/i;

export function stripTags(raw: string): string {
  return raw.replace(/<([^>]*)>/g, (_m, inner: string) => (BLOCK_TAG.test(inner.trim()) ? " " : ""));
}

/**
 * 去标签 → 解码实体 → 再脱一次标签 → 压空白 → 截断。
 *
 * 第二遍脱标签不是多余：Atom 的 `<summary type="html">` 将整段 HTML **转义**后放进字段，
 * 只脱一次等于把 `<div>` 原样显示在卡片上。双重解码仍然禁止——
 * `&amp;lt;script&amp;gt;` 解一层得到 `&lt;script&gt;`，它是用户想看的字面文本，
 * 既不再解成 `<`，也不会被脱标签吃掉。
 */
export function toPlainText(raw: string, maxLength = MAX_TEXT_LENGTH): { text: string; truncated: boolean } {
  const firstPass = stripTags(unwrapCdata(raw));
  const cleaned = stripTags(decodeEntities(firstPass));
  const text = cleaned.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return { text, truncated: false };
  return { text: text.slice(0, maxLength).trimEnd(), truncated: true };
}

/** 提取块内第一个指定标签的内容（容忍命名空间前缀与属性） */
function firstTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, "i");
  const m = re.exec(block);
  return m ? m[1] ?? null : null;
}

/**
 * 按标签切块，同时保留开始标签上的属性。
 *
 * RSS 1.0/RDF 的条目地址在 `<item rdf:about="…">` 上，`<link>` 反而是自闭合的
 * `rdf:resource`；只取内文会把这类源的链接全丢掉。
 */
function blocksWithAttrs(source: string, tag: string): Array<{ attrs: string; inner: string }> {
  const out: Array<{ attrs: string; inner: string }> = [];
  const openRe = new RegExp(`<${tag}\\b([^>]*?)(/?)>`, "gi");
  const closeTag = `</${tag}`.toLowerCase();
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(source))) {
    const attrs = m[1] ?? "";
    if (m[2] === "/") {
      out.push({ attrs, inner: "" });
      continue;
    }
    const from = openRe.lastIndex;
    const closeIdx = source.toLowerCase().indexOf(closeTag, from);
    if (closeIdx < 0) break;
    out.push({ attrs, inner: source.slice(from, closeIdx) });
    const endIdx = source.indexOf(">", closeIdx);
    openRe.lastIndex = endIdx < 0 ? closeIdx : endIdx + 1;
  }
  return out;
}

/** 取属性值，兼容 rdf:about / about / href 三种写法 */
function attrValue(attrs: string, ...names: string[]): string | null {
  for (const name of names) {
    const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(attrs);
    const raw = m ? (m[2] ?? m[3] ?? "") : "";
    if (raw) return raw.trim();
  }
  return null;
}

/** Atom 的链接是属性形式：优先 rel=alternate（或没有 rel），否则第一个合法 href */
function atomLink(entry: string): string | null {
  const links = Array.from(entry.matchAll(/<link\b([^>]*?)\/?>/gi)).map((m) => m[1] ?? "");
  let fallback: string | null = null;
  for (const attrs of links) {
    const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const raw = href ? (href[2] ?? href[3] ?? "") : "";
    if (!raw) continue;
    const url = safeSrc(decodeEntities(raw.trim()));
    if (!url) continue;
    const rel = /rel\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const relValue = rel ? (rel[2] ?? rel[3] ?? "").toLowerCase() : "";
    if (!relValue || relValue === "alternate") return url;
    if (!fallback) fallback = url;
  }
  return fallback;
}

function pickDate(entry: string): string | null {
  for (const tag of ["pubDate", "published", "updated", "date", "lastBuildDate"]) {
    const raw = firstTag(entry, tag) ?? firstTag(entry, `dc:${tag}`);
    if (!raw) continue;
    const text = toPlainText(raw).text;
    const ts = Date.parse(text);
    if (Number.isFinite(ts)) return new Date(ts).toISOString();
  }
  return null;
}

function pickAuthor(entry: string): string | null {
  // Atom 的 <author> 是一段结构（name + uri + email），整块当作者名会把邮箱端上卡片
  const authorBlock = firstTag(entry, "author");
  if (authorBlock) {
    const name = toPlainText(firstTag(authorBlock, "name") ?? "").text;
    if (name) return name.slice(0, 60);
  }
  for (const tag of ["dc:creator", "itunes:author"]) {
    const raw = firstTag(entry, tag);
    if (raw) {
      const text = toPlainText(raw).text;
      if (text) return text.slice(0, 60);
    }
  }
  if (authorBlock) {
    const whole = toPlainText(authorBlock).text;
    return whole ? whole.slice(0, 60) : null;
  }
  return null;
}

function buildItem(block: string, attrs: string, isAtom: boolean): ParsedFeedItem | null {
  const title = toPlainText(firstTag(block, "title") ?? "").text;
  if (!title) return null;
  let link: string | null;
  if (isAtom) {
    link = atomLink(block);
  } else {
    const raw = toPlainText(firstTag(block, "link") ?? "").text;
    // RDF / 部分 Atom-in-RSS：链接在自闭合 <link rdf:resource> 或条目的 about 属性上
    link =
      safeSrc(raw) ??
      safeSrc(atomLink(block) ?? "") ??
      safeSrc(attrValue(block, "rdf:resource", "resource") ?? "") ??
      safeSrc(attrValue(attrs, "rdf:about", "about", "href") ?? "") ??
      null;
  }
  const summary = toPlainText(
    firstTag(block, "description") ?? firstTag(block, "summary") ?? firstTag(block, "content") ?? ""
  ).text;
  return {
    title,
    link,
    publishedAt: pickDate(block),
    author: pickAuthor(block),
    summary: summary || null,
  };
}

export function parseFeed(xml: string, opts: { maxItems?: number } = {}): ParsedFeed {
  const maxItems = Math.max(1, Math.min(MAX_FEED_ITEMS, Math.floor(opts.maxItems ?? MAX_FEED_ITEMS)));
  const source = xml.replace(/\0/g, "");
  let dropped = 0;
  let truncated = false;

  const hasAtom = /<feed[\s>]/i.test(source);
  const hasRdf = /<rdf:RDF/i.test(source);
  let blocks = blocksWithAttrs(source, hasAtom ? "entry" : "item");
  if (!blocks.length) blocks = blocksWithAttrs(source, hasAtom ? "item" : "entry");

  const feedTitleRaw = firstTag(source, "title");
  const items: ParsedFeedItem[] = [];
  for (const block of blocks) {
    const item = buildItem(block.inner, block.attrs, hasAtom);
    if (!item) {
      dropped++;
      continue;
    }
    items.push(item);
    if (items.length >= maxItems) break;
  }
  if (blocks.length > items.length + dropped) truncated = true;

  return {
    feedTitle: feedTitleRaw ? (toPlainText(feedTitleRaw).text || null) : null,
    format: hasAtom ? "atom" : hasRdf ? "rdf" : items.length ? "rss" : "unknown",
    items,
    dropped,
    truncated,
  };
}

/**
 * 相对时间（中文，卡片副标题用）。
 *
 * 时间缺失返回 null 而不是「刚刚」：把没有时间的条目说成刚刚，等于给用户一个
 * 永远在冒新的假动态流。
 */
export function relativeTime(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

/**
 * 从 Content-Type / 正文嗅探是不是订阅源。
 *
 * 很多站点给任何 URL 都返 200 + HTML；不判定就直接解析，用户填错地址时
 * 卡片会显示「解析到 0 条」而不是「这不是个 feed」。
 */
export function looksLikeFeed(contentType: string, bodyHead: string): boolean {
  const ct = contentType.toLowerCase();
  if (/rss|atom|xml/.test(ct)) return true;
  const head = bodyHead.slice(0, 512).toLowerCase();
  return head.includes("<?xml") || head.includes("<rss") || head.includes("<feed") || head.includes("rdf:rdf");
}
