/**
 * 媒体封面代理与 B 站视频流代理的资源上限（升级改造方案 P0-5）。
 *
 * 两条链路都是「匿名可访问的出站通道」，修复前没有任何闸门：
 *   · 媒体代理把上游响应 `arrayBuffer()` 全量读进内存：签名 URL 指向 100MB 文件
 *     就能把进程吃穿；缓存只数条目（800）不数字节，等于没有上限。
 *   · B 站流 `fetch` 不带超时（上游挂着就永久占 socket）、响应体原样透传
 *     （`bytes=0-` 就是整条视频）、公开无鉴权也无限流。
 *
 * 这里锁的是**边界本身**：413/415/504/503/429 各对应哪一条护栏、槽位是否归还、
 * 淘汰是否真的按字节发生。断言只认状态码与可观测副作用，不锁实现细节。
 *
 * 判据说明：`new Response(stream)` 构造时 undici 会按 highWaterMark 预取 1 块，
 * 所以「路由没有读体」是 pulls<=1，而不是 pulls===0。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, afterAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  clampRangeHeader,
  envPositiveInt,
  isStreamIdleTimeout,
  readWithIdleTimeout,
  StreamBudget,
  StreamIdleTimeoutError,
} from '@/lib/stream-budget'
import { generateMediaSignature } from '@/lib/media-proxy'

interface StreamCounter {
  pulls: number
  cancels: number
}

const ENV_KEYS = [
  'NAVHUB_BILI_STREAM_HEADER_TIMEOUT_MS',
  'NAVHUB_BILI_STREAM_IDLE_TIMEOUT_MS',
  'NAVHUB_BILI_STREAM_MAX_RANGE_BYTES',
  'NAVHUB_BILI_STREAM_MAX_CONCURRENT',
  'NAVHUB_BILI_STREAM_MAX_PER_MIN',
  'NAVHUB_MEDIA_PROXY_MAX_BYTES',
  'NAVHUB_MEDIA_PROXY_CACHE_BYTES',
]

function setEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) process.env[key] = value
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// 卫生兜底：本文件改写 process.env、stub 全局 fetch 并按用例 resetModules，
// 收尾统一清掉，避免同 worker 的后续文件看到残留状态。
afterAll(() => {
  vi.resetModules()
  for (const key of ENV_KEYS) delete process.env[key]
})

/** 每次 `pull` 都计数：只有真的有人在读响应体，这个数字才会超过预取的那 1 次 */
function trackedStream(chunks: Uint8Array[], counter: StreamCounter) {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      counter.pulls += 1
      if (index < chunks.length) controller.enqueue(chunks[index++])
      else controller.close()
    },
    cancel() {
      counter.cancels += 1
    },
  })
}

/**
 * 首块可给（或不给）、之后永远挂起的上游。
 * 不给首块用于测「响应头尚未发出就空闲超时」；给首块用于占住并发槽位。
 */
function stalledStream(firstChunk: Uint8Array | null, counter: StreamCounter) {
  // 每条流各自判断「首块」：counter 是用例级共享的，第二次回源时它已经不是 1
  let isHead = true
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      counter.pulls += 1
      if (isHead && firstChunk) {
        isHead = false
        controller.enqueue(firstChunk)
        return
      }
      // 返回一个永不 resolve 的 promise：读请求随之挂起
      return new Promise<void>(() => undefined)
    },
    cancel() {
      counter.cancels += 1
    },
  })
}

