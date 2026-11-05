import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ensureHttpsUrl,
  normalizeBilibiliTarget,
  buildBilibiliEmbedUrl,
  isAllowedBilivideoStreamHost,
  parseBilibiliWithXingzhige,
  parseBilibiliWithMir6,
  parseBilibiliWithWbi,
  parseBilibiliWithNativeHtml5,
  parseBilibiliWithPc,
  parseBilibiliWithAndroid,
  resolveBilibiliHdStream,
  resolveOutboundAccessKey,
  accessKeyCacheBucket,
  clearBilibiliHdStreamCache,
  XINGZHIGE_BILI_PARSE_ENDPOINT,
} from '../src/lib/video-bilibili-hd-parser'

describe('video-bilibili-hd-parser (Xingzhige + 5 Backup Engines Auto-Failover)', () => {
  beforeEach(() => {
    clearBilibiliHdStreamCache()
  })

  it('normalizes http:// and // URLs to https:// to prevent Mixed Content warnings', () => {
    expect(ensureHttpsUrl('http://i2.hdslb.com/bfs/archive/test.jpg')).toBe(
      'https://i2.hdslb.com/bfs/archive/test.jpg'
    )
    expect(ensureHttpsUrl('//player.bilibili.com/player.html?bvid=BV1MmUSB5Efw')).toBe(
      'https://player.bilibili.com/player.html?bvid=BV1MmUSB5Efw'
    )
    expect(ensureHttpsUrl('https://upos-sz-mirrorhw.bilivideo.com/test.mp4')).toBe(
      'https://upos-sz-mirrorhw.bilivideo.com/test.mp4'
    )
    expect(ensureHttpsUrl('')).toBeUndefined()
  })

  it('normalizes bare bvid, aid, and multi-part URLs into canonical Bilibili URLs', () => {
    const fromBvid = normalizeBilibiliTarget({ bvid: 'bv1MmUSB5Efw' })
    expect(fromBvid.bvid).toBe('BV1MmUSB5Efw')
    expect(fromBvid.canonicalUrl).toBe('https://www.bilibili.com/video/BV1MmUSB5Efw')
    expect(fromBvid.p).toBe(1)

    const fromUrlWithP = normalizeBilibiliTarget({
      url: 'https://www.bilibili.com/video/BV1MmUSB5Efw?p=3',
    })
    expect(fromUrlWithP.bvid).toBe('BV1MmUSB5Efw')
    expect(fromUrlWithP.p).toBe(3)
    expect(fromUrlWithP.canonicalUrl).toBe('https://www.bilibili.com/video/BV1MmUSB5Efw?p=3')

    const fromAid = normalizeBilibiliTarget({ aid: '115609228544903' })
    expect(fromAid.aid).toBe('115609228544903')
    expect(fromAid.canonicalUrl).toBe('https://www.bilibili.com/video/av115609228544903')
  })

  it('strictly validates bilivideo CDN hostnames to prevent SSRF in /api/videos/bili-stream', () => {
    expect(
      isAllowedBilivideoStreamHost(
        'https://upos-sz-mirrorhw.bilivideo.com/upgcxcode/43/94/34249113943/34249113943-1-192.mp4?platform=html5'
      )
    ).toBe(true)
    expect(
      isAllowedBilivideoStreamHost('https://cn-gdgz-fx-01-01.bilivideo.cn/upgcxcode/test.mp4')
    ).toBe(true)
    expect(isAllowedBilivideoStreamHost('http://127.0.0.1:3000/api/internal')).toBe(false)
    expect(isAllowedBilivideoStreamHost('https://evil.example.com/bilivideo.com/test.mp4')).toBe(
      false
    )
    expect(isAllowedBilivideoStreamHost('file:///etc/passwd')).toBe(false)
  })

  it('parses Xingzhige API (Primary) response successfully', async () => {
    let requestedUrl = ''
    const mockFetch: typeof fetch = async (input) => {
      requestedUrl = String(input)
      return new Response(
        JSON.stringify({
          code: 0,
          msg: 'video',
          data: {
            bvid: 'BV1MmUSB5Efw',
            aid: 115609228544903,
            cid: 34249113943,
            video: {
              title: 'MCP协议详解与实战',
              fm: 'http://i2.hdslb.com/bfs/archive/pic.jpg',
              max_qxd: '高清 720P',
              url: 'https://upos-sz-mirrorhw.bilivideo.com/upgcxcode/test.mp4',
            },
            owner: { name: '徐庶讲AI', face: 'http://i0.hdslb.com/bfs/face/avatar.jpg' },
            stat: { view: 1910, like: 23, danmaku: 5 },
          },
        }),
        { status: 200 }
      )
    }

    // 默认配置下访客填的 key 不出站（星之阁是不受我们控制的第三方）
    const result = await parseBilibiliWithXingzhige(
      { bvid: 'BV1MmUSB5Efw', accessKey: 'test_vip_key' },
      mockFetch
    )

    expect(requestedUrl).toContain('https://api.xingzhige.com/API/b_parse/?')
    expect(requestedUrl).not.toContain('test_vip_key')
    expect(result.ok).toBe(true)
    expect(result.source).toBe('xingzhige')
    expect(result.qualityLabel).toBe('高清 720P')
    expect(result.coverUrl).toBe('https://i2.hdslb.com/bfs/archive/pic.jpg')
    expect(result.streamUrl).toBe('https://upos-sz-mirrorhw.bilivideo.com/upgcxcode/test.mp4')
  })

  it('parses Backup Engine 1: Mir6 (米人 API) response successfully', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          code: 200,
          msg: '解析成功',
          title: 'Cursor全套实战教程',
          imgurl: 'http://i2.hdslb.com/bfs/archive/mir6.jpg',
          desc: '米人解析描述',
          data: [
            {
              title: '第一讲',
              accept: ['高清 720P', '流畅 360P'],
              video_url: 'https://upos-sz-estghw.bilivideo.com/upgcxcode/mir6-stream.mp4',
            },
          ],
          user: { name: 'AI创作者', user_img: 'http://i0.hdslb.com/bfs/face/mir6.jpg' },
        }),
        { status: 200 }
      )
    }

    const result = await parseBilibiliWithMir6({ bvid: 'BV1MmUSB5Efw' }, mockFetch)
    expect(result.ok).toBe(true)
    expect(result.source).toBe('mir6')
    expect(result.qualityLabel).toBe('高清 720P')
    expect(result.title).toBe('Cursor全套实战教程')
    expect(result.coverUrl).toBe('https://i2.hdslb.com/bfs/archive/mir6.jpg')
    expect(result.streamUrl).toBe('https://upos-sz-estghw.bilivideo.com/upgcxcode/mir6-stream.mp4')
    expect(result.owner?.name).toBe('AI创作者')
  })

  it('automatically falls back from Xingzhige to Mir6 when Xingzhige fails', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input)
      if (urlStr.includes('api.xingzhige.com')) {
        return new Response(JSON.stringify({ code: -400, msg: '星之阁服务超时' }), { status: 504 })
      }
      if (urlStr.includes('api.mir6.com')) {
        return new Response(
          JSON.stringify({
            code: 200,
            msg: '解析成功',
            title: '米人备用解析成功',
            imgurl: 'https://i2.hdslb.com/bfs/archive/mir6.jpg',
            data: [{ video_url: 'https://upos-sz-mirrorhw.bilivideo.com/mir6.mp4' }],
          }),
          { status: 200 }
        )
      }
      throw new Error(`Unexpected call: ${urlStr}`)
    }

    const result = await resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw' }, mockFetch)
    expect(result.ok).toBe(true)
    expect(result.source).toBe('mir6')
    expect(result.streamUrl).toBe('https://upos-sz-mirrorhw.bilivideo.com/mir6.mp4')
  })

  it('automatically falls back to Official WBI when both Xingzhige and Mir6 fail', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input)
      if (urlStr.includes('api.xingzhige.com')) {
        throw new Error('Connection refused')
      }
      if (urlStr.includes('api.mir6.com')) {
        return new Response(JSON.stringify({ code: 500, msg: '米人服务繁忙' }), { status: 500 })
      }
      if (urlStr.includes('x/web-interface/view')) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: { bvid: 'BV1MmUSB5Efw', cid: 34249113943, title: 'WBI备用解析视频' },
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('x/player/wbi/playurl')) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              quality: 64,
              durl: [{ url: 'https://upos-sz-mirrorhw.bilivideo.com/wbi-stream.mp4' }],
            },
          }),
          { status: 200 }
        )
      }
      throw new Error(`Unexpected call: ${urlStr}`)
    }

    const result = await resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw' }, mockFetch)
    expect(result.ok).toBe(true)
    expect(result.source).toBe('bilibili_wbi')
    expect(result.qualityLabel).toBe('高清 720P')
    expect(result.streamUrl).toBe('https://upos-sz-mirrorhw.bilivideo.com/wbi-stream.mp4')
  })

  it('automatically falls back to Official HTML5 when Xingzhige, Mir6, and WBI fail', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const urlStr = String(input)
      if (urlStr.includes('api.xingzhige.com') || urlStr.includes('api.mir6.com')) {
        throw new Error('Timeout')
      }
      if (urlStr.includes('x/web-interface/view')) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: { bvid: 'BV1MmUSB5Efw', cid: 34249113943, title: 'HTML5备用视频' },
          }),
          { status: 200 }
        )
      }
      if (urlStr.includes('x/player/wbi/playurl')) {
        return new Response(JSON.stringify({ code: -352, message: '风控拦截' }), { status: 200 })
      }
      if (urlStr.includes('x/player/playurl') && urlStr.includes('platform=html5')) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              quality: 64,
              durl: [{ url: 'https://upos-sz-mirrorhw.bilivideo.com/html5-stream.mp4' }],
            },
          }),
          { status: 200 }
        )
      }
      throw new Error(`Unexpected call: ${urlStr}`)
    }

    const result = await resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw' }, mockFetch)
    expect(result.ok).toBe(true)
    expect(result.source).toBe('bilibili_html5')
    expect(result.streamUrl).toBe('https://upos-sz-mirrorhw.bilivideo.com/html5-stream.mp4')
  })

  it('respects preferredEngine when user manually specifies a backup engine (e.g. mir6)', async () => {
    let calledEngine = ''
    const mockFetch: typeof fetch = async (input: RequestInfo | URL) => {
      const urlStr = String(input)
      if (urlStr.includes('mir6.com')) {
        calledEngine = 'mir6'
        return new Response(
          JSON.stringify({
            code: 200,
            msg: '解析成功',
            data: [
              {
                title: '手动切换测试视频',
                video_url: 'https://upos-sz-mirrorhw.bilivideo.com/mir6-manual.mp4',
              },
            ],
          }),
          { status: 200 }
        )
      }
      throw new Error(`Should not call other engines, called: ${urlStr}`)
    }

    const result = await resolveBilibiliHdStream(
      { bvid: 'BV1MmUSB5Efw', preferredEngine: 'mir6' },
      mockFetch
    )
    expect(calledEngine).toBe('mir6')
    expect(result.ok).toBe(true)
    expect(result.source).toBe('mir6')
    expect(result.streamUrl).toBe('https://upos-sz-mirrorhw.bilivideo.com/mir6-manual.mp4')
  })

  it('falls back to iframe_fallback when all 6 engines fail without throwing an error', async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error('Network offline')
    }

    const result = await resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw' }, mockFetch)
    expect(result.ok).toBe(false)
    expect(result.source).toBe('iframe_fallback')
    expect(result.embedUrl).toContain('https://player.bilibili.com/player.html?')
    expect(result.embedUrl).toContain('bvid=BV1MmUSB5Efw')
    expect(result.errorReason).toContain('6 大解析引擎全部熔断失败')
  })

  it('builds https embed URL with high_quality=1 and seek parameter', () => {
    const embed = buildBilibiliEmbedUrl({
      bvid: 'BV1MmUSB5Efw',
      p: 2,
      autoplay: true,
      seekSec: 95,
    })
    expect(embed.startsWith('https://player.bilibili.com/player.html?')).toBe(true)
    expect(embed).toContain('bvid=BV1MmUSB5Efw')
    expect(embed).toContain('p=2')
    expect(embed).toContain('high_quality=1')
    expect(embed).toContain('t=95')
  })
})

