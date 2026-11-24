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
  /**
   * 2026-11-21 架构变更后重写：业务路由出站已收口到 packages/ai 的
   * safeFetch（连接级 IP 钉扎 + 受控重定向 + 跨源剥离敏感头），路由不再
   * 自己写 redirect:'manual' 循环，也不再自带第二份敏感头集合。
   * 断言从「路由里有这些字面量」改为「路由确实走统一出口，且逐跳安全
   * 语义由权威层 ssrf.ts 钉住」——后者由 ssrf-redirect-headers.test.ts
   * 单独覆盖，本文件只守调用关系不退化。
   */
  it('走统一出口 safeFetch：受控重定向 + 媒体域名白名单逐跳复验 + 无 URL 子串欺骗', () => {
    expect(ROUTE).toContain("from '@/lib/ssrf-guard'")
    expect(ROUTE).toContain('safeFetch(')
    expect(ROUTE).toContain('maxRedirects')
    expect(ROUTE).toContain('fetchWithRedirectGuard')
    // 起始 URL + 重定向每跳/落地地址 + GET 入口共至少 3 处过 isSafeMediaHost
    expect((ROUTE.match(/isSafeMediaHost\(/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(ROUTE).toContain('result.redirects')
    expect(ROUTE).toContain('result.finalUrl')
    // 严禁 CodeQL js/incomplete-url-substring-sanitization 的 hostname.includes('hdslb.com')
    expect(ROUTE).not.toMatch(/hostname\.includes\(/)
    expect(ROUTE).toContain('matchesRootDomain(')
    // 响应头包含 CSP sandbox 与 nosniff
    expect(ROUTE).toContain("'Content-Security-Policy': \"default-src 'none'; sandbox\"")
    expect(ROUTE).toContain("'X-Content-Type-Options': 'nosniff'")
    // 不再有裸 fetch 或自维护的 manual 重定向循环
    expect(ROUTE).not.toMatch(/await fetch\(rawUrl/)
    expect(ROUTE).not.toMatch(/redirect:\s*['"]manual['"]/)
  })

  it('跨源重定向剥离敏感头由权威 SSRF 层统一负责', () => {
    const AI_SSRF = readFileSync(resolve(ROOT, '..', '..', 'packages/ai/src/ssrf.ts'), 'utf8')
    expect(AI_SSRF).toContain('SENSITIVE_REDIRECT_HEADERS')
    for (const h of ['authorization', 'cookie', 'proxy-authorization']) {
      expect(AI_SSRF.toLowerCase()).toContain(h)
    }
    expect(AI_SSRF).toMatch(/origin\s*!==\s*prevOrigin|prevOrigin\s*!==\s*\w+\.origin/)
    // 路由不再自带第二份实现（两侧曾是两份代码、真的漂移过）
    expect(ROUTE).not.toContain("delete baseHeaders['Referer']")
  })
})
