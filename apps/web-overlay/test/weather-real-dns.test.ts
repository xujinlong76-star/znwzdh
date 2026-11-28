/**
 * 天气走真实 DNS 解析器（8.8.8.8，已连接 UDP + 金丝雀）的定向测试。
 *
 * 覆盖三件事（对应任务要求）：
 *  1. DNS 失败 → 路由返回 stale/502 dns_failure，绝不回退系统解析器；
 *  2. 成功 → 真实 IP（不是 198.18/15），SSRF 校验照常拦受保护地址；
 *  3. 金丝雀：解析器返回受保护地址或抛错即不可信。
 *
 * 系统解析器被桩成「坏解析器」形态（公网域名一律返回 198.18/15）：
 * 注入解析器若被绕过、回退到系统解析器，这里立刻现形。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }))

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

import {
  DEFAULT_GUARD,
  SsrfBlockedError,
  createExternalDnsResolver,
  isBlockedIp,
  isDnsResolverFailure,
  resolveAndCheck,
  verifyWeatherDnsResolver,
  type DnsResolverLike,
} from '../src/lib/ssrf-guard'
import { __setWeatherDnsResolverForTest } from '../src/lib/weather-dns'

const PUBLIC_IP = '93.184.216.34'
const POISONED_IP = '198.18.0.1'

function fakeResolver(addresses: string[]): DnsResolverLike {
  return { lookup: async () => addresses.map((address) => ({ address })) }
}

function failingResolver(message = 'boom'): DnsResolverLike {
  return {
    lookup: async () => {
      throw new Error(message)
    },
  }
}

function hangingResolver(): DnsResolverLike {
  return { lookup: () => new Promise(() => {}) }
}

let originalFetch: typeof globalThis.fetch
const calls: string[] = []

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubUpstream(handler: (url: string) => Response | Error): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const out = handler(url)
    if (out instanceof Error) throw out
    return out
  }) as typeof globalThis.fetch
}

const FORECAST_OK = {
  current: { time: '2026-10-23T20:15', temperature_2m: 18.7, weather_code: 0 },
  hourly: { time: [], temperature_2m: [], weather_code: [], precipitation_probability: [], precipitation: [] },
  daily: {
    time: ['2026-10-23'],
    weather_code: [0],
    temperature_2m_max: [19.2],
    temperature_2m_min: [12.4],
    precipitation_probability_max: [10],
    precipitation_sum: [0],
  },
}

const AIR_OK = { current: { us_aqi: 42 } }

async function getWeather(query: string) {
  const route = await import('../src/app/api/weather/route')
  const request = new Request(`http://localhost/api/weather${query}`)
  const res = await route.GET(request)
  return { status: res.status, body: (await res.json()) as Record<string, any> }
}

beforeEach(() => {
  calls.length = 0
  originalFetch = globalThis.fetch
  lookupMock.mockReset()
  // 默认把系统解析器桩成坏解析器：公网域名返回 198.18/15
  lookupMock.mockResolvedValue([{ address: POISONED_IP, family: 4 }])
  delete process.env.QWEATHER_API_HOST
  delete process.env.QWEATHER_API_KEY
})

afterEach(() => {
  globalThis.fetch = originalFetch
  __setWeatherDnsResolverForTest(null)
})

describe('天气真实 DNS：注入解析器优先，绝不回退系统解析器', () => {
  it('注入解析器返回公网 IP → 放行，且系统解析器根本没被调用', async () => {
    await expect(
      resolveAndCheck(new URL('https://api.open-meteo.com/v1/forecast'), {
        ...DEFAULT_GUARD,
        timeoutMs: 1_000,
        dnsResolver: fakeResolver([PUBLIC_IP]),
      }),
    ).resolves.toBeUndefined()
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('注入解析器返回受保护地址 → blocked-ip（SSRF 规则对注入结果同样生效）', async () => {
    let caught: unknown
    try {
      await resolveAndCheck(new URL('https://api.open-meteo.com/v1/forecast'), {
        ...DEFAULT_GUARD,
        timeoutMs: 1_000,
        dnsResolver: fakeResolver([POISONED_IP]),
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SsrfBlockedError)
    expect((caught as SsrfBlockedError).code).toBe('blocked-ip')
    expect(isDnsResolverFailure(caught)).toBe(false)
  })

  it('注入解析器抛错 → dns-failure，且不回退系统解析器（系统桩返回公网 IP 也不会成功）', async () => {
    lookupMock.mockResolvedValue([{ address: PUBLIC_IP, family: 4 }])
    let caught: unknown
    try {
      await resolveAndCheck(new URL('https://api.open-meteo.com/v1/forecast'), {
        ...DEFAULT_GUARD,
        timeoutMs: 1_000,
        dnsResolver: failingResolver(),
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SsrfBlockedError)
    expect((caught as SsrfBlockedError).code).toBe('dns-failure')
    expect(isDnsResolverFailure(caught)).toBe(true)
  })

  it('注入解析器挂起 → dns-timeout，而不是无限等下去', async () => {
    let caught: unknown
    try {
      await resolveAndCheck(new URL('https://api.open-meteo.com/v1/forecast'), {
        ...DEFAULT_GUARD,
        timeoutMs: 50,
        dnsResolver: hangingResolver(),
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(SsrfBlockedError)
    expect((caught as SsrfBlockedError).code).toBe('dns-timeout')
    expect((caught as SsrfBlockedError).reason).toMatch(/DNS 解析超时/)
    expect(isDnsResolverFailure(caught)).toBe(true)
  })
})

describe('天气真实 DNS：金丝雀自检', () => {
  it('金丝雀域名返回公网 IP → 可信', async () => {
    const result = await verifyWeatherDnsResolver(fakeResolver([PUBLIC_IP]))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.addresses).toEqual([PUBLIC_IP])
  })

  it('金丝雀域名返回受保护地址 → 不可信（坏解析器形态）', async () => {
    const result = await verifyWeatherDnsResolver(fakeResolver([POISONED_IP]))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/受保护网段/)
  })

  it('金丝雀解析抛错 → 不可信', async () => {
    const result = await verifyWeatherDnsResolver(failingResolver())
    expect(result.ok).toBe(false)
  })
})

describe('天气真实 DNS：真实解析器打通 8.8.8.8', () => {
  it('api.open-meteo.com 返回真实公网 IP（不是 198.18/15）', { timeout: 20_000 }, async () => {
    const resolver = createExternalDnsResolver()
    const addrs = await resolver.lookup('api.open-meteo.com')
    expect(addrs.length).toBeGreaterThan(0)
    for (const a of addrs) {
      expect(isBlockedIp(a.address)).toBe(false)
    }
  })
})

describe('/api/weather：DNS 失败走 stale/502 dns_failure', () => {
  it('无缓存时解析器失败 → 502 dns_failure，且根本不打上游', async () => {
    __setWeatherDnsResolverForTest(failingResolver())
    stubUpstream(() => jsonResponse(FORECAST_OK))
    const { status, body } = await getWeather('?city=tokyo&fresh=1')
    expect(status).toBe(502)
    expect(body.ok).toBe(false)
    expect(body.reason).toBe('dns_failure')
    expect(body.message).toContain('未回退系统解析器')
    expect(calls).toHaveLength(0)
  })

  it('有历史成功结果时解析器失败 → 200 + stale 标记', async () => {
    __setWeatherDnsResolverForTest(fakeResolver([PUBLIC_IP]))
    stubUpstream((url) => (url.includes('air-quality') ? jsonResponse(AIR_OK) : jsonResponse(FORECAST_OK)))
    const first = await getWeather('?city=shanghai')
    expect(first.body.ok).toBe(true)
    expect(first.body.stale).toBe(false)
    const fetchedAt = first.body.fetchedAt as number

    __setWeatherDnsResolverForTest(failingResolver())
    stubUpstream(() => {
      throw new Error('must not reach upstream')
    })
    const second = await getWeather('?city=shanghai&fresh=1')
    expect(second.status).toBe(200)
    expect(second.body.ok).toBe(true)
    expect(second.body.stale).toBe(true)
    expect(second.body.staleAt).toBe(fetchedAt)
  })
})

// mock 卫生（D2）：清除本文件的模块 mock 缓存，避免驻留同 worker 的后续文件
afterAll(() => {
  vi.resetModules()
})
