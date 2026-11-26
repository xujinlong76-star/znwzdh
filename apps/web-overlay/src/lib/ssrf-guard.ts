import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { PassThrough, pipeline, Readable, Transform } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate, createZstdDecompress } from 'node:zlib'

/**
 * SSRF 防护（前端 apps/web 侧独立副本）。
 *
 * apps/web 不依赖 workspace 包，无法直接复用 packages/ai/src/ssrf.ts；
 * 这里是与其同源的独立实现（三层防护口径一致），后续若前端接入内部包再统一。
 *
 * 适用面：任何「用户可控输入 -> 服务端发起请求」的路由（website-metadata 等）。
 * 三层防护：
 *   1. 协议与形态白名单：只允许 http/https，禁止 URL 内嵌凭据与危险内网端口
 *   2. 解析后校验：先 DNS 解析再逐个检查 IP，挡 127.0.0.1.nip.io 指向内网的情况
 *   3. 重定向逐跳校验与 DNS 重绑定防护：手动跟随跳转，每一跳重新做 DNS + IP 校验，
 *      并用 node:http/https 的 lookup 回调把已校验 IP 固定到 socket；HTTPS 仍以
 *      原 hostname 做 SNI 与证书校验，agent:false 禁止跨策略复用连接。
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
 * 即使显式 allowPrivateNetworks=true 也永久拒绝的地址。
 *
 * 普通环回/私网/ULA 可以供本地开发或内网导航站使用；链路本地和云元数据
 * 端点不是普通内网服务，仍必须 fail-closed。IPv4 映射/兼容与 NAT64 形式
 * 要剥出内嵌 IPv4 再判，避免换一种文本写法就绕过。
 */
export function isAlwaysBlockedIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) {
    const [a, b, c, d] = ip.split('.').map(Number) as [number, number, number, number]
    if (a === 0) return true                              // 0.0.0.0/8
    if (a === 169 && b === 254) return true               // 链路本地 / 云元数据
    if (a === 100 && b === 100 && c === 100 && d === 200) return true // 阿里云元数据
    return false
  }
  if (version !== 6) return true                          // 非法地址 fail-closed

  const bytes = ipv6ToBytes(ip)
  if (!bytes) return true
  if (allZero(bytes, 0, 16)) return true                   // :: 未指定地址
  if (allZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isAlwaysBlockedIp(embeddedIpv4(bytes))         // ::ffff:a.b.c.d
  }
  if (allZero(bytes, 0, 12)) {
    // ::1 是普通环回，可由 allowPrivateNetworks 显式放行；其它 IPv4 兼容地址继续判内嵌 IPv4。
    if (bytes[15] === 1) return false
    return isAlwaysBlockedIp(embeddedIpv4(bytes))
  }
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return isAlwaysBlockedIp(embeddedIpv4(bytes))         // NAT64
  }
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true // fe80::/10
  // fd00:ec2::254（AWS IPv6 IMDS）：按 16 字节精确比较，覆盖所有展开/压缩写法。
  if (
    bytes[0] === 0xfd && bytes[1] === 0x00 && bytes[2] === 0x0e && bytes[3] === 0xc2 &&
    allZero(bytes, 4, 14) && bytes[14] === 0x02 && bytes[15] === 0x54
  ) return true
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
    const blocked = opts.allowPrivateNetworks ? isAlwaysBlockedIp(host) : isBlockedIp(host)
    if (blocked) {
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

  // 无论是否放行私网都必须检查全部 DNS 结果；混合结果中有一个不安全就整体拒绝。
  // allowPrivateNetworks 只放宽普通私网，不放行云元数据/链路本地等永久阻断地址。
  for (const record of records) {
    const blocked = opts.allowPrivateNetworks ? isAlwaysBlockedIp(record.address) : isBlockedIp(record.address)
    if (blocked) {
      throw new SsrfBlockedError(`${host} 解析到受保护地址: ${record.address}`)
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

export interface PinnedAddress {
  address: string
  family: number
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | PinnedAddress[],
  family?: number,
) => void

/**
 * node:http/https 的连接级 lookup：只返回本次已校验的 IP，不再触发 DNS。
 * Node 24 的 autoSelectFamily 默认传 all:true，必须回地址数组；旧形态回单地址。
 */
export function pinnedLookup(pinned: PinnedAddress): LookupFunction {
  const family = pinned.family === 6 ? 6 : 4
  return ((_hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
    if (options.all === true) {
      callback(null, [{ address: pinned.address, family }])
      return
    }
    callback(null, pinned.address, family)
  }) as LookupFunction
}

const SENSITIVE_REDIRECT_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization'])
const NO_RESPONSE_BODY_STATUS = new Set([204, 205, 304])

interface PreparedBody {
  data: string | Uint8Array | undefined
  contentType: string | undefined
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name)
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) delete headers[key]
  }
}

