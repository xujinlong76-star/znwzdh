/**
 * SSRF 防护。
 *
 * 这是本系统唯一的「用户可控输入 -> 服务端发起网络请求」路径（AI 富化时抓取用户提交的 URL），
 * 也是最容易被忽视的高危点。防护分三层：
 *
 *   1. **协议白名单**：只允许 http/https（挡掉 file:// gopher:// 等）。
 *   2. **解析后校验**（关键）：先 DNS 解析，再检查每个解析结果的 IP 是否落在
 *      环回 / 私网 / 链路本地 / 唯一本地 / 保留网段。
 *      ⚠️ 只校验 URL 字符串是不够的 —— 攻击者可用 127.0.0.1.nip.io 这类
 *      域名解析到内网，必须看解析后的真实 IP。
 *   3. **重定向逐跳校验**：手动跟随重定向，每一跳都重新做 DNS + IP 校验，
 *      否则 https://evil.com -> 302 -> http://169.254.169.254/ 就绕过了校验。
 *
 * 另外限制超时、响应体大小与重定向跳数，避免被慢速/超大响应拖死。
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface FetchGuardOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  /** 显式放行私网（仅本地开发/NAS 内网导航站需要） */
  allowPrivateNetworks: boolean;
  userAgent: string;
}

export const DEFAULT_GUARD: FetchGuardOptions = {
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  allowPrivateNetworks: false,
  userAgent: "NavHubBot/0.1 (+https://github.com/navhub)",
};

export class SsrfBlockedError extends Error {
  /** 显式字段（不用参数属性语法：Node 的 strip-only 模式不支持） */
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "SsrfBlockedError";
    this.reason = reason;
  }
}

export const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** 判断一个 IP 是否属于「不应该被服务端主动访问」的网段 */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  // 不是合法 IP 一律视为不安全
  return true;
}

export function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];

  if (a === 0) return true;                          // 0.0.0.0/8      "本网络"
  if (a === 10) return true;                         // 10.0.0.0/8     私网
  if (a === 127) return true;                        // 127.0.0.0/8    环回
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10  CGNAT
  if (a === 169 && b === 254) return true;           // 169.254.0.0/16 链路本地（云元数据！）
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12  私网
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16 私网
  // 以下保留网段必须精确到 /24：早先只比较前两段，把 192.0.1.x/192.88.1.x
  // 这类正常公网地址一起拦了；同时 192.0.2.0/24（TEST-NET-1）反而漏拦。
  if (a === 192 && b === 0 && c === 0) return true;  // 192.0.0.0/24   IETF 协议保留
  if (a === 192 && b === 0 && c === 2) return true;  // 192.0.2.0/24   TEST-NET-1 文档
  if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 6to4 中继
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 基准测试
  if (a === 198 && b === 51 && c === 100) return true;  // 198.51.100.0/24 文档
  if (a === 203 && b === 0 && c === 113) return true;   // 203.0.113.0/24 文档
  if (a >= 224) return true;                         // 224.0.0.0/4 组播 + 240.0.0.0/4 保留 + 255.255.255.255
  return false;
}

/**
 * 把 IPv6 文本展开成 16 字节（不依赖字符串前缀猜测）。
 *
 * 为什么必须真解析：`::ffff:127.0.0.1`、`::ffff:7f00:1`、
 * `0:0:0:0:0:ffff:127.0.0.1`、`0000:...:7f00:0001` 是**同一个地址**，
 * 前缀匹配只能覆盖其中一部分写法；漏掉的那种就是 SSRF 绕过口子。
 * 返回 null 表示不是合法 IPv6（调用方按 fail-closed 处理）。
 */
