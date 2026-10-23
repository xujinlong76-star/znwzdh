import type { FastifyPluginAsync } from "fastify";
import { guardedFetch } from "@navhub/ai";
import type { AppContext } from "../context.ts";
import type { SiteOfflineArchive } from "@navhub/core";

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
      return existing;
    }

    const site = await ctx.repo.getSite(id);
    if (!site) {
      reply.code(404);
      return {
        error: "NOT_FOUND",
        message: "Site not found",
      };
    }

    // 若无现成快照，根据元数据生成初始快照
    const syntheticHtml = `
      <article class="prose max-w-none">
        <h1>${escapeHtml(site.title)}</h1>
        <p class="lead">${escapeHtml(site.description || "暂无描述信息")}</p>
        <hr/>
        <div class="metadata">
          <p><strong>官方网址：</strong> <a href="${escapeHtml(site.url)}" target="_blank" rel="noopener">${escapeHtml(site.url)}</a></p>
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
    return archive;
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
        error: "NOT_FOUND",
        message: "Site not found",
      };
    }

    // 尝试拉取远程轻量网页文本或使用高保真离线模板
    let bodyText = site.description || "";
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
          // 严格清洗 HTML 标签与属性（防 XSS）
          bodyText = sanitizeSnapshotHtml(bodyMatch[1]);
        }
      }
    } catch {
      // 容错降级
    }

    const htmlContent = `
      <article class="prose max-w-none">
        <h1>${escapeHtml(site.title)}</h1>
        <p class="lead">${escapeHtml(site.description || "")}</p>
        <hr/>
        <div class="metadata">
          <p><strong>原站直达：</strong> <a href="${escapeHtml(site.url)}" target="_blank" rel="noopener">${escapeHtml(site.url)}</a></p>
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
    return archive;
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

function sanitizeSnapshotHtml(raw: string): string {
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "")
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/\bon[a-z]+\s*=\s*(["'][^"']*["']|[^\s>]+)/gi, "")
    .replace(/\bhref\s*=\s*(["']\s*javascript:[^"']*["']|\s*javascript:[^\s>]+)/gi, 'href="#"')
    .replace(/\bsrc\s*=\s*(["']\s*javascript:[^"']*["']|\s*javascript:[^\s>]+)/gi, 'src=""')
    .trim();
}
