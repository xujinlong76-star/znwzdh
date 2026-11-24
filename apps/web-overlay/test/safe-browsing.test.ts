/**
 * 品牌认官网第二步 W6：Safe Browsing 安全数据源测试（W3 模块）。
 *
 * 测 src/lib/safe-browsing.ts（lookupUrls / getCertificateInfo）与
 * src/app/api/safe-browsing/route.ts 的源码守卫。
 *
 * 铁律：测试一律用夹具，绝不发真实网络请求、绝不用真实 key。
 *  - Google API 用 vi.stubGlobal('fetch') 夹具化：返回体照抄 Safe Browsing
 *    API v4 的 threatMatches:find 形状；key 只用 'fixture-test-key'。
 *  - 证书测试只走本地可判的分支（非法主机名、回环/私网被 SSRF 拦截），
 *    不建真实 TLS 连接；真实握手成功路径不在夹具测试内。
 *
 * 约定（见 src/lib/safe-browsing.ts 文件头）：
 *  - 无 key：不发请求，status 'unavailable'，原因写明未配置
 *    NAVHUB_SAFE_BROWSING_API_KEY；绝不编结论。
 *  - 有命中：status 'unsafe'，threatType 只转述 Google 原文（如 MALWARE）；
 *    无命中：status 'safe'，含义只是“本次查询 Google 未返回任何命中”。
 *  - 失败（网络错、非 2xx、解析失败）：status 'unknown'，只写失败事实。
 *  - 证书拿不到：{ certificate: null, reason }，不编签发者与有效期。
 *  - key 绝不出现在返回体与错误原因里。
 *
 * 体例：vitest + 相对路径 import；源码守卫先去注释再断言。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getCertificateInfo,
  lookupUrls,
  SAFE_BROWSING_SOURCE,
} from '../src/lib/safe-browsing'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

function readSource(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const ENV_KEY = 'NAVHUB_SAFE_BROWSING_API_KEY'
/** 夹具 key：只在测试里用，绝不是真实 key。 */
const FIXTURE_KEY = 'fixture-test-key'
const CHECKED_URL = 'https://evil.example/malware'

/** Safe Browsing API v4 threatType 枚举（照抄接口文档，不自造类型）。 */
const THREAT_TYPES = [
  'MALWARE',
  'SOCIAL_ENGINEERING',
  'UNWANTED_SOFTWARE',
  'POTENTIALLY_HARMFUL_APPLICATION',
] as const

/** 夹具：命中两条（MALWARE + SOCIAL_ENGINEERING）。 */
const HIT_BODY = {
  matches: [
    {
      threatType: 'MALWARE',
      platformType: 'ANY_PLATFORM',
      threatEntryType: 'URL',
      threat: { url: CHECKED_URL },
    },
    {
      threatType: 'SOCIAL_ENGINEERING',
      platformType: 'ANY_PLATFORM',
      threatEntryType: 'URL',
      threat: { url: 'https://evil.example/phish' },
    },
  ],
}

/** 夹具：无命中（空对象即 v4 的无命中响应）。 */
const MISS_BODY = {}

/** 夹具：畸形命中——缺 threatType 或缺 threat.url，必须被丢弃。 */
const MALFORMED_BODY = {
  matches: [
    { platformType: 'ANY_PLATFORM', threat: { url: 'https://x.example/' } },
    { threatType: 'MALWARE', threat: {} },
    { threatType: '', threat: { url: 'https://x.example/' } },
    null,
    'junk',
  ],
}

type FetchStub = ReturnType<typeof vi.fn>

function okResponse(body: unknown): { ok: true; status: 200; json: () => Promise<unknown> } {
  return { ok: true, status: 200, json: async () => body }
}

function stubFetch(impl: (...args: unknown[]) => unknown): FetchStub {
  const stub = vi.fn(impl)
  vi.stubGlobal('fetch', stub)
  return stub
}

