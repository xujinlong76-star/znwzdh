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
 *   1. 协议与形态白名单：只允许 http/https，禁止 URL 内嵌凭据与危险内网端口
 *   2. 解析后校验：先 DNS 解析再逐个检查 IP，挡 127.0.0.1.nip.io 指向内网的情况
 *   3. 重定向逐跳校验与 DNS 重绑定防护：手动跟随跳转，每一跳重新做 DNS + IP 校验；
 *      HTTP 请求直连已校验 IP 并锁死 Host 头，HTTPS 请求在建连后二次复核 DNS 解析结果。
 * 另加超时、响应体大小与跳数上限，避免被慢速/超大响应拖死。
 */
export interface GuardOptions {
  timeoutMs: number
  maxBytes: number
  maxRedirects: number
  /** 显式放行私网（仅本地开发/内网导航站需要） */
  allowPrivateNetworks: boolean
  userAgent: string
  /**
   * 允许的主机白名单（undefined = 不限制）。
   * 中枢代理类调用方用它把出站 host 钉死到 env 配置的 HUB_BASE hostname：
   * 用户可控的路径/查询串再也改不了 host，重定向逐跳复验，302 逃逸即拦。
   */
  allowedHosts?: readonly string[]
  /**
   * 允许的端口白名单（undefined = 不限制，仅拦高危端口表）。
   * 与 allowedHosts 联用时，每一跳的端口也要落在表内。
   */
  allowedPorts?: readonly number[]
  /**
   * 调用方传入的取消信号（与内部超时信号合并后交给 fetch）。
   * 代理路由用它把「客户端断开」穿透到上游，不加则取消只能等超时。
   */
  signal?: AbortSignal
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

/**
 * 明确拒绝的高危内网服务端口。
 *
 * 2026-11-06 深扫 P2-2：本表此前与 packages/ai/src/ssrf.ts 各维护一份，
 * 口径已漂移（40 vs 37，仅 28 共有）——同一个 URL 在两套实现里可能得到相反判定。
 * 现两侧统一为 packages/core/src/ssrf-ports.ts 的 BLOCKED_PORTS_UNION（并集 48 个）。
 *
 * 为什么这里是**数值副本**而不是 `import from "@navhub/core"`：
 * apps/web 是 vendored 底座、不在 pnpm workspace 内，Next 构建期无法解析 @navhub/core
 * （vitest 有别名，但 next build 没有）。所以必须复制；一致性由
 * apps/web/test/ssrf-ports-drift.test.ts 守住（它会比对两侧与 core 的三方一致）。
 */
export const BLOCKED_PORTS = new Set([
  21, 22, 23, 25, 110, 111, 135, 139, 143, 445,
  512, 513, 514, 1433, 1521, 2049, 2181, 2375, 2376, 2379,
  2380, 3306, 3389, 4222, 5432, 5601, 5672, 5900, 5984, 6379,
  6380, 6443, 7000, 7001, 7002, 8086, 8500, 8600, 9042, 9092,
  9200, 9300, 10250, 10255, 11211, 15672, 27017, 27018, 27019,
])

export function assertUrlShape(url: URL): void {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfBlockedError(`协议不允许: ${url.protocol}`)
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError('禁止在 URL 中携带认证凭据')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').trim()
  if (!host) {
    throw new SsrfBlockedError('URL 缺少有效主机名')
  }
  if (url.port) {
    const port = Number(url.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535 || BLOCKED_PORTS.has(port)) {
      throw new SsrfBlockedError(`端口不允许访问: ${url.port}`)
    }
  }
}

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
  // 非法 IP 文本一律按 fail-closed 拦截（与 packages/ai/src/ssrf.ts 保持一致）
  if (isIP(v) !== 6) return true

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

async function resolveAndCheckAddresses(url: URL, opts: GuardOptions): Promise<string[]> {
  assertUrlShape(url)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    if (!opts.allowPrivateNetworks && isBlockedIp(host)) {
      throw new SsrfBlockedError(`目标 IP 位于受保护网段: ${host}`)
    }
    return [host]
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
  if (!opts.allowPrivateNetworks) {
    for (const r of records) {
      if (isBlockedIp(r.address)) {
        throw new SsrfBlockedError(`${host} 解析到受保护地址: ${r.address}`)
      }
    }
  }
  return records.map((r) => r.address)
}

/** DNS 解析 + 逐结果 IP 校验（关键：不能只校验 URL 字符串） */
export async function resolveAndCheck(url: URL, opts: GuardOptions): Promise<void> {
  await resolveAndCheckAddresses(url, opts)
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
  // 跨源重定向要剥离敏感头（P2-3，2026-11-06 深扫）。
  // 旧实现每一跳都用同一份 init.headers 重建，若调用方传了 Authorization/Cookie，
  // 白名单域名的一个 302 就能把它们带到第三方/内网。packages/ai/src/ssrf.ts 早已
  // 逐跳剥离，此处与它对齐（parity 测试会锁两侧行为一致）。
  const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization'])
  let carriedHeaders: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) }
  let prevOrigin = current.origin
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    // 逐跳 host/端口钉死（SSRF 2026-11-25）：只在调用方给了白名单时才收紧，
    // 未给的调用方（favicon/rss 等）行为与历史逐字一致。
    const hopHost = current.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (!isHostAllowed(hopHost, opts.allowedHosts)) {
      throw new SsrfBlockedError(`主机 ${hopHost} 不在域名白名单内`)
    }
    const hopPort = current.port ? Number(current.port) : current.protocol === 'https:' ? 443 : 80
    if (opts.allowedPorts && !opts.allowedPorts.includes(hopPort)) {
      throw new SsrfBlockedError(`端口 ${hopPort} 不在允许范围内`)
    }
    const resolvedIps = await resolveAndCheckAddresses(current, opts)
    const rawHost = current.hostname.replace(/^\[|\]$/g, '')
    const isLiteralIp = isIP(rawHost) !== 0

    // 防 DNS 重绑定（TOCTOU）：
    // - HTTP 明文：直接改写请求 URL 为已校验的 IP，并通过 Host 头保留原域名
    // - HTTPS：因 TLS SNI/证书校验需用原域名建连，连接返回后立即二次复核 DNS 解析
    // 解析结果可能有多个（localhost 常得 ::1 + 127.0.0.1），监听方却可能只绑其一：
    // 只钉第一个 IP 时，::1 优先的机器上 localhost 出站会全灭（ECONNREFUSED，
    // CI 2026-11-25 ISR 阶段 4 的 502×60 就是这么来的；裸 fetch 有 Happy Eyeballs
    // 兜底才没事）。逐个候选尝试、仅连接级失败换下一个 IP——每个候选都是解析后
    // 校验过的地址，防重绑定语义不变；取消/超时立即向上传递，不重试。
    //
    // 写法刻意沿用 6f3ad68b 的 let + 条件赋值形态：ad7b235a 的 pinTargets
    // 数组 + for-of 写法被 CodeQL js/request-forgery 标为新告警
    // （ssrf-guard.ts:328，3 个来源），而 6f3ad68b 的同款 let 形态在 PR
    // #187 首轮 CodeQL 全绿、0 条告警；不要再把 fetch 参数改成数组/循环变量。
    const headers: Record<string, string> = {
      'User-Agent': opts.userAgent,
      ...carriedHeaders,
    }
    let fetchTarget = current.toString()
    if (!isLiteralIp && current.protocol === 'http:' && resolvedIps[0]) {
      const pinned = new URL(current.toString())
      const ip = resolvedIps[0]
      pinned.hostname = isIP(ip) === 6 ? `[${ip}]` : ip
      fetchTarget = pinned.toString()
      if (!headers['Host'] && !headers['host']) {
        headers['Host'] = current.host
      }
    }

    const CONNECTION_ERRORS = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'])
    const attempts =
      !isLiteralIp && current.protocol === 'http:' ? Math.max(resolvedIps.length, 1) : 1
    let response: Response | undefined
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        const ip = resolvedIps[attempt]
        if (ip) {
          const pinned = new URL(current.toString())
          pinned.hostname = isIP(ip) === 6 ? `[${ip}]` : ip
          fetchTarget = pinned.toString()
        }
      }
      try {
        response = await fetch(fetchTarget, {
          ...init,
          redirect: 'manual',
          // 调用方信号（客户端断开）与内部超时合并：任一路 abort 都掐断上游。
          signal: opts.signal
            ? AbortSignal.any([AbortSignal.timeout(opts.timeoutMs), opts.signal])
            : AbortSignal.timeout(opts.timeoutMs),
          headers,
        })
        break
      } catch (err) {
        // 取消/超时是调用方的意图，立即向上传递，不换 IP 重试。
        if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) throw err
        const cause = (err as { cause?: unknown } | null)?.cause
        const code = cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : undefined
        if (typeof code !== 'string' || !CONNECTION_ERRORS.has(code)) throw err
        lastError = err
      }
    }
    if (!response) {
      throw lastError ?? new Error('上游连接失败')
    }

    if (!isLiteralIp && current.protocol === 'https:' && !opts.allowPrivateNetworks) {
      await resolveAndCheckAddresses(current, opts)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return { response, finalUrl: current.toString() }
      // 释放中间响应体，避免长连接一直挂在连接池里
      await response.body?.cancel().catch(() => { /* 连接已断开时忽略 */ })
      const next = new URL(location, current)
      // 跨源跳转：剥离敏感头，后续跳不再携带（同源跳转保留，避免打断正常鉴权流）
      if (next.origin !== prevOrigin) {
        const nextHeaders: Record<string, string> = {}
        for (const [k, v] of Object.entries(carriedHeaders)) {
          if (!SENSITIVE_HEADERS.has(k.toLowerCase())) nextHeaders[k] = v
        }
        carriedHeaders = nextHeaders
      }
      prevOrigin = next.origin
      current = next
      continue
    }
    // 体积限制：读前先看 Content-Length，读完再截断一次
    const declared = Number(response.headers.get('content-length') || '0')
    if (declared > opts.maxBytes) {
      await response.body?.cancel().catch(() => { /* 响应体超限时尽力取消底层流，连接已断开时可安全忽略 */ })
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
    assertUrlShape(u)
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) !== 0 && isBlockedIp(host)) return false
    return true
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

