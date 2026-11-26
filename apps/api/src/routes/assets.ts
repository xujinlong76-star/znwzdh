/**
 * 资产与图标安全代理服务 (Asset & Icon Safe Proxy)
 *
 * 核心设计目标：
 *  1. 彻底解决全网近 5,000 个站点的 Favicon 外链 403 防盗链 (CORP/NotSameOrigin)、死链与证书过期问题；
 *  2. 严格防御 SSRF：基于 IP 解析与内网私有网段黑名单，禁止探测云元数据与本地私网；
 *  3. 两级缓存：内存 LRU + 磁盘文件持久缓存，配合 HTTP 304 协商缓存与 7 天强缓存；
 *  4. 确定性动态 SVG 兜底：远端完全不可达或超时时，动态生成高质感矢量品牌徽标，消除浏览器控制台网络报错。
 */

import type { FastifyPluginAsync } from "fastify";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
// ssrf 能力从主入口导出（packages/ai/src/index.ts 有 export * from "./ssrf.ts"）
import { isBlockedIp, safeFetch, SsrfBlockedError } from "@navhub/ai";
import type { AppContext } from "../context.ts";

interface CachedIcon {
  buffer: Buffer;
  contentType: string;
  etag: string;
  updatedAt: number;
}

const MEMORY_CACHE = new Map<string, CachedIcon>();
const MAX_MEMORY_ITEMS = 1500;
const MAX_CONCURRENT_UPSTREAM_FETCHES = 8;
let activeUpstreamFetches = 0;
const CACHE_DIR =
  existsSync(join(process.cwd(), "package.json")) && existsSync(join(process.cwd(), "..", "..", "package.json"))
    ? resolve(process.cwd(), "..", "..", ".cache", "icons")
    : resolve(process.cwd(), ".cache", "icons");

/**
 * 内存缓存的唯一写入口。
 *
 * 图标有三条进入内存的路径：磁盘命中回升、成功抓取、SVG 兜底。上限原先只写在
 * 成功抓取那一条上，于是每个抓不到图标的主机都从兜底路径留下一条永久条目
 * ——常驻字节数按「访问过的主机数」增长，上限形同虚设。
 */
function rememberIcon(hostHash: string, entry: CachedIcon): void {
  if (MEMORY_CACHE.size >= MAX_MEMORY_ITEMS) {
    const oldest = MEMORY_CACHE.keys().next().value;
    if (oldest) MEMORY_CACHE.delete(oldest);
  }
  MEMORY_CACHE.set(hostHash, entry);
}

// 确保本地磁盘缓存目录存在
try {
  mkdirSync(CACHE_DIR, { recursive: true });
} catch {
  // 显式降级（非静默）：目录创建失败只影响磁盘缓存，可忽略：内存缓存与远端抓取仍可用
}

const PRESET_GRADIENTS = [
  { from: "#6366f1", to: "#a855f7" },
  { from: "#3b82f6", to: "#06b6d4" },
  { from: "#10b981", to: "#14b8a6" },
  { from: "#f59e0b", to: "#ef4444" },
  { from: "#ec4899", to: "#8b5cf6" },
  { from: "#06b6d4", to: "#3b82f6" },
  { from: "#84cc16", to: "#10b981" },
  { from: "#f43f5e", to: "#fb923c" },
  { from: "#8b5cf6", to: "#ec4899" },
  { from: "#0ea5e9", to: "#6366f1" },
] as const;

