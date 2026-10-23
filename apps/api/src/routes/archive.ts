import type { FastifyPluginAsync } from "fastify";
import { guardedFetch } from "@navhub/ai";
import type { AppContext } from "../context.ts";
import type { SiteOfflineArchive } from "@navhub/core";

function enrichArchiveForClient(archive: SiteOfflineArchive) {
  const plainText = extractPlainTextFromHtml(archive.htmlContent, archive.title, archive.excerpt);
  return {
    ...archive,
    plainText,
    contentLength: plainText.length || archive.byteSize || archive.htmlContent.length,
    meta: {
      description: archive.excerpt || undefined,
      keywords: Array.isArray(archive.tags) ? archive.tags : [],
    },
  };
}

export const archiveRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 获取站点的离线快照
   */
  app.get(
    "/api/sites/:id/archive",
    {
      config: {
        scope: "public",
        rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 60, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await ctx.repo.getLatestSiteArchive(id);

    if (existing) {
      const enriched = enrichArchiveForClient(existing);
      return {
        ok: true,
        archive: enriched,
        ...enriched,
      };
    }

    const site = await ctx.repo.getSite(id);
    if (!site) {
      reply.code(404);
      return {
        ok: false,
        error: "NOT_FOUND",
        message: "Site not found",
      };
    }

    const safeSiteUrl = /^https?:\/\//i.test(site.url) ? site.url : "#";

    // 若无现成快照，根据元数据生成初始快照
    const syntheticHtml = `
      <article class="prose max-w-none">
        <h1>${escapeHtml(site.title)}</h1>
        <p class="lead">${escapeHtml(site.description || "暂无描述信息")}</p>
        <hr/>
        <div class="metadata">
          <p><strong>官方网址：</strong> <a href="${escapeHtml(safeSiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(site.url)}</a></p>
          <p><strong>分类：</strong> ${escapeHtml(site.categoryId || "未分类")}</p>
          <p><strong>标签：</strong> ${(site.tags || []).map((t) => escapeHtml(String(t))).join(", ") || "无"}</p>
        </div>
        <section class="mt-4">
          <h2>关于 ${escapeHtml(site.title)}</h2>
          <p>该文档快照由 NavHub Local-First 离线文档归档引擎于 ${new Date().toLocaleString()} 自动生成并存证。</p>
          <p>支持断网离线无损查阅、SingleFile HTML 导出与纯文本 Markdown 提取。</p>
        </section>
      </article>
    `.trim();

    const archive: SiteOfflineArchive = {
      siteId: site.id,
      title: site.title,
      url: site.url,
      capturedAt: Date.now(),
      excerpt: site.description || "离线快照文档",
      readTimeMinutes: Math.max(1, Math.ceil((syntheticHtml.length / 500))),
      htmlContent: syntheticHtml,
      byteSize: Buffer.byteLength(syntheticHtml, "utf8"),
      tags: site.tags || [],
    };

    await ctx.repo.saveSiteArchive(archive);
    const enriched = enrichArchiveForClient(archive);
    return {
      ok: true,
      archive: enriched,
      ...enriched,
    };
  });

  /**
   * 触发重新捕获并归档离线快照
   */
  app.post(
    "/api/sites/:id/archive",
    {
      config: {
        scope: "public",
        rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 20, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);

    if (!site) {
      reply.code(404);
      return {
        ok: false,
        error: "NOT_FOUND",
        message: "Site not found",
      };
    }

    // 尝试拉取远程轻量网页文本或使用高保真离线模板
    let bodyText = escapeHtml(site.description || "");
    try {
      /**
       * 必须走 guardedFetch，不能直接 fetch(site.url)：
       * 这个端点 scope=public，站点 URL 又可由写入方自由指定（canonicalizeUrl 只做归一，
       * 不拦私网）。裸 fetch 等于把「让服务端访问任意地址并把响应存库再公开读出」
       * 的能力暴露给匿名用户（典型目标是 169.254.169.254 云元数据与内网管理台）。
       * 逐跳 SSRF 校验 + 超时 + 响应体上限都交给同一个守卫。
       */
      const res = await guardedFetch(site.url, {
        timeoutMs: 3000,
        maxBytes: 256 * 1024,
        maxRedirects: 2,
        allowPrivateNetworks: ctx.config.fetch.allowPrivateNetworks,
      });
      if (res.status >= 200 && res.status < 300) {
        const text = res.body;
        const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch && bodyMatch[1]) {
          // 严格清洗 HTML 标签与属性（防存储型/导出型 XSS）
          bodyText = sanitizeSnapshotHtml(bodyMatch[1]);
        }
      }
    } catch {
      // 容错降级
    }

    const safeSiteUrl = /^https?:\/\//i.test(site.url) ? site.url : "#";

    const htmlContent = `
      <article class="prose max-w-none">
        <h1>${escapeHtml(site.title)}</h1>
        <p class="lead">${escapeHtml(site.description || "")}</p>
        <hr/>
        <div class="metadata">
          <p><strong>原站直达：</strong> <a href="${escapeHtml(safeSiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(site.url)}</a></p>
          <p><strong>快照生成时间：</strong> ${new Date().toLocaleString()}</p>
        </div>
        <div class="archive-body mt-4">
          ${bodyText || `<p>${escapeHtml(site.title)} 离线核心索引存档已就绪。</p>`}
        </div>
      </article>
    `.trim();

    const archive: SiteOfflineArchive = {
      siteId: site.id,
      title: site.title,
      url: site.url,
      capturedAt: Date.now(),
      excerpt: site.description || "最新离线快照",
      readTimeMinutes: Math.max(1, Math.ceil((htmlContent.length / 500))),
      htmlContent,
      byteSize: Buffer.byteLength(htmlContent, "utf8"),
      tags: site.tags || [],
    };

    await ctx.repo.saveSiteArchive(archive);
    const enriched = enrichArchiveForClient(archive);
    return {
      ok: true,
      archive: enriched,
      ...enriched,
    };
  });
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function unescapeBasicEntities(str: string): string {
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'");
}

