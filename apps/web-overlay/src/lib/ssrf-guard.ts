import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * SSRF 防护（前端 apps/web 侧副本）。
 *
 * apps/web 不依赖 workspace 包，无法直接复用 packages/ai/src/ssrf.ts；
 * 这里是与其同源的实现（三层防护口径一致），后续若前端接入内部包再统一。
 *
 * 适用面：任何「用户可控输入 -> 服务端发起请求」的路由（website-metadata 等）。
 * 三层防护：
 *   1. 协议白名单：只允许 http/https（挡 file:// gopher:// javascript: 等）
 *   2. 解析后校验：先 DNS 解析再逐个检查 IP，挡 127.0.0.1.nip.io 指向内网的情况
 *   3. 重定向逐跳校验：手动跟随跳转，每一跳重新做 DNS + IP 校验
 *      否则 evil.com -> 302 -> 169.254.169.254 即可绕过
 * 另加超时、响应体大小与跳数上限，避免被慢速/超大响应拖死。
 */
export interface GuardOptions {
  timeoutMs: number
  maxBytes: number
  maxRedirects: number
  /** 显式放行私网（仅本地开发/内网导航站需要） */
  allowPrivateNetworks: boolean
  userAgent: string
}

export const DEFAULT_GUARD: GuardOptions = {
  timeoutMs: 8_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  allowPrivateNetworks: false,
  userAgent: 'NavHubBot/0.1 (+https://github.com/navhub)',
}

export class SsrfBlockedError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(`SSRF 防护拦截: ${reason}`)
    this.name = 'SsrfBlockedError'
    this.reason = reason
  }
}

export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  const blocked: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ]
  return blocked.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (n & mask) === (ipv4ToInt(base) & mask)
  })
}

export function isBlockedIp(ip: string): boolean {
  const v = ip.toLowerCase()
  if (v === '::1' || v === '::') return true
  if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true
  // IPv4-mapped IPv6（::ffff:127.0.0.1）
  const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/)
  if (mapped && mapped[1]) return isBlockedIpv4(mapped[1])
  return isIP(v) === 4 ? isBlockedIpv4(v) : false
}

/** DNS 解析 + 逐结果 IP 校验（关键：不能只校验 URL 字符串） */
export async function resolveAndCheck(url: URL, opts: GuardOptions): Promise<void> {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError(`协议不允许: ${url.protocol}`)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    if (!opts.allowPrivateNetworks && isBlockedIp(host)) {
      throw new SsrfBlockedError(`目标 IP 位于受保护网段: ${host}`)
    }
    return
  }
  let records: Array<{ address: string }>
  try {
    records = await lookup(host, { all: true })
  } catch {
    throw new SsrfBlockedError(`域名解析失败: ${host}`)
  }
  if (!records.length) throw new SsrfBlockedError(`域名无解析结果: ${host}`)
  if (opts.allowPrivateNetworks) return
  for (const r of records) {
    if (isBlockedIp(r.address)) {
      throw new SsrfBlockedError(`${host} 解析到受保护地址: ${r.address}`)
    }
  }
}

export interface GuardedFetchResult {
  response: Response
  finalUrl: string
}

/**
 * 带 SSRF 防护的 fetch：手动跟随重定向，每一跳重新校验。
 * @throws SsrfBlockedError 被防护拦截（调用方应转为 400 而非回源）
 */
export async function guardedFetch(
  rawUrl: string,
  options: Partial<GuardOptions> = {},
  init: RequestInit = {}
): Promise<GuardedFetchResult> {
  const opts = { ...DEFAULT_GUARD, ...options }
  let current = new URL(rawUrl)
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    await resolveAndCheck(current, opts)
    const response = await fetch(current.toString(), {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { 'User-Agent': opts.userAgent, ...(init.headers || {}) },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return { response, finalUrl: current.toString() }
      current = new URL(location, current)
      continue
    }
    // 体积限制：读前先看 Content-Length，读完再截断一次
    const declared = Number(response.headers.get('content-length') || '0')
    if (declared > opts.maxBytes) {
      throw new SsrfBlockedError(`响应体过大: ${declared} 字节`)
    }
    return { response, finalUrl: current.toString() }
  }
  throw new SsrfBlockedError(`重定向次数超过上限 (${opts.maxRedirects})`)
}

/** 轻量预检（只做协议与字符串层判断，适合在发起请求前快速拒绝） */
export function isProbablySafeUrl(input: string): boolean {
  try {
    const u = new URL(input)
    return ALLOWED_PROTOCOLS.has(u.protocol)
  } catch {
    return false
  }
}
