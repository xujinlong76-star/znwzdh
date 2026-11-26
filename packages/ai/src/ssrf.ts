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
 *   3. **连接级 IP pinning**：把校验通过的 IP 通过 socket lookup 回调固定到
 *      本次连接，HTTPS 仍用原域名做 SNI/证书校验，关闭解析后重绑定的 TOCTOU。
 *   4. **重定向逐跳校验**：手动跟随重定向，每一跳都重新做 DNS + IP 校验并重新 pin，
 *      否则 https://evil.com -> 302 -> http://169.254.169.254/ 就绕过了校验。
 *
 * 另外限制超时、响应体大小与重定向跳数，避免被慢速/超大响应拖死。
 */
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { PassThrough, Readable, Transform } from "node:stream";
import zlib from "node:zlib";
import { BLOCKED_PORTS_UNION } from "@navhub/core";

export interface FetchGuardOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  /** 显式放行私网（仅本地开发/NAS 内网导航站需要） */
  allowPrivateNetworks: boolean;
  /**
   * 精确主机名白名单：仅对这些主机跳过 DNS 解析后的 IP 校验。
   * 用途：出口网关用合成地址（198.18.0.0/15 基准测试段）代理真实出站时，
   * 写死在代码里的第一方采集端点会被误拦。只接受精确主机名（小写比较，
   * 不做后缀/通配匹配），不适用于字面 IP 主机名；协议、端口、凭证、超时、
   * 响应体上限与重定向逐跳校验一律保留。默认不设 = 不放行任何主机。
   * 绝不在用户可控 URL 的路径上设置此项。
   */
  trustedHosts?: ReadonlySet<string> | readonly string[];
  userAgent: string;
  /**
   * 严格域名白名单（2026-11-21）。非空时只允许这些 host（子域按 `*.example.com` 写法）。
   *
   * 为什么需要：IP 黑名单是「防坏」，白名单是「只信任已知好」。
   * 对固定对接少数平台的路由（视频抓取、GitHub API），白名单能把攻击面
   * 从「任意公网 URL」压到「几个确定域名」——这也是 CodeQL 静态数据流
   * 唯一能彻底消除污点告警的形态。
   */
  allowedHosts?: readonly string[];
}

export const DEFAULT_GUARD: FetchGuardOptions = {
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  allowPrivateNetworks: false,
  userAgent: "NavHubBot/0.1 (+https://github.com/navhub)",
  allowedHosts: undefined,
};

/**
 * 判断 host 是否命中白名单。
 *
 * 支持两种写法：
 *   `api.github.com`   精确匹配
 *   `*.example.com`   匹配 example.com 的全部子域（不含 example.com 本身）
 * 比较前统一转小写并去掉端口与 IPv6 方括号。
 */
export function isHostAllowed(host: string, allowedHosts: readonly string[] | undefined): boolean {
  if (!allowedHosts || allowedHosts.length === 0) return true;
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/:\d+$/, "");
  if (!h) return false;
  for (const raw of allowedHosts) {
    const pattern = String(raw || "").toLowerCase().trim();
    if (!pattern) continue;
    if (pattern === h) return true;
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      // 只允许真正的子域；精确域本身要用无通配写法单独列出
      if (h.endsWith("." + suffix)) return true;
    }
  }
  return false;
}

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
  // 链路本地 fe80::/10 与已废弃的站点本地 fec0::/10
  if (b[0] === 0xfe && ((b[1]! & 0xc0) === 0x80 || (b[1]! & 0xc0) === 0xc0)) return true;
  // 唯一本地 fc00::/7
  if ((b[0]! & 0xfe) === 0xfc) return true;
  // 组播 ff00::/8
  if (b[0] === 0xff) return true;
  // 丢弃前缀 100::/64
  if (b[0] === 0x01 && b[1] === 0x00 && bytesAllZero(b, 2, 8)) return true;

  return false;
}

/**
 * 不该被「用户提交的网址」指向的端口。
 *
 * 判据不是「常见不常见」，而是**SSRF 攻击面**：这些端口后面通常是数据库、
 * 缓存、容器运行时或集群控制面，一旦被服务端代为访问，等于把内网管理接口
 * 暴露出去（Redis 未授权写 crontab、Docker API 起容器是典型利用链）。
 *
 * 同时也保护我们自己：这些端口上不会有正常网页，探活必然是噪声。
 * 只做「精确端口」匹配，不做范围——避免把 8080/8443 这类正常站点误杀。
 */
// 端口表统一来自 @navhub/core（2026-11-06 深扫 P2-2）。
// 此前本文件与 apps/web-overlay/src/lib/ssrf-guard.ts 各维护一份，口径已经漂移
// （37 vs 40，仅 28 共有，且一侧是 Set<string> 另一侧是 Set<number>）——
// 同一个 URL 在两套实现里可能得到相反判定。
// 现统一为并集口径；判定走 isBlockedPortUnion 以同时接受字符串与数字。
const BLOCKED_PORTS = new Set(BLOCKED_PORTS_UNION.map(String));