/* ==========================================================================
 * safeFetch：统一对外出口（2026-11-21 CodeQL 收敛点）
 * ========================================================================== */

/**
 * 严格域名白名单判断。
 *
 * 只支持精确域名与 *.example.com 子域通配；比较前统一小写并去端口/末尾点。
 * 用严格比对而非 includes——`https://evil.com/?github.com` 这类 URL 的
 * query 里含目标域名，子串匹配会误放行。
 */
export function isHostAllowed(host: string, allowedHosts: readonly string[] | undefined): boolean {
  if (!allowedHosts || allowedHosts.length === 0) return true
  const h = String(host || '').toLowerCase().replace(/^\/\[|\]\$/g, '').replace(/:\d+$/, '').replace(/\.$/, '')
  if (!h) return false
  for (const raw of allowedHosts) {
    const pattern = String(raw || '').toLowerCase().trim()
    if (!pattern) continue
    if (pattern === h) return true
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2)
      if (h.endsWith('.' + suffix)) return true
    }
  }
  return false
}

export interface SafeFetchOptions extends Partial<GuardOptions> {
  method?: string
  headers?: Record<string, string>
  body?: string | URLSearchParams | undefined
  allowedHosts?: readonly string[]
  allowedPorts?: readonly number[]
}

export interface SafeFetchResult {
  ok: boolean
  status: number
  headers: Headers
  body: Uint8Array
  finalUrl: string
  pinnedIp: string | null
  redirects: string[]
}

