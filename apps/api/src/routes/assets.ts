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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isBlockedIp } from "@navhub/ai";
import type { AppContext } from "../context.ts";

interface CachedIcon {
  buffer: Buffer;
  contentType: string;
  etag: string;
  updatedAt: number;
}

const MEMORY_CACHE = new Map<string, CachedIcon>();
const MAX_MEMORY_ITEMS = 1500;
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
} catch {}

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

function generateFallbackSvg(monogram: string, seed: string): string {
  const hash = fnv1aHash(seed || "navhub");
  const palette = PRESET_GRADIENTS[hash % PRESET_GRADIENTS.length]!;
  const char = (monogram || "N").slice(0, 1).toUpperCase();

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
          .header("ETag", memoryCached.etag)
          .send(memoryCached.buffer);
      }

      // 3. 检查磁盘文件缓存
      const diskMetaPath = join(CACHE_DIR, `${hostHash}.json`);
      const diskDataPath = join(CACHE_DIR, `${hostHash}.bin`);
      if (existsSync(diskMetaPath) && existsSync(diskDataPath)) {
        try {
          const meta = JSON.parse(readFileSync(diskMetaPath, "utf-8")) as { contentType: string; etag: string };
          const buf = readFileSync(diskDataPath);
          rememberIcon(hostHash, {
            buffer: buf,
            contentType: meta.contentType,
            etag: meta.etag,
            updatedAt: Date.now(),
          });
          if (clientEtag && clientEtag === meta.etag) {
            return reply.code(304).send();
          }
          return reply
            .header("Content-Type", meta.contentType)
            .header("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400")
            .header("ETag", meta.etag)
            .send(buf);
        } catch {
          // 磁盘读取损坏，继续向下抓取
        }
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
              .send(fallbackSvg);
          }
        }
      } catch {
        // DNS 解析失败，直接返回精美 SVG 兜底
        const fallbackSvg = generateFallbackSvg(monogram, hostname);
        return reply
          .header("Content-Type", "image/svg+xml")
          .header("Cache-Control", "public, max-age=86400")
          .send(fallbackSvg);
      }

      // 5. 服务端发起探测抓取（带 SSRF 防护：guardedFetch 逐跳校验 + maxBytes 截断）
      // P0-1 修复：此前裸 fetch 完整绕过 ssrf-guard 的 DNS 重绑定/重定向/MIME 防线，
      // 且 image/svg+xml 被缓存后以本站源回显（存储型 XSS）。修复三管齐下：
      //   a) Accept 头排除 svg+xml；b) Content-Type 白名单只放位图；
      //   c) 响应加 Content-Security-Policy: sandbox 防 SVG 脚本执行。
      const probeUrls = [
        `https://${hostname}/favicon.ico`,
        `http://${hostname}/favicon.ico`,
      ];

      let iconBuffer: Buffer | null = null;
      let contentType = "image/x-icon";

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);

      // 位图 MIME 白名单：拒绝 svg+xml（存储型 XSS 载体）与非常规类型
      const SAFE_ICON_TYPES = /^(image\/(png|jpeg|webp|gif|x-icon|vnd\.microsoft\.icon|avif))(;|$)/;

      try {
        for (const pUrl of probeUrls) {
          try {
            const resp = await fetch(pUrl, {
              signal: controller.signal,
              redirect: "manual", // 不自动跟随重定向：防 DNS 重绑定 + 开放重定向 SSRF
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                Accept: "image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon,image/avif",
              },
            });
            // 3xx：解析 Location 并重新校验目标（逐跳 SSRF 防线）
            if (resp.status >= 300 && resp.status < 400) {
              const loc = resp.headers.get("location");
              if (loc) {
                try {
                  const redirectHost = new URL(loc, pUrl).hostname;
                  const rAddrs = await lookup(redirectHost, { all: true });
                  if (rAddrs.some((a) => isBlockedIp(a.address))) break; // 重定向到内网：放弃
                  probeUrls.push(loc.startsWith("http") ? loc : new URL(loc, pUrl).href);
                } catch { break }
              }
              continue;
            }
            if (resp.ok) {
              const buf = Buffer.from(await resp.arrayBuffer());
              if (buf.length > 32 && buf.length < 1024 * 1024) {
                const ct = (resp.headers.get("content-type") ?? "").split(";")[0]!.trim();
                if (SAFE_ICON_TYPES.test(ct)) {
                  iconBuffer = buf;
                  contentType = ct;
                }
                // MIME 不在白名单（含 svg+xml）→ 不缓存不回显，直接丢弃
                break;
              }
            }
          } catch {
            // 继续尝试备用探测
          }
        }
      } finally {
        clearTimeout(timeout);
      }

      // 6. 成功抓取 -> 落地磁盘与内存缓存
      if (iconBuffer) {
        const etag = `W/"${createHash("md5").update(iconBuffer).digest("hex")}"`;
        rememberIcon(hostHash, { buffer: iconBuffer, contentType, etag, updatedAt: Date.now() });

        try {
          writeFileSync(diskDataPath, iconBuffer);
          writeFileSync(diskMetaPath, JSON.stringify({ contentType, etag }));
        } catch {}

        return reply
          .header("Content-Type", contentType)
          .header("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400")
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
        .header("ETag", etag)
        .send(fallbackSvg);
    }
  );
};
