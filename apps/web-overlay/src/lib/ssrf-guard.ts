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

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b, c] = parts as [number, number, number, number]
  if (a === 0) return true                              // 0.0.0.0/8
  if (a === 10) return true                             // 10.0.0.0/8
  if (a === 127) return true                            // 127.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true     // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true               // 169.254.0.0/16 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true      // 172.16.0.0/12
  if (a === 192 && b === 168) return true               // 192.168.0.0/16
  // 保留网段必须精确到 /24：只比较前两段会误伤 192.0.1.x/192.88.1.x 等正常公网，
  // 同时漏掉 192.0.2.0/24（TEST-NET-1）。两处实现（core 与本镜像）保持一致。
  if (a === 192 && b === 0 && c === 0) return true      // 192.0.0.0/24 IETF 保留
  if (a === 192 && b === 0 && c === 2) return true      // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true    // 192.88.99.0/24 6to4 中继
  if (a === 198 && (b === 18 || b === 19)) return true  // 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true   // 198.51.100.0/24 文档
  if (a === 203 && b === 0 && c === 113) return true    // 203.0.113.0/24 文档
  if (a >= 224) return true                             // 组播 + 保留
  return false
}

/**
 * IPv6 文本 → 16 字节。
 *
 * 不能靠字符串前缀判断：`::ffff:127.0.0.1`、`::ffff:7f00:1`、
 * `0:0:0:0:0:ffff:127.0.0.1`、`::127.0.0.1` 是同一个地址的不同写法，
 * 前缀匹配必然漏掉一部分，而漏掉的那个就是 SSRF 绕过口子。
 */
function ipv6ToBytes(input: string): Uint8Array | null {
  let s = input.toLowerCase().split('%')[0] ?? ''
  if (!s || !s.includes(':')) return null

  if (s.includes('.')) {
    const idx = s.lastIndexOf(':')
    if (idx < 0) return null
    const v4 = s.slice(idx + 1).split('.').map((p) => Number(p))
    if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16)
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16)
    s = s.slice(0, idx + 1) + hi + ':' + lo
  }

  const halves = s.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : []

  let groups: string[]
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length
    if (missing < 0) return null
    groups = [...left, ...Array<string>(missing).fill('0'), ...right]
  } else {
    if (left.length !== 8) return null
    groups = left
  }

  const bytes = new Uint8Array(16)
  for (let i = 0; i < 8; i++) {
    const g = groups[i]!
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    const v = Number.parseInt(g, 16)
    bytes[i * 2] = v >> 8
    bytes[i * 2 + 1] = v & 0xff
  }
  return bytes
}

function allZero(bytes: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (bytes[i] !== 0) return false
  return true
}

function embeddedIpv4(bytes: Uint8Array): string {
  return [bytes[12], bytes[13], bytes[14], bytes[15]].join('.')
}

export function isBlockedIp(ip: string): boolean {
  const v = ip.toLowerCase()
  if (isIP(v) === 4) return isBlockedIpv4(v)
  if (isIP(v) !== 6) return false

  const b = ipv6ToBytes(v)
  if (!b) return true // 解析不了 → fail closed
  if (allZero(b, 0, 16)) return true                                  // ::
  if (allZero(b, 0, 15) && b[15] === 1) return true                   // ::1
  if (allZero(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) {        // ::ffff:v4
    return isBlockedIpv4(embeddedIpv4(b))
  }
  if (allZero(b, 0, 12)) return isBlockedIpv4(embeddedIpv4(b))        // ::v4（IPv4 兼容）
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return isBlockedIpv4(embeddedIpv4(b))                             // NAT64 64:ff9b::/96
  }
  if (b[0] === 0x20 && b[1] === 0x02) return true                      // 6to4 2002::/16
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true // Teredo
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true // 2001:db8::/32
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return true           // fe80::/10
  if ((b[0]! & 0xfe) === 0xfc) return true                            // fc00::/7
  if (b[0] === 0xff) return true                                      // ff00::/8
  if (b[0] === 0x01 && b[1] === 0x00 && allZero(b, 2, 8)) return true // 100::/64 丢弃前缀
  return false
}

/**
 * 带超时的 DNS 解析。
 *
 * `lookup()` 本身没有超时；弱网或恶意域名可以让请求在 DNS 阶段无限挂起，
 * 此时 fetch 的 AbortSignal 还没开始计时。超时按 fail-closed 处理。
 */
async function lookupWithTimeout(host: string, timeoutMs: number): Promise<Array<{ address: string }>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SsrfBlockedError(`DNS 解析超时: ${host}`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
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
    records = await lookupWithTimeout(host, opts.timeoutMs)
  } catch (err) {
    // DNS 超时是安全拦截，保留原始错误类型；其它解析失败统一收敛
    if (err instanceof SsrfBlockedError) throw err
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
      // 释放中间响应体，避免长连接一直挂在连接池里
      await response.body?.cancel().catch(() => { /* 连接已断开时忽略 */ })
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

/**
 * 边读边计数地读取响应体，超过上限立即中断。
 *
 * 为什么不能只信 Content-Length：分块传输（chunked）可以完全不发这个头，
 * 或者发一个远小于实际体量的假值。只做头部校验等于给攻击者留了一条
 * 「让服务端把 2GB 读进内存」的路 —— 必须按实际字节数截断。
 */
export async function readBodyLimited(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const body = response.body
  if (!body) return { bytes: new Uint8Array(0), truncated: false }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        chunks.push(value.subarray(0, Math.max(0, value.byteLength - (total - maxBytes))))
        truncated = true
        break
      }
      chunks.push(value)
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => { /* 截断后取消底层流，网络已中断时忽略残留异常 */ })
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.byteLength
  }
  return { bytes: merged, truncated }
}

/** 同 readBodyLimited，但按 UTF-8 解码为文本（用于 HTML 元数据抽取） */
export async function readTextLimited(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const { bytes, truncated } = await readBodyLimited(response, maxBytes)
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), truncated }
}
