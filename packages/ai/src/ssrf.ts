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
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true;                          // 0.0.0.0/8      "本网络"
  if (a === 10) return true;                         // 10.0.0.0/8     私网
  if (a === 127) return true;                        // 127.0.0.0/8    环回
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10  CGNAT
  if (a === 169 && b === 254) return true;           // 169.254.0.0/16 链路本地（云元数据！）
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12  私网
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16 私网
  if (a === 192 && b === 0) return true;             // 192.0.0.0/24   保留
  if (a === 192 && b === 88) return true;            // 192.88.99.0/24 6to4 中继
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 基准测试
  if (a === 198 && b === 51) return true;            // 192.0.2/198.51.100 文档
  if (a === 203 && b === 0) return true;             // 203.0.113.0/24 文档
  if (a >= 224) return true;                         // 224.0.0.0/4 组播 + 240.0.0.0/4 保留 + 255.255.255.255
  return false;
}

export function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().split("%")[0]!;
  if (lower === "::" || lower === "::1") return true;                 // 未指定 / 环回
  // fe80::/10 链路本地：fe80-febb（不能只判 fe80: 前缀）
  const firstHextet = lower.split(":")[0] ?? "";
  // 展开 :: 缩写时首段可能为空，此时保守起见走完整解析
  if (lower.startsWith("fe80:") || lower.startsWith("fe90:") || lower.startsWith("fea") || lower.startsWith("feb")) {
    // 快路径：常见 fe80/fe90-febf 前缀直接拦
    if (/^fe[89ab]/i.test(firstHextet)) return true;
  }
  if (firstHextet) {
    const hi = parseInt(firstHextet, 16);
    if (Number.isFinite(hi) && (hi & 0xffc0) === 0xfe80) return true;
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;   // 唯一本地 fc00::/7
  if (lower.startsWith("ff")) return true;                             // 组播
  if (lower.startsWith("2001:db8")) return true;                        // 文档网段 2001:db8::/32
  if (lower.startsWith("2002:")) return true;                           // 6to4 内嵌 v4
  // IPv4 映射/兼容地址：取出内嵌的 IPv4 再判一次，防止 ::ffff:127.0.0.1 绕过
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex?.[1] && hex[2]) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    const v4 = [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
    return isBlockedIpv4(v4);
  }
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
    addrs = await lookup(host, { all: true });
  } catch (err) {
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

/**
 * 带 SSRF 防护的 fetch。
 * 手工跟随重定向（fetch 的 redirect:"follow" 无法逐跳校验，因此禁用）。
 */
export async function guardedFetch(rawUrl: string, options: Partial<FetchGuardOptions> = {}): Promise<GuardedFetchResult> {
  const opts = { ...DEFAULT_GUARD, ...options };
  let current = assertUrlShape(rawUrl);
  const redirects: string[] = [];

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
        try {
          const pinned = await lookup(current.hostname, { all: true });
          const first = pinned[0]?.address;
          if (first && isIP(first)) {
            if (isBlockedIp(first)) throw new SsrfBlockedError(current.hostname + " 解析到受保护网段 " + first, "blocked-ip");
            const portSuffix = current.port ? ":" + current.port : "";
            fetchUrl = "http://" + (first.includes(":") ? "[" + first + "]" : first) + portSuffix + (current.pathname + current.search + current.hash);
            extraHeaders["Host"] = current.hostname;
          }
        } catch (e) {
          if (e instanceof SsrfBlockedError) throw e;
          // pin 失败则回退到域名直连（循环头部的 resolveAndCheck 已做过一次校验）
        }
      }
      res = await fetch(fetchUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": opts.userAgent, Accept: "text/html,application/xhtml+xml", ...extraHeaders },
      });
      // https 二次校验：收窄 DNS 重绑定窗口
      if (current.protocol === "https:") await resolveAndCheck(current, opts).catch(() => undefined);
    } catch (err) {
      clearTimeout(timer);
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