describe('StreamBudget 并发与每调用方窗口', () => {
  it('并发槽位用尽后拒绝为 saturated，release 后恢复', () => {
    const budget = new StreamBudget({ maxConcurrent: 2, maxPerWindow: 100, windowMs: 60_000 })
    expect(budget.tryAcquire('1.1.1.1')).toBeNull()
    expect(budget.tryAcquire('1.1.1.1')).toBeNull()
    expect(budget.snapshot()).toEqual({ active: 2, trackedKeys: 1 })
    expect(budget.tryAcquire('1.1.1.1')).toBe('saturated')
    budget.release()
    expect(budget.tryAcquire('2.2.2.2')).toBeNull()
    budget.release()
    budget.release()
    expect(budget.snapshot().active).toBe(0)
  })

  it('同一调用方超过窗口额度拒绝为 rate_limited，且不占并发槽位', () => {
    const budget = new StreamBudget({ maxConcurrent: 10, maxPerWindow: 2, windowMs: 60_000 })
    expect(budget.tryAcquire('3.3.3.3')).toBeNull()
    expect(budget.tryAcquire('3.3.3.3')).toBeNull()
    expect(budget.tryAcquire('3.3.3.3')).toBe('rate_limited')
    // 被限流的请求不该留下并发痕迹
    expect(budget.snapshot().active).toBe(2)
    // 别的调用方不受牵连
    expect(budget.tryAcquire('4.4.4.4')).toBeNull()
  })

  it('窗口滚过后同一调用方重新获得额度', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-30T00:00:00Z'))
    const budget = new StreamBudget({ maxConcurrent: 10, maxPerWindow: 1, windowMs: 1000 })
    expect(budget.tryAcquire('5.5.5.5')).toBeNull()
    expect(budget.tryAcquire('5.5.5.5')).toBe('rate_limited')
    vi.setSystemTime(new Date('2026-10-30T00:00:02Z'))
    expect(budget.tryAcquire('5.5.5.5')).toBeNull()
    vi.useRealTimers()
  })

  it('窗口表有界：海量不同 IP 不能把 Map 撑大', () => {
    const budget = new StreamBudget({
      maxConcurrent: 100,
      maxPerWindow: 5,
      windowMs: 60_000,
      maxKeys: 2,
    })
    for (let i = 0; i < 200; i++) {
      budget.tryAcquire(`10.0.${Math.floor(i / 250)}.${i % 250}`)
      budget.release()
    }
    expect(budget.snapshot().trackedKeys).toBeLessThanOrEqual(2)
  })

  it('构造参数做下界归一，release 不会把计数减成负数', () => {
    // maxConcurrent 归一到 1：第二个并发请求被拒
    const concurrent = new StreamBudget({ maxConcurrent: 0, maxPerWindow: 1000, windowMs: 60_000 })
    expect(concurrent.tryAcquire('a')).toBeNull()
    expect(concurrent.tryAcquire('a')).toBe('saturated')
    // maxPerWindow 归一到 1：同一调用方的第二个请求被拒
    const perWindow = new StreamBudget({ maxConcurrent: 100, maxPerWindow: -3, windowMs: 60_000 })
    expect(perWindow.tryAcquire('a')).toBeNull()
    expect(perWindow.tryAcquire('a')).toBe('rate_limited')
    concurrent.release()
    concurrent.release()
    concurrent.release()
    expect(concurrent.snapshot().active).toBe(0)
  })

  it('reset 恢复到初始状态', () => {
    const budget = new StreamBudget({ maxConcurrent: 1, maxPerWindow: 1, windowMs: 60_000 })
    expect(budget.tryAcquire('b')).toBeNull()
    budget.reset()
    expect(budget.snapshot()).toEqual({ active: 0, trackedKeys: 0 })
  })
})

describe('clampRangeHeader 单次转发封顶', () => {
  it('bytes=0- 这类「整条流」请求被夹到上限', () => {
    expect(clampRangeHeader('bytes=0-', 100)).toBe('bytes=0-99')
    expect(clampRangeHeader('bytes=0-999999999', 100)).toBe('bytes=0-99')
    expect(clampRangeHeader('bytes=1000-', 100)).toBe('bytes=1000-1099')
  })

  it('本就在额度内的 Range 只夹紧上界，不改语义', () => {
    expect(clampRangeHeader('bytes=100-199', 100)).toBe('bytes=100-199')
    expect(clampRangeHeader('bytes=50-150', 100)).toBe('bytes=50-149')
    expect(clampRangeHeader('  bytes=0-9  ', 100)).toBe('bytes=0-9')
  })

  it('解析不了的形态（多段/后缀/非法）原样带回，交给上游按标准处理', () => {
    expect(clampRangeHeader('bytes=0-10,20-30', 100)).toBe('bytes=0-10,20-30')
    expect(clampRangeHeader('bytes=-500', 100)).toBe('bytes=-500')
    expect(clampRangeHeader('items=0-10', 100)).toBe('items=0-10')
    expect(clampRangeHeader(null, 100)).toBeNull()
  })
})