let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env[ENV_KEY]
  delete process.env[ENV_KEY]
})

afterEach(() => {
  if (savedKey === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = savedKey
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('夹具自检：命中/未命中/畸形三种响应体的形状', () => {
  it('命中夹具的 threatType 都是 v4 枚举原文', () => {
    for (const m of HIT_BODY.matches) {
      expect((THREAT_TYPES as readonly string[]).includes(m.threatType)).toBe(true)
    }
    expect(HIT_BODY.matches.map((m) => m.threatType)).toEqual(['MALWARE', 'SOCIAL_ENGINEERING'])
  })

  it('未命中夹具没有 matches 键', () => {
    expect('matches' in MISS_BODY).toBe(false)
  })

  it('畸形夹具里没有一条同时带有效 threatType 与 threat.url', () => {
    for (const m of MALFORMED_BODY.matches) {
      const ok =
        !!m &&
        typeof m === 'object' &&
        typeof (m as { threatType?: unknown }).threatType === 'string' &&
        !!((m as { threatType?: unknown }).threatType as string) &&
        typeof ((m as { threat?: { url?: unknown } }).threat?.url) === 'string'
      expect(ok).toBe(false)
    }
  })
})

describe('lookupUrls：无 key 时 unavailable 且不发请求', () => {
  it('未配置 key：不调 fetch，status unavailable，原因写明未配置', async () => {
    const fetchStub = stubFetch(() => Promise.resolve(okResponse(MISS_BODY)))
    const result = await lookupUrls([CHECKED_URL])
    expect(fetchStub).not.toHaveBeenCalled()
    expect(result.status).toBe('unavailable')
    expect(result.matches).toEqual([])
    expect(result.reason).toContain(ENV_KEY)
    expect(result.source).toBe(SAFE_BROWSING_SOURCE)
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false)
    // 返回体里不出现任何 key 字面量。
    expect(JSON.stringify(result)).not.toContain('AIza')
  })

  it('key 只有空白也算未配置', async () => {
    process.env[ENV_KEY] = '   '
    const fetchStub = stubFetch(() => Promise.resolve(okResponse(MISS_BODY)))
    const result = await lookupUrls([CHECKED_URL])
    expect(fetchStub).not.toHaveBeenCalled()
    expect(result.status).toBe('unavailable')
  })
})

describe('lookupUrls：夹具命中/未命中映射（只转述 threatType 原文）', () => {
  it('命中：status unsafe，threatType 原样保留 MALWARE 与 SOCIAL_ENGINEERING', async () => {
    process.env[ENV_KEY] = FIXTURE_KEY
    const fetchStub = stubFetch(() => Promise.resolve(okResponse(HIT_BODY)))
    const result = await lookupUrls([CHECKED_URL])
    expect(result.status).toBe('unsafe')
    expect(result.matches.map((m) => m.threatType)).toEqual(['MALWARE', 'SOCIAL_ENGINEERING'])
    expect(result.matches[0]?.url).toBe(CHECKED_URL)
    expect(result.reason).toBeNull()
    expect(JSON.stringify(result)).not.toContain(FIXTURE_KEY)
  })

  it('命中时请求本身符合 v4 约定：POST 到 Google 域名、带被查 URL 与四种 threatType', async () => {
    process.env[ENV_KEY] = FIXTURE_KEY
    const fetchStub = stubFetch(() => Promise.resolve(okResponse(HIT_BODY)))
    await lookupUrls([CHECKED_URL])
    expect(fetchStub).toHaveBeenCalledTimes(1)
    const [url, init] = fetchStub.mock.calls[0] as [string, { method?: string; body?: string }]
    expect(url).toContain('safebrowsing.googleapis.com/v4/threatMatches:find')
    expect(url).toContain(`key=${FIXTURE_KEY}`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body ?? '{}') as {
      threatInfo?: { threatTypes?: string[]; threatEntries?: { url?: string }[] }
    }
    expect(body.threatInfo?.threatTypes).toEqual([...THREAT_TYPES])
    expect(body.threatInfo?.threatEntries).toEqual([{ url: CHECKED_URL }])
  })

  it('未命中：status safe 只表示“本次查询 Google 未返回任何命中”，不是全面安全背书', async () => {
    process.env[ENV_KEY] = FIXTURE_KEY
    stubFetch(() => Promise.resolve(okResponse(MISS_BODY)))
    const result = await lookupUrls([CHECKED_URL])
    expect(result.status).toBe('safe')
    expect(result.matches).toEqual([])
    expect(result.reason).toBeNull()
  })

  it('畸形命中被丢弃、不自补类型：无有效命中即 safe', async () => {
    process.env[ENV_KEY] = FIXTURE_KEY
    stubFetch(() => Promise.resolve(okResponse(MALFORMED_BODY)))
    const result = await lookupUrls([CHECKED_URL])
    expect(result.status).toBe('safe')
    expect(result.matches).toEqual([])
  })

  it('重复 URL 去重后只查一次', async () => {
    process.env[ENV_KEY] = FIXTURE_KEY
    const fetchStub = stubFetch(() => Promise.resolve(okResponse(MISS_BODY)))
    await lookupUrls([CHECKED_URL, CHECKED_URL, CHECKED_URL])
    const [, init] = fetchStub.mock.calls[0] as [string, { body?: string }]
    const body = JSON.parse(init.body ?? '{}') as {
      threatInfo?: { threatEntries?: unknown[] }
    }
    expect(body.threatInfo?.threatEntries).toHaveLength(1)
  })

  it('超过 500 条只取前 500 条（v4 单次上限）', async () => {
    process.env[ENV_KEY] = FIXTURE_KEY
    const fetchStub = stubFetch(() => Promise.resolve(okResponse(MISS_BODY)))
    const urls = Array.from({ length: 501 }, (_, i) => `https://example.com/${i}`)
    await lookupUrls(urls)
    const [, init] = fetchStub.mock.calls[0] as [string, { body?: string }]
    const body = JSON.parse(init.body ?? '{}') as {
      threatInfo?: { threatEntries?: unknown[] }
    }
    expect(body.threatInfo?.threatEntries).toHaveLength(500)
  })
})

describe('lookupUrls：失败不冒充结论', () => {
  it('非 2xx：status unknown，原因写 HTTP 状态，不编造', async () => {
    process.env[ENV_KEY] = FIXTURE_KEY
    stubFetch(() => Promise.resolve({ ok: false, status: 403, json: async () => ({}) }))
    const result = await lookupUrls([CHECKED_URL])
    expect(result.status).toBe('unknown')
    expect(result.matches).toEqual([])
    expect(result.reason).toContain('403')
    expect(JSON.stringify(result)).not.toContain(FIXTURE_KEY)
  })

  it('网络错：status unknown，原因写失败事实', async () => {
    process.env[ENV_KEY] = FIXTURE_KEY
    stubFetch(() => Promise.reject(new Error('boom')))
    const result = await lookupUrls([CHECKED_URL])
    expect(result.status).toBe('unknown')
    expect(result.reason).toContain('boom')
  })

  it('响应解析失败：status unknown', async () => {
    process.env[ENV_KEY] = FIXTURE_KEY
    stubFetch(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('bad json')
        },
      }),
    )
    const result = await lookupUrls([CHECKED_URL])
    expect(result.status).toBe('unknown')
    expect(result.reason).toContain('解析')
  })

  it('没有可查的有效 URL：status unknown，不发请求', async () => {
    process.env[ENV_KEY] = FIXTURE_KEY
    const fetchStub = stubFetch(() => Promise.resolve(okResponse(MISS_BODY)))
    for (const input of [[], ['not-a-url', 'ftp://x.example/', '']]) {
      const result = await lookupUrls(input)
      expect(result.status, JSON.stringify(input)).toBe('unknown')
      expect(result.reason, JSON.stringify(input)).toContain('没有可查的有效 URL')
    }
    expect(fetchStub).not.toHaveBeenCalled()
  })
})

