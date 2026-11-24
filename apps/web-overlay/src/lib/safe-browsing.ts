/**
 * Google Safe Browsing v4 接入（仅服务端用，绝不在客户端 import）。
 *
 * 用途：品牌认官网第二步（W3）。对单个或一批 URL 问 Google Safe Browsing
 * 是否命中已知威胁，并用 node:tls 直读目标主机的证书签发者与有效期。
 * 只返回公开的域名/证书/安全事实；拿不到的写“未查到/未公开”，不编结论。
 *
 * 诚实口径（与 verified-brands.ts 同一条线）：
 * - API key 只从环境变量 NAVHUB_SAFE_BROWSING_API_KEY 读，绝不硬编码、
 *   绝不写进仓库、绝不出现在返回体与错误原因里。
 * - 无 key 时不发请求、不猜结论，返回 status "unavailable" 并写明原因。
 * - 有 key 但请求失败（网络错、非 2xx、响应解析失败）返回 status "unknown"，
 *   同样只写失败事实，不把“查不到”等同于“安全”。
 * - 有命中时只原样返回 Google 的 threatType（如 MALWARE），不写自封结论；
 *   无命中时 status "safe" 的含义只是“本次查询 Google 未返回任何命中”，
 *   不是对该站点的全面安全背书。
 * - 证书查不到（握手失败、超时、无证书、SSRF 拦截）返回 certificate: null
 *   并写明原因，不编签发者与有效期。
 * - 本模块不缓存、不记日志、不持久化任何被查 URL。
 */
import { connect, type PeerCertificate } from 'node:tls'
import { isIP } from 'node:net'
import { DEFAULT_GUARD, resolveAndCheck, SsrfBlockedError } from './ssrf-guard'

export const SAFE_BROWSING_SOURCE = 'Google Safe Browsing'

const SAFE_BROWSING_API_URL =
  'https://safebrowsing.googleapis.com/v4/threatMatches:find'

/** Google Safe Browsing API v4 单次请求最多 500 条 threatEntries */
const MAX_URLS_PER_REQUEST = 500
const SAFE_BROWSING_TIMEOUT_MS = 8_000
const CERTIFICATE_TIMEOUT_MS = 8_000
const MAX_URL_LENGTH = 2048

const API_KEY_ENV = 'NAVHUB_SAFE_BROWSING_API_KEY'

/**
 * 向 Google 查询的威胁类型（照抄 Safe Browsing API v4 的 threatType 枚举，
 * 不自造类型；返回的命中 threatType 也是 Google 原样）。
 */
const THREAT_TYPES = [
  'MALWARE',
  'SOCIAL_ENGINEERING',
  'UNWANTED_SOFTWARE',
  'POTENTIALLY_HARMFUL_APPLICATION',
] as const

export type SafeBrowsingStatus = 'safe' | 'unsafe' | 'unknown' | 'unavailable'

/** 一条 Google 原样命中：threatType 只照抄 Google 返回值，不改写、不翻译。 */
export interface SafeBrowsingMatch {
  /** Google 返回的 threatType 原值，如 MALWARE */
  threatType: string
  threatEntryType?: string
  platformType?: string
  /** Google 在命中里回带的 URL */
  url: string
}

export interface SafeBrowsingResult {
  status: SafeBrowsingStatus
  source: typeof SAFE_BROWSING_SOURCE
  checkedAt: string
  matches: SafeBrowsingMatch[]
  /** 无结论/失败时的原因；有结论时为 null */
  reason: string | null
}

export interface CertificateInfo {
  host: string
  /** 证书 subject CN（证书原文，如无则 null） */
  subject: string | null
  /** 证书签发者 CN（证书原文，如无则 null） */
  issuer: string | null
  /** 证书签发者组织 O（证书原文，如无则 null） */
  issuerOrganization: string | null
  /** 证书生效时间（ISO 8601，证书原文转换；读不到为 null） */
  validFrom: string | null
  /** 证书到期时间（ISO 8601，证书原文转换；读不到为 null） */
  validTo: string | null
}

export interface CertificateLookup {
  certificate: CertificateInfo | null
  /** 查到证书时为 null；查不到时写明原因 */
  reason: string | null
}