/**
 * A3：`access_key` 的出站闸门与缓存分桶。
 *
 * 两条独立的红线，都在这里钉住：
 *  1) 访客贴进来的是他本人的 B 站登录凭据。默认**不**把它交给第三方解析站
 *     （星之阁 / 米人 都不受我们控制），要显式 `NAVHUB_BILI_FORWARD_USER_KEY=1`；
 *  2) 解析结果按「真正出站的那把 key」分桶。以前只分 custom/default 两档，
 *     任何两把不同的 key 共用同一份结果 = 把 A 账号的签名流地址发给 B。
 */
describe('A3：access_key 出站闸门与缓存分桶', () => {
  const xingzhigePayload = () =>
    JSON.stringify({
      code: 0,
      msg: 'video',
      data: {
        bvid: 'BV1MmUSB5Efw',
        aid: 115609228544903,
        cid: 34249113943,
        video: {
          title: 'A3 用例',
          fm: 'http://i2.hdslb.com/bfs/archive/pic.jpg',
          max_qxd: '高清 720P',
          url: 'https://upos-sz-mirrorhw.bilivideo.com/upgcxcode/test.mp4',
        },
      },
    })

  /** 只对星之阁应答，其余上游一律失败：这样出站次数与「上游看到的 key」都可直接断言 */
  function xingzhigeOnlyFetch(seen: { count: number; url: string }) {
    return (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith(XINGZHIGE_BILI_PARSE_ENDPOINT)) {
        seen.count++
        seen.url = url
        return new Response(xingzhigePayload(), { status: 200 })
      }
      throw new Error(`不该出站：${url}`)
    }) as unknown as typeof fetch
  }

  beforeEach(() => {
    clearBilibiliHdStreamCache()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('默认不把访客的 key 交给第三方解析站', () => {
    vi.stubEnv('NAVHUB_BILI_FORWARD_USER_KEY', '')
    vi.stubEnv('NAVHUB_BILIBILI_ACCESS_KEY', '')
    expect(resolveOutboundAccessKey({ bvid: 'BV1MmUSB5Efw', accessKey: 'visitor_key' })).toBe('')
  })

  it('显式开启转发后才把访客的 key 交出去', () => {
    vi.stubEnv('NAVHUB_BILI_FORWARD_USER_KEY', '1')
    expect(resolveOutboundAccessKey({ bvid: 'BV1MmUSB5Efw', accessKey: 'visitor_key' })).toBe(
      'visitor_key',
    )
  })

  it('操作者自己配的 key 照旧出站——那是部署者对自己账号的处置', () => {
    vi.stubEnv('NAVHUB_BILI_FORWARD_USER_KEY', '')
    vi.stubEnv('NAVHUB_BILIBILI_ACCESS_KEY', 'operator_key')
    // 访客没填 → 用操作者的
    expect(resolveOutboundAccessKey({ bvid: 'BV1MmUSB5Efw' })).toBe('operator_key')
    // 访客填了但转发关着 → 仍然只用操作者的，绝不把访客的夹带出去
    expect(resolveOutboundAccessKey({ bvid: 'BV1MmUSB5Efw', accessKey: 'visitor_key' })).toBe(
      'operator_key',
    )
  })

  it('上游收到的请求里没有任何访客凭据（真实出站形状）', async () => {
    vi.stubEnv('NAVHUB_BILI_FORWARD_USER_KEY', '')
    vi.stubEnv('NAVHUB_BILIBILI_ACCESS_KEY', '')
    const seen = { count: 0, url: '' }
    const result = await resolveBilibiliHdStream(
      { bvid: 'BV1MmUSB5Efw', accessKey: 'visitor_secret_key' },
      xingzhigeOnlyFetch(seen),
    )
    expect(seen.count).toBe(1)
    expect(seen.url).not.toContain('visitor_secret_key')
    expect(seen.url).not.toContain('access_key=')
    expect(result.ok).toBe(true)
  })

  it('key 被拦下时如实标注；正常情况不挂多余的 false 字段', async () => {
    vi.stubEnv('NAVHUB_BILI_FORWARD_USER_KEY', '')
    vi.stubEnv('NAVHUB_BILIBILI_ACCESS_KEY', '')
    clearBilibiliHdStreamCache()
    const ignored = await resolveBilibiliHdStream(
      { bvid: 'BV1MmUSB5Efw', accessKey: 'visitor_a' },
      xingzhigeOnlyFetch({ count: 0, url: '' }),
    )
    expect(ignored.accessKeyIgnored).toBe(true)

    clearBilibiliHdStreamCache()
    const plain = await resolveBilibiliHdStream(
      { bvid: 'BV1MmUSB5Efw' },
      xingzhigeOnlyFetch({ count: 0, url: '' }),
    )
    expect('accessKeyIgnored' in plain).toBe(false)
  })

  it('开启转发后，两把不同的 key 不共用同一份解析结果', async () => {
    vi.stubEnv('NAVHUB_BILI_FORWARD_USER_KEY', '1')
    const seen = { count: 0, url: '' }
    const fetchImpl = xingzhigeOnlyFetch(seen)

    await resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw', accessKey: 'key_A' }, fetchImpl)
    expect(seen.count).toBe(1)
    // 同一把 key：命中缓存，不再出站
    await resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw', accessKey: 'key_A' }, fetchImpl)
    expect(seen.count).toBe(1)
    // 换一把 key：必须重新出站，不能把 A 的签名流地址当成 B 的结果发出去
    await resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw', accessKey: 'key_B' }, fetchImpl)
    expect(seen.count).toBe(2)
    expect(seen.url).toContain('access_key=key_B')
  })

  it('key 被拦下时按操作者档分桶：不会和「真用了访客 key」的结果共用一条缓存', async () => {
    vi.stubEnv('NAVHUB_BILIBILI_ACCESS_KEY', '')
    vi.stubEnv('NAVHUB_BILI_FORWARD_USER_KEY', '')
    const seen = { count: 0, url: '' }
    const fetchImpl = xingzhigeOnlyFetch(seen)
    // 转发关着：访客 A 与访客 B 的 key 都没出站，结果确实同属免登录档，共用缓存是**对的**
    await resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw', accessKey: 'key_A' }, fetchImpl)
    await resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw', accessKey: 'key_B' }, fetchImpl)
    expect(seen.count).toBe(1)
    expect(seen.url).not.toContain('access_key=')
  })

  it('缓存桶是稳定摘要：同 key 同桶、异 key 异桶、无 key 归 anon', async () => {
    expect(await accessKeyCacheBucket('')).toBe('anon')
    const a = await accessKeyCacheBucket('key_A')
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(await accessKeyCacheBucket('key_A')).toBe(a)
    expect(await accessKeyCacheBucket('key_B')).not.toBe(a)
    // 原始 key 绝不进缓存键：桶里只有摘要
    expect(a).not.toContain('key_A')
  })

  it('环境没有 WebCrypto 时对带 key 的请求不缓存（宁可多解析一次也不串味）', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    try {
      Object.defineProperty(globalThis, 'crypto', {
        value: {},
        configurable: true,
        writable: true,
      })
      expect(await accessKeyCacheBucket('key_A')).toBeNull()

      vi.stubEnv('NAVHUB_BILI_FORWARD_USER_KEY', '1')
      const seen = { count: 0, url: '' }
      const fetchImpl = xingzhigeOnlyFetch(seen)
      await resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw', accessKey: 'key_A' }, fetchImpl)
      await resolveBilibiliHdStream({ bvid: 'BV1MmUSB5Efw', accessKey: 'key_A' }, fetchImpl)
      expect(seen.count, '指纹算不出来还继续缓存，就是把 A 的结果发给 B').toBe(2)
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original)
    }
  })
})