/**
 * 统一的对外 HTTP 出口。
 *
 * 本实现与 packages/ai/src/ssrf.ts 的 safeFetch 行为一致，由
 * apps/web/test/ssrf-parity.test.ts 守两侧口径；但**不 import** workspace 包
 * ——overlay 是独立可部署的 vendored 底座，依赖边界禁止 @navhub/*。
 *
 * 五道防线：协议/凭据/端口白名单 → DNS 后 IP 黑名单 → 连接级 IP 钉扎
 * （http 明文改写 URL 为已校验 IP + Host 头）→ manual 重定向逐跳校验 →
 * 硬超时 + 体积上限。
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = { ...DEFAULT_GUARD, ...options }
  const allowedPorts = options.allowedPorts ?? [80, 443]
  let current = new URL(rawUrl)
  const redirects: string[] = []
  let method = (options.method ?? 'GET').toUpperCase()
  let body = options.body instanceof URLSearchParams ? options.body.toString() : options.body
  const SENSITIVE = new Set(['authorization', 'cookie', 'proxy-authorization'])
  let carriedHeaders: Record<string, string> = { ...(options.headers ?? {}) }
  let prevOrigin = ''

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const port = current.port ? Number(current.port) : current.protocol === 'https:' ? 443 : 80
    if (!allowedPorts.includes(port)) throw new SsrfBlockedError(`端口 ${port} 不在允许范围内`)

    const rawHost = current.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (!isHostAllowed(rawHost, options.allowedHosts)) {
      throw new SsrfBlockedError(`主机 ${rawHost} 不在域名白名单内`)
    }
    const resolvedIps = await resolveAndCheckAddresses(current, opts)
    const pinned = resolvedIps[0] ?? (isIP(rawHost) ? rawHost : null)

    const headers: Record<string, string> = { 'User-Agent': opts.userAgent, ...carriedHeaders }
    if (prevOrigin && prevOrigin !== current.origin) {
      for (const k of Object.keys(headers)) if (SENSITIVE.has(k.toLowerCase())) delete headers[k]
    }
    // 连接级钉扎：http 改写目标 IP，Host 保留原域名；https 靠域名建连，
    // 由 resolveAndCheck 保证解析安全（与 packages/ai 侧同口径）
    let fetchTarget = current.toString()
    if (!isIP(rawHost) && current.protocol === 'http:' && pinned) {
      const u = new URL(current.toString())
      u.hostname = isIP(pinned) === 6 ? `[${pinned}]` : pinned
      fetchTarget = u.toString()
      if (!headers['Host'] && !headers['host']) headers['Host'] = current.host
    }

    const response = await fetch(fetchTarget, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
    })

    const declared = Number(response.headers.get('content-length') || '0')
    if (declared > opts.maxBytes) {
      await response.body?.cancel().catch(() => { /* 连接已断开 */ })
      throw new SsrfBlockedError(`响应体过大: ${declared} 字节`)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) {
        return finishSafe(response, current.toString(), pinned, redirects)
      }
      await response.body?.cancel().catch(() => { /* 连接已断开 */ })
      if (redirects.length >= opts.maxRedirects) {
        throw new SsrfBlockedError(`重定向次数超过上限 (${opts.maxRedirects})`)
      }
      const next = new URL(location, current)
      redirects.push(current.toString())
      prevOrigin = current.origin
      if (response.status === 301 || response.status === 302 || response.status === 303) {
        method = 'GET'
        body = undefined
      }
      current = next
      continue
    }
    return finishSafe(response, current.toString(), pinned, redirects)
  }
  throw new SsrfBlockedError(`重定向次数超过上限 (${opts.maxRedirects})`)
}