describe('getCertificateInfo：拿不到证书时返回 null 与原因（无真实 TLS）', () => {
  it('非法主机名：certificate null，原因写明主机名无效', async () => {
    for (const host of ['not a host!!!', '', '   ']) {
      const result = await getCertificateInfo(host)
      expect(result.certificate, JSON.stringify(host)).toBeNull()
      expect(result.reason, JSON.stringify(host)).toBe('主机名无效')
    }
  })

  it('回环地址被 SSRF 拦截：certificate null，原因写明被拦截', async () => {
    const result = await getCertificateInfo('localhost')
    expect(result.certificate).toBeNull()
    expect(result.reason).toContain('拦截')
  })

  it('私网地址被 SSRF 拦截：certificate null，原因写明被拦截', async () => {
    const result = await getCertificateInfo('10.0.0.5')
    expect(result.certificate).toBeNull()
    expect(result.reason).toContain('拦截')
  })

  it('拿不到时绝不编签发者与有效期：certificate 是 null 而不是空字段对象', async () => {
    const result = await getCertificateInfo('localhost')
    expect(result.certificate).toBeNull()
    expect(JSON.stringify(result)).not.toContain('issuer')
    expect(JSON.stringify(result)).not.toContain('validTo')
  })
})

describe('Safe Browsing 接口源码守卫（route.ts）', () => {
  const route = () => stripComments(readSource('src/app/api/safe-browsing/route.ts'))

  it('缺 url / 非法 url 返回 400，不进查询', () => {
    expect(route()).toContain('缺少有效的 url 参数')
    expect(route()).toContain('url 参数不是有效的 URL')
    expect(route()).toContain('url 参数不是有效的 http(s) URL')
    expect(route()).toContain('status: 400')
  })

  it('同时委托 lookupUrls 与 getCertificateInfo，不自己编结论', () => {
    expect(route()).toContain('lookupUrls')
    expect(route()).toContain('getCertificateInfo')
    expect(route()).not.toContain("status: 'safe'")
    expect(route()).not.toContain("status: 'unsafe'")
  })

  it('不缓存、不记日志、不持久化被查 URL', () => {
    expect(route()).toContain("'Cache-Control': 'no-store'")
    for (const token of ['localStorage', 'sessionStorage', 'indexedDB', 'sendBeacon', 'prisma', '.insert(', '.upsert(', 'console.']) {
      expect(route(), token).not.toContain(token)
    }
    expect(route()).not.toContain('fetch(')
  })

  it('源码里无硬编码 key', () => {
    expect(route()).not.toContain('AIza')
    expect(route()).not.toContain('api_key=')
  })
})

describe('Safe Browsing 模块源码守卫（lib/safe-browsing.ts）', () => {
  const lib = () => stripComments(readSource('src/lib/safe-browsing.ts'))

  it('无 key 返回 unavailable 的约定写在源码里', () => {
    expect(lib()).toContain("status: 'unavailable'")
    expect(lib()).toContain(ENV_KEY)
  })

  it('只问 Google Safe Browsing 一个外部去向，不记日志、不持久化', () => {
    expect((lib().match(/fetch\(/g) ?? []).length).toBe(1)
    expect(lib()).toContain('safebrowsing.googleapis.com')
    for (const token of ['localStorage', 'sessionStorage', 'indexedDB', 'sendBeacon', 'prisma', '.insert(', '.upsert(', 'console.']) {
      expect(lib(), token).not.toContain(token)
    }
  })

  it('源码里无硬编码 key，key 只从环境变量读', () => {
    expect(lib()).not.toContain('AIza')
    expect(lib()).toContain(`process.env[${'API_KEY_ENV'}]`)
  })
})