/** 校验 URL 协议与主机名形态；不做 DNS（DNS 在 resolveAndCheck 里） */
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

/** 白名单只认精确主机名（小写比较，不做后缀/通配匹配）；字面 IP 永不走白名单 */
export function isTrustedHost(host: string, trustedHosts: FetchGuardOptions["trustedHosts"]): boolean {
  if (!trustedHosts) return false;
  const want = host.toLowerCase();
  for (const h of trustedHosts) {
    if (h.toLowerCase() === want) return true;
  }
  return false;
}

/** DNS 解析并校验全部解析结果，返回已校验安全的 IP 地址清单 */
/**
 * 无论是否放行私网都**永久拦截**的地址段。
 *
 * allowPrivateNetworks 的正当用途是「本地开发连 NAS/内网站点」，
 * 它不该连带放开云元数据地址（169.254.169.254 / fd00:ec2::254 等）——
 * 那是凭据泄露面，不是「用户想访问的内网服务」。
 * 2026-11-21 实测发现旧逻辑 allowPrivateNetworks=true 时会真去连
 * 169.254.169.254（ENETUNREACH），据此补上这道无条件防线。
 */
export function isAlwaysBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    // 169.254.0.0/16 链路本地（含全部云厂商元数据端点）
    if (/^169\.254\./.test(ip)) return true;
    // 100.100.100.200 阿里云元数据
    if (ip === "100.100.100.200") return true;
    // 0.0.0.0/8
    if (/^0\./.test(ip)) return true;
    return false;
  }
  if (v === 6) {
    const bytes = ipv6ToBytes(ip);
    if (!bytes) return true;
    // fe80::/10 链路本地（覆盖 fe80:... 的完整与压缩写法）
    if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true;
    // fd00:ec2::254：AWS IPv6 IMDS，虽属 ULA 也必须无条件阻断。
    if (
      bytes[0] === 0xfd && bytes[1] === 0x00 && bytes[2] === 0x0e && bytes[3] === 0xc2
      && bytesAllZero(bytes, 4, 14) && bytes[14] === 0x02 && bytes[15] === 0x54
    ) {
      return true;
    }
    // ::1 由 allowPrivateNetworks 的常规环回规则决定，不能按兼容 IPv4 的 0.0.0.1 处理。
    if (bytesAllZero(bytes, 0, 15) && bytes[15] === 0x01) return false;
    // 所有内嵌 IPv4 的过渡形态都递归判断，不能只认 ::ffff/96。
    const ipv4Mapped = bytesAllZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff;
    const ipv4Compatible = bytesAllZero(bytes, 0, 12);
    const nat64WellKnown = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b
      && bytesAllZero(bytes, 4, 12);
    const nat64LocalUse = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b
      && bytes[4] === 0x00 && bytes[5] === 0x01 && bytesAllZero(bytes, 6, 8);
    if (ipv4Mapped || ipv4Compatible || nat64WellKnown || nat64LocalUse) {
      return isAlwaysBlockedIp(embeddedIpv4(bytes));
    }
    return false;
  }
  return true;
}

export async function resolveAndCheck(url: URL, opts: FetchGuardOptions): Promise<string[]> {
  const host = url.hostname.replace(/^\[|\]$/g, "");

  // 主机名本身就是字面 IP 时直接判（白名单不适用于字面 IP）。
  // 显式放行私网时仍返回自身，供连接级 pinning 使用。
  if (isIP(host)) {
    if (opts.allowPrivateNetworks ? isAlwaysBlockedIp(host) : isBlockedIp(host)) {
      throw new SsrfBlockedError("目标是受保护地址: " + host, "blocked-ip");
    }
    return [host];
  }

  // 精确主机名白名单：跳过 DNS-IP 校验（出口网关用合成地址代理出站时，
  // 写死在代码里的第一方端点会被误拦，见 U-284）。协议/端口/凭证校验在
  // assertUrlShape 里已做；重定向每一跳都重新进本函数按新 URL 主机名判定，
  // 跳出白名单的主机仍会被校验。返回 [] 表示“已显式信任、无需钉 IP 直连”
  //（仅用于调用方写死的第一方 HTTPS 端点，绝不用于用户可控 URL）。
  if (isTrustedHost(host, opts.trustedHosts)) return [];

  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookupWithTimeout(host, opts.timeoutMs);
  } catch (err) {
    if (err instanceof SsrfBlockedError) throw err; // 解析超时：fail-closed
    throw new SsrfBlockedError("DNS 解析失败: " + host, "dns-failure");
  }
  if (addrs.length === 0) throw new SsrfBlockedError("DNS 无结果: " + host, "dns-empty");

  const safeIps: string[] = [];
  // 全部解析结果都必须检查。显式放行私网时只放宽普通私网，
  // 云元数据/链路本地仍无条件拒绝；任一结果不安全则整次拒绝。
  for (const a of addrs) {
    const blocked = opts.allowPrivateNetworks ? isAlwaysBlockedIp(a.address) : isBlockedIp(a.address);
    if (blocked) {
      throw new SsrfBlockedError(host + " 解析到受保护地址 " + a.address, "blocked-ip");
    }
    safeIps.push(a.address);
  }
  return safeIps;
}

