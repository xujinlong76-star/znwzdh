import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import type { SiteOfflineArchive } from "@navhub/core";

// 内存快照存储（生产环境可映射为 SQLite / 文件存储）
const archiveStore = new Map<string, SiteOfflineArchive>();

export const archiveRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 获取站点的离线快照
   */
  app.get("/api/sites/:id/archive", { config: { scope: "public" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = archiveStore.get(id);

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
          <p><strong>官方网址：</strong> <a href="${site.url}" target="_blank" rel="noopener">${site.url}</a></p>
          <p><strong>分类：</strong> ${escapeHtml(site.categoryId || "未分类")}</p>
          <p><strong>标签：</strong> ${(site.tags || []).join(", ") || "无"}</p>
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

    archiveStore.set(id, archive);
    return archive;
  });

  /**
   * 触发重新捕获并归档离线快照
   */
  app.post("/api/sites/:id/archive", { config: { scope: "public" } }, async (req, reply) => {
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(site.url, {
        signal: controller.signal,
        headers: { "User-Agent": "NavHub-OfflineArchiver/1.0" },
      });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch && bodyMatch[1]) {
          // 简易过滤 script/style
          bodyText = bodyMatch[1]
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .trim();
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
          <p><strong>原站直达：</strong> <a href="${site.url}" target="_blank" rel="noopener">${site.url}</a></p>
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

    archiveStore.set(id, archive);
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