/**
 * 从清洗后的离线快照 HTML 提炼结构化纯文本段落（供阅读器沉浸模式与 Markdown 导出使用）
 */
export function extractPlainTextFromHtml(html: string, fallbackTitle = "", fallbackExcerpt = ""): string {
  if (!html) {
    return [fallbackTitle ? `# ${fallbackTitle}` : "", fallbackExcerpt].filter(Boolean).join("\n\n");
  }
  const structured = html
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n")
    .replace(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi, "\n\n## $1\n\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1\n")
    .replace(/<\/(p|div|section|article|header|tr|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const paragraphs = unescapeBasicEntities(structured)
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return [fallbackTitle ? `# ${fallbackTitle}` : "", fallbackExcerpt].filter(Boolean).join("\n\n");
  }
  return paragraphs.join("\n\n");
}

/**
 * 解码 HTML 数字/命名实体并剔除空白控制符，用于识别绕过型伪协议（如 &#106;avascript:）
 */
function decodeHtmlEntitiesForSchemeCheck(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : "";
    })
    .replace(/&#(\d+);?/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(Math.min(code, 0x10ffff)) : "";
    })
    .replace(/&(colon|tab|newline);?/gi, (m) => (m.toLowerCase().startsWith("&colon") ? ":" : ""))
    .replace(/[\u0000-\u0020]+/g, "")
    .toLowerCase();
}

function isDangerousUriAttrValue(rawVal: string): boolean {
  const unquoted = rawVal.trim().replace(/^["'`]|["'`]$/g, "");
  const normalized = decodeHtmlEntitiesForSchemeCheck(unquoted);
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("vbscript:") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("file:") ||
    normalized.startsWith("blob:")
  );
}

/**
 * 严格清洗离线快照 HTML（防范 <svg onload>, 实体编码伪协议, srcdoc, 孤立未闭合 <script 等 XSS 向量）
 */
export function sanitizeSnapshotHtml(raw: string): string {
  return raw
    // 1. 移除 HTML 注释
    .replace(/<!--[\s\S]*?-->/g, "")
    // 2. 移除高危成对标签及其内部全部内容
    .replace(/<(script|style|iframe|frame|frameset|object|embed|applet|form|svg|math|template|noscript|textarea|audio|video)\b[\s\S]*?<\/\1\s*>/gi, "")
    // 3. 兜底移除任何残留的同名开/闭标签或自闭合危险标签（防未闭合 <script src=...> 等绕过）
    .replace(/<\/?\s*(script|style|iframe|frame|frameset|object|embed|applet|form|svg|math|template|noscript|textarea|audio|video|source|track|base|meta|link|input|button|select|option)\b[^>]*>/gi, "")
    // 4. 移除所有内联事件处理器属性（on* = "..." / '...' / `...` / 无引号值）
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s>"'`]+)/gi, "")
    // 5. 移除 srcdoc / formaction 等可直接注入代码或跳转的属性
    .replace(/\s+(?:srcdoc|formaction|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s>"'`]+)/gi, "")
    // 6. 清洗 href / src / action / data 属性中的危险伪协议（含 HTML 实体混淆）
    .replace(
      /\b(href|src|action|data)\s*=\s*("[^"]*"|'[^']*'|`[^`]*`|[^\s>"'`]+)/gi,
      (full, attrName: string, rawVal: string) => {
        if (isDangerousUriAttrValue(rawVal)) {
          return attrName.toLowerCase() === "href" ? 'href="#"' : `${attrName}=""`;
        }
        return full;
      }
    )
    .trim();
}