export interface GuardedFetchResult {
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: string;
  truncated: boolean;
  /** 真正读进内存的响应体字节数（触发截断时等于上限，不是对端声称的总大小） */
  bytes: number;
  redirects: string[];
  /**
   * 对端给的缓存校验器。调用方存起来，下次带 `If-None-Match` /
   * `If-Modified-Since` 做条件请求，回 304 就复用上次判定——
   * 这是链接检查器（lychee 等）避免重复抓取的通用做法。
   */
  etag?: string;
  lastModified?: string;
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
  /** 外部传入的取消信号（如任务队列超时或主动中止） */
  signal?: AbortSignal;
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

/* ------------------------------------------------------------------ *
 * 出站观测（升级改造方案 P2：任务与出站可观测性）
 * ------------------------------------------------------------------ */

/**
 * 出站结果分类。
 *
 * 为什么把 `http_error` 与 `network_error` 分开：前者是「对端应答了但应答是
 * 4xx/5xx」，说明目标站有问题；后者是「我们根本没拿到应答」，说明出口链路、
 * DNS 或超时配置有问题。两种情况的处置完全不同，合成一个 failure 就看不出了。
 * `blocked` 单独一档：它是 SSRF 防护生效的证据，数量异常上涨意味着有人在试探。
 */
export type OutboundOutcome = "ok" | "http_error" | "blocked" | "network_error";

export interface OutboundObservation {
  /** 目标 host（含端口）。不带路径与查询串：既避免时间序列爆炸，也不留用户输入 */
  host: string;
  method: string;
  outcome: OutboundOutcome;
  /** 拦截原因（SsrfBlockedError.reason，有界枚举）；非拦截为 null */
  reason: string | null;
  /** HTTP 状态码；没拿到应答时为 null */
  status: number | null;
  /** 实际发出的请求次数（含重定向跳）；失败路径无法确定，报 0 */
  hops: number;
  /** 读到的响应体字节数 */
  bytes: number;
  durationMs: number;
}

type OutboundObserver = (observation: OutboundObservation) => void;

let outboundObserver: OutboundObserver | null = null;

/**
 * 注册出站观测回调（中枢启动时把它接到进程内指标）。
 *
 * 为什么用回调而不是让 packages/ai 直接引指标模块：ai 包不该认得中枢的进程内
 * 计数器，反向依赖会让它只能在中枢里使用。观察者的异常一律吞掉——一次抓取
 * 成功与否、以及安全拦截的原始错误类型，都比一条指标重要。
 */
export function setOutboundObserver(observer: OutboundObserver | null): void {
  outboundObserver = observer;
}

function observeOutbound(observation: OutboundObservation): void {
  if (outboundObserver === null) return;
  try {
    outboundObserver(observation);
  } catch {
    // 指标链路坏了不影响抓取本身
  }
}

/** 解析不出 URL 时归到 fixed label，不让高基数或异常输入进指标 */
function hostForObservation(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return "invalid-url";
  }
}

/**
 * `guardedFetch` 的对外入口：执行真实抓取并上报一次出站观测。
 *
 * 语义与旧的直接实现完全一致（含抛出的错误类型），只是多了一条观测。
 */