describe('readWithIdleTimeout 与 envPositiveInt', () => {
  it('及时到达时原样返回结果', async () => {
    expect(await readWithIdleTimeout(async () => 'chunk', 50)).toBe('chunk')
  })

  it('空闲超过阈值抛 StreamIdleTimeoutError，读取失败原样透传', async () => {
    await expect(readWithIdleTimeout(() => new Promise(() => undefined), 10)).rejects.toThrow(
      StreamIdleTimeoutError
    )
    const err = await readWithIdleTimeout(() => new Promise(() => undefined), 10).catch((e) => e)
    expect(isStreamIdleTimeout(err)).toBe(true)
    const boom = new Error('上游断开')
    await expect(readWithIdleTimeout(() => Promise.reject(boom), 50)).rejects.toBe(boom)
    expect(isStreamIdleTimeout(boom)).toBe(false)
  })

  it('环境变量只接受正数，其余回落默认值', () => {
    process.env.NAVHUB_MEDIA_PROXY_MAX_BYTES = '1234'
    expect(envPositiveInt('NAVHUB_MEDIA_PROXY_MAX_BYTES', 99)).toBe(1234)
    process.env.NAVHUB_MEDIA_PROXY_MAX_BYTES = '567.9'
    expect(envPositiveInt('NAVHUB_MEDIA_PROXY_MAX_BYTES', 99)).toBe(567)
    for (const bad of ['0', '-5', 'abc', '', 'NaN', 'Infinity']) {
      process.env.NAVHUB_MEDIA_PROXY_MAX_BYTES = bad
      expect(envPositiveInt('NAVHUB_MEDIA_PROXY_MAX_BYTES', 99)).toBe(99)
    }
    delete process.env.NAVHUB_MEDIA_PROXY_MAX_BYTES
    expect(envPositiveInt('NAVHUB_MEDIA_PROXY_MAX_BYTES', 99)).toBe(99)
  })
})

