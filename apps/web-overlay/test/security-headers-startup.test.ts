/**
 * 安全头启动告警（U-415）：读构建产物 routes-manifest 判定 CSP / HSTS
 * 是否下发，缺失时告警、全有时静默、产物不可读时不刷假警报。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectSecurityHeaders, warnIfSecurityHeadersOff } from '../src/lib/security-headers-startup'

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warnSpy.mockRestore()
})

function manifest(headers: Array<{ key: string; value: string }>): object {
  return { version: 1, headers: [{ source: '/:path*', headers }] }
}

describe('inspectSecurityHeaders', () => {
  it('空规则：CSP 与 HSTS 都缺', () => {
    expect(inspectSecurityHeaders([])).toEqual({ csp: false, hsts: false })
    expect(inspectSecurityHeaders(undefined)).toEqual({ csp: false, hsts: false })
  })

  it('report-only 出现即算 CSP 有，但 HSTS 仍缺', () => {
    const status = inspectSecurityHeaders([
      { source: '/:path*', headers: [{ key: 'Content-Security-Policy-Report-Only', value: "default-src 'self'" }] },
    ])
    expect(status).toEqual({ csp: true, hsts: false })
  })

  it('enforce 出现也算 CSP 有；头名大小写不敏感', () => {
    const status = inspectSecurityHeaders([
      {
        source: '/:path*',
        headers: [
          { key: 'content-security-policy', value: "default-src 'self'" },
          { key: 'STRICT-TRANSPORT-SECURITY', value: 'max-age=15552000' },
        ],
      },
    ])
    expect(status).toEqual({ csp: true, hsts: true })
  })

  it('非数组 / 缺 headers 的规则被跳过，不抛错', () => {
    expect(inspectSecurityHeaders([{ source: '/' }, null, { headers: 'nope' }])).toEqual({
      csp: false,
      hsts: false,
    })
  })
})

describe('warnIfSecurityHeadersOff', () => {
  async function withManifest(content: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'security-headers-'))
    await writeFile(join(dir, 'routes-manifest.json'), content)
    return dir
  }

  it('两项全有：静默，不告警', async () => {
    const dir = await withManifest(
      JSON.stringify(
        manifest([
          { key: 'Content-Security-Policy-Report-Only', value: "default-src 'self'" },
          { key: 'Strict-Transport-Security', value: 'max-age=15552000' },
        ]),
      ),
    )
    try {
      expect(await warnIfSecurityHeadersOff(dir)).toEqual([])
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('两项都缺：返回两项并各告警一次', async () => {
    const dir = await withManifest(JSON.stringify(manifest([])))
    try {
      expect(await warnIfSecurityHeadersOff(dir)).toEqual([
        'Content-Security-Policy(-Report-Only)',
        'Strict-Transport-Security',
      ])
      expect(warnSpy).toHaveBeenCalledTimes(2)
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('[security-headers]')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('只缺 HSTS：只返回并告警 HSTS', async () => {
    const dir = await withManifest(
      JSON.stringify(manifest([{ key: 'Content-Security-Policy', value: "default-src 'self'" }])),
    )
    try {
      expect(await warnIfSecurityHeadersOff(dir)).toEqual(['Strict-Transport-Security'])
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('产物不可读 / 不是合法 JSON：静默跳过，不刷假警报', async () => {
    const missing = await mkdtemp(join(tmpdir(), 'security-headers-missing-'))
    await rm(missing, { recursive: true, force: true })
    expect(await warnIfSecurityHeadersOff(missing)).toEqual([])
    expect(warnSpy).not.toHaveBeenCalled()

    const bad = await withManifest('{not json')
    try {
      expect(await warnIfSecurityHeadersOff(bad)).toEqual([])
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      await rm(bad, { recursive: true, force: true })
    }
  })
})