export async function guardedFetch(
  rawUrl: string,
  options: Partial<FetchGuardOptions> = {},
  request: GuardedFetchRequest = {},
): Promise<GuardedFetchResult> {
  const startedAt = Date.now();
  const method = (request.method ?? "GET").toUpperCase();
  const host = hostForObservation(rawUrl);
  try {
    const result = await runGuardedFetch(rawUrl, options, request);
    observeOutbound({
      host,
      method,
      outcome: result.status >= 400 ? "http_error" : "ok",
      reason: null,
      status: result.status,
      hops: result.redirects.length + 1,
      bytes: result.bytes,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    const blocked = error instanceof SsrfBlockedError;
    observeOutbound({
      host,
      method,
      outcome: blocked ? "blocked" : "network_error",
      reason: blocked ? error.reason : null,
      status: null,
      hops: 0,
      bytes: 0,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

/**
 * 带 SSRF 防护的 fetch 的实现体。
 * 手工跟随重定向（fetch 的 redirect:"follow" 无法逐跳校验，因此禁用）。
 *
 * 第三参数用于动态 REST 工具等写请求：方法、请求头与请求体都会在每一跳重新
 * 校验 URL/DNS；301/302/303 按浏览器语义降级为 GET 并丢弃请求体，307/308 保留。
 * 跨源跳转会移除 Authorization/Cookie，避免把调用方凭据带到另一个主机。
 *
 * 对外入口是下面的 `guardedFetch`（它负责观测），这里保持纯抓取语义。
 */
async function runGuardedFetch(
  rawUrl: string,
  options: Partial<FetchGuardOptions> = {},
  request: GuardedFetchRequest = {},
): Promise<GuardedFetchResult> {
  const opts = { ...DEFAULT_GUARD, ...options };
  let current = assertUrlShape(rawUrl);
  const redirects: string[] = [];
  let method = normalizeMethod(request.method);
  const requestBody = request.body;
  const bodyIsForm = requestBody instanceof URLSearchParams;
  let body = bodyIsForm ? requestBody.toString() : requestBody;
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
    const verifiedIps = await resolveAndCheck(current, opts);
    const rawHost = current.hostname.replace(/^\[|\]$/g, "");
    // 普通域名与显式放行私网的域名都固定使用本次校验的首个安全 IP。
    // trustedHosts 是调用方显式信任的出口网关，返回空数组时不 pin（原有安全语义）。
    const pinned = verifiedIps[0] ?? (isIP(rawHost) ? rawHost : null);
    if (request.signal?.aborted) throw new Error("抓取已取消: " + current.toString());

    // fetch 会忽略 Node 的 connect.lookup，不能用于连接级 pinning。这里与 safeFetch
    // 共用 rawRequest，保证“校验的 IP”就是 socket 实际连接的 IP。
    if (body !== undefined && (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") && !hasHeader(headers, "content-type")) {
      // 与 fetch 对请求体的默认行为保持一致。
      headers["Content-Type"] = bodyIsForm ? "application/x-www-form-urlencoded;charset=UTF-8" : "text/plain;charset=UTF-8";
    }
    let res: RawResponse;
    try {
      res = await rawRequest({
        url: current,
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body,
        pinnedIp: pinned,
        hostname: rawHost,
        timeoutMs: opts.timeoutMs,
        maxBytes: opts.maxBytes,
        signal: request.signal,
        truncateOnLimit: true,
      });
    } catch (err) {
      // 保留安全拦截的原始类型；超时在旧实现中由 AbortController 触发，属于网络失败，
      // 因此仍包装为普通 Error，避免观测分类从 network_error 突变成 blocked。
      if (err instanceof SsrfBlockedError && err.reason !== "timeout") throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error("抓取失败 " + current.toString() + ": " + msg);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("重定向缺少 Location: " + current.toString());
      const next = new URL(loc, current);
      // 下一跳同样要过协议检查；IP 检查与重新 pin 在循环头部进行。
      assertUrlShape(next.toString());
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

    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    return {
      finalUrl: current.toString(),
      status: res.status,
      contentType: res.headers.get("content-type"),
      body: new TextDecoder("utf-8", { fatal: false }).decode(res.body),
      truncated: res.truncated,
      bytes: res.body.byteLength,
      redirects,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
    };
  }

  throw new Error("重定向次数超过 " + opts.maxRedirects + " 次");
}

/* ==========================================================================
 * safeFetch：统一的对外请求安全边界（2026-11-21）
 * ==========================================================================
 *
 * guardedFetch 与 safeFetch 共用下面的 rawRequest：
 *
 * 两者都把已校验的 IP 通过 node:http/https 的 `lookup` 回调固定到 socket，
 * 同时在 HTTPS 上显式给 `servername` 保证 SNI 与证书校验仍按**域名**进行。
 * 这样「校验的 IP」与「实际发包的 IP」是同一个值，不存在解析后重绑定的窗口。
 * safeFetch 提供精简的 Uint8Array 响应；guardedFetch 保留文本截断与观测语义。
 *
 * 五道防线与本文件既有实现保持一致（payload 上限、超时、逐跳校验、
 * 敏感头剥离、协议/端口/凭据白名单），不新造第二套口径。
 */

/** 一次 DNS 解析的结果：地址 + 协议族。 */
export interface PinnedAddress {
  address: string;
  family: number;
}

/**
 * 连接级 IP 钉扎的回调工厂。
 *
 * 传给 http(s) 的 `lookup` 选项后，Node 不再自行调用 dns.lookup，
 * 而是直接用我们校验过的地址建连——这是消除 TOCTOU 的关键。
 *
 * 同时导出给测试断言存在性（ssrf-safefetch-guard.test.ts 锁
 * `pinnedLookup`、`lookup: pinnedLookup`、`servername:` 三个符号）。
 */
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | PinnedAddress[],
  family?: number,
) => void;

export function pinnedLookup(pinned: PinnedAddress) {
  const family = pinned.family === 6 ? 6 : 4;
  return (
    _hostname: string,
    options: unknown,
    callback: LookupCallback,
  ): void => {
    // Node 24 autoSelectFamily 默认会传 all:true，此时必须返回地址数组；
    // 旧版/显式单地址形态仍返回 callback(err, address, family)。
    if (typeof options === "object" && options !== null && "all" in options && options.all === true) {
      callback(null, [{ address: pinned.address, family }]);
      return;
    }
    callback(null, pinned.address, family);
  };
}

/** safeFetch 的返回：只暴露调用方真正需要的字段。 */
export interface SafeFetchResult {
  ok: boolean;
  status: number;
  headers: Headers;
  /** 已按 maxBytes 截断的响应体 */
  body: Uint8Array;
  /** 是否因达到 maxBytes 而提前结束读取 */
  truncated: boolean;
  /** 跟随重定向后的最终 URL */
  finalUrl: string;
  /** 实际落地的对端 IP（钉扎值，便于审计与测试断言） */
  pinnedIp: string | null;
  redirects: string[];
}

export interface SafeFetchOptions extends Partial<FetchGuardOptions> {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams | undefined;
  /**
   * 覆盖默认的允许端口（默认仅 80/443）。传 null 表示接受 URL 显式声明的、
   * 未命中 BLOCKED_PORTS 的任意端口，供需要兼容既有抓取行为的调用方使用。
   */
  allowedPorts?: readonly number[] | null;
  /** 达到 maxBytes 时返回截断结果而非抛 body_too_large；默认抛错。 */
  truncateOnLimit?: boolean;
  /** 外部取消信号。 */
  signal?: AbortSignal;
}

/**
 * 统一的对外 HTTP 出口。
 *
 * 五道防线（顺序即执行顺序，任一道失败都抛 SsrfBlockedError）：
 *  1. URL 形态：仅 http/https；拒绝内嵌凭据；端口白名单。
 *  2. DNS 后 IP 黑名单：私网/环回/链路本地/IPv6 映射全覆盖。
 *  3. 防 DNS Rebinding：把校验通过的 IP 钉到本次连接（lookup 回调）。
 *  4. 受控重定向：manual + 逐跳重新走全套校验，最多 maxRedirects 跳。
 *  5. 硬超时 + 响应体积上限。
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts: FetchGuardOptions = { ...DEFAULT_GUARD, ...options };
  const maxRedirects = Math.max(0, opts.maxRedirects);
  const allowedPorts = options.allowedPorts === undefined ? [80, 443] : options.allowedPorts;

  let current = assertUrlShape(rawUrl);
  const redirects: string[] = [];
  let method = (options.method ?? "GET").toUpperCase();
  let body = options.body instanceof URLSearchParams ? options.body.toString() : options.body;

  // 复用文件里既有的权威定义，不再造第三份敏感头集合
  let carriedHeaders: Record<string, string> = { ...(options.headers ?? {}) };
  let prevOrigin = "";

  for (let hop = 0; hop <= maxRedirects; hop++) {
    // ---- 防线 1b：端口白名单 ----
    const port = current.port ? Number(current.port) : current.protocol === "https:" ? 443 : 80;
    if (allowedPorts !== null && !allowedPorts.includes(port)) {
      throw new SsrfBlockedError(`端口 ${port} 不在允许范围内`, "port_not_allowed");
    }

    // ---- 防线 1c / 2：域名白名单 + DNS 后 IP 黑名单 ----
    const rawHost = current.hostname.replace(/^\[|\]$/g, "");
    if (!isHostAllowed(rawHost, opts.allowedHosts)) {
      throw new SsrfBlockedError(`主机 ${rawHost} 不在域名白名单内`, "host_not_allowed");
    }
    // resolveAndCheck 接收 URL 对象（不是字符串），且返回全部安全 IP；
    // 任一 A 记录不安全就抛 SsrfBlockedError（多记录下 fail-closed）。
    const resolved = await resolveAndCheck(current, opts);
    // 钉扎目标取值优先级：
    //  1) resolveAndCheck 返回的首个安全 IP（公网或显式放行私网的域名）；
    //  2) 主机名本身是字面 IP 时用它自己（各分支均返回自身，此处为兜底）；
    //  3) 都没有则不钉（仅可能是显式 trustedHosts，由调用方承担对应信任语义）。
    const pinned = resolved[0] ?? (isIP(rawHost) ? rawHost : null);

    // ---- 防线 3：把校验通过的 IP 钉到本次连接 ----
    const headers: Record<string, string> = {
      "User-Agent": opts.userAgent,
      ...carriedHeaders,
    };
    // 跨源跳转剥离凭据（与 guardedFetch 同口径）
    if (prevOrigin && prevOrigin !== current.origin) {
      for (const k of Object.keys(headers)) {
        if (SENSITIVE_REDIRECT_HEADERS.has(k.toLowerCase())) delete headers[k];
      }
    }

    // ---- 防线 5：硬超时 + 体积上限 ----
    //
    // 为什么不用 fetch：实测 Node 的 fetch **静默忽略** `connect` 选项
    // （探针验证 lookup 回调从未被调用），也就是说用 fetch 写的"钉扎"
    // 是一层假防护——校验的 IP 与实际发包的 IP 可能不同。
    // 只有 node:http/https 的 `lookup` 选项会被真正用于 socket 建连，
    // 因此这里回到原生模块，换来的是**真实**的连接级钉扎。
    const res = await rawRequest({
      url: current,
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      pinnedIp: pinned,
      hostname: rawHost,
      timeoutMs: opts.timeoutMs,
      maxBytes: opts.maxBytes,
      signal: options.signal,
      truncateOnLimit: options.truncateOnLimit === true,
    });

    // ---- 防线 4：受控重定向，逐跳重新校验 ----
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: res.headers,
        body: res.body,
        truncated: res.truncated,
        finalUrl: current.toString(),
        pinnedIp: pinned,
        redirects,
      };
      }
      // res.body 是已读进内存的 Uint8Array（rawRequest 已消费流），无需 cancel
      if (redirects.length >= maxRedirects) {
        throw new SsrfBlockedError(`重定向超过 ${maxRedirects} 跳`, "too_many_redirects");
      }
      const next = new URL(location, current);
      redirects.push(current.toString());
      prevOrigin = current.origin;
      // 301/302/303 降级为 GET 并丢弃 body（浏览器语义）
      if (res.status === 301 || res.status === 302 || res.status === 303) {
        method = "GET";
        body = undefined;
      }
      current = assertUrlShape(next.toString());
      continue;
    }

    return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        headers: res.headers,
        body: res.body,
        truncated: res.truncated,
        finalUrl: current.toString(),
        pinnedIp: pinned,
        redirects,
      };
  }
  throw new SsrfBlockedError("重定向次数超出限制", "too_many_redirects");
}

export interface SafeFetchStreamOptions extends SafeFetchOptions {
  /** 响应头等待时间；0 表示由调用方的 signal 控制。 */
  timeoutMs?: number;
}

/**
 * 连接级钉扎的流式出口。仅供 SSE 等必须边收边处理的调用方使用。
 * 与 safeFetch 共用 URL/DNS/IP 校验，但拒绝重定向，避免把凭据带到下一跳。
 */
export async function safeFetchStream(
  rawUrl: string,
  options: SafeFetchStreamOptions = {},
): Promise<Response> {
  const current = assertUrlShape(rawUrl);
  const port = current.port ? Number(current.port) : current.protocol === "https:" ? 443 : 80;
  if (options.allowedPorts !== null && !(options.allowedPorts ?? [80, 443]).includes(port)) {
    throw new SsrfBlockedError(`端口 ${port} 不在允许范围内`, "port_not_allowed");
  }
  const opts = { ...DEFAULT_GUARD, ...options };
  const hostname = current.hostname.replace(/^\[|\]$/g, "");
  if (!isHostAllowed(hostname, opts.allowedHosts)) {
    throw new SsrfBlockedError(`主机 ${hostname} 不在域名白名单内`, "host_not_allowed");
  }
  const resolved = await resolveAndCheck(current, opts);
  const pinnedIp = resolved[0] ?? (isIP(hostname) ? hostname : null);
  const headers = cloneHeaders(options.headers);
  if (!hasHeader(headers, "user-agent")) headers["User-Agent"] = opts.userAgent;

  return rawStreamRequest({
    url: current,
    method: (options.method ?? "GET").toUpperCase(),
    headers,
    body: options.body instanceof URLSearchParams ? options.body.toString() : options.body,
    pinnedIp,
    hostname,
    timeoutMs: options.timeoutMs ?? 0,
    maxBytes: options.maxBytes ?? opts.maxBytes,
    signal: options.signal,
  });
}

function byteLimitTransform(maxBytes: number): Transform {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        callback(bodyTooLargeError(maxBytes));
        return;
      }
      callback(null, chunk);
    },
  });
}

/** 原生流式请求：头部返回后解除建连超时，body 仍受 signal 与双重字节上限约束。 */
function rawStreamRequest(args: {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  pinnedIp: string | null;
  hostname: string;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
}): Promise<Response> {
  const { url, method, headers, body, pinnedIp, hostname, timeoutMs, maxBytes, signal } = args;
  const isHttps = url.protocol === "https:";

  return new Promise<Response>((resolvePromise, rejectPromise) => {
    let req: http.ClientRequest;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let response: http.IncomingMessage | undefined;
    let outputStream: PassThrough | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(err);
    };
    const onAbort = () => {
      const reason = signal?.reason;
      const err = reason instanceof Error ? reason : new Error("抓取已取消: " + url.toString());
      req?.destroy(err);
      response?.destroy(err);
      outputStream?.destroy(err);
      fail(err);
    };
    const onResponse = (res: http.IncomingMessage) => {
      response = res;
      if (settled) {
        res.destroy();
        return;
      }
      if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400) {
        const err = new SsrfBlockedError("流式端点不允许重定向", "redirect");
        res.destroy();
        req?.destroy();
        fail(err);
        return;
      }

      settled = true;
      if (timer) clearTimeout(timer);
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (typeof value === "string") responseHeaders.set(key, value);
        else if (Array.isArray(value)) responseHeaders.set(key, value.join(", "));
      }
      const encodingHeader = res.headers["content-encoding"];
      const encodings = parseContentEncodings(typeof encodingHeader === "string" ? encodingHeader : null);
      const shouldDecode = encodings !== null
        && encodings.length > 0
        && method !== "HEAD"
        && res.statusCode !== 204
        && res.statusCode !== 304;
      if (shouldDecode) {
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
      }

      const output = new PassThrough();
      outputStream = output;
      const stages: Transform[] = [byteLimitTransform(maxBytes)];
      if (shouldDecode && encodings !== null) {
        for (const encoding of [...encodings].reverse()) {
          stages.push(createContentDecoder(encoding), byteLimitTransform(maxBytes));
        }
      }
      const failStream = (err: Error) => {
        res.destroy();
        for (const stage of stages) stage.destroy();
        cleanup();
        if (!output.destroyed) output.destroy(err);
      };
      res.on("error", failStream);
      output.on("error", failStream);
      output.on("finish", cleanup);
      let upstream: Readable = res;
      for (const stage of stages) {
        stage.on("error", failStream);
        upstream = upstream.pipe(stage);
      }
      upstream.pipe(output);
      const noBody = method === "HEAD" || res.statusCode === 204 || res.statusCode === 304;
      resolvePromise(new Response(noBody ? null : Readable.toWeb(output) as unknown as ReadableStream<Uint8Array>, {
        status: res.statusCode ?? 0,
        headers: responseHeaders,
      }));
    };

    const common = {
      method,
      headers: { ...headers, ...(body !== undefined ? { "Content-Length": String(Buffer.byteLength(body)) } : {}) },
      ...(pinnedIp
        ? { lookup: pinnedLookup({ address: pinnedIp, family: isIP(pinnedIp) }), servername: hostname }
        : {}),
    };
    const requestOptions = {
      hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      ...common,
      agent: false,
    };
    req = isHttps
      ? https.request(requestOptions, onResponse)
      : http.request(requestOptions, onResponse);
    req.on("error", fail);
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        const err = new SsrfBlockedError(`请求超时（${timeoutMs}ms）`, "timeout");
        req.destroy(err);
        fail(err);
      }, timeoutMs);
    }
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    if (!settled) {
      if (body !== undefined) req.write(body);
      req.end();
    }
  });
}