describe('媒体封面代理：体积、类型与缓存字节预算', () => {
  const mediaUrl = (name: string) => `https://i0.hdslb.com/bos/article/${name}.png`

  function mockUpstream(factory: (url: string) => Response) {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        calls.push(url)
        return factory(url)
      })
    )
    return { calls }
  }

  function mediaRequest(rawUrl: string, headers?: Record<string, string>) {
    const sig = generateMediaSignature(rawUrl)
    return new Request(
      `http://localhost/api/media/proxy?url=${encodeURIComponent(rawUrl)}&sig=${sig}`,
      { headers }
    )
  }

  /** 阈值在模块加载时读取，所以每个用例都要重置注册表再重新 import */
  async function loadMedia(env: Record<string, string> = {}) {
    setEnv(env)
    vi.resetModules()
    const mod = await import('@/app/api/media/proxy/route')
    return mod.GET as (request: Request) => Promise<Response>
  }

  it('Content-Length 超限直接 413，且不开始读体', async () => {
    const counter: StreamCounter = { pulls: 0, cancels: 0 }
    mockUpstream(
      () =>
        new Response(trackedStream([new Uint8Array(64)], counter), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': '99999999' },
        })
    )
    const GET = await loadMedia({ NAVHUB_MEDIA_PROXY_MAX_BYTES: '1024' })
    const res = await GET(mediaRequest(mediaUrl('too-big')))
    expect(res.status).toBe(413)
    expect(res.headers.get('X-Media-Limit-Bytes')).toBe('1024')
    expect(counter.pulls).toBeLessThanOrEqual(1)
    expect(counter.cancels).toBe(1)
  })

  it('没有 Content-Length 时边读边限，到点即断并回 413', async () => {
    const counter: StreamCounter = { pulls: 0, cancels: 0 }
    mockUpstream(
      () =>
        new Response(
          trackedStream(
            Array.from({ length: 8 }, () => new Uint8Array(400)),
            counter
          ),
          { status: 200, headers: { 'content-type': 'image/png' } }
        )
    )
    const GET = await loadMedia({ NAVHUB_MEDIA_PROXY_MAX_BYTES: '1000' })
    const res = await GET(mediaRequest(mediaUrl('no-length')))
    expect(res.status).toBe(413)
    // 确实流式读到超限才断，而不是一开始就放弃
    expect(counter.pulls).toBeGreaterThan(1)
    expect(counter.cancels).toBe(1)
  })

  it('SVG 被挡在门外：同源代理回 SVG 等于把站外脚本变成站内 XSS', async () => {
    const counter: StreamCounter = { pulls: 0, cancels: 0 }
    mockUpstream(
      () =>
        new Response(trackedStream([new TextEncoder().encode('<svg onload="alert(1)"/>')], counter), {
          status: 200,
          headers: { 'content-type': 'image/svg+xml' },
        })
    )
    const GET = await loadMedia()
    const res = await GET(mediaRequest(mediaUrl('evil')))
    expect(res.status).toBe(415)
    expect(res.headers.get('X-Media-Content-Type')).toBe('image/svg+xml')
    expect(counter.pulls).toBeLessThanOrEqual(1)
  })

  it('带参数的 Content-Type 归一后判定；text/html 与类型缺失同样拒绝', async () => {
    mockUpstream(
      () =>
        new Response(new TextEncoder().encode('<script>x</script>'), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
    )
    const GET = await loadMedia()
    const html = await GET(mediaRequest(mediaUrl('html')))
    expect(html.status).toBe(415)
    expect(html.headers.get('X-Media-Content-Type')).toBe('text/html')

    const counter: StreamCounter = { pulls: 0, cancels: 0 }
    mockUpstream(
      () =>
        new Response(trackedStream([new Uint8Array([1, 2, 3])], counter), {
          status: 200,
          headers: {},
        })
    )
    const noType = await GET(mediaRequest(mediaUrl('no-type')))
    expect(noType.status).toBe(415)
    // 哨兵值必须是 latin1：曾写过中文，Response 构造直接抛错，415 变成 500
    expect(noType.headers.get('X-Media-Content-Type')).toBe('unknown')
    expect(counter.pulls).toBeLessThanOrEqual(1)
  })

  it('合法小图：首取 MISS、再取 HIT 且不再打上游，条件请求回 304', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
    const { calls } = mockUpstream(
      () =>
        new Response(bytes.slice(), {
          status: 200,
          headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) },
        })
    )
    const GET = await loadMedia()
    const url = mediaUrl('fresh-hit')
    const first = await GET(mediaRequest(url))
    expect(first.status).toBe(200)
    expect(first.headers.get('X-Media-Cache')).toBe('MISS')
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes)

    const etag = first.headers.get('ETag')!
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/)
    const second = await GET(mediaRequest(url))
    expect(second.status).toBe(200)
    expect(second.headers.get('X-Media-Cache')).toBe('HIT')
    expect(calls).toHaveLength(1)

    const conditional = await GET(mediaRequest(url, { 'if-none-match': etag }))
    expect(conditional.status).toBe(304)
    expect(calls).toHaveLength(1)
  })

  it('缓存按字节预算淘汰：装不下了踢最旧条目，而不是无限累加', async () => {
    const small = new Uint8Array(400)
    const { calls } = mockUpstream(
      () => new Response(small.slice(), { status: 200, headers: { 'content-type': 'image/png' } })
    )
    // 单张 400B / 单图上限 1024B / 缓存总预算 1000B：第三张必然挤掉第一张
    const GET = await loadMedia({
      NAVHUB_MEDIA_PROXY_MAX_BYTES: '1024',
      NAVHUB_MEDIA_PROXY_CACHE_BYTES: '1000',
    })
    const a = mediaUrl('budget-a')
    const b = mediaUrl('budget-b')
    const c = mediaUrl('budget-c')
    expect((await GET(mediaRequest(a))).headers.get('X-Media-Cache')).toBe('MISS')
    expect((await GET(mediaRequest(b))).headers.get('X-Media-Cache')).toBe('MISS')
    expect(calls).toHaveLength(2)
    expect((await GET(mediaRequest(c))).headers.get('X-Media-Cache')).toBe('MISS')
    expect(calls).toHaveLength(3)

    // b 仍在：说明踢的是最旧的 a，而不是把整表清空
    expect((await GET(mediaRequest(b))).headers.get('X-Media-Cache')).toBe('HIT')
    expect(calls).toHaveLength(3)
    // a 已被字节预算挤出去：重新回源
    expect((await GET(mediaRequest(a))).headers.get('X-Media-Cache')).toBe('MISS')
    expect(calls).toHaveLength(4)
  })

  it('上游非 2xx 如实降级为 502，且不会污染缓存', async () => {
    const { calls } = mockUpstream(() => new Response('nope', { status: 404 }))
    const GET = await loadMedia()
    const url = mediaUrl('missing')
    expect((await GET(mediaRequest(url))).status).toBe(502)
    expect((await GET(mediaRequest(url))).status).toBe(502)
    expect(calls).toHaveLength(2)
  })

  it('缺签名与坏签名拦在门口，且不打上游', async () => {
    const { calls } = mockUpstream(() => new Response('should not be fetched', { status: 200 }))
    const GET = await loadMedia()
    const unsigned = new Request(
      `http://localhost/api/media/proxy?url=${encodeURIComponent(mediaUrl('unsigned'))}`
    )
    expect((await GET(unsigned)).status).toBe(400)
    const tampered = new Request(
      `http://localhost/api/media/proxy?url=${encodeURIComponent(mediaUrl('tampered'))}&sig=deadbeef`
    )
    expect((await GET(tampered)).status).toBe(403)
    expect(calls).toHaveLength(0)
  })
})

