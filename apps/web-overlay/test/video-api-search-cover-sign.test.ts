/**
 * `/api/videos` 搜索与 compact 路径须下发预签代理封面。
 *
 * 根因（2026-11-20 真机实测，电脑 :3002）：全局搜索 spotlight 搜 "Python" 时，
 * 视频结果缩略图用 `icon` 直链渲染；B 站 hdslb 封面 2× ERR_BLOCKED_BY_ORB
 *（i0.hdslb.com）+ 2× HTTP 403（i1.hdslb.com），同 4 个 URL 两轮复现。
 * `/api/videos?q=` 与 `compact=1` 均未给 icon 签名，与 /videos SSR 的
 * withSignedVideoIcons、`/api/videos/[id]/items` 的 signIcon 不一致；
 * spotlight 也只认 `video.icon`，不认 `mediaProxyIconUrl`。
 *
 * 修复：路由搜索路径与 compactCategory 出参时 signIcon；spotlight 优先用
 * mediaProxyIconUrl。本文件测路由侧；渲染侧由源码守卫
 * `spotlight-video-cover-proxy.test.ts` 覆盖。
 */
import { describe,
  it,
  expect,
  vi,
  afterAll } from 'vitest'

const NAV_DATA = {
  navigationItems: [
    {
      id: 'cat_ai_engineering',
      title: 'AI 与大模型工程',
      items: [
        {
          id: 'vid_python_1',
          title: 'Python 从入门到精通',
          href: 'https://www.bilibili.com/video/BV1Test001',
          icon: 'https://i0.hdslb.com/bfs/archive/test001.jpg',
          videoConfig: { type: 'bilibili', author: '测试UP主', durationSec: 3600 },
        },
        {
          id: 'vid_local_1',
          title: '本地图标视频',
          href: 'https://example.com/v/2',
          icon: '/icons/local.svg',
          videoConfig: { type: 'custom', author: '本地', durationSec: 100 },
        },
      ],
      subCategories: [],
    },
  ],
}

vi.doMock('@/lib/github', () => ({
  getFileContent: vi.fn(async () => NAV_DATA),
}))

// 同 github-hub.test.ts：路由顶层 import 了 @/lib/auth（next-auth v5 beta），
// vitest Node ESM 下 "next/server" 解析失败；GET 路径不碰 auth（verifyAdminSession
// 只在 POST 用），mock 掉即可。
vi.mock('@/lib/auth', () => ({
  auth: () => Promise.resolve(null),
  verifyAdminSession: () => Promise.resolve({ ok: false, error: 'Unauthorized', status: 401 }),
}))

const ROUTE = '@/app/api/videos/route'

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe('/api/videos 搜索结果封面签名', () => {
  it('?q= 命中项带 mediaProxyIconUrl，签名可校验', async () => {
    const { GET } = await import(ROUTE)
    const res = await GET(new Request('http://localhost/api/videos?q=python&compact=1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.videos).toHaveLength(1)
    const v = body.videos[0]
    expect(v.mediaProxyIconUrl).toMatch(/^\/api\/media\/proxy\?url=https%3A%2F%2Fi0\.hdslb\.com/)
    const { verifyMediaSignature } = await import('@/lib/media-proxy')
    const u = new URL(v.mediaProxyIconUrl, 'http://localhost')
    expect(
      verifyMediaSignature(
        decodeURIComponent(u.searchParams.get('url')!),
        u.searchParams.get('sig')!,
      ),
    ).toBe(true)
  })

  it('本地相对路径图标不签名、不改动', async () => {
    const { GET } = await import(ROUTE)
    const res = await GET(new Request('http://localhost/api/videos?q=本地&compact=1'))
    const body = await res.json()
    expect(body.videos).toHaveLength(1)
    expect(body.videos[0].mediaProxyIconUrl).toBeUndefined()
  })

  it('?compact=1 分类条目同样带预签代理封面', async () => {
    const { GET } = await import(ROUTE)
    const res = await GET(new Request('http://localhost/api/videos?compact=1'))
    const body = await res.json()
    const item = body.navigationItems[0].items[0]
    expect(item.mediaProxyIconUrl).toMatch(/^\/api\/media\/proxy\?url=/)
  })
})