/** rawRequest 返回的轻量响应（safeFetch 与 guardedFetch 共用）。 */
interface RawResponse {
  status: number;
  headers: Headers;
  body: Uint8Array;
  truncated: boolean;
}

type ContentEncoding = "gzip" | "x-gzip" | "deflate" | "br" | "zstd";

const SUPPORTED_CONTENT_ENCODINGS = new Set<string>(["gzip", "x-gzip", "deflate", "br", "zstd"]);

/**
 * 返回 null 表示编码链中含有未知编码。此时必须整条链都不解码，并与 fetch 一样
 * 保留原始字节及 Content-Encoding/Content-Length，避免破坏调用方仍可识别的响应。
 */
function parseContentEncodings(value: string | null): ContentEncoding[] | null {
  if (value === null) return [];
  const encodings = value.split(",").map((item) => item.trim().toLowerCase());
  if (encodings.some((item) => !SUPPORTED_CONTENT_ENCODINGS.has(item))) return null;
  return encodings as ContentEncoding[];
}

function createContentDecoder(encoding: ContentEncoding): Transform {
  switch (encoding) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    case "zstd":
      return zlib.createZstdDecompress();
  }
}

function bodyTooLargeError(maxBytes: number): SsrfBlockedError {
  return new SsrfBlockedError(`响应体超过上限 ${maxBytes} 字节`, "body_too_large");
}