function ipv6ToBytes(input: string): Uint8Array | null {
  let s = input.toLowerCase().split("%")[0] ?? "";
  if (!s || !s.includes(":")) return null;

  // 末尾内嵌点分 IPv4（::ffff:127.0.0.1）先折算成两个 hextet
  if (s.includes(".")) {
    const idx = s.lastIndexOf(":");
    if (idx < 0) return null;
    const parts = s.slice(idx + 1).split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((parts[0]! << 8) | parts[1]!).toString(16);
    const lo = ((parts[2]! << 8) | parts[3]!).toString(16);
    s = s.slice(0, idx + 1) + hi + ":" + lo;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];

  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  } else {
    if (left.length !== 8) return null;
    groups = left;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const g = groups[i]!;
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = Number.parseInt(g, 16);
    bytes[i * 2] = v >> 8;
    bytes[i * 2 + 1] = v & 0xff;
  }
  return bytes;
}

function bytesAllZero(bytes: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (bytes[i] !== 0) return false;
  return true;
}

function embeddedIpv4(bytes: Uint8Array): string {
  return [bytes[12], bytes[13], bytes[14], bytes[15]].join(".");
}

export function isBlockedIpv6(ip: string): boolean {
  const b = ipv6ToBytes(ip);
  // 解析不了的一律视为不安全（fail closed）
  if (!b) return true;

  // :: （未指定）与 ::1（环回）
  if (bytesAllZero(b, 0, 16)) return true;
  if (bytesAllZero(b, 0, 15) && b[15] === 1) return true;

  // IPv4 映射 ::ffff:a.b.c.d —— 前 10 字节为 0 且 10/11 字节为 0xff
  if (bytesAllZero(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) {
    return isBlockedIpv4(embeddedIpv4(b));
  }
  // IPv4 兼容 ::a.b.c.d（已废弃，但 Linux 上仍可路由到内网）
  if (bytesAllZero(b, 0, 12)) return isBlockedIpv4(embeddedIpv4(b));
  // NAT64 64:ff9b::/96 —— 内嵌 v4，在 NAT64 网络里等价于直连该 v4
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return isBlockedIpv4(embeddedIpv4(b));
  }
  // 6to4 2002::/16（内嵌 v4）
  if (b[0] === 0x20 && b[1] === 0x02) return true;
  // Teredo 2001:0000::/32（内嵌 v4，混淆编码）
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true;
  // 文档网段 2001:db8::/32
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true;
  // 链路本地 fe80::/10
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true;
  // 唯一本地 fc00::/7
  if ((b[0]! & 0xfe) === 0xfc) return true;
  // 组播 ff00::/8
  if (b[0] === 0xff) return true;
  // 丢弃前缀 100::/64
  if (b[0] === 0x01 && b[1] === 0x00 && bytesAllZero(b, 2, 8)) return true;

  return false;
}

/** 校验 URL 协议与主机名形态；不做 DNS（DNS 在 resolveAndCheck 里） */
const BLOCKED_PORTS = new Set(["22", "25", "110", "143", "3306", "5432", "6379", "6380", "9200", "11211", "27017", "27018"]);
export function assertUrlShape(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new SsrfBlockedError("无效的 URL: " + raw, "malformed"); }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError("仅允许 http/https，收到 " + url.protocol, "protocol");
  }
  if (url.hostname === "" ) throw new SsrfBlockedError("缺少主机名", "no-host");
  if (url.username || url.password) throw new SsrfBlockedError("URL 不得携带凭证", "credentials");
  if (url.port && BLOCKED_PORTS.has(url.port)) throw new SsrfBlockedError("禁止访问该端口: " + url.port, "blocked-port");
  return url;
}

/**
 * 带超时的 DNS 解析。
 *
 * `resolveAndCheck` 必须先解析域名才能校验解析后的 IP，但 `lookup()` 本身没有超时：
 * 弱网 / CI 环境下某些域名会长时间无响应，直接挂死调用方（`health_check` 顺序巡检
 * 多个站点时尤其致命——一个卡住的域名就能把整次调用拖过调用方的超时）。
 * 这里给解析加上硬上限；**超时即 fail-closed**：解析不出的目标一律按受保护处理，
 * 绝不因为「还没解析完」就放行请求。
 *
 * 说明：被超时放弃的底层查询不会真正中断（node:dns/promises 的 lookup 不支持
 * AbortSignal），但它不持有需要清理的句柄；我们只保证调用方不再等待它。
 */