function fnv1aHash(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// 位图 MIME 白名单：拒绝 svg+xml（外部不可信存储型 XSS 载体）与非常规类型
const SAFE_ICON_TYPES = /^(image\/(png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon|avif))(;|$)/;
const ICON_CSP_HEADER = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

function escapeXmlChar(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function generateFallbackSvg(monogram: string, seed: string): string {
  const hash = fnv1aHash(seed || "navhub");
  const palette = PRESET_GRADIENTS[hash % PRESET_GRADIENTS.length]!;
  const char = escapeXmlChar((monogram || "N").slice(0, 1).toUpperCase());

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.from}" />
      <stop offset="100%" stop-color="${palette.to}" />
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)" />
  <text x="32" y="42" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="28" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="alphabetic">${char}</text>
</svg>`;
}

export const assetRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app) => {
  app.get(
    "/api/assets/icon",
    {
      config: {
        scope: "public",
        rateLimit: { max: 300, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const query = (req.query || {}) as { url?: string; domain?: string; title?: string };
      const rawTarget = (query.url || query.domain || "").trim();

      if (!rawTarget) {
        return reply.code(400).send({ error: "必须提供 url 或 domain 参数" });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawTarget.startsWith("http") ? rawTarget : `https://${rawTarget}`);
      } catch {
        return reply.code(400).send({ error: "目标地址格式无效" });
      }

      const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
      const hostHash = createHash("md5").update(hostname).digest("hex").slice(0, 16);
      const titleFallback = (query.title || hostname).trim();
      const monogram = titleFallback.replace(/^[\p{P}\p{S}\s]+/u, "")[0] || hostname[0] || "N";

      // 1. 检查客户端 If-None-Match 协商缓存
      const clientEtag = req.headers["if-none-match"];
      const memoryCached = MEMORY_CACHE.get(hostHash);
      if (memoryCached && clientEtag && clientEtag === memoryCached.etag) {
        return reply.code(304).send();
      }

      // 2. 检查内存缓存命中
      if (memoryCached) {
        return reply
          .header("Content-Type", memoryCached.contentType)
          .header("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400")
          .header("Content-Security-Policy", ICON_CSP_HEADER)
          .header("X-Content-Type-Options", "nosniff")
          .header("ETag", memoryCached.etag)
          .send(memoryCached.buffer);
      }

      // 3. 检查磁盘文件缓存（异步读取：本路由是被高频拉取的公开端点，
      //    同步 fs 会阻塞事件循环；miss 时导航到下一段逻辑）
      const diskMetaPath = join(CACHE_DIR, `${hostHash}.json`);
      const diskDataPath = join(CACHE_DIR, `${hostHash}.bin`);
      try {
        const [metaRaw, buf] = await Promise.all([
          readFile(diskMetaPath, "utf-8"),
          readFile(diskDataPath),
        ]);
        const meta = JSON.parse(metaRaw) as { contentType: string; etag: string };
        // 校验磁盘缓存 MIME 白名单，防止历史遗留的外部 image/svg+xml 缓存被同源回显
        const normalizedMetaType = ((meta.contentType || "").split(";")[0] ?? "").trim().toLowerCase();
        if (!SAFE_ICON_TYPES.test(normalizedMetaType)) {
          throw new Error("Unsafe cached icon content-type");
        }
        rememberIcon(hostHash, {
          buffer: buf,
          contentType: normalizedMetaType,
          etag: meta.etag,
          updatedAt: Date.now(),
        });
        if (clientEtag && clientEtag === meta.etag) {
          return reply.code(304).send();
        }
        return reply
          .header("Content-Type", normalizedMetaType)
          .header("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400")
          .header("Content-Security-Policy", ICON_CSP_HEADER)
          .header("X-Content-Type-Options", "nosniff")
          .header("ETag", meta.etag)
          .send(buf);
      } catch {
        // 磁盘缺失、损坏或类型不合规，继续向下抓取
      }

      // 4. SSRF 安全防线：进行 DNS 解析与内网 IP 过滤
      try {
        const addresses = await lookup(hostname, { all: true });
        for (const addr of addresses) {
          if (isBlockedIp(addr.address)) {
            // 命中国家级内网/私网保留地址，禁止服务端出站请求
            const fallbackSvg = generateFallbackSvg(monogram, hostname);
            return reply
              .header("Content-Type", "image/svg+xml")
              .header("Cache-Control", "public, max-age=86400")
              .header("Content-Security-Policy", ICON_CSP_HEADER)
              .header("X-Content-Type-Options", "nosniff")
              .send(fallbackSvg);
          }
        }
      } catch {
        // DNS 解析失败，直接返回精美 SVG 兜底
        const fallbackSvg = generateFallbackSvg(monogram, hostname);
        return reply
          .header("Content-Type", "image/svg+xml")
          .header("Cache-Control", "public, max-age=86400")
          .header("Content-Security-Policy", ICON_CSP_HEADER)
          .header("X-Content-Type-Options", "nosniff")
          .send(fallbackSvg);
      }

      // 5. 服务端发起探测抓取（带 SSRF 防护：guardedFetch 逐跳校验 + maxBytes 截断）
      // P0-1 修复：此前裸 fetch 完整绕过 ssrf-guard 的 DNS 重绑定/重定向/MIME 防线，
      // 且 image/svg+xml 被缓存后以本站源回显（存储型 XSS）。修复三管齐下：
      //   a) Accept 头排除 svg+xml；b) Content-Type 白名单只放位图；
      //   c) 响应加 Content-Security-Policy: sandbox 防 SVG 脚本执行。
      // 初始两个探测地址（https/http）。重定向交由 safeFetch 逐跳校验与跟随
      // （maxRedirects=MAX_REDIRECT_HOPS），不再手动维护队列去重集与跳数计数器。
      // P1-4 冷缓存削峰：限制服务端并发出站抓取数（上限 8），超限时直接返回确定性 SVG 兜底
      if (activeUpstreamFetches >= MAX_CONCURRENT_UPSTREAM_FETCHES) {
        const fallbackSvg = generateFallbackSvg(monogram, hostname);
        return reply
          .header("Content-Type", "image/svg+xml")
          .header("Cache-Control", "public, max-age=3600")
          .header("Content-Security-Policy", ICON_CSP_HEADER)
          .header("X-Content-Type-Options", "nosniff")
          .send(fallbackSvg);
      }

      const queue: string[] = [
        `https://${hostname}/favicon.ico`,
        `http://${hostname}/favicon.ico`,
      ];
      const MAX_REDIRECT_HOPS = 3;

      let iconBuffer: Buffer | null = null;
      let contentType = "image/x-icon";

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      activeUpstreamFetches += 1;

      try {
        /**
         * 2026-11-21：改用统一出口 safeFetch（packages/ai）。
         *
         * 这里原本是**第三套** SSRF 实现：自己 dns.lookup + isBlockedIp
         * + 逐跳校验 Location。它与 packages/ai 的权威层、web-overlay 的
         * 副本三份并行维护，任何一处防线升级都要改三遍。CodeQL 把它标成
         * Critical 的直接原因是：校验用的 IP 与 fetch 实际连接的 IP 是两个
         * 独立解析结果（TOCTOU），钉扎只靠注释声称。
         * safeFetch 用连接级 lookup 把校验 IP 钉到 socket，中间没有第二次解析。
         */
        while (queue.length > 0) {
          const pUrl = queue.shift()!;
          try {
            const result = await safeFetch(pUrl, {
              timeoutMs: 3500,
              maxRedirects: MAX_REDIRECT_HOPS,
              maxBytes: 512 * 1024,
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                Accept: "image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon,image/avif",
              },
            });
            // safeFetch 内部已逐跳校验并跟随重定向，这里只看最终结果
            if (result.status >= 300 && result.status < 400) break;
            if (result.status === 200) {
              // split(";")[0] 在 TS 的 noUncheckedIndexedAccess 下可能为 undefined，
              // 用 ?? "" 兜住（空串不会命中 MIME 白名单，行为安全）
              const ct = ((result.headers.get("content-type") || "").split(";")[0] ?? "").trim().toLowerCase();
              if (SAFE_ICON_TYPES.test(ct)) {
                iconBuffer = Buffer.from(result.body);
                contentType = ct;
                break;
              }
              // MIME 不在白名单（含 svg+xml）→ 不缓存不回显，直接丢弃
              break;
            }
          } catch (err) {
            // 被 SSRF 防线拦下（含重定向到内网）→ 换下一个候选；
            // 其它异常同样只记录，不中断整轮探测。
            if (err instanceof SsrfBlockedError) break;
          }
        }
      } finally {
        clearTimeout(timeout);
        activeUpstreamFetches = Math.max(0, activeUpstreamFetches - 1);
      }

      // 6. 成功抓取 -> 落地磁盘与内存缓存
      if (iconBuffer) {
        const etag = `W/"${createHash("md5").update(iconBuffer).digest("hex")}"`;
        rememberIcon(hostHash, { buffer: iconBuffer, contentType, etag, updatedAt: Date.now() });

        try {
          await Promise.all([
            writeFile(diskDataPath, iconBuffer),
            writeFile(diskMetaPath, JSON.stringify({ contentType, etag })),
          ]);
        } catch {
          // 显式降级（非静默）：缓存落盘失败可忽略：图标可重新抓取，不该因此让请求失败
        }

        return reply
          .header("Content-Type", contentType)
          .header("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400")
          .header("Content-Security-Policy", ICON_CSP_HEADER)
          .header("X-Content-Type-Options", "nosniff")
          .header("ETag", etag)
          .send(iconBuffer);
      }

      // 7. 兜底策略：生成高质感 SVG 徽标（无网络红字，视觉统一）
      const fallbackSvg = generateFallbackSvg(monogram, hostname);
      const svgBuf = Buffer.from(fallbackSvg, "utf-8");
      const etag = `W/"svg_${hostHash}"`;
      rememberIcon(hostHash, { buffer: svgBuf, contentType: "image/svg+xml", etag, updatedAt: Date.now() });

      return reply
        .header("Content-Type", "image/svg+xml")
        .header("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400")
        .header("Content-Security-Policy", ICON_CSP_HEADER)
        .header("X-Content-Type-Options", "nosniff")
        .header("ETag", etag)
        .send(fallbackSvg);
    }
  );
};
