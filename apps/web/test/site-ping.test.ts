import { describe, it, expect, vi } from 'vitest'
import { probeSiteLatency } from '../src/lib/site-ping'

describe('Site Reachability & Latency Prober', () => {
  it('应拒绝非 http/https 协议 URL', async () => {
    const res = await probeSiteLatency('javascript:alert(1)')
    expect(res.reachable).toBe(false)
    expect(res.quality).toBe('unreachable')
    expect(res.error).toBe('URL 格式错误')
  })

  it('正常响应时应返回毫秒延迟与对应评级', async () => {
    // 模拟 fetch 成功
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return Promise.resolve(new Response('ok'))
    })

    try {
      const res = await probeSiteLatency('https://example.com')
      expect(res.reachable).toBe(true)
      expect(typeof res.latencyMs).toBe('number')
      expect(['fast', 'normal']).toContain(res.quality)
      expect(res.label).toContain('ms')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('超时被 abort 时应返回连接超时错误', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        const signal = options?.signal
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }
      })
    })

    try {
      const res = await probeSiteLatency('https://slow-site.com', 50)
      expect(res.reachable).toBe(false)
      expect(res.quality).toBe('unreachable')
      expect(res.label).toContain('超时')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
