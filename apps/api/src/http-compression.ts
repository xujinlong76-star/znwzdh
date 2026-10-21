/**
 * 响应压缩（gzip）。
 *
 * 为什么需要：中枢的 JSON 响应体量很不均匀——插件市场列表一页 24 条，
 * 每条都带完整 manifest，单次响应 **1.16MB**（实测 `content-length:
 * 1157817`）。默认部署（docker-compose 双服务）没有反向代理压缩，
 * 这 1.16MB 是原样走网络的；移动端弱网下就是数秒白屏。
 *
 * 为什么不引 `@fastify/compress`：
 *  - 依赖面：本项目刻意保持「核心零额外依赖」（安全头、指标、限流都是手写/官方插件）；
 *  - 需求面：我们只需要「JSON 文本 > 1KB 时 gzip」，不需要 brotli 协商、
 *    流式压缩、阈值按路由配置这些能力。
 *  30 行的 onSend 钩子即可覆盖，且行为完全可读。
 *
 * 刻意不压缩的响应：
 *  - `text/event-stream`（SSE）：压缩会把事件缓冲在压缩窗口里，心跳与任务
 *    事件将不再实时——这是功能问题，不是性能取舍；
 *  - 已有 `content-encoding` 的响应（上游/下游任一环节已压过，重复压会直接损坏）；
 *  - 流式 payload（Buffer/string 之外的 Readable）：钩子里拿不到完整体，
 *    交给 Node 自己处理；
 *  - 304/204 与 HEAD：没有实体，压缩无意义。
 */
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";

const gzipAsync = promisify(gzip);

/** 小于该字节数的响应压了反而更大（gzip 头 + 压缩率不足） */
const MIN_COMPRESS_BYTES = 1024;

/** gzip 级别：6 是压缩率/CPU 的常用折中（1.16MB JSON 实测约 6~10ms） */
const GZIP_LEVEL = 6;

/** 可压缩的 content-type 前缀（SSE 单独排除，见文件头注释） */
function isCompressibleType(contentType: string): boolean {
  const type = contentType.toLowerCase();
  if (!type) return false;
  if (type.includes("text/event-stream")) return false;
  return (
    type.startsWith("application/json") ||
    type.startsWith("application/javascript") ||
    type.startsWith("text/") ||
    type.startsWith("image/svg+xml")
  );
}

/** 客户端是否接受 gzip（q=0 视为拒绝，遵循 RFC 9110） */
function acceptsGzip(header: string | undefined): boolean {
  if (!header) return false;
  // RFC 9110：显式列出的编码优先于 `*`。所以不能「先遇到谁就返回谁」——
  // `*;q=0, gzip` 里通配符排在前面，会被误判成拒绝；`gzip;q=0, *` 则相反。
  let explicit: number | null = null;
  let wildcard: number | null = null;
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (name !== "gzip" && name !== "*") continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const parsed = qParam ? Number(qParam.slice(2)) : 1;
    const quality = Number.isFinite(parsed) ? parsed : 1;
    if (name === "gzip") {
      // 同一编码重复出现时取最高的 q（宽松处理，避免受头顺序影响）
      if (explicit === null || quality > explicit) explicit = quality;
    } else if (wildcard === null || quality > wildcard) {
      wildcard = quality;
    }
  }
  if (explicit !== null) return explicit > 0;
  return wildcard !== null && wildcard > 0;
}

/**
 * 注册 gzip 压缩钩子。
 *
 * 必须在 `app.listen()` / `app.ready()` **之前**调用：Fastify 在 ready 时
 * 固化插件树与钩子链，之后追加的根级钩子不会再应用到已注册的子插件路由。
 */
export function registerCompression(app: FastifyInstance): void {
  app.addHook("onSend", async (req, reply, payload) => {
    // 只处理能拿到完整实体的响应
    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return payload;
    if (req.method === "HEAD") return payload;
    if (reply.statusCode === 204 || reply.statusCode === 304) return payload;

    // 已编码（例如上游代理压过）就不再动，否则会二次压缩损坏内容
    if (reply.getHeader("content-encoding")) return payload;

    if (!isCompressibleType(String(reply.getHeader("content-type") ?? ""))) return payload;
    if (!acceptsGzip(req.headers["accept-encoding"] as string | undefined)) return payload;

    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
    if (body.length < MIN_COMPRESS_BYTES) return payload;

    let compressed: Buffer;
    try {
      compressed = await gzipAsync(body, { level: GZIP_LEVEL });
    } catch {
      // 压缩失败不能影响响应本身：原样返回未压缩体
      return payload;
    }
    // 极小概率压完更大（已高度随机的短文本）：此时保留原体更划算
    if (compressed.length >= body.length) return payload;

    reply.header("content-encoding", "gzip");
    // Vary 必须累加而不是覆盖：CORS 钩子已经写了 `Vary: Origin`，
    // 覆盖掉会让共享缓存把「A 源的响应」复用给「B 源」。
    const vary = String(reply.getHeader("vary") ?? "").trim();
    if (!/\baccept-encoding\b/i.test(vary)) {
      reply.header("vary", vary ? `${vary}, accept-encoding` : "accept-encoding");
    }
    // 长度由 Fastify 按新 payload 重新计算；残留旧值会让客户端读少/读多字节
    reply.removeHeader("content-length");
    return compressed;
  });
}