function normalizeHeaders(input: HeadersInit | undefined, userAgent: string): Record<string, string> {
  const normalized = new Headers(input)
  if (!normalized.has('user-agent')) normalized.set('user-agent', userAgent)
  const headers: Record<string, string> = {}
  normalized.forEach((value, key) => { headers[key] = value })
  return headers
}

async function prepareBody(input: BodyInit | null | undefined): Promise<PreparedBody> {
  if (input === undefined || input === null) return { data: undefined, contentType: undefined }
  if (typeof input === 'string') return { data: input, contentType: 'text/plain;charset=UTF-8' }
  if (input instanceof URLSearchParams) {
    return { data: input.toString(), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' }
  }
  if (input instanceof ArrayBuffer) return { data: new Uint8Array(input), contentType: undefined }
  if (ArrayBuffer.isView(input)) {
    return { data: new Uint8Array(input.buffer, input.byteOffset, input.byteLength), contentType: undefined }
  }
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return { data: new Uint8Array(await input.arrayBuffer()), contentType: input.type || undefined }
  }
  if (typeof FormData !== 'undefined' && input instanceof FormData) {
    const encoded = new Response(input)
    return {
      data: new Uint8Array(await encoded.arrayBuffer()),
      contentType: encoded.headers.get('content-type') ?? undefined,
    }
  }
  throw new TypeError('SSRF 守卫不支持流式请求体；请先缓冲为字符串或字节')
}

function incomingHeaders(rawHeaders: string[]): Headers {
  const headers = new Headers()
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) headers.append(rawHeaders[i]!, rawHeaders[i + 1]!)
  return headers
}

function contentDecoders(headers: Headers): Transform[] | null {
  const encodings = (headers.get('content-encoding') ?? '')
    .split(',')
    .map((encoding) => encoding.trim().toLowerCase())
    .filter(Boolean)
  const decoders: Transform[] = []
  // Content-Encoding 按列出顺序编码，必须按相反顺序解码。
  for (const encoding of encodings.reverse()) {
    switch (encoding) {
      case 'identity':
        break
      case 'gzip':
      case 'x-gzip':
        decoders.push(createGunzip())
        break
      case 'deflate':
        decoders.push(createInflate())
        break
      case 'br':
        decoders.push(createBrotliDecompress())
        break
      case 'zstd':
        decoders.push(createZstdDecompress())
        break
      default:
        return null
    }
  }
  return decoders
}

function createLimitTransform(maxBytes: number): Transform {
  let total = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.byteLength
      if (total > maxBytes) {
        callback(new SsrfBlockedError(`响应体过大: 超过 ${maxBytes} 字节`))
        return
      }
      callback(null, chunk)
    },
  })
}

function createResponsePipeline(
  incoming: http.IncomingMessage,
  headers: Headers,
  maxBytes: number,
  onError: (error: Error) => void,
): { stream: Readable; headers: Headers } {
  const decoders = contentDecoders(headers)
  const responseHeaders = new Headers(headers)
  if (decoders && decoders.length > 0) {
    responseHeaders.delete('content-encoding')
    responseHeaders.delete('content-length')
  }
  const transforms: Transform[] = [createLimitTransform(maxBytes), ...(decoders ?? [])]
  if (decoders && decoders.length > 0) transforms.push(createLimitTransform(maxBytes))
  const destination = new PassThrough()
  pipeline(incoming, ...transforms, destination, (error) => {
    if (error) onError(error)
  })
  return { stream: destination, headers: responseHeaders }
}

