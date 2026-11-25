/**
 * SSRF 中枢代理加固回归（2026-11-25，6 条严重提醒 B2 线）。
 *
 * 覆盖：
 * ① guardedFetch 的 allowedHosts / allowedPorts 逐跳钉死（跨 host 重定向即拦，
 *    同 host 重定向放行）；② 外部取消信号穿透到上游 fetch；
 * ③ buildPinnedHubUrl / buildHubUrl 的路径段校验与 host 钉死；
 * ④ hubGuardOptions 的 host/端口推导；
 * ⑤ 七处 sink 的源码级调用关系（走守卫出口、不用裸 fetch、不破坏流式）。
 * ⑥ localhost 解析到多 IP（::1 在前、服务只绑 127.0.0.1）时连接失败换下一个
 *    候选（回归：CI 2026-11-25 ISR 阶段 4 的 502×60；裸 fetch 有 Happy Eyeballs
 *    兜底，旧实现只钉 resolvedIps[0] 没有）。
 *
 * 行为用例 mock `node:dns/promises` 与全局 fetch，与 ssrf-guard.test.ts 同口径；
 * 路由处理器本身串着 auth/会话/签名副作用，按仓库惯例只钉源码级调用关系。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }))

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

import {
  buildHubUrl,
  buildPinnedHubUrl,
  guardedFetch,
  hubGuardOptions,
  SsrfBlockedError,
} from '../src/lib/ssrf-guard'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 里的真源；镜像副本（apps/web/test 这一份）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return hit
}

/** 去注释：负向断言不能被注释里的旧写法「匹配上」，正向断言也不该靠注释过关 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const GUARD_SRC = readFileSync(overlayFile('src/lib/ssrf-guard.ts'), 'utf8')
const HUB_ROUTE = codeOnly(readFileSync(overlayFile('src/app/api/hub/[...path]/route.ts'), 'utf8'))
const ME_ROUTE = codeOnly(readFileSync(overlayFile('src/app/api/me/[[...path]]/route.ts'), 'utf8'))
const SEARCH_ROUTE = codeOnly(readFileSync(overlayFile('src/app/api/search/route.ts'), 'utf8'))
const SUBMISSIONS_ROUTE = codeOnly(readFileSync(overlayFile('src/app/api/submissions/route.ts'), 'utf8'))
const SUBMISSION_NUMBER_ROUTE = codeOnly(
  readFileSync(overlayFile('src/app/api/submissions/[number]/route.ts'), 'utf8'),
)
const HUB_LIB = codeOnly(readFileSync(overlayFile('src/lib/server/hub.ts'), 'utf8'))
const BILI_ROUTE = codeOnly(
  readFileSync(overlayFile('src/app/api/videos/bili-stream/route.ts'), 'utf8'),
)

const LOCALHOST_RESOLVES_LOOPBACK = [{ address: '127.0.0.1', family: 4 }]

function stubFetchOk(body = '{"ok":true}') {
  return vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(body, { status: 200 }))
}

beforeEach(() => {
  lookupMock.mockReset()
  lookupMock.mockResolvedValue(LOCALHOST_RESOLVES_LOOPBACK)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// mock 卫生（D2）：清除本文件的模块 mock 缓存，避免驻留同 worker 的后续文件
afterAll(() => {
  vi.resetModules()
})

describe('guardedFetch：host/端口逐跳钉死', () => {
  it('首跳 host 不在白名单内即拦，不发 DNS、不发请求', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      guardedFetch('http://evil.example/x', {
        allowedHosts: ['localhost'],
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(SsrfBlockedError)
    await expect(
      guardedFetch('http://evil.example/x', {
        allowedHosts: ['localhost'],
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/不在域名白名单内/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('端口不在白名单内即拦', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      guardedFetch('http://localhost:9999/x', {
        allowedHosts: ['localhost'],
        allowedPorts: [8787],
        allowPrivateNetworks: true,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/不在允许范围内/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('钉死的中枢 host 放行：http 明文钉到已校验 IP + Host 头保留原域名', async () => {
    const fetchMock = stubFetchOk()
    vi.stubGlobal('fetch', fetchMock)
    const { response } = await guardedFetch('http://localhost:8787/api/search?q=x', {
      ...hubGuardOptions('http://localhost:8787'),
      timeoutMs: 5000,
      maxBytes: 1024,
    })
    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // http 明文：请求 URL 被改写为已校验的 127.0.0.1，Host 头仍是原域名
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8787/api/search?q=x')
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['Host']).toBe('localhost:8787')
  })

  it('同 host 重定向跟随、跨 host 重定向即拦（且只发一次请求）', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('127.0.0.1:8787/api/search')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://evil.example/steal' },
        })
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      guardedFetch('http://localhost:8787/api/search?q=x', {
        ...hubGuardOptions('http://localhost:8787'),
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/不在域名白名单内/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('同 host 重定向正常跟随到底', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      if (String(input).includes('/api/search')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://localhost:8787/api/other' },
        })
      }
      return new Response('{"ok":true}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { response, finalUrl } = await guardedFetch('http://localhost:8787/api/search?q=x', {
      ...hubGuardOptions('http://localhost:8787'),
      timeoutMs: 5000,
    })
    expect(response.status).toBe(200)
    expect(finalUrl).toBe('http://localhost:8787/api/other')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('guardedFetch：外部取消信号穿透到上游', () => {
  it('调用方 abort ⇒ 上游 fetch 立刻 AbortError（hub 代理的「停止」按钮依赖这一路）', async () => {
    vi.stubGlobal(
      'fetch',
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError')),
          )
        }),
    )
    const client = new AbortController()
    const pending = guardedFetch('http://localhost:8787/api/ask', {
      ...hubGuardOptions('http://localhost:8787'),
      timeoutMs: 10_000,
      signal: client.signal,
    })
    // 还没 abort 时它确实挂着——否则这条用例什么都没证明
    const racedWhilePending = await Promise.race([
      pending.then(
        () => 'resolved' as const,
        () => 'rejected' as const,
      ),
      new Promise((r) => setTimeout(() => r('pending' as const), 50)),
    ])
    expect(racedWhilePending).toBe('pending')
    client.abort()
    await expect(pending).rejects.toThrow(/abort/i)
  })
})

describe('guardedFetch：解析到多 IP 时连接失败换下一个候选', () => {
  it('localhost 解析到 ::1 在前、服务只绑 127.0.0.1 时仍能连上（回归：CI 2026-11-25 ISR 阶段 4 的 502×60）', async () => {
    // DNS mock 返回 ::1 在前（与本机/CI runner 的 lookup 顺序一致），服务只绑
    // 127.0.0.1：旧实现只钉 resolvedIps[0] 会 ECONNREFUSED ::1，新实现换下一个
    // 候选 IP 后 200。测试用真 fetch + 真本地服务，不 stub fetch。
    lookupMock.mockResolvedValue([
      { address: '::1', family: 6 },
      { address: '127.0.0.1', family: 4 },
    ])
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      const { response } = await guardedFetch(`http://localhost:${port}/api/categories`, {
        ...hubGuardOptions(`http://localhost:${port}`),
        timeoutMs: 5000,
        maxBytes: 1024,
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('全部候选都拒绝连接时抛错、不静默吞掉', async () => {
    lookupMock.mockResolvedValue([
      { address: '::1', family: 6 },
      { address: '127.0.0.1', family: 4 },
    ])
    // 找一个当前无人监听的端口：先起一个服务取端口、关掉再用它。
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    await expect(
      guardedFetch(`http://localhost:${port}/api/categories`, {
        ...hubGuardOptions(`http://localhost:${port}`),
        timeoutMs: 5000,
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/fetch failed/)
  })
})

describe('buildPinnedHubUrl：路径段校验 + host 钉死', () => {
  it('正常段拼成 /api/... 并保留查询串', () => {
    expect(buildPinnedHubUrl('http://localhost:8787', ['search'], '?q=x').toString()).toBe(
      'http://localhost:8787/api/search?q=x',
    )
    expect(buildPinnedHubUrl('http://localhost:8787/', ['me', 'x']).toString()).toBe(
      'http://localhost:8787/api/me/x',
    )
    // HUB_BASE 带 /api 后缀时不重复拼 /api
    expect(buildPinnedHubUrl('http://localhost:8787/api', ['sites']).toString()).toBe(
      'http://localhost:8787/api/sites',
    )
  })

  it('段内特殊字符被编码，失去结构意义', () => {
    expect(buildPinnedHubUrl('http://localhost:8787', ['a b']).toString()).toBe(
      'http://localhost:8787/api/a%20b',
    )
  })

  it("'..' / '.' / 空段 / 反斜杠 / '?#' 段一律拒", () => {
    for (const bad of ['..', '.', '', 'a\\b', 'a?b', 'a#b']) {
      expect(() => buildPinnedHubUrl('http://localhost:8787', [bad])).toThrow(SsrfBlockedError)
    }
  })

  it('查询串含 # 即拒', () => {
    expect(() => buildPinnedHubUrl('http://localhost:8787', ['search'], '?q=a#b')).toThrow(
      SsrfBlockedError,
    )
  })
})

describe('buildHubUrl：hubGet/hubGetProbe 的 path 校验', () => {
  it('正常 path（含查询串）放行', () => {
    expect(buildHubUrl('http://localhost:8787', '/api/me/x?y=1').toString()).toBe(
      'http://localhost:8787/api/me/x?y=1',
    )
  })

  it("'//evil.com' 绝对形式、绝对 URL、反斜杠、'#' 一律拒", () => {
    for (const bad of [
      '//evil.com/x',
      'https://evil.com/api/x',
      '/api\\..',
      '/api/x#frag',
      'api/sites',
    ]) {
      expect(() => buildHubUrl('http://localhost:8787', bad)).toThrow(SsrfBlockedError)
    }
  })

  it("'..' 段拒：明文与 %2E 编码都算穿越", () => {
    for (const bad of ['/api/x/../admin', '/api/%2e%2e/admin', '/api/%2E%2E/admin']) {
      expect(() => buildHubUrl('http://localhost:8787', bad)).toThrow(SsrfBlockedError)
    }
  })
})

describe('hubGuardOptions：host/端口推导', () => {
  it('localhost:8787 钉死 host、放行私网、端口含 8787/80/443', () => {
    const opts = hubGuardOptions('http://localhost:8787')
    expect(opts.allowedHosts).toEqual(['localhost'])
    expect(opts.allowPrivateNetworks).toBe(true)
    expect(opts.allowedPorts).toEqual(expect.arrayContaining([8787, 80, 443]))
  })

  it('docker 内网主机名与 127.0.0.1 同理', () => {
    expect(hubGuardOptions('http://api:8787').allowedHosts).toEqual(['api'])
    expect(hubGuardOptions('http://127.0.0.1:8787').allowedHosts).toEqual(['127.0.0.1'])
    expect(hubGuardOptions('https://hub.internal').allowedPorts).toEqual(
      expect.arrayContaining([443, 80]),
    )
  })
})

describe('源码级调用关系：七处 sink 走守卫出口', () => {
  it('ssrf-guard：白名单/信号选项与中枢 helper 齐全', () => {
    expect(GUARD_SRC).toContain('allowedHosts?: readonly string[]')
    expect(GUARD_SRC).toContain('allowedPorts?: readonly number[]')
    expect(GUARD_SRC).toContain('signal?: AbortSignal')
    expect(GUARD_SRC).toContain('export function hubGuardOptions')
    expect(GUARD_SRC).toContain('export function buildPinnedHubUrl')
    expect(GUARD_SRC).toContain('export function buildHubUrl')
  })

  it('hub 代理：guardedFetch + host 钉死 + 合并信号，不再裸 fetch', () => {
    expect(HUB_ROUTE).toContain('guardedFetch(')
    expect(HUB_ROUTE).toContain('buildPinnedHubUrl(')
    expect(HUB_ROUTE).toContain('hubGuardOptions(')
    expect(HUB_ROUTE).toContain('hub_upstream_redirect_blocked')
    expect(HUB_ROUTE).toMatch(/signal:\s*upstreamSignal/)
    expect(HUB_ROUTE).not.toContain('await fetch(target')
  })

  it('me 代理：guardedFetch + host 钉死，不再裸 fetch（固定路径三处不动）', () => {
    expect(ME_ROUTE).toContain('guardedFetch(')
    expect(ME_ROUTE).toContain('buildPinnedHubUrl(')
    expect(ME_ROUTE).toContain('hubGuardOptions(')
    expect(ME_ROUTE).not.toContain('await fetch(target')
  })

  it('search：guardedFetch + host 钉死，不再裸 fetch', () => {
    expect(SEARCH_ROUTE).toContain('guardedFetch(')
    expect(SEARCH_ROUTE).toContain('buildPinnedHubUrl(')
    expect(SEARCH_ROUTE).toContain('hubGuardOptions(')
    expect(SEARCH_ROUTE).not.toContain('await fetch(targetUrl')
  })

  it('submissions 列表：status 白名单 + guardedFetch，不再裸 fetch', () => {
    expect(SUBMISSIONS_ROUTE).toContain('ALLOWED_SUBMISSION_STATUS')
    expect(SUBMISSIONS_ROUTE).toContain('guardedFetch(')
    expect(SUBMISSIONS_ROUTE).toContain('hubGuardOptions(')
    expect(SUBMISSIONS_ROUTE).not.toContain('await fetch(url.toString()')
  })

  it('submissions [number]：PATCH 入口 + 三个 helper 各自校验编号，GitHub 路径编码', () => {
    const guards = SUBMISSION_NUMBER_ROUTE.match(/\/\^\\d\+\$\/\.test\(issueNumber\)/g) ?? []
    // PATCH 入口 1 处 + updateIssueLabels/addIssueComment/closeIssue 各 1 处 = 4 处
    expect(guards.length).toBe(4)
    const encoded = SUBMISSION_NUMBER_ROUTE.match(/encodeURIComponent\(issueNumber\)/g) ?? []
    expect(encoded.length).toBeGreaterThanOrEqual(5)
    expect(SUBMISSION_NUMBER_ROUTE).toContain('guardedFetch(')
    expect(SUBMISSION_NUMBER_ROUTE).toContain('hubGuardOptions(')
  })

  it('hub.ts：hubGet/hubGetProbe 拼 URL 前校验 + 钉死 host', () => {
    expect(HUB_LIB).toContain('buildHubUrl(')
    expect(HUB_LIB).not.toContain('fetch(`${HUB_BASE}${path}`')
  })

  it('bili-stream：路由内联白名单补齐，流式仍走手动 fetch、不走 safeFetch', () => {
    expect(BILI_ROUTE).toContain('isAllowedBiliStreamHostInline(')
    expect(BILI_ROUTE).toContain('BILI_STREAM_ALLOWED_SUFFIXES')
    expect(BILI_ROUTE).toContain('port !== 80 && port !== 443')
    expect(BILI_ROUTE).toContain('fetchWithHeaderTimeout(')
    expect(BILI_ROUTE).not.toContain('safeFetch(')
  })
})