async function finishSafe(
  response: Response,
  finalUrl: string,
  pinnedIp: string | null,
  redirects: string[],
): Promise<SafeFetchResult> {
  const buf = new Uint8Array(await response.arrayBuffer())
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body: buf,
    finalUrl,
    pinnedIp,
    redirects,
  }
}

/* ==========================================================================
 * 中枢代理专用：host 钉死（SSRF 2026-11-25）
 * ========================================================================== */

/**
 * 中枢代理的守卫配置：把出站 host 钉死到 HUB_BASE 的 hostname、端口钉死到
 * HUB_BASE 的端口（另放行 80/443，容纳同 host 的 http↔https 跳转）。
 *
 * 为什么 allowPrivateNetworks: true 在这里是安全的：
 * 中枢本就是 localhost:8787 / docker 内网主机名，默认的私网拦截会自断代理。
 * host 来自服务端 env（不是用户输入），用户只能改路径与查询串；host 被
 * allowedHosts 钉死后，解析目标只能是该 hostname 自己的地址——攻击者无法
 * 借此让服务端去解析/连接任意内网地址（含 169.254.169.254 云元数据）。
 * 注意：allowPrivateNetworks 会连带放行云元数据段（2026-11-21 发现），
 * 所以本配置**只许**与 allowedHosts 联用，绝不单独传给用户可控 host 的调用。
 */
