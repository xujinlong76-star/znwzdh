/**
 * SSRF 守卫回归（P1-6）。
 *
 * 修的是什么：
 *  1. `isSafeUrl` 只认点分四段 IPv4 与少量 IPv6 写法，`2130706433` / `0x7f000001` /
 *     `127.1` / `0177.0.0.1` / `localhost.` / `[0:0:0:0:0:0:0:1]` / `[::ffff:127.0.0.1]`
 *     这些**解析器眼里等价于本机**的写法全部能绕过（都是实测可用的经典绕过）。
 *  2. 更致命的是 `createGuardedApiExecutor` 用默认 fetch 自动跟随重定向：
 *     合法公网 URL 只要 302 到 `http://169.254.169.254/…`（云元数据）就整体绕过校验。
 *     现在改成 `redirect: 'manual'` + 逐跳重新校验。
 */
import { describe, expect, it } from 'vitest'
import { createGuardedApiExecutor, isSafeUrl } from '../src/dynamic-tool-synthesizer.ts'

describe('isSafeUrl：等价于本机的各种写法都不可绕过', () => {
  it.each([
    'http://2130706433/', // 十进制 127.0.0.1
    'http://0x7f000001/', // 十六进制
    'http://127.1/', // 缩写形式
    'http://0177.0.0.1/', // 八进制段（parseInt 读作 177，解析器读作 127）
    'http://localhost./', // 尾随点
    'http://[::ffff:127.0.0.1]/', // IPv4 映射 IPv6
    'http://[0:0:0:0:0:0:0:1]/', // 未压缩的 loopback
    'http://169.254.169.254/latest/meta-data/', // 云元数据
    'file:///etc/passwd',
  ])('%s 必须被拒绝', (url) => {
    expect(isSafeUrl(url).safe).toBe(false)
  })

  it('正常公网地址仍然放行（守卫不得误伤）', () => {
    expect(isSafeUrl('https://api.github.com/repos').safe).toBe(true)
    expect(isSafeUrl('https://example.com:8443/path?q=1').safe).toBe(true)
  })
})

describe('createGuardedApiExecutor：重定向必须逐跳校验', () => {
  it('302 指向云元数据时拒绝，且不去真的请求内网', async () => {
    const calls: string[] = []
    const fetchFn = (async (url: unknown) => {
      calls.push(String(url))
      return new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      })
    }) as unknown as typeof fetch

    const exec = createGuardedApiExecutor({ fetchFn })
    await expect(exec('https://evil.example/redirect')).rejects.toThrow(/SSRF Guard Violation/)
    expect(calls).toEqual(['https://evil.example/redirect'])
  })

  it('相对 Location 会按当前地址解析后再校验，合法跳转照常返回', async () => {
    let n = 0
    const fetchFn = (async () => {
      n += 1
      if (n === 1) {
        return new Response(null, { status: 302, headers: { location: '/ok' } })
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const exec = createGuardedApiExecutor({ fetchFn })
    const out = await exec('https://public.example/a')
    expect(out.status).toBe(200)
    expect(out.data).toEqual({ ok: true })
    expect(n).toBe(2)
  })

  it('重定向环有跳数上限，不会无限跟随', async () => {
    const fetchFn = (async (url: unknown) =>
      new Response(null, { status: 302, headers: { location: String(url) } })) as unknown as typeof fetch

    const exec = createGuardedApiExecutor({ fetchFn })
    await expect(exec('https://public.example/loop')).rejects.toThrow(/Too many redirects/)
  })

  it('302 的 POST 会降级为 GET 并丢弃请求体', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchFn = (async (url: unknown, init: RequestInit = {}) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: '/next' } })
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const exec = createGuardedApiExecutor({ fetchFn })
    await exec('https://public.example/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    })
    expect(calls[1]?.init.method).toBe('GET')
    expect(calls[1]?.init.body).toBeUndefined()
    expect(
      Object.keys(calls[1]?.init.headers as Record<string, string>).map((k) => k.toLowerCase())
    ).not.toContain('content-type')
  })

  it('307 保留原方法和请求体', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchFn = (async (url: unknown, init: RequestInit = {}) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(null, { status: 307, headers: { location: '/next' } })
      }
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const exec = createGuardedApiExecutor({ fetchFn })
    await exec('https://public.example/start', { method: 'PUT', body: 'payload' })
    expect(calls[1]?.init.method).toBe('PUT')
    expect(calls[1]?.init.body).toBe('payload')
  })

  it('跨源重定向移除 Authorization/Cookie', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchFn = (async (url: unknown, init: RequestInit = {}) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: 'https://other.example/next' } })
      }
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const exec = createGuardedApiExecutor({ fetchFn })
    await exec('https://public.example/start', {
      headers: { authorization: 'Bearer secret', cookie: 'sid=1' },
    })
    const headers = calls[1]?.init.headers as Record<string, string>
    expect(headers.authorization).toBeUndefined()
    expect(headers.cookie).toBeUndefined()
  })
})