async function collectResponseBody(stream: Readable): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
    chunks.push(chunk)
    total += chunk.byteLength
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('The operation was aborted.', 'AbortError')
}

type RawResponse =
  | { kind: 'buffered'; status: number; headers: Headers; body: Uint8Array }
  | { kind: 'streaming'; status: number; headers: Headers; response: Response }

/**
 * 唯一真正发出网络包的地方。HTTP/HTTPS 都把已校验 IP 交给 lookup 固定到 socket；
 * HTTPS 的 hostname/servername 保留原域名，证书校验仍由 node:https 完成。
 */
function requestOnce(args: {
  url: URL
  hostname: string
  pinnedIp: string
  method: string
  headers: Record<string, string>
  body: string | Uint8Array | undefined
  timeoutMs: number
  maxBytes: number
  signal?: AbortSignal | null
  bufferBody: boolean
}): Promise<RawResponse> {
  const { url, hostname, pinnedIp, method, headers, body, timeoutMs, maxBytes, signal, bufferBody } = args
  const isHttps = url.protocol === 'https:'

  return new Promise<RawResponse>((resolvePromise, rejectPromise) => {
    const reqRef: { current?: http.ClientRequest } = {}
    const timerRef: { current?: ReturnType<typeof setTimeout> } = {}
    let incoming: http.IncomingMessage | undefined
    let settled = false

    const cleanup = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      signal?.removeEventListener('abort', onAbort)
    }
    const terminate = (error: Error) => {
      cleanup()
      // 先标记 settled，再 destroy；否则同步触发的 aborted/error 会覆盖原始超时或体积错误。
      if (!settled) {
        settled = true
        rejectPromise(error)
      }
      reqRef.current?.destroy(error)
      incoming?.destroy(error)
    }
    const onAbort = () => {
      const reason = signal?.reason
      terminate(reason instanceof Error ? reason : new DOMException('The operation was aborted.', 'AbortError'))
    }
    const fail = (error: Error) => {
      if (settled) return
      terminate(error)
    }
    const finishBuffered = (res: http.IncomingMessage, headers: Headers, body: Uint8Array) => {
      if (settled) return
      settled = true
      cleanup()
      resolvePromise({
        kind: 'buffered',
        status: res.statusCode ?? 500,
        headers,
        body,
      })
    }

    const requestHeaders = { ...headers }
    // 每跳按真实 body 重算长度，避免重定向后残留旧 Content-Length/Transfer-Encoding。
    deleteHeader(requestHeaders, 'content-length')
    deleteHeader(requestHeaders, 'transfer-encoding')
    if (body !== undefined) {
      requestHeaders['content-length'] = String(typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength)
    }

    const requestOptions: https.RequestOptions = {
      hostname,
      port: url.port ? Number(url.port) : (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: requestHeaders,
      agent: false,
      lookup: pinnedLookup({ address: pinnedIp, family: isIP(pinnedIp) }),
      ...(isHttps && isIP(hostname) === 0 ? { servername: hostname } : {}),
    }

    const onResponse = (res: http.IncomingMessage) => {
      incoming = res
      const status = res.statusCode ?? 500
      const hasNoBody = method === 'HEAD' || NO_RESPONSE_BODY_STATUS.has(status)
      const declared = Number(res.headers['content-length'] || '0')
      if (!hasNoBody && declared > maxBytes) {
        fail(new SsrfBlockedError(`响应体过大: ${declared} 字节`))
        return
      }

      try {
        const rawHeaders = incomingHeaders(res.rawHeaders)
        if (hasNoBody) res.resume()
        const { stream: bodyStream, headers: responseHeaders } = hasNoBody
          ? { stream: null, headers: rawHeaders }
          : createResponsePipeline(res, rawHeaders, maxBytes, (error) => {
              cleanup()
              fail(error)
            })

        if (!bufferBody) {
          const response = new Response(bodyStream ? Readable.toWeb(bodyStream) as unknown as ReadableStream<Uint8Array> : null, {
            status,
            statusText: res.statusMessage ?? '',
            headers: responseHeaders,
          })
          Object.defineProperty(response, 'url', { value: url.toString(), configurable: true })
          settled = true
          // 返回 Response 后继续计时，直到 body 读完/取消，慢速分包不能绕过总超时。
          res.once('end', cleanup)
          res.once('close', cleanup)
          res.once('error', cleanup)
          resolvePromise({ kind: 'streaming', status, headers: responseHeaders, response })
          return
        }

        void (bodyStream ? collectResponseBody(bodyStream) : Promise.resolve(new Uint8Array(0))).then((body) => {
          finishBuffered(res, responseHeaders, body)
        }, (error: unknown) => {
          fail(error instanceof Error ? error : new Error(String(error)))
        })
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    }

    reqRef.current = isHttps ? https.request(requestOptions, onResponse) : http.request(requestOptions, onResponse)
    const req = reqRef.current
    req.on('error', (error) => {
      if (incoming) incoming.destroy(error)
      else fail(error)
    })
    timerRef.current = setTimeout(() => {
      terminate(new DOMException(`请求超时（${timeoutMs}ms）`, 'TimeoutError'))
    }, timeoutMs)

    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (body !== undefined) req.write(body)
    req.end()
  })
}

function redirectedMethod(method: string, status: number): string {
  if (status === 303 && method !== 'GET' && method !== 'HEAD') return 'GET'
  if ((status === 301 || status === 302) && method === 'POST') return 'GET'
  return method
}

function stripSensitiveHeaders(headers: Record<string, string>): void {
  for (const key of Object.keys(headers)) {
    if (SENSITIVE_REDIRECT_HEADERS.has(key.toLowerCase())) delete headers[key]
  }
}

/**
 * 带 SSRF 防护的 fetch：手动跟随重定向，每一跳重新校验并固定 IP。
 * 返回结构与之前一致；自动解压响应，调用方仍可按解压后字节边读边截断。
 * @throws SsrfBlockedError 被防护拦截（调用方应转为 400 而非回源）
 */
export async function guardedFetch(
  rawUrl: string,
  options: Partial<GuardOptions> = {},
  init: RequestInit = {}
): Promise<GuardedFetchResult> {
  const opts = { ...DEFAULT_GUARD, ...options }
  let current = new URL(rawUrl)
  assertUrlShape(current)
  const carriedHeaders = normalizeHeaders(init.headers, opts.userAgent)
  let method = (init.method ?? 'GET').toUpperCase()
  const prepared = await prepareBody(init.body)
  let body = prepared.data
  if (body !== undefined && (method === 'GET' || method === 'HEAD')) {
    throw new TypeError('Request with GET/HEAD method cannot have body.')
  }
  if (prepared.contentType && !hasHeader(carriedHeaders, 'content-type')) {
    carriedHeaders['content-type'] = prepared.contentType
  }

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    throwIfAborted(init.signal)
    const resolvedIps = await resolveAndCheckAddresses(current, opts)
    const pinned = resolvedIps[0]
    if (!pinned) throw new SsrfBlockedError(`域名无可用地址: ${current.hostname}`)
    throwIfAborted(init.signal)

    const rawHost = current.hostname.replace(/^\[|\]$/g, '')
    const headers = { ...carriedHeaders, host: current.host }
    const result = await requestOnce({
      url: current,
      hostname: rawHost,
      pinnedIp: pinned,
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      timeoutMs: opts.timeoutMs,
      maxBytes: opts.maxBytes,
      signal: init.signal,
      bufferBody: false,
    })
    if (result.kind !== 'streaming') throw new Error('SSRF 请求层返回了意外响应')
    const { response } = result

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return { response, finalUrl: current.toString() }
      await response.body?.cancel().catch(() => { /* 连接已断开时忽略 */ })
      if (hop >= opts.maxRedirects) throw new SsrfBlockedError(`重定向次数超过上限 (${opts.maxRedirects})`)
      const next = new URL(location, current)
      assertUrlShape(next)
      if (next.origin !== current.origin) stripSensitiveHeaders(carriedHeaders)
      const nextMethod = redirectedMethod(method, response.status)
      if (nextMethod === 'GET' && method !== 'GET') {
        body = undefined
        deleteHeader(carriedHeaders, 'content-type')
      }
      method = nextMethod
      current = next
      continue
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
 * 本实现与 packages/ai/src/ssrf.ts 的 safeFetch 行为同源，由
 * apps/web/test/ssrf-parity.test.ts 守两侧口径；但**不 import** workspace 包
 * ——overlay 是独立可部署的 vendored 底座，依赖边界禁止 @navhub/*。
 *
 * 五道防线：协议/凭据/端口白名单 → DNS 后 IP 黑名单 → lookup 连接级 IP 钉扎
 * （HTTPS 保留原 hostname 的 SNI/证书校验）→ 手动重定向逐跳校验 →
 * 硬超时 + 响应体积上限。
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = { ...DEFAULT_GUARD, ...options }
  const allowedPorts = options.allowedPorts ?? [80, 443]
  let current = new URL(rawUrl)
  assertUrlShape(current)
  const redirects: string[] = []
  let method = (options.method ?? 'GET').toUpperCase()
  const prepared = await prepareBody(options.body)
  let body = prepared.data
  if (body !== undefined && (method === 'GET' || method === 'HEAD')) {
    throw new TypeError('Request with GET/HEAD method cannot have body.')
  }
  const carriedHeaders = normalizeHeaders(options.headers, opts.userAgent)
  if (prepared.contentType && !hasHeader(carriedHeaders, 'content-type')) {
    carriedHeaders['content-type'] = prepared.contentType
  }

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    assertUrlShape(current)
    const port = current.port ? Number(current.port) : current.protocol === 'https:' ? 443 : 80
    if (!allowedPorts.includes(port)) throw new SsrfBlockedError(`端口 ${port} 不在允许范围内`)

    const rawHost = current.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (!isHostAllowed(rawHost, options.allowedHosts)) {
      throw new SsrfBlockedError(`主机 ${rawHost} 不在域名白名单内`)
    }
    const resolvedIps = await resolveAndCheckAddresses(current, opts)
    const pinned = resolvedIps[0] ?? (isIP(rawHost) ? rawHost : null)
    if (!pinned) throw new SsrfBlockedError(`域名无可用地址: ${current.hostname}`)

    const hostname = current.hostname.replace(/^\[|\]$/g, '')
    const headers = { ...carriedHeaders, host: current.host }
    const result = await requestOnce({
      url: current,
      hostname,
      pinnedIp: pinned,
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      timeoutMs: opts.timeoutMs,
      maxBytes: opts.maxBytes,
      bufferBody: true,
    })
    if (result.kind !== 'buffered') throw new Error('SSRF 请求层返回了意外响应')

    if (result.status >= 300 && result.status < 400) {
      const location = result.headers.get('location')
      if (!location) return finishSafe(result, current.toString(), pinned, redirects)
      if (redirects.length >= opts.maxRedirects) {
        throw new SsrfBlockedError(`重定向次数超过上限 (${opts.maxRedirects})`)
      }
      const next = new URL(location, current)
      assertUrlShape(next)
      redirects.push(current.toString())
      if (next.origin !== current.origin) stripSensitiveHeaders(carriedHeaders)
      const nextMethod = redirectedMethod(method, result.status)
      if (nextMethod === 'GET' && method !== 'GET') {
        body = undefined
        deleteHeader(carriedHeaders, 'content-type')
      }
      method = nextMethod
      current = next
      continue
    }
    return finishSafe(result, current.toString(), pinned, redirects)
  }
  throw new SsrfBlockedError(`重定向次数超过上限 (${opts.maxRedirects})`)
}

function finishSafe(
  response: { status: number; headers: Headers; body: Uint8Array },
  finalUrl: string,
  pinnedIp: string | null,
  redirects: string[],
): SafeFetchResult {
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    headers: response.headers,
    body: response.body,
    finalUrl,
    pinnedIp,
    redirects,
  }
}
