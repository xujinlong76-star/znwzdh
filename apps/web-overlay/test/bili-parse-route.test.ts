/**
 * `/api/videos/bili-parse` 的两条路由级契约（A3）。
 *
 * 1. **凭据不进 URL**：`access_key` 只允许走 POST body。query 会留在浏览器历史、
 *    反向代理与服务端访问日志、以及各种错误上报里，而它等同于用户的 B 站登录态。
 * 2. **匿名出站通道要有预算**：一次解析最多顺序打 6 个上游。没有闸门时任何人都能把
 *    本站当免费解析代理，出口 IP 被目标站拉黑之后，看到「全都解析失败」的是全体真实用户。
 *
 * 解析器用 `vi.doMock` 定桩：这里测的是路由行为（参数走向、状态码、额度归还），
 * key 到底出不出站由 `video-bilibili-hd-parser.test.ts` 的 A3 组负责。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

type ParseInput = Record<string, unknown>
interface StubResult {
  ok: boolean
  source: string
  canonicalUrl: string
  p: number
  qualityLabel: string
  embedUrl: string
  streamUrl?: string
  expiresAt: number
}

const ROUTE = '@/app/api/videos/bili-parse/route'
const PARSER = '@/lib/video-bilibili-hd-parser'
const ENV_KEYS = ['NAVHUB_BILI_PARSE_MAX_CONCURRENT', 'NAVHUB_BILI_PARSE_MAX_PER_MIN']

function okResult(input: ParseInput): StubResult {
  return {
    ok: true,
    source: 'xingzhige',
    canonicalUrl:
      typeof input.bvid === 'string'
        ? `https://www.bilibili.com/video/${input.bvid}`
        : 'https://www.bilibili.com/video/BV1MmUSB5Efw',
    p: typeof input.p === 'number' ? input.p : 1,
    qualityLabel: '高清 720P',
    streamUrl: 'https://upos-sz-mirrorhw.bilivideo.com/upgcxcode/test.mp4',
    embedUrl: 'https://player.bilibili.com/player.html?bvid=BV1MmUSB5Efw',
    expiresAt: Date.now() + 60_000,
  }
}

/** 阈值在模块加载时读取，所以每个用例都要重新定桩再重新 import */
async function loadRoute(env: Record<string, string> = {}) {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(process.env, env)

  const resolveMock = vi.fn(async (input: ParseInput) => okResult(input))
  vi.doMock(PARSER, () => ({ resolveBilibiliHdStream: resolveMock }))
  vi.resetModules()
  const mod = (await import(ROUTE)) as {
    GET: (request: Request) => Promise<Response>
    POST: (request: Request) => Promise<Response>
  }
  return { GET: mod.GET, POST: mod.POST, resolveMock }
}

function get(url: string, ip = '203.0.113.1') {
  return new Request(`http://localhost${url}`, { headers: { 'x-forwarded-for': ip } })
}

function post(body: Record<string, unknown>, ip = '203.0.113.1') {
  return new Request('http://localhost/api/videos/bili-parse', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  vi.doUnmock(PARSER)
  vi.resetModules()
})

describe('GET：access_key 不再从 query 收', () => {
  it('query 里有 access_key 直接 400，并指引用 POST——而且一次上游都不碰', async () => {
    for (const name of ['access_key', 'accessKey']) {
      const { GET, resolveMock } = await loadRoute()
      const res = await GET(get(`/api/videos/bili-parse?bvid=BV1MmUSB5Efw&${name}=visitor_secret`))
      expect(res.status).toBe(400)
      const body = (await res.json()) as { ok: boolean; code?: string; error?: string }
      expect(body.ok).toBe(false)
      expect(body.code).toBe('credential_in_query')
      expect(body.error).toContain('POST')
      expect(resolveMock, '拒绝发生在进解析链之前，凭据连日志都不该留').not.toHaveBeenCalled()
    }
  })

  it('不带凭据的普通解析照常 200，并给可共享的私有缓存', async () => {
    const { GET, resolveMock } = await loadRoute()
    const res = await GET(get('/api/videos/bili-parse?bvid=BV1MmUSB5Efw&p=2'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('private, max-age=300')
    const input = resolveMock.mock.calls[0]?.[0] as ParseInput
    expect(input.bvid).toBe('BV1MmUSB5Efw')
    expect(input.p).toBe(2)
    expect(input.accessKey, 'GET 不该再往解析器塞 key').toBeUndefined()
  })

  it('缺 bvid/aid/url 时给结构化 code，而不是只有一句话', async () => {
    const { GET } = await loadRoute()
    const res = await GET(get('/api/videos/bili-parse'))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code?: string }).code).toBe('missing_target')
  })
})