async function lookupWithTimeout(host: string, timeoutMs: number): Promise<Array<{ address: string }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SsrfBlockedError("DNS 解析超时: " + host, "dns-timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** DNS 解析并校验全部解析结果 */
export async function resolveAndCheck(url: URL, opts: FetchGuardOptions): Promise<void> {
  if (opts.allowPrivateNetworks) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");

  // 主机名本身就是字面 IP 时直接判
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfBlockedError("目标是受保护网段: " + host, "blocked-ip");
    return;
  }

  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookupWithTimeout(host, opts.timeoutMs);
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw err; // 解析超时：fail-closed
    throw new SsrfBlockedError("DNS 解析失败: " + host, "dns-failure");
  }
  if (addrs.length === 0) throw new SsrfBlockedError("DNS 无结果: " + host, "dns-empty");

  // 全部解析结果都必须安全（DNS 轮询/多 A 记录下，只要有一个是不安全的就拒绝）
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new SsrfBlockedError(host + " 解析到受保护网段 " + a.address, "blocked-ip");
    }
  }
}

export interface GuardedFetchResult {
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: string;
  truncated: boolean;
  redirects: string[];
}

/** `guardedFetch` 允许的请求方法。GET/HEAD 不允许携带请求体。 */
const GUARDED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);
const SENSITIVE_REDIRECT_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);
const MAX_REQUEST_BODY_BYTES = 256 * 1024;

export interface GuardedFetchRequest {
  /** HTTP 方法，默认 GET；仅允许 GET/HEAD/POST/PUT/PATCH/DELETE。 */
  method?: string;
  /** 请求头。Host/Content-Length/Connection 等逐跳头会被丢弃。 */
  headers?: Record<string, string>;
  /** 请求体，仅支持字符串或 URLSearchParams；GET/HEAD 不得携带。 */
  body?: string | URLSearchParams;
  /** 未显式提供 Accept 时的默认值。 */
  accept?: string;
}

function normalizeMethod(input?: string): string {
  const method = (input ?? "GET").toUpperCase();
  if (!GUARDED_METHODS.has(method)) {
    throw new SsrfBlockedError("不允许的 HTTP 方法: " + method, "method");
  }
  return method;
}

function cloneHeaders(input?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(input ?? {})) {
    const key = rawKey.trim();
    if (!key) continue;
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) {
      throw new SsrfBlockedError("请求头包含非法换行", "header-injection");
    }
    out[key] = value;
  }
  return out;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) delete headers[key];
  }
}

/**
 * 带 SSRF 防护的 fetch。
 * 手工跟随重定向（fetch 的 redirect:"follow" 无法逐跳校验，因此禁用）。
 *
 * 第三参数用于动态 REST 工具等写请求：方法、请求头与请求体都会在每一跳重新
 * 校验 URL/DNS；301/302/303 按浏览器语义降级为 GET 并丢弃请求体，307/308 保留。
 * 跨源跳转会移除 Authorization/Cookie，避免把调用方凭据带到另一个主机。
 */