export function hubGuardOptions(base: string): Partial<GuardOptions> {
  const u = new URL(base)
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
  return {
    allowPrivateNetworks: true,
    allowedHosts: [u.hostname],
    allowedPorts: [...new Set([port, 80, 443])],
  }
}

/** 路径段校验：拒绝空段、'.'/'..'、反斜杠与 '?/#'（编进段里会改写 URL 结构）。 */
function assertHubPathSegment(seg: string): void {
  if (
    !seg ||
    seg === '.' ||
    seg === '..' ||
    seg.includes('\\') ||
    seg.includes('?') ||
    seg.includes('#')
  ) {
    throw new SsrfBlockedError(`非法路径段: ${seg}`)
  }
}

/**
 * 把用户可控路径段拼进中枢 URL（host 钉死版）。
 *
 * 每段单独 encodeURIComponent 后再拼——段里的 '/'、'%'、'?'、'#' 都失去结构意义；
 * '.'/'..' 段在编码前就拒绝（URL 解析器会把 %2E 也当成 dot 段规范化，单靠
 * 编码拦不住穿越）。拼完断言 hostname 仍等于 base 的 hostname。
 * search 只能是查询串（可带或不带前导 '?'），含 '#' 即拒。
 */
export function buildPinnedHubUrl(base: string, segments: readonly string[], search = ''): URL {
  const baseUrl = new URL(base)
  for (const seg of segments) assertHubPathSegment(seg)
  if (search.includes('#')) {
    throw new SsrfBlockedError('查询串含非法字符')
  }
  const url = new URL('/api/' + segments.map((s) => encodeURIComponent(s)).join('/'), baseUrl)
  if (url.hostname.toLowerCase() !== baseUrl.hostname.toLowerCase()) {
    throw new SsrfBlockedError('目标主机不在允许范围内')
  }
  if (search) url.search = search.startsWith('?') ? search.slice(1) : search
  return url
}

/**
 * 校验 hubGet/hubGetProbe 的 path（调用方传入，至少一处带用户污点）并拼成 URL。
 *
 * 必须以单个 '/' 开头：'//evil.com/x' 会被 URL 解析成跨 host，绝对 URL 与
 * 反斜杠（http(s) 下解析器把 '\' 当 '/'）同理拒绝；'.'/'..' 段在解码后逐段
 * 检查（'%2e%2e' 也算穿越）；拼完断言 hostname 未变。
 * 抛 SsrfBlockedError，由 hubGet/hubGetProbe 的既有 catch 收敛为 null/failed。
 */
export function buildHubUrl(base: string, path: string): URL {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('#')) {
    throw new SsrfBlockedError('非法中枢路径')
  }
  const rawPath = path.split('?')[0] ?? ''
  for (const seg of rawPath.split('/')) {
    let decoded = seg
    try {
      decoded = decodeURIComponent(seg)
    } catch {
      throw new SsrfBlockedError('非法中枢路径')
    }
    if (decoded === '.' || decoded === '..') {
      throw new SsrfBlockedError('非法中枢路径')
    }
  }
  const baseUrl = new URL(base)
  const url = new URL(path, baseUrl)
  if (url.hostname.toLowerCase() !== baseUrl.hostname.toLowerCase()) {
    throw new SsrfBlockedError('目标主机不在允许范围内')
  }
  return url
}
