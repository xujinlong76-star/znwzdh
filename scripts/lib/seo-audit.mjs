/**
 * SEO 运行时审计的纯函数部分（可单测，不做网络请求）。
 *
 * 只做「抓回来的 HTML 是否满足收录底线」这件事：title / description /
 * canonical / robots / h1 / lang / OG / JSON-LD / 站内链接闭环。业务正确性
 * 归各页面的结构测试，这里回答的是部署后真实响应里的表现。
 *
 * `auditPageDetailed` 返回带 kind 的明细（meta / canonical / robots / og /
 * jsonld / links），CLI 用它统计 `ogMissing` 等汇总字段；`auditPage` 保留
 * 纯字符串返回值，给旧调用方和单测用。
 */

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function fromCodePointSafe(value) {
  const code = Number(value);
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCodePointSafe(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => fromCodePointSafe(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** 从 sitemap XML 里取出 URL 列表；只保留 http/https */
export function parseSitemapLocs(xml) {
  const out = [];
  for (const match of String(xml ?? "").matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)) {
    const raw = decodeHtmlEntities(match[1]).trim();
    if (!/^https?:\/\//i.test(raw)) continue;
    out.push(raw);
  }
  return [...new Set(out)];
}

/** 按属性名取 `<meta>` 的 content（name= 与 content= 顺序任意） */
export function metaContent(html, name) {
  const wanted = String(name).toLowerCase();
  for (const tag of String(html ?? "").match(/<meta\b[^>]*>/gi) ?? []) {
    const nameMatch = /\bname\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
    if (!nameMatch || nameMatch[2].trim().toLowerCase() !== wanted) continue;
    const content = /\bcontent\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
    return content ? decodeHtmlEntities(content[2]) : "";
  }
  return null;
}

/** 按 property 取 `<meta>` 的 content（og:url 等） */
export function metaPropertyContent(html, property) {
  const wanted = String(property).toLowerCase();
  for (const tag of String(html ?? "").match(/<meta\b[^>]*>/gi) ?? []) {
    const propMatch = /\bproperty\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
    if (!propMatch || propMatch[2].trim().toLowerCase() !== wanted) continue;
    const content = /\bcontent\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
    return content ? decodeHtmlEntities(content[2]) : "";
  }
  return null;
}

/** `<link rel="...">` 的 href（rel 支持空格分隔的多值） */
export function linkHref(html, relValue) {
  const wanted = String(relValue).toLowerCase();
  for (const tag of String(html ?? "").match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
    if (!rel || !rel[2].toLowerCase().split(/\s+/).includes(wanted)) continue;
    const href = /\bhref\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
    return href ? decodeHtmlEntities(href[2]) : "";
  }
  return null;
}

/**
 * 取所有 `<script type="application/ld+json">` 的原文。
 * 不做实体解码：script 是 raw text，内容里的 `&amp;` 不是 HTML 实体。
 */
export function extractJsonLd(html) {
  const blocks = [];
  const pattern = /<script\b[^>]*\btype\s*=\s*(?:(["'])application\/ld\+json\1|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html ?? "").matchAll(pattern)) {
    blocks.push(match[2].trim());
  }
  return blocks;
}

/** 取所有 `<a href>` 的目标；只解析已带引号的写法（Next 输出如此） */
export function extractAnchors(html) {
  const hrefs = [];
  for (const tag of String(html ?? "").match(/<a\b[^>]*>/gi) ?? []) {
    const href = /\bhref\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
    if (href) hrefs.push(decodeHtmlEntities(href[2]));
  }
  return hrefs;
}


export function analyzeHtml(html, url) {
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ""));
  const langMatch = /<html\b[^>]*\blang\s*=\s*(["'])([\s\S]*?)\1/i.exec(String(html ?? ""));
  return {
    url,
    title: titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : null,
    description: metaContent(html, "description"),
    canonical: linkHref(html, "canonical"),
    robots: metaContent(html, "robots"),
    ogUrl: metaPropertyContent(html, "og:url"),
    ogImage: metaPropertyContent(html, "og:image"),
    ogType: metaPropertyContent(html, "og:type"),
    ogSiteName: metaPropertyContent(html, "og:site_name"),
    ogLocale: metaPropertyContent(html, "og:locale"),
    jsonLd: extractJsonLd(html),
    anchors: extractAnchors(html),
    h1Count: (String(html ?? "").match(/<h1\b[^>]*>/gi) ?? []).length,
    lang: langMatch ? langMatch[2].trim() : null,
  };
}

/** 统一尾斜杠与百分号编码差异，避免把「同一地址的两种写法」误报成 canonical 错 */
export function normalizeUrl(value, base) {
  try {
    const url = new URL(value, base);
    url.hash = "";
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.host}${path}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * 校验 JSON-LD：必须是合法 JSON、声明 schema.org 上下文、节点带 @type；
 * BreadcrumbList / ItemList 的 position 从 1 连续；任何位置禁止 aggregateRating。
 * 返回问题列表。
 */
function auditJsonLdNode(node, add) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const hasGraph = Array.isArray(node["@graph"]);
  const type = node["@type"];
  // @graph 容器可以不带 @type，但子节点必须是可识别的 schema 节点
  if (!hasGraph && (!type || (Array.isArray(type) && type.length === 0))) {
    add("JSON-LD 缺少 @type");
  }
  const types = Array.isArray(type) ? type : type ? [type] : [];
  for (const name of types) {
    if (name !== "BreadcrumbList" && name !== "ItemList") continue;
    const items = Array.isArray(node.itemListElement) ? node.itemListElement : [];
    items.forEach((item, index) => {
      const position = Number(item?.position);
      if (position !== index + 1) {
        add(`JSON-LD ${name} 的 position 应从 1 连续（第 ${index + 1} 项为 ${item?.position ?? "空"}）`);
      }
    });
  }
  if (hasGraph) {
    for (const child of node["@graph"]) auditJsonLdNode(child, add);
  }
}

function findAggregateRating(value, add) {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "aggregateRating")) {
    add("JSON-LD 出现 aggregateRating（禁止编造评分）");
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    findAggregateRating(child, add);
  }
}

export function auditJsonLd(blocks) {
  const issues = [];
  const seen = new Set();
  const add = (message) => {
    if (seen.has(message)) return;
    seen.add(message);
    issues.push(message);
  };

  for (const [index, block] of [...(blocks ?? [])].entries()) {
    let data;
    try {
      data = JSON.parse(block);
    } catch {
      add(`JSON-LD #${index + 1} 不是合法 JSON`);
      continue;
    }
    const roots = Array.isArray(data) ? data : [data];
    if (roots.length === 0) add(`JSON-LD #${index + 1} 为空`);
    for (const root of roots) {
      if (!root || typeof root !== "object" || Array.isArray(root)) {
        add(`JSON-LD #${index + 1} 顶层不是对象`);
        continue;
      }
      const context = root["@context"];
      if (!context || !JSON.stringify(context).includes("schema.org")) {
        add("JSON-LD 缺少 @context 或未声明 schema.org");
      }
      auditJsonLdNode(root, add);
      findAggregateRating(root, add);
    }
  }

  return issues;
}

/**
 * 站内链接闭环：爬虫首轮就要能从 SSR HTML 走到下一层。
 *   /                 → 至少 1 条 `/category/` 链接
 *   /site/*           → 至少 1 条指向其他站点的 `/site/` 链接
 *   /category/<id>    → 至少 1 条 `/site/` 链接
 * 外链、自链、锚点不计入。
 */
export function auditInternalLinks(url, anchors) {
  let page;
  try {
    page = new URL(url);
  } catch {
    return [];
  }
  const path = page.pathname.replace(/\/+$/, "") || "/";
  let match = null;
  let message = null;
  if (path === "/") {
    /**
     * 首页必须有分类入口。
     *
     * 接受 `/category`（总览 hub）与 `/category/{slug}`（达标分类）两种形态：
     * 达标分类不足门槛时，首页目录带会整体隐藏（链到未达标分类就是链到 404），
     * 此时 `/category` 总览是**唯一合法的分类入口**。只认子路径会把
     * 「数据薄但结构正确」的首页误判成内链缺失。
     * 子分类链接是否真的渲染，由 test/home-directory.test.ts 的源码守卫负责。
     */
    match = (hrefPath) => hrefPath === "/category" || hrefPath.startsWith("/category/");
    message = "首页缺少 /category 站内链接";
  } else if (path.startsWith("/site/")) {
    match = (hrefPath) => hrefPath.startsWith("/site/") && (hrefPath.replace(/\/+$/, "") || "/") !== path;
    message = "站点详情缺少相关 /site/ 站内链接";
  } else if (/^\/category\/[^/]+$/.test(path)) {
    match = (hrefPath) => hrefPath.startsWith("/site/");
    message = "分类页缺少 /site/ 站内链接";
  }
  if (!match) return [];

  const found = (anchors ?? []).some((href) => {
    try {
      const target = new URL(href, page);
      if (target.origin !== page.origin) return false;
      return match(target.pathname);
    } catch {
      return false;
    }
  });
  return found ? [] : [message];
}

/**
 * 「图片指向本机、页面不指向本机」= Next 在 metadataBase 缺席时用
 * `http://localhost:3000` 兜底解析出来的地址。审计的 base 本身就是 localhost 时
 * 光看 host 不够（本地/dev 也是 localhost），所以要连端口一起比。
 */
export function isBogusLocalOriginAsset(assetUrl, pageUrl) {
  const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;
  try {
    const asset = new URL(assetUrl, pageUrl);
    const page = new URL(pageUrl);
    if (!LOCAL_HOST_RE.test(asset.hostname)) return false;
    // 真域名页面 + 本机图片：分享图必然打不开，是配置缺失。
    if (!LOCAL_HOST_RE.test(page.hostname)) return true;
    // 两边都是本机但端口不同（页面 :3078、图片 :3000）说明这个地址不是当前服务
    // 解析出来的，而是构建期 metadataBase 兜底值被烤进产物的残留 —— 实测
    // `/algorithms`（当时无 revalidate）三连 HIT 一直是 http://localhost:3000。
    // 端口相同则不报：那是本地/dev 的正常形态，报了就是常年红在无关处。
    return asset.port !== page.port;
  } catch {
    return false;
  }
}

/**
 * 单页收录底线检查的明细版。`kind` 用于 CLI 汇总：
 * meta / canonical / robots / og / jsonld / links。
 */
export function auditPageDetailed(page, { expectIndexable = true } = {}) {
  const issues = [];
  const push = (kind, message) => issues.push({ kind, message });

  if (!page.title) push("meta", "缺少 <title>");
  else if (page.title.length < 4) push("meta", `<title> 过短（${page.title.length} 字符）`);

  if (typeof page.description !== "string" || !page.description.trim()) {
    push("meta", "缺少 meta description");
  }
  if (!page.lang) push("meta", "<html> 缺少 lang");
  if (page.h1Count !== 1) push("meta", `<h1> 数量为 ${page.h1Count}（应为 1）`);

  if (!page.canonical) {
    push("canonical", "缺少 canonical");
  } else {
    const got = normalizeUrl(page.canonical, page.url);
    const want = normalizeUrl(page.url, page.url);
    if (!got || got !== want) push("canonical", `canonical 指向 ${page.canonical}（期望 ${page.url}）`);
  }

  if (expectIndexable && /noindex/i.test(page.robots ?? "")) {
    push("robots", `出现在 sitemap 却声明 noindex（${page.robots}）`);
  }

  if (expectIndexable) {
    if (!page.ogImage) push("og", "缺少 og:image");
    else if (isBogusLocalOriginAsset(page.ogImage, page.url)) {
      // 专防 metadataBase 缺席的那一类静默错误：Next 在没有 metadataBase 时
      // 用 `http://localhost:3000` 兜底解析相对图片地址，于是分享卡的图片指向
      // 一个绝不存在的外域地址。canonical / og:url 不会被兜底（保持相对，
      // 且相对地址已由上面两条比对覆盖），只有 images 会中招。
      // 根因是部署侧没注入 NAVHUB_SITE_URL；构建期首份 ISR 快照也可能暂时如此，
      // 一个 revalidate 周期后自愈，所以这条报「配置/快照」而不是「页面坏了」。
      push(
        "og",
        `og:image 指向本机地址（${page.ogImage}）：NAVHUB_SITE_URL 未注入时 Next 用 http://localhost:3000 兜底 metadataBase；若线上确实配了，说明抓到的是构建期首份快照，等一个 revalidate 周期复查`,
      );
    }
    if (!page.ogType) push("og", "缺少 og:type");
    if (!page.ogSiteName) push("og", "缺少 og:site_name");
    if (!page.ogLocale) push("og", "缺少 og:locale");
  }
  if (page.ogUrl) {
    const og = normalizeUrl(page.ogUrl, page.url);
    const canonical = page.canonical ? normalizeUrl(page.canonical, page.url) : null;
    if (canonical && og !== canonical) push("og", `og:url（${page.ogUrl}）与 canonical 不一致`);
  } else if (expectIndexable) {
    push("og", "缺少 og:url");
  }

  for (const message of auditJsonLd(page.jsonLd ?? [])) push("jsonld", message);

  if (expectIndexable) {
    for (const message of auditInternalLinks(page.url, page.anchors ?? [])) push("links", message);
  }

  return issues;
}

/**
 * 单页收录底线检查。返回问题字符串（空数组 = 通过）。
 * `expectIndexable=false` 用于明确的 noindex 页面（本脚本默认只查 sitemap，
 * 因此 sitemap 里的页面一律期望可索引）。
 */
export function auditPage(page, options) {
  return auditPageDetailed(page, options).map((item) => item.message);
}

/** 从 sitemap 里等距抽样：始终包含首尾，避免只测首页附近 */
export function pickSample(urls, limit) {
  const list = [...new Set(urls ?? [])];
  if (limit <= 0 || list.length <= limit) return list;
  if (limit === 1) return [list[0]];
  const step = (list.length - 1) / (limit - 1);
  const out = [];
  for (let i = 0; i < limit; i++) {
    out.push(list[Math.round(i * step)]);
  }
  return [...new Set(out)];
}