/**
 * 对已受网络字节上限约束的编码体逐层解码。
 *
 * 使用流式解码而非一次性解压：每一层输出都在超过 maxBytes 时立即停止，避免
 * gzip/br 炸弹在计数前先扩展出巨大 Buffer。多编码按声明顺序的逆序解码。
 */
function decodeContentBody(
  encoded: Buffer,
  encodings: readonly ContentEncoding[],
  maxBytes: number,
  truncateOnLimit: boolean,
): Promise<{ body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const decoders = [...encodings].reverse().map(createContentDecoder);
    const chunks: Buffer[] = [];
    const stageBytes = decoders.map(() => 0);
    let finalBytes = 0;
    let settled = false;

    const destroyDecoders = () => {
      for (const decoder of decoders) decoder.destroy();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      destroyDecoders();
      reject(err);
    };
    const limitExceeded = (decoderIndex: number, chunk: Buffer) => {
      if (decoderIndex === decoders.length - 1) {
        const remaining = Math.max(0, maxBytes - finalBytes);
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
      }
      if (!truncateOnLimit) {
        fail(bodyTooLargeError(maxBytes));
        return;
      }
      settled = true;
      destroyDecoders();
      resolve({ body: Buffer.concat(chunks), truncated: true });
    };

    decoders.forEach((decoder, index) => {
      decoder.on("data", (chunk: Buffer) => {
        if (settled) return;
        const nextStageBytes = (stageBytes[index] ?? 0) + chunk.byteLength;
        stageBytes[index] = nextStageBytes;
        if (nextStageBytes > maxBytes) {
          limitExceeded(index, chunk);
          return;
        }
        if (index === decoders.length - 1) {
          chunks.push(chunk);
          finalBytes += chunk.byteLength;
        }
      });
      decoder.on("error", (err) => {
        fail(new Error(`响应内容解码失败 (${encodings[encodings.length - 1 - index]}): ${err.message}`));
      });
      const next = decoders[index + 1];
      if (next) decoder.pipe(next);
    });

    const last = decoders[decoders.length - 1];
    last?.on("end", () => {
      if (settled) return;
      settled = true;
      resolve({ body: Buffer.concat(chunks), truncated: false });
    });
    decoders[0]?.end(encoded);
  });
}