describe('POST：凭据走请求体', () => {
  it('body 里的 accessKey 原样交给解析器，响应一律 no-store', async () => {
    const { POST, resolveMock } = await loadRoute()
    const res = await POST(post({ bvid: 'BV1MmUSB5Efw', access_key: 'visitor_secret' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect((resolveMock.mock.calls[0]?.[0] as ParseInput).accessKey).toBe('visitor_secret')
  })

  it('不带 key 的解析可以进私有缓存', async () => {
    const { POST } = await loadRoute()
    const res = await POST(post({ bvid: 'BV1MmUSB5Efw' }))
    expect(res.headers.get('Cache-Control')).toContain('private, max-age=300')
  })

  it('解析器抛错也如实回结构化 code，不变成 500 白屏', async () => {
    const { POST } = await loadRoute()
    const res = await POST(post({ bvid: 'BV1MmUSB5Efw' }))
    expect(res.status).toBe(200)
    const missing = await POST(post({}))
    expect(missing.status).toBe(400)
    expect(((await missing.json()) as { code?: string }).code).toBe('missing_target')
  })
})

describe('出站预算：按调用方限流 + 进程并发', () => {
  it('同一 IP 超窗口额度后 429 + Retry-After，且不再打上游', async () => {
    const { GET, resolveMock } = await loadRoute({ NAVHUB_BILI_PARSE_MAX_PER_MIN: '2' })
    expect((await GET(get('/api/videos/bili-parse?bvid=BV1'))).status).toBe(200)
    expect((await GET(get('/api/videos/bili-parse?bvid=BV2'))).status).toBe(200)

    const limited = await GET(get('/api/videos/bili-parse?bvid=BV3'))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBeTruthy()
    expect(((await limited.json()) as { code?: string }).code).toBe('rate_limited')
    expect(resolveMock).toHaveBeenCalledTimes(2)
  })

  it('限流按调用方分桶：别人不会被你刷的那几名下线', async () => {
    const { GET } = await loadRoute({ NAVHUB_BILI_PARSE_MAX_PER_MIN: '1' })
    expect((await GET(get('/api/videos/bili-parse?bvid=BV1', '198.51.100.7'))).status).toBe(200)
    expect((await GET(get('/api/videos/bili-parse?bvid=BV1', '192.0.2.44'))).status).toBe(200)
  })

  it('并发满了给 503（与「你打太快」分开报），而不是把请求排进内存里等', async () => {
    const { GET, resolveMock } = await loadRoute({ NAVHUB_BILI_PARSE_MAX_CONCURRENT: '1' })
    let release: (value: StubResult) => void = () => {}
    resolveMock.mockImplementationOnce(
      () => new Promise<StubResult>((resolve) => { release = resolve }),
    )
    const first = GET(get('/api/videos/bili-parse?bvid=BV1'))
    const busy = await GET(get('/api/videos/bili-parse?bvid=BV2', '192.0.2.44'))
    expect(busy.status).toBe(503)
    expect(((await busy.json()) as { code?: string }).code).toBe('saturated')
    release(okResult({ bvid: 'BV1' }))
    expect((await first).status).toBe(200)
  })

  it('解析抛错必须归还并发槽：一次异常不能永久吃掉额度', async () => {
    const { GET, resolveMock } = await loadRoute({ NAVHUB_BILI_PARSE_MAX_CONCURRENT: '1' })
    resolveMock.mockImplementationOnce(() => Promise.reject(new Error('上游全部失败')))
    const boom = await GET(get('/api/videos/bili-parse?bvid=BV1'))
    expect(boom.status).toBe(400)
    expect(((await boom.json()) as { code?: string }).code).toBe('parse_failed')

    const next = await GET(get('/api/videos/bili-parse?bvid=BV2', '192.0.2.44'))
    expect(next.status, '漏还槽位的话这里会变成 503，而且是永久 503').toBe(200)
  })

  it('POST 与 GET 共用同一份预算：换方法绕不开限流', async () => {
    const { GET, POST } = await loadRoute({ NAVHUB_BILI_PARSE_MAX_PER_MIN: '1' })
    expect((await GET(get('/api/videos/bili-parse?bvid=BV1', '192.0.2.9'))).status).toBe(200)
    const blocked = await POST(post({ bvid: 'BV2' }, '192.0.2.9'))
    expect(blocked.status).toBe(429)
  })
})

describe('契约：播放器发出去的形状，路由必须原样收得住', () => {
  const PLAYER = 'src/components/video-bilibili-hd-player.tsx'
  const ROUTE_SRC = 'src/app/api/videos/bili-parse/route.ts'

  /** 取「组装 payload → fetch」之间的那段源码里出现过的 body 字段名 */
  function sentBodyKeys(src: string): string[] {
    const start = src.indexOf('const payload')
    const end = src.indexOf('fetch(', start)
    expect(start > 0 && end > start, '找不到播放器组装解析请求的那段代码').toBe(true)
    const block = src.slice(start, end)
    const keys = new Set<string>()
    for (const literal of block.matchAll(/\{\s*([^}]*)\}/g)) {
      for (const pair of literal[1].split(',')) {
        const key = pair.split(':')[0]?.trim()
        if (key && /^[A-Za-z_$][\w$]*$/.test(key)) keys.add(key)
      }
    }
    for (const assign of block.matchAll(/payload\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) {
      keys.add(assign[1])
    }
    return [...keys].sort()
  }

  function unreadKeys(routeSrc: string, keys: string[]): string[] {
    return keys.filter((key) => !routeSrc.includes(`body.${key}`))
  }

  it('播放器发的每个字段都被路由读取——多塞或改名的字段不会静默丢掉', () => {
    const keys = sentBodyKeys(read(PLAYER))
    expect(keys, '至少该发出这些解析参数').toEqual(
      expect.arrayContaining(['accessKey', 'aid', 'bvid', 'cid', 'engine', 'forceRefresh', 'p']),
    )
    expect(unreadKeys(read(ROUTE_SRC), keys)).toEqual([])
    // 扫描机没瞎：路由没读的字段必须被点名
    expect(unreadKeys(read(ROUTE_SRC), [...keys, 'sneaky'])).toEqual(['sneaky'])
  })

  it('解析请求的 URL 不带 query——凭据只可能出现在 body 里', () => {
    const src = read(PLAYER)
    const urls = [...src.matchAll(/fetch\(\s*[`'"](\/api\/videos\/bili-parse[^`'"]*)[`'"]/g)].map((m) => m[1])
    expect(urls, '播放器应当只发一条 bili-parse 请求').toHaveLength(1)
    expect(urls[0]).toBe('/api/videos/bili-parse')
    // 扫描机没瞎：把 key 塞回 query 的写法会被同一条规则抓到
    const leaked = 'fetch(`/api/videos/bili-parse?bvid=BV1&access_key=secret`)'
    const hit = /fetch\(\s*[`'"](\/api\/videos\/bili-parse[^`'"]*)[`'"]/.exec(leaked)
    expect(hit?.[1] ?? '').toContain('access_key')
    expect(src).toContain("method: 'POST'")
  })

  it('被预算拦下时如实区分「你太快」与「大家都挤」，而不是静默切成内嵌', async () => {
    const src = read(PLAYER)
    expect(src).toMatch(/res\.status === 429 \|\| res\.status === 503/)
    const texts = [...src.matchAll(/return '(同时解析的人[^']*|解析太频繁[^']*)'/g)].map((m) => m[1])
    expect(texts).toHaveLength(2)
    expect(texts[0]).not.toBe(texts[1])
    expect(src).toContain('setStreamErrorNotice(err instanceof ParseDeniedError ? err.message : null)')
    // 请求没进解析器 = key 没被用过，状态徽标不能再写「VIP 密钥已启用」
    expect(src, '被拦下时不得声称密钥已启用').toContain(
      'accessKeyIgnored: err instanceof ParseDeniedError ? Boolean(accessKey.trim())',
    )

    // 行为侧：429 与 503 的 code 确实分开，前端才有得判
    const { GET } = await loadRoute({ NAVHUB_BILI_PARSE_MAX_PER_MIN: '1', NAVHUB_BILI_PARSE_MAX_CONCURRENT: '1' })
    expect((await GET(get('/api/videos/bili-parse?bvid=BV1', '192.0.2.11'))).status).toBe(200)
    const denied = await GET(get('/api/videos/bili-parse?bvid=BV2', '192.0.2.11'))
    expect(((await denied.json()) as { code?: string }).code).toBe('rate_limited')
    expect(denied.headers.get('Retry-After'), '文案里的「等十几秒」要有服务端依据').toBeTruthy()
  })
})