function isCheckableUrl(value: string): boolean {
  if (!value || value.length > MAX_URL_LENGTH) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

/**
 * 批量问 Google Safe Browsing。无 key 不发请求；失败不冒充结论。
 * 入参只接受 http(s) URL；非法、重复、超 500 条的部分直接丢弃（不报错，
 * 因为这只是“本次查询的范围”，不是被查 URL 本身的结论）。
 */
export async function lookupUrls(urls: string[]): Promise<SafeBrowsingResult> {
  const checkedAt = new Date().toISOString()
  const source = SAFE_BROWSING_SOURCE
  const checked = [...new Set(urls.filter(isCheckableUrl))].slice(0, MAX_URLS_PER_REQUEST)
  if (checked.length === 0) {
    return {
      status: 'unknown',
      source,
      checkedAt,
      matches: [],
      reason: '没有可查的有效 URL（仅支持 http/https）',
    }
  }

  const apiKey = process.env[API_KEY_ENV]?.trim()
  if (!apiKey) {
    return {
      status: 'unavailable',
      source,
      checkedAt,
      matches: [],
      reason: `未配置 ${API_KEY_ENV}，未向 Google Safe Browsing 发起查询`,
    }
  }

  let response: Response
  try {
    response = await globalThis.fetch(
      `${SAFE_BROWSING_API_URL}?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'navhub-safe-browsing', clientVersion: '1.0.0' },
          threatInfo: {
            threatTypes: [...THREAT_TYPES],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: checked.map((url) => ({ url })),
          },
        }),
        signal: AbortSignal.timeout(SAFE_BROWSING_TIMEOUT_MS),
      },
    )
  } catch (error) {
    return {
      status: 'unknown',
      source,
      checkedAt,
      matches: [],
      reason: `Google Safe Browsing 请求失败：${error instanceof Error ? error.message : '未知错误'}`,
    }
  }

  if (!response.ok) {
    return {
      status: 'unknown',
      source,
      checkedAt,
      matches: [],
      reason: `Google Safe Browsing 请求失败（HTTP ${response.status}）`,
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return {
      status: 'unknown',
      source,
      checkedAt,
      matches: [],
      reason: 'Google Safe Browsing 返回了无法解析的响应',
    }
  }

  const rawMatches =
    body && typeof body === 'object' && Array.isArray((body as { matches?: unknown }).matches)
      ? (body as { matches: unknown[] }).matches
      : []
  // 只收带字符串 threatType 的命中并原样保留；Google 没给 threatType 的
  // 畸形条目直接丢弃，不自补类型。
  const matches: SafeBrowsingMatch[] = rawMatches.flatMap((m) => {
    if (!m || typeof m !== 'object') return []
    const threatType = (m as { threatType?: unknown }).threatType
    const threat = (m as { threat?: unknown }).threat
    const threatUrl =
      threat && typeof threat === 'object'
        ? (threat as { url?: unknown }).url
        : undefined
    if (typeof threatType !== 'string' || !threatType) return []
    if (typeof threatUrl !== 'string' || !threatUrl) return []
    const entry: SafeBrowsingMatch = { threatType, url: threatUrl }
    const threatEntryType = (m as { threatEntryType?: unknown }).threatEntryType
    const platformType = (m as { platformType?: unknown }).platformType
    if (typeof threatEntryType === 'string') entry.threatEntryType = threatEntryType
    if (typeof platformType === 'string') entry.platformType = platformType
    return [entry]
  })

  return {
    status: matches.length > 0 ? 'unsafe' : 'safe',
    source,
    checkedAt,
    matches,
    reason: null,
  }
}

function normalizeHost(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '')
  if (!h || h.length > 253) return null
  // IPv6 字面量允许带方括号；其余只允许域名合法字符
  if (h.startsWith('[') && h.endsWith(']')) {
    const inner = h.slice(1, -1)
    return isIP(inner) === 6 ? inner : null
  }
  if (isIP(h) !== 0) return h
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(h)) return null
  return h
}

function readCertificate(host: string, cert: PeerCertificate): CertificateInfo {
  const subject = cert.subject as { CN?: unknown } | undefined
  const issuer = cert.issuer as { CN?: unknown; O?: unknown } | undefined
  return {
    host,
    subject: typeof subject?.CN === 'string' ? subject.CN : null,
    issuer: typeof issuer?.CN === 'string' ? issuer.CN : null,
    issuerOrganization: typeof issuer?.O === 'string' ? issuer.O : null,
    validFrom: toIsoOrNull(cert.valid_from),
    validTo: toIsoOrNull(cert.valid_to),
  }
}

/**
 * 用 TLS 握手直读主机证书的签发者与有效期。只读证书，不发 HTTP 请求。
 * 拿不到证书返回 { certificate: null, reason }，不编签发者与有效期。
 * 主机先过仓库 SSRF 防护（DNS 解析 + 内网/回环段拦截），被拦也如实返回原因。
 */
export async function getCertificateInfo(host: string): Promise<CertificateLookup> {
  const normalized = normalizeHost(host)
  if (!normalized) {
    return { certificate: null, reason: '主机名无效' }
  }

  try {
    await resolveAndCheck(new URL(`https://${normalized}`), DEFAULT_GUARD)
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      return { certificate: null, reason: `证书查询被拦截：${error.message}` }
    }
    return {
      certificate: null,
      reason: `证书查询失败：${error instanceof Error ? error.message : '未知错误'}`,
    }
  }

  return new Promise<CertificateLookup>((resolve) => {
    const socket = connect({
      host: normalized,
      port: 443,
      // IP 字面量不发 SNI；域名按原样发 SNI
      servername: isIP(normalized) === 0 ? normalized : undefined,
      timeout: CERTIFICATE_TIMEOUT_MS,
    })
    const done = (result: CertificateLookup) => {
      socket.destroy()
      resolve(result)
    }
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate()
      if (!cert || Object.keys(cert).length === 0) {
        done({ certificate: null, reason: '目标主机未返回证书' })
        return
      }
      done({ certificate: readCertificate(normalized, cert), reason: null })
    })
    socket.once('timeout', () => {
      done({ certificate: null, reason: '读取证书超时' })
    })
    socket.once('error', (error: Error) => {
      done({ certificate: null, reason: `无法读取证书：${error.message}` })
    })
  })
}