/**
 * 用 node:http/https 发一次请求，并**把已校验的 IP 钉到 socket 上**。
 *
 * 这是 safeFetch/guardedFetch 唯一真正发网络包的地方。钉扎靠 `lookup` 选项：
 * Node 会用它替代 dns.lookup 来解析主机名，于是"校验的 IP"与"连接的 IP"
 * 是同一个值——中间没有第二次解析，DNS Rebinding 的 TOCTOU 窗口被关闭。
 * HTTP 与 HTTPS 都用同一个回调；HTTPS 另有 `servername` 保证 SNI 与
 * 证书校验仍按域名进行（否则钉到 IP 会证书不匹配）。
 * `agent:false` 禁用跨请求连接复用，避免 socket 绕过后续请求的策略与 pinning。
 */
function rawRequest(args: {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  pinnedIp: string | null;
  hostname: string;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
  truncateOnLimit: boolean;
}): Promise<RawResponse> {
  const { url, method, headers, body, pinnedIp, hostname, timeoutMs, maxBytes, signal, truncateOnLimit } = args;
  const isHttps = url.protocol === "https:";

  return new Promise<RawResponse>((resolvePromise, rejectPromise) => {
    let settled = false;
    let req: http.ClientRequest;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(err);
    };
    const onAbort = () => {
      const reason = signal?.reason;
      const err = reason instanceof Error ? reason : new Error("抓取已取消: " + url.toString());
      req.destroy(err);
      fail(err);
    };
    const toResponse = (
      res: http.IncomingMessage,
      body: Buffer,
      truncated: boolean,
      decoded: boolean,
    ): RawResponse => {
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (typeof v === "string") flat[k] = v;
        else if (Array.isArray(v)) flat[k] = v.join(", ");
      }
      const responseHeaders = new Headers(flat);
      if (decoded) {
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
      }
      return {
        status: res.statusCode ?? 0,
        headers: responseHeaders,
        body: new Uint8Array(body),
        truncated,
      };
    };

    const common = {
      method,
      headers: { ...headers, ...(body !== undefined ? { "Content-Length": String(Buffer.byteLength(body)) } : {}) },
      // 钉扎：已验证的 IP 直接作为连接目标地址。
      ...(pinnedIp
        ? {
            lookup: pinnedLookup({ address: pinnedIp, family: isIP(pinnedIp) }),
            servername: hostname,
          }
        : {}),
    };
    const onResponse = (res: http.IncomingMessage) => {
      const chunks: Buffer[] = [];
      const encodingHeader = res.headers["content-encoding"];
      const encodings = parseContentEncodings(typeof encodingHeader === "string" ? encodingHeader : null);
      // HEAD 与无正文状态没有可解码的表示体；保持原始响应语义。
      const shouldDecode = encodings !== null
        && encodings.length > 0
        && method !== "HEAD"
        && res.statusCode !== 204
        && res.statusCode !== 304;
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        total += chunk.byteLength;
        if (total > maxBytes) {
          if (truncateOnLimit) {
            const remaining = Math.max(0, maxBytes - (total - chunk.byteLength));
            if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
            settled = true;
            cleanup();
            // 编码流本身被截断时无法保证得到完整表示体，保留原来的原始字节截断语义。
            resolvePromise(toResponse(res, Buffer.concat(chunks), true, false));
            res.destroy();
            req.destroy();
          } else {
            fail(bodyTooLargeError(maxBytes));
            res.destroy();
            req.destroy();
          }
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (settled) return;
        const encoded = Buffer.concat(chunks);
        if (!shouldDecode || encodings === null) {
          settled = true;
          cleanup();
          resolvePromise(toResponse(res, encoded, false, false));
          return;
        }
        // 解码仍在同一总超时内；流式解码的每一层输出都再次受 maxBytes 约束。
        decodeContentBody(encoded, encodings, maxBytes, truncateOnLimit).then((decoded) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolvePromise(toResponse(res, decoded.body, decoded.truncated, true));
        }, fail);
      });
      res.on("aborted", () => fail(new Error("响应提前中断: " + url.toString())));
      res.on("error", fail);
    };

    // HTTPS 的 hostname 传原域名（SNI/证书校验按域名），实际 IP 由 lookup 决定。
    // agent:false 每次独立建连，禁止跨请求/跨策略复用 socket。
    const requestOptions = {
      hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      ...common,
      agent: false,
    };
    req = isHttps
      ? https.request(requestOptions, onResponse)
      : http.request(requestOptions, onResponse);

    req.on("error", fail);
    // 总时限（而非 socket 空闲时限）：慢速分包也不能绕过 timeoutMs。
    timer = setTimeout(() => {
      const err = new SsrfBlockedError(`请求超时（${timeoutMs}ms）`, "timeout");
      req.destroy(err);
      fail(err);
    }, timeoutMs);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    if (!settled) {
      if (body !== undefined) req.write(body);
      req.end();
    }
  });
}