export async function guardedFetch(
  rawUrl: string,
  options: Partial<FetchGuardOptions> = {},
  request: GuardedFetchRequest = {},
): Promise<GuardedFetchResult> {
  const opts = { ...DEFAULT_GUARD, ...options };
  let current = assertUrlShape(rawUrl);
  const redirects: string[] = [];
  let method = normalizeMethod(request.method);
  let body = request.body instanceof URLSearchParams ? request.body.toString() : request.body;
  if (body !== undefined && typeof body !== "string") {
    throw new SsrfBlockedError("请求体只支持字符串或 URLSearchParams", "unsupported-body");
  }
  if (body !== undefined && (method === "GET" || method === "HEAD")) {
    throw new SsrfBlockedError(method + " 请求不能携带请求体", "body-not-allowed");
  }
  if (body !== undefined && new TextEncoder().encode(body).byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new SsrfBlockedError("请求体超过 " + MAX_REQUEST_BODY_BYTES + " 字节", "body-too-large");
  }
  const headers = cloneHeaders(request.headers);
  if (!hasHeader(headers, "user-agent")) headers["User-Agent"] = opts.userAgent;
  if (!hasHeader(headers, "accept")) headers.Accept = request.accept ?? "text/html,application/xhtml+xml";

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    await resolveAndCheck(current, opts);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      // TOCTOU 缓解：http 明文请求直接钉 IP 直连（Host 头保留原域名），
      // 避免 resolve 与 fetch 之间的 DNS 重绑定窗口；https 因 SNI/证书无法钉 IP，
      // 仍走域名，但在读取 body 前后各做一次 resolveAndCheck 以收窄窗口。
      let fetchUrl = current.toString();
      const extraHeaders: Record<string, string> = {};
      if (current.protocol === "http:" && !opts.allowPrivateNetworks && !isIP(current.hostname.replace(/^\[|\]$/g, ""))) {
        let pinned: Array<{ address: string }> = [];
        try {
          pinned = await lookupWithTimeout(current.hostname, opts.timeoutMs);
        } catch {
          // pin 超时或解析失败：回退到域名直连（循环头部的 resolveAndCheck 已校验过一次）
        }
        const first = pinned[0]?.address;
        if (first && isIP(first)) {
          if (isBlockedIp(first)) throw new SsrfBlockedError(current.hostname + " 解析到受保护网段 " + first, "blocked-ip");
          const portSuffix = current.port ? ":" + current.port : "";
          fetchUrl = "http://" + (first.includes(":") ? "[" + first + "]" : first) + portSuffix + (current.pathname + current.search + current.hash);
          extraHeaders.Host = current.host;
        }
      }
      res = await fetch(fetchUrl, {
        method,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        redirect: "manual",
        signal: controller.signal,
        headers: { ...headers, ...extraHeaders },
      });
      // https 二次校验：收窄 DNS 重绑定窗口。
      // 只吞掉「解析失败」这类瞬态错误；若二次解析落到受保护网段（重绑定攻击的特征），
      // 必须把 SsrfBlockedError 抛出去 —— 否则这次校验等于没做。
      if (current.protocol === "https:") {
        await resolveAndCheck(current, opts).catch((err) => {
          if (err instanceof SsrfBlockedError) throw err;
        });
      }
    } catch (err) {
      clearTimeout(timer);
      // 保留安全拦截的原始类型：调用方靠 instanceof SsrfBlockedError 区分
      // 「被防护拒绝」与「网络失败」，包装成普通 Error 会让前者退化成 500。
      if (err instanceof SsrfBlockedError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error("抓取失败 " + current.toString() + ": " + msg);
    }

    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get("location");
      if (!loc) throw new Error("重定向缺少 Location: " + current.toString());
      const next = new URL(loc, current);
      // 下一跳同样要过协议检查；IP 检查在循环头部进行
      assertUrlShape(next.toString());
      // 释放中间响应体，避免连接一直挂着
      await res.body?.cancel().catch(() => undefined);
      if (next.origin !== current.origin) {
        for (const key of Object.keys(headers)) {
          if (SENSITIVE_REDIRECT_HEADERS.has(key.toLowerCase())) delete headers[key];
        }
      }
      // 浏览器/fetch 语义：301/302 的 POST 与 303 的非 GET/HEAD 降级为 GET；307/308 保留。
      if (
        (res.status === 303 && method !== "GET" && method !== "HEAD") ||
        ((res.status === 301 || res.status === 302) && method === "POST")
      ) {
        method = "GET";
        body = undefined;
        deleteHeader(headers, "content-type");
      }
      redirects.push(next.toString());
      current = next;
      continue;
    }

    try {
      const { text, truncated } = await readLimited(res, opts.maxBytes);
      return {
        finalUrl: current.toString(),
        status: res.status,
        contentType: res.headers.get("content-type"),
        body: text,
        truncated,
        redirects,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("重定向次数超过 " + opts.maxRedirects + " 次");
}

/** 边读边计数，超过上限立即停止（避免大文件把内存吃满） */
async function readLimited(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const body = res.body;
  if (!body) return { text: "", truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.subarray(0, Math.max(0, value.byteLength - (total - maxBytes))));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(merged), truncated };
}