describe('B 站视频流代理：超时、Range 封顶、并发与限流', () => {
  const streamUrl = 'https://denv01.bilivideo.com/upgcxcode/10/20/123456/avc.mp4'

  function biliRequest(target: string, headers: Record<string, string> = {}) {
    const url = new URL('https://app.example.com/api/videos/bili-stream')
    url.searchParams.set('url', target)
    return new NextRequest(url.toString(), { headers })
  }

  function mockUpstream(factory: (url: string, init?: RequestInit) => Response) {
    const seen: Array<{ url: string; headers: Headers }> = []
    const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      seen.push({ url, headers: new Headers(init?.headers) })
      return factory(url, init)
    })
    vi.stubGlobal('fetch', fn)
    return { seen, fn }
  }

  async function loadStream(env: Record<string, string> = {}) {
    setEnv(env)
    vi.resetModules()
    const mod = await import('@/app/api/videos/bili-stream/route')
    return {
      GET: mod.GET as (request: NextRequest) => Promise<Response>,
      HEAD: mod.HEAD as (request: NextRequest) => Promise<Response>,
    }
  }

  it('缺参数与非法域名在预算之前就被拦下，且不打上游', async () => {
    const { fn } = mockUpstream(() => new Response('nope', { status: 200 }))
    const mod = await loadStream()
    expect((await mod.GET(new NextRequest('https://app.example.com/api/videos/bili-stream'))).status).toBe(400)
    expect((await mod.GET(biliRequest('https://127.0.0.1:8787/internal.mp4'))).status).toBe(403)
    expect(fn).not.toHaveBeenCalled()
  })

  it('转发 206 分片：标记 best-effort，并把 bytes=0- 夹到单次上限', async () => {
    const counter: StreamCounter = { pulls: 0, cancels: 0 }
    const { seen } = mockUpstream(
      () =>
        new Response(trackedStream([new Uint8Array([1, 2, 3, 4])], counter), {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'accept-ranges': 'bytes',
            'content-range': 'bytes 0-99/4096',
          },
        })
    )
    const mod = await loadStream({ NAVHUB_BILI_STREAM_MAX_RANGE_BYTES: '100' })
    const res = await mod.GET(biliRequest(streamUrl, { range: 'bytes=0-', 'x-forwarded-for': '9.9.9.9' }))
    expect(res.status).toBe(206)
    expect(res.headers.get('X-NavHub-Stream-Mode')).toBe('best-effort')
    expect(res.headers.get('Content-Range')).toBe('bytes 0-99/4096')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
    // 上游收到的是夹紧后的 Range，而不是播放器原始的「整条流」
    expect(seen[0].headers.get('Range')).toBe('bytes=0-99')
    expect(seen[0].headers.get('Referer')).toBe('https://www.bilibili.com/')
  })

  it('HEAD 只回头，不带响应体', async () => {
    mockUpstream(
      () =>
        new Response(null, {
          status: 206,
          headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-0/4096' },
        })
    )
    const mod = await loadStream()
    const res = await mod.HEAD(biliRequest(streamUrl, { 'x-forwarded-for': '8.8.8.8' }))
    expect(res.status).toBe(206)
    expect(res.headers.get('X-NavHub-Stream-Mode')).toBe('best-effort')
    expect(res.body).toBeNull()
  })

  it('首块空闲超时：响应头尚未发出时如实回 504，并取消上游读取', async () => {
    const counter: StreamCounter = { pulls: 0, cancels: 0 }
    mockUpstream(
      () =>
        new Response(stalledStream(null, counter), {
          status: 206,
          headers: { 'content-type': 'video/mp4' },
        })
    )
    const mod = await loadStream({
      NAVHUB_BILI_STREAM_IDLE_TIMEOUT_MS: '30',
      NAVHUB_BILI_STREAM_HEADER_TIMEOUT_MS: '5000',
    })
    const res = await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '7.7.7.7' }))
    expect(res.status).toBe(504)
    expect((await res.json()).error).toContain('回退直链')
    expect(counter.cancels).toBe(1)
  })

  /**
   * 首块超时之外还有「响应头都没回来」这一段：这一段的闸门是 fetchWithHeaderTimeout。
   * 上游挂着不回 ⇒ 必须到点 abort、如实回 502，并把槽位还回去；
   * 少还一次，一次挂住的上游就永久吃掉一格并发。
   */
  it('响应头阶段挂住：到点 abort 并回 502，并发槽位照样归还', async () => {
    let attempts = 0
    let aborted = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        attempts += 1
        if (attempts === 1) {
          // 真实 fetch 的语义：signal 被 abort 时请求以 AbortError 结束，而不是永远挂着
          return await new Promise<Response>((_resolve, reject) => {
            const onAbort = () => {
              aborted += 1
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            }
            const signal = init?.signal
            if (signal?.aborted) onAbort()
            else signal?.addEventListener('abort', onAbort, { once: true })
          })
        }
        return new Response(new Uint8Array([3, 3]), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        })
      })
    )
    const mod = await loadStream({
      NAVHUB_BILI_STREAM_HEADER_TIMEOUT_MS: '30',
      NAVHUB_BILI_STREAM_MAX_CONCURRENT: '1',
    })
    const stuck = await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '2.2.2.1' }))
    expect(stuck.status).toBe(502)
    expect(typeof (await stuck.json()).error).toBe('string')
    expect(aborted).toBe(1)

    const next = await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '2.2.2.2' }))
    expect(next.status).toBe(200)
    await next.body?.cancel()
  })

  it('并发满回 503；客户端断开归还槽位后立刻可用', async () => {
    const counter: StreamCounter = { pulls: 0, cancels: 0 }
    mockUpstream(
      () =>
        new Response(stalledStream(new Uint8Array([9, 9]), counter), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        })
    )
    const mod = await loadStream({
      NAVHUB_BILI_STREAM_MAX_CONCURRENT: '1',
      NAVHUB_BILI_STREAM_MAX_PER_MIN: '50',
    })
    const held = await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '6.6.6.1' }))
    expect(held.status).toBe(200)

    const denied = await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '6.6.6.2' }))
    expect(denied.status).toBe(503)
    expect((await denied.json()).error).toContain('改用直链')
    expect(denied.headers.get('Retry-After')).toBe('5')

    // 不读响应体 ⇒ 槽位一直被占；客户端断开（cancel）后才归还
    await held.body?.cancel()
    const after = await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '6.6.6.3' }))
    expect(after.status).toBe(200)
    await after.body?.cancel()
  })

  it('同一 IP 超窗口额度回 429，别的 IP 不受牵连', async () => {
    mockUpstream(
      () => new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'video/mp4' } })
    )
    const mod = await loadStream({
      NAVHUB_BILI_STREAM_MAX_PER_MIN: '2',
      NAVHUB_BILI_STREAM_MAX_CONCURRENT: '10',
    })
    expect((await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '5.5.5.1' }))).status).toBe(200)
    expect((await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '5.5.5.2' }))).status).toBe(200)
    expect((await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '5.5.5.2' }))).status).toBe(200)
    const limited = await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '5.5.5.2' }))
    expect(limited.status).toBe(429)
    expect((await limited.json()).error).toContain('频繁')
    expect((await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '5.5.5.9' }))).status).toBe(200)
  })

  it('上游 5xx 如实透传状态并归还槽位（漏还等于永久吃掉并发额度）', async () => {
    let fail = true
    mockUpstream(
      () =>
        fail
          ? new Response('upstream down', { status: 500 })
          : new Response(new Uint8Array([7, 7]), {
              status: 200,
              headers: { 'content-type': 'video/mp4' },
            })
    )
    const mod = await loadStream({ NAVHUB_BILI_STREAM_MAX_CONCURRENT: '1' })
    const bad = await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '4.4.4.4' }))
    expect(bad.status).toBe(500)
    fail = false
    const good = await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '4.4.4.4' }))
    expect(good.status).toBe(200)
    await good.body?.cancel()
  })

  it('重定向逐跳校验：跳到内网地址即 403，绝不代为请求', async () => {
    const { seen } = mockUpstream((url) =>
      url.includes('bilivideo.com')
        ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8787/probe' } })
        : new Response('should never be fetched', { status: 200 })
    )
    const mod = await loadStream()
    const res = await mod.GET(biliRequest(streamUrl, { 'x-forwarded-for': '3.3.3.3' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('白名单')
    expect(seen.map((entry) => entry.url)).toEqual([streamUrl])
  })

  it('超时只覆盖响应头阶段：不能用一个贯穿全程的 signal 掐断正在播放的流', () => {
    const HERE = dirname(fileURLToPath(import.meta.url))
    const relative = join('src', 'app', 'api', 'videos', 'bili-stream', 'route.ts')
    const candidates = [resolve(HERE, '..', '..', 'web-overlay'), resolve(HERE, '..')]
    const root = candidates.find((p) => existsSync(join(p, relative)))
    if (!root) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
    const src = readFileSync(join(root, relative), 'utf8')
    // 注释里会正名讨论「AbortSignal.timeout 为什么不能用」，只拦真代码
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/AbortSignal\.timeout/)
    expect(code).toMatch(/clearTimeout\(timer\)/)
    expect(code).toMatch(/readWithIdleTimeout/)
    // 交棒给流之后由流自己归还，其余出口统一在 finally 归还
    expect(code).toMatch(/if \(!handedOff\) STREAM_BUDGET\.release\(\)/)
  })
})
