/**
 * 媒体代理安全加固回归（2026-11-06 S-4 / 深度扫描）。
 *
 * 覆盖：① MAC 从 16 hex 升到 64 hex；② 常量时间比较（timingSafeEqual）；
 * ③ v2 带 exp 签名在过期后失效；④ 旧 16 hex 灰度兼容；
 * ⑤ 篡改 URL / 签名必拒；⑥ 重定向逐跳校验（源码级：fetch 不再用默认 follow）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  generateMediaSignature,
  verifyMediaSignature,
  generateMediaSignatureV2,
  verifyMediaSignatureV2
} from '@/lib/media-proxy'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = readFileSync(resolve(ROOT, 'src/lib/media-proxy.ts'), 'utf8')
const ROUTE = readFileSync(resolve(ROOT, 'src/app/api/media/proxy/route.ts'), 'utf8')

describe('媒体签名强度', () => {
  it('generateMediaSignature 返回全长 64 hex（256 bit MAC）', () => {
    const sig = generateMediaSignature('https://i0.hdslb.com/a.jpg')
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })

  it('新签名可被校验，篡改 URL 或签名即拒', () => {
    const url = 'https://i0.hdslb.com/b.jpg'
    const sig = generateMediaSignature(url)
    expect(verifyMediaSignature(url, sig)).toBe(true)
    expect(verifyMediaSignature(url + '?x=1', sig)).toBe(false)
    expect(verifyMediaSignature(url, sig.slice(0, 63) + (sig[63] === '0' ? '1' : '0'))).toBe(false)
  })

  it('旧 16 hex 签名在灰度期仍兼容（ISR 缓存页面不被打断）', () => {
    const url = 'https://i0.hdslb.com/c.jpg'
    const legacy = generateMediaSignature(url).slice(0, 16)
    expect(verifyMediaSignature(url, legacy)).toBe(true)
  })

  it('源码使用 timingSafeEqual，不再用 === 比较签名', () => {
    expect(LIB).toContain('timingSafeEqual')
    expect(LIB).not.toMatch(/expected\s*===\s*signature/)
  })

  it('v2 带过期签名：有效期内通过、过期后拒绝', () => {
    const url = 'https://i0.hdslb.com/d.jpg'
    const sig = generateMediaSignatureV2(url, 3600)
    expect(verifyMediaSignatureV2(url, sig)).toBe(true)
    const future = Date.now() + 7200 * 1000
    expect(verifyMediaSignatureV2(url, sig, future)).toBe(false)
    expect(verifyMediaSignatureV2(url + '?evil=1', sig)).toBe(false)
  })
})

describe('上游重定向逐跳防护', () => {
  it('fetch 使用 redirect: manual 且逐跳校验 isSafeMediaHost', () => {
    expect(ROUTE).toContain("redirect: 'manual'")
    expect(ROUTE).toContain('fetchWithRedirectGuard')
    // 每跳都重新调用 isSafeMediaHost（不是只校验起始 URL）
    expect((ROUTE.match(/isSafeMediaHost\(/g) ?? []).length).toBeGreaterThanOrEqual(2)
    // 不再出现不带 redirect 选项的裸 fetch(rawUrl)
    expect(ROUTE).not.toMatch(/fetch\(rawUrl,\s*\{[^}]*signal:/s)
  })

  it('跨源重定向剥离 Referer/Origin', () => {
    expect(ROUTE).toContain("delete baseHeaders['Referer']")
    expect(ROUTE).toContain("delete baseHeaders['Origin']")
  })
})
