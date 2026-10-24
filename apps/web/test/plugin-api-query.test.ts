/**
 * 回归：插件列表客户端的筛选/分页参数必须真的进 URL。
 *
 * 共享工作树里的一轮未提交重构把 `?${qs}` 退化成只有 `?`，搜索、类型筛选、
 * 排序、分页与作者页分页因此全部失效——市场页表现为「搜索条件挂上了，
 * 结果却还是全部插件」。这里钉住 4 个入口的查询串，避免再次静默丢失。
 *
 * 身份参数不在此列：T1 起 `?anonId=` 已全量下线，只走 X-Navhub-Anon-Id header，
 * 因此断言 header，同时确保 URL 里不再出现 anonId。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAdminPlugins, fetchAuthorPlugins, fetchMyPlugins, fetchPlugins } from '@/lib/navhub-api'

interface FetchCall {
  url: string
  headers: Record<string, string>
}

let calls: FetchCall[] = []

beforeEach(() => {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push({ url, headers: { ...((init?.headers as Record<string, string>) ?? {}) } })
      return new Response(JSON.stringify({ items: [], total: 0, limit: 0, offset: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function lastCall(): { url: URL; headers: Record<string, string> } {
  expect(calls.length).toBeGreaterThan(0)
  const call = calls[calls.length - 1]
  return { url: new URL(call.url, 'http://localhost'), headers: call.headers }
}

describe('插件列表请求必须携带筛选与分页参数', () => {
  it('fetchPlugins：q/kind/sort/limit/offset 一个都不能丢', async () => {
    await fetchPlugins({ q: '待审包 x', kind: 'theme', sort: 'new', limit: 24, offset: 48 })
    const { url } = lastCall()
    expect(url.pathname).toBe('/api/hub/plugins')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: 'theme',
      q: '待审包 x',
      sort: 'new',
      limit: '24',
      offset: '48',
    })
  })

  it('fetchAdminPlugins：status/kind/q/sort/limit/offset 全量透传', async () => {
    await fetchAdminPlugins({
      status: 'pending',
      kind: 'site-pack',
      q: 'e2e',
      sort: 'new',
      limit: 10,
      offset: 20,
    })
    const { url } = lastCall()
    expect(url.pathname).toBe('/api/hub/admin/plugins')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'pending',
      kind: 'site-pack',
      q: 'e2e',
      sort: 'new',
      limit: '10',
      offset: '20',
    })
  })

  it('fetchMyPlugins：分页进 URL，身份只走 header', async () => {
    await fetchMyPlugins({ limit: 12, offset: 24, identity: 'anon-test' })
    const { url, headers } = lastCall()
    expect(url.pathname).toBe('/api/hub/plugins/mine')
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '12', offset: '24' })
    expect(url.searchParams.get('anonId')).toBeNull()
    expect(headers['X-Navhub-Anon-Id']).toBe('anon-test')
  })

  it('fetchAuthorPlugins：分页参数进 URL', async () => {
    await fetchAuthorPlugins('abcdef12', { limit: 6, offset: 6 })
    const { url } = lastCall()
    expect(url.pathname).toBe('/api/hub/plugins/author/abcdef12')
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '6', offset: '6' })
  })
})
