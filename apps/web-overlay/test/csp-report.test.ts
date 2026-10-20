import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST, __resetCspRateLimiter } from '../src/app/api/csp-report/route'
import {
  GLOBAL_PER_MINUTE,
  PER_IP_PER_MINUTE,
  RateLimiter,
  parseCspReport,
  readCappedBody,
  sanitizeUri,
} from '../src/lib/csp-report'

const REPORT = JSON.stringify({
  'csp-report': {
    'document-uri': 'https://example.com/admin/navigation?token=secret',
    'blocked-uri': 'inline',
    'violated-directive': 'script-src-elem',
    'source-file': 'https://example.com/_next/static/chunks/app.js',
    'line-number': 12,
  },
})

describe('CSP 上报解析与脱敏', () => {
  it('解析 report-uri 格式', () => {
    const summary = parseCspReport(REPORT)
    expect(summary?.violatedDirective).toBe('script-src-elem')
    expect(summary?.lineNumber).toBe(12)
  })

  it('解析 report-to 格式', () => {
    const summary = parseCspReport(
      JSON.stringify({
        type: 'csp-violation',
        body: { effectiveDirective: 'script-src', blockedURL: 'https://cdn.example/x.js' },
      }),
    )
    expect(summary?.violatedDirective).toBe('script-src')
    expect(summary?.blockedUri).toBe('https://cdn.example/x.js')
  })

  it('非法 JSON 返回 null', () => {
    expect(parseCspReport('not json')).toBeNull()
    expect(parseCspReport('{"type":"other"}')).toBeNull()
  })

  it('脱敏去掉 query 与 hash 并截断', () => {
    expect(sanitizeUri('https://a.example/p?token=secret')).toBe('https://a.example/p')
    expect(sanitizeUri('https://a.example/p#frag')).toBe('https://a.example/p')
    expect(sanitizeUri('x'.repeat(500)).length).toBeLessThanOrEqual(201)
  })
})

describe('CSP 上报限流与体积上限', () => {
  beforeEach(() => {
    __resetCspRateLimiter()
  })

  it('单 IP 超额后拒绝', () => {
    const limiter = new RateLimiter(3, 100)
    expect(limiter.allow('1.1.1.1')).toBe(true)
    expect(limiter.allow('1.1.1.1')).toBe(true)
    expect(limiter.allow('1.1.1.1')).toBe(true)
    expect(limiter.allow('1.1.1.1')).toBe(false)
  })

  it('全局闸门生效', () => {
    const limiter = new RateLimiter(100, 2)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('b')).toBe(true)
    expect(limiter.allow('c')).toBe(false)
  })

  it('超过体积上限的请求体被标记', async () => {
    const request = new Request('https://example.com/api/csp-report', {
      method: 'POST',
      body: 'x'.repeat(1024),
    })
    const result = await readCappedBody(request, 512)
    expect(result.tooLarge).toBe(true)
  })
})

describe('CSP 上报端点', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    __resetCspRateLimiter()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('合法上报返回 204 并写脱敏日志', async () => {
    const res = await POST(
      new Request('https://example.com/api/csp-report', {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report' },
        body: REPORT,
      }),
    )
    expect(res.status).toBe(204)
    const logged = String(warn.mock.calls[0]?.[0] ?? '')
    expect(logged).toContain('csp-report')
    expect(logged).not.toContain('secret')
  })

  it('非法正文返回 400', async () => {
    const res = await POST(
      new Request('https://example.com/api/csp-report', { method: 'POST', body: 'nope' }),
    )
    expect(res.status).toBe(400)
  })

  it('超限正文返回 413', async () => {
    const res = await POST(
      new Request('https://example.com/api/csp-report', {
        method: 'POST',
        headers: { 'content-length': String(10 * 1024 * 1024) },
        body: 'x',
      }),
    )
    expect(res.status).toBe(413)
  })

  it('同一 IP 超过配额后返回 429', async () => {
    const make = () =>
      new Request('https://example.com/api/csp-report', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.9' },
        body: REPORT,
      })
    for (let i = 0; i < PER_IP_PER_MINUTE; i++) {
      const ok = await POST(make())
      expect(ok.status).toBe(204)
    }
    const limited = await POST(make())
    expect(limited.status).toBe(429)
    expect(GLOBAL_PER_MINUTE).toBeGreaterThan(PER_IP_PER_MINUTE)
  })
})
