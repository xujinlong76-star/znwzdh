import { describe, expect, it } from 'vitest'
import {
  SsrfBlockedError,
  isHostAllowed,
  safeFetch,
} from '../../../packages/ai/src/ssrf'

/**
 * safeFetch 攻击向量回归（2026-11-21）。
 *
 * 对应 CodeQL 8 条 Critical SSRF 告警的收敛验证。这里测的是**行为**，
 * 不是源码字面量：每个用例都真的调用 safeFetch，断言它在建连之前拒绝。
 *
 * 只覆盖「应当被拒」的向量——被拒时不会真的发网络包，因此可在 CI 无网环境跑。
 * 放行路径（需要真实外网）由 e2e 与手工验证覆盖。
 */
describe('safeFetch 网络隔离', () => {
  const blocked = [
    ['http://127.0.0.1/', 'IPv4 环回'],
    ['http://127.0.0.1:8080/', '环回非标端口'],
    ['http://169.254.169.254/latest/meta-data/', '云元数据（AWS/GCP）'],
    ['http://[::1]/', 'IPv6 环回'],
    ['http://[::ffff:127.0.0.1]/', 'IPv6 映射 IPv4'],
    ['http://[::ffff:169.254.169.254]/', 'IPv6 映射元数据地址'],
    ['http://2130706433/', '十进制整数形式的 127.0.0.1'],
    ['http://0x7f000001/', '十六进制形式的 127.0.0.1'],
    ['http://10.0.0.1/', 'RFC1918 10/8'],
    ['http://172.16.0.1/', 'RFC1918 172.16/12'],
    ['http://192.168.1.1/', 'RFC1918 192.168/16'],
    ['http://100.64.0.1/', 'CGNAT 100.64/10'],
    ['http://0.0.0.0/', '全零地址'],
    ['http://[fe80::1]/', 'IPv6 链路本地'],
    ['http://[fc00::1]/', 'IPv6 唯一本地'],
  ] as const

  for (const [url, label] of blocked) {
    it(`拒绝 ${label}: ${url}`, async () => {
      await expect(safeFetch(url, { timeoutMs: 1500 })).rejects.toBeInstanceOf(SsrfBlockedError)
    })
  }

  it('拒绝非 http(s) 协议', async () => {
    for (const url of ['ftp://example.com/', 'file:///etc/passwd', 'gopher://example.com/']) {
      await expect(safeFetch(url, { timeoutMs: 1500 })).rejects.toBeInstanceOf(SsrfBlockedError)
    }
  })

  it('拒绝内嵌凭据的 URL', async () => {
    await expect(safeFetch('http://user:pass@example.com/', { timeoutMs: 1500 })).rejects.toBeInstanceOf(
      SsrfBlockedError,
    )
  })

  it('拒绝非白名单端口', async () => {
    await expect(
      safeFetch('http://example.com:6379/', { timeoutMs: 1500, allowedHosts: ['example.com'] }),
    ).rejects.toBeInstanceOf(SsrfBlockedError)
  })
})

describe('safeFetch 域名白名单', () => {
  it('命中精确域名放行判断', () => {
    expect(isHostAllowed('api.github.com', ['api.github.com'])).toBe(true)
  })
  it('未命中则拒绝', () => {
    expect(isHostAllowed('evil.com', ['api.github.com'])).toBe(false)
  })
  it('通配子域匹配，但不含裸域', () => {
    expect(isHostAllowed('cdn.example.com', ['*.example.com'])).toBe(true)
    expect(isHostAllowed('example.com', ['*.example.com'])).toBe(false)
  })
  it('空白名单表示不限制（交由 IP 黑名单兜底）', () => {
    expect(isHostAllowed('anything.com', undefined)).toBe(true)
    expect(isHostAllowed('anything.com', [])).toBe(true)
  })
  it('白名单在 DNS 解析之前就拦截（不发网络包）', async () => {
    await expect(
      safeFetch('https://not-in-list.example/', {
        timeoutMs: 1500,
        allowedHosts: ['api.github.com'],
      }),
    ).rejects.toThrow(/白名单/)
  })
})

describe('safeFetch 重定向防护', () => {
  it('恶意 302 跳转到内网必须被拦截', async () => {
    // 用本地 http server 制造一个「公网页面 302 到 169.254.169.254」的场景。
    // safeFetch 的每一跳都会重新校验，因此第二跳在解析阶段就被拒。
    const http = await import('node:http')
    const srv = http.createServer((_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
      res.end()
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
    const port = (srv.address() as { port: number }).port
    try {
      await expect(
        safeFetch(`http://127.0.0.1:${port}/`, {
          timeoutMs: 2000,
          allowPrivateNetworks: true,
          allowedPorts: [80, 443, port],
        }),
      ).rejects.toBeInstanceOf(SsrfBlockedError)
    } finally {
      srv.close()
    }
  })
})
